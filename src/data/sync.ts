import { useSyncExternalStore } from 'react';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, type Auth, type User } from 'firebase/auth';
import {
  arrayUnion,
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  deleteField,
  doc,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  setDoc,
  type DocumentReference,
  type Firestore,
  type QuerySnapshot,
  type SnapshotMetadata,
} from 'firebase/firestore';
import { waitMinutes } from '../domain/inventory';
import { localDate } from '../domain/loyalty';
import type { Order } from '../domain/types';
import { applyRemote, enableOutbox, getState, isWiped, openDay, replayOutbox, setRemote, type Collection, type Op } from './store';
import { emulatorConfig, firebaseConfig, localOnly, useEmulator } from './firebase-config';

/**
 * Sync between devices (laptop ⇄ kitchen tablet ⇄ CFO phone) through
 * Firebase Firestore.
 *
 *  - Every change is still saved on the device first (store.ts), so the
 *    booth keeps working with no internet.
 *  - Firestore's own offline cache queues writes and sends them when the
 *    internet comes back; other devices get them within about a second.
 *  - Each device signs in once with the shared booth account; the rules in
 *    firestore.rules only let that account read or write.
 *
 * Layout in Firestore: settings/main, days/{dayId}, orders/{orderId}, cards/{cardId},
 * cashMoves/{id}. Public (customer page, no login): tracker/{mode_date_number}
 * and public/booth-{mode}, holding only order numbers, status and wait times.
 */

// ---------- Status shown in the top bar ----------

export type SyncStatus = { label: string; detail: string; connected: boolean; needsSignIn?: boolean };

const LOCAL_ONLY: SyncStatus = {
  label: 'This device only',
  detail: 'Firebase is not set up yet. The cashier and monitor windows on this laptop are in sync; the kitchen tablet is not.',
  connected: false,
};

let status: SyncStatus = LOCAL_ONLY;
const statusListeners = new Set<() => void>();

export function setSyncStatus(next: SyncStatus) {
  status = next;
  for (const l of statusListeners) l();
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    () => status,
  );
}

// ---------- Booth login ----------

export type AuthState = { enabled: boolean; ready: boolean; email: string | null };
let authState: AuthState = { enabled: false, ready: true, email: null };
const authListeners = new Set<() => void>();

function setAuthState(next: AuthState) {
  authState = next;
  for (const l of authListeners) l();
}

export function useAuthState(): AuthState {
  return useSyncExternalStore(
    (cb) => {
      authListeners.add(cb);
      return () => authListeners.delete(cb);
    },
    () => authState,
  );
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

export async function signInBooth(email: string, password: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!auth) return { ok: false, message: 'Sync is not set up on this app yet.' };
  try {
    await signInWithEmailAndPassword(auth, email.trim(), password);
    return { ok: true };
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code.includes('network')) return { ok: false, message: 'No internet. Connect once to sign in; after that the app works offline.' };
    if (code.includes('too-many-requests')) return { ok: false, message: 'Too many tries. Wait a minute and try again.' };
    if (code.includes('invalid') || code.includes('wrong-password') || code.includes('user-not-found')) return { ok: false, message: 'Wrong email or password.' };
    return { ok: false, message: `Could not sign in (${code || 'unknown error'}).` };
  }
}

/** The shared database, for the public customer page (null when sync is not set up). */
export function publicDb(): Firestore | null {
  return db;
}

export async function signOutBooth() {
  if (auth) await signOut(auth);
}

// ---------- Firestore adapter ----------

/** Firestore rejects `undefined`; JSON drops it (and nothing else we store). */
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** A patch for a merge write: a field set to `undefined` means "remove it". */
function patchFields(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) out[k] = v === undefined ? deleteField() : plain(v);
  return out;
}

function ref(col: Collection, id: string): DocumentReference {
  return col === 'settings' ? doc(db!, 'settings', 'main') : doc(db!, col, id);
}

let writeError: string | null = null;
/** True when writeError came from a failed write (not from a listener). */
let writeFailed = false;

function push(op: Op) {
  if (!db) return;
  const r = ref(op.col, op.id);
  const done =
    op.type === 'put'
      ? setDoc(r, plain(op.doc) as Record<string, unknown>)
      : op.type === 'patch'
        ? setDoc(r, patchFields(op.patch), { merge: true })
        : op.type === 'append'
          ? // The server adds the entry to whatever list it has, so two devices never overwrite each other.
            setDoc(r, { [op.field]: arrayUnion(plain(op.item)) }, { merge: true })
          : deleteDoc(r);
  if (op.col === 'orders') publishTracker(op.id);
  if (op.col === 'orders' || op.col === 'days' || op.col === 'settings') scheduleBoothSummary();
  done.then(() => {
    // A later write that goes through means the earlier problem is over.
    if (writeError && writeFailed) {
      writeError = null;
      writeFailed = false;
      updateStatus();
    }
  }).catch((e: { code?: string; message?: string }) => {
    if (e.code === 'permission-denied' && op.col === 'cashMoves') {
      // Rules not published yet: the entry is still saved on this device.
      cashBlocked = true;
      updateStatus();
      return;
    }
    writeError = e.code === 'permission-denied' ? 'This login is not allowed to save. Sign in with the booth account.' : `Sync error: ${e.message ?? e.code}`;
    writeFailed = true;
    console.error('sync write failed', e);
    updateStatus();
  });
}

/** True while the Firebase rules do not allow cash in/out yet (shown as a note; everything else syncs). */
let cashBlocked = false;

// ---------- Public copy for the customer page ----------
// Customers are not signed in, so they can never read the booth data. The
// device that changes an order also writes a tiny public copy of it: the
// order number, its status and its times. No names, items or money.

let publicBlocked = false;

function publicWrite(path: [string, string], data: Record<string, unknown>) {
  if (!db) return;
  setDoc(doc(db, path[0], path[1]), data).catch((e: { code?: string }) => {
    // Until the new rules are published this fails; the booth keeps working.
    if (!publicBlocked) console.warn('customer page copy not saved', e);
    if (e.code === 'permission-denied' && !publicBlocked) {
      publicBlocked = true;
      updateStatus();
    }
  });
}

/** The id customers look up: mode, date and order number, e.g. live_2026-11-23_A-012. */
export function trackerId(mode: string, date: string, number: string): string {
  return `${mode}_${date}_${number.toUpperCase()}`;
}

export type TrackerDoc = { number: string; status: Order['status'] | 'voided'; createdAt: number; readyAt: number | null; claimedAt: number | null; spinsLeft: number; updatedAt: number };

function publishTracker(orderId: string) {
  const o = getState().orders[orderId];
  if (!o) return;
  const data: TrackerDoc = {
    number: o.number,
    status: o.voided ? 'voided' : o.status,
    createdAt: o.createdAt,
    readyAt: o.readyAt ?? null,
    claimedAt: o.claimedAt ?? null,
    spinsLeft: Math.max(0, o.spinsEarned - o.spins.length),
    updatedAt: Date.now(),
  };
  publicWrite(['tracker', trackerId(o.mode, localDate(o.createdAt), o.number)], data);
}

export type BoothDoc = {
  open: boolean;
  date: string | null;
  /** Orders in the kitchen, oldest first. */
  queue: string[];
  /** Ready and not picked up yet, newest first (at most 10). */
  ready: string[];
  waitMinutes: number;
  soldOut: string[];
  updatedAt: number;
};

let boothTimer: ReturnType<typeof setTimeout> | null = null;
let lastBooth = '';
const BOOTH_EVERY_MS = 20000;

/** Sold out, queue, ready numbers and wait time for the customer page, at most every 20 seconds. */
let boothSentAt = 0;

function scheduleBoothSummary() {
  if (boothTimer) return;
  // Right away if nothing was sent in the last 20 seconds, otherwise at the end of them.
  const wait = Math.max(0, BOOTH_EVERY_MS - (Date.now() - boothSentAt));
  boothTimer = setTimeout(sendBoothSummary, wait);
}

// A device closing or going to the background sends what is waiting first.
if (typeof addEventListener === 'function') {
  addEventListener('pagehide', () => boothTimer && sendBoothSummary());
  addEventListener('visibilitychange', () => typeof document !== 'undefined' && document.visibilityState === 'hidden' && boothTimer && sendBoothSummary());
}

function sendBoothSummary() {
  if (boothTimer) clearTimeout(boothTimer);
  boothTimer = null;
  const st = getState();
  const day = openDay(st);
  const todays = day ? Object.values(st.orders).filter((o) => o.dayId === day.id && !o.voided) : [];
  const summary: Omit<BoothDoc, 'updatedAt'> = {
    open: !!day,
    date: day?.date ?? null,
    queue: todays.filter((o) => o.status === 'new' || o.status === 'cooking').sort((a, b) => a.createdAt - b.createdAt).map((o) => o.number),
    ready: todays.filter((o) => o.status === 'ready').sort((a, b) => (b.readyAt ?? 0) - (a.readyAt ?? 0)).slice(0, 10).map((o) => o.number),
    waitMinutes: waitMinutes(todays, Date.now(), st.settings.defaultWaitMinutes),
    soldOut: st.settings.menu.filter((m) => m.active && day?.soldOut[m.id]).map((m) => m.name),
  };
  const key = JSON.stringify(summary);
  if (key === lastBooth) return;
  lastBooth = key;
  boothSentAt = Date.now();
  publicWrite(['public', `booth-${st.settings.mode}`], { ...summary, updatedAt: Date.now() });
}

// What each listener last told us, to show one combined status.
const meta: Partial<Record<Collection, SnapshotMetadata>> = {};
let unsubscribers: (() => void)[] = [];

function updateStatus() {
  if (!authState.email) return;
  if (writeError) return setSyncStatus({ label: 'Sync problem', detail: writeError, connected: false });
  const all = Object.values(meta);
  const pending = all.some((m) => m?.hasPendingWrites);
  const offline = all.length < (cashBlocked ? 4 : 5) || all.some((m) => m?.fromCache);
  const notes = [
    cashBlocked && 'Cash in/out entries stay on this device until the new Firebase rules are published (see docs/PLAN.md).',
    publicBlocked && 'The customer order page is not switched on yet: publish the new Firebase rules (see docs/PLAN.md).',
  ].filter(Boolean);
  if (offline) setSyncStatus({ label: pending ? 'Offline · will sync' : 'Offline · up to date here', detail: 'Changes are saved on this device and will be sent when the internet is back.', connected: false });
  else if (pending) setSyncStatus({ label: 'Syncing…', detail: 'Sending the latest changes to the other devices.', connected: true });
  else
    setSyncStatus({
      label: 'Synced',
      detail: [`All devices up to date. Signed in as ${authState.email}.`, ...notes].join(' '),
      connected: true,
    });
}

/**
 * The first time we hear from the server, upload anything this device has
 * that the server doesn't (e.g. orders taken offline before sync was set up).
 * After that, the server's copy wins for every document.
 */
const uploadedOnce: Partial<Record<Collection, boolean>> = {};

function onCollection(col: 'orders' | 'days' | 'cards' | 'cashMoves', snap: QuerySnapshot) {
  meta[col] = snap.metadata;
  const ops: Op[] = [];
  const removed = new Set<string>();
  for (const ch of snap.docChanges()) {
    if (ch.type === 'removed') {
      removed.add(ch.doc.id);
      ops.push({ type: 'remove', col, id: ch.doc.id });
    } else if (isWiped(col, ch.doc.data())) {
      // A device that missed "Start fresh" uploaded it again: remove it for good.
      removed.add(ch.doc.id);
      push({ type: 'remove', col, id: ch.doc.id });
    } else ops.push({ type: 'put', col, id: ch.doc.id, doc: ch.doc.data() });
  }
  if (!snap.metadata.fromCache && !uploadedOnce[col]) {
    uploadedOnce[col] = true;
    const onServer = new Set(snap.docs.map((d) => d.id));
    for (const [id, d] of Object.entries(getState()[col])) {
      // Something another device just deleted must not be sent back up.
      if (!onServer.has(id) && !removed.has(id) && !isWiped(col, d)) push({ type: 'put', col, id, doc: d });
    }
  }
  const firstFromServer = !snap.metadata.fromCache && !replayed[col];
  applyRemote(ops);
  if (firstFromServer) {
    // Only now that the shared copy is here: send what this device changed while signed out.
    replayed[col] = true;
    replayOutbox(col);
  }
  updateStatus();
}

const replayed: Partial<Record<Collection, boolean>> = {};

function attach() {
  if (!db) return;
  setRemote({ push });
  const opts = { includeMetadataChanges: true };
  unsubscribers = [
    onSnapshot(collection(db, 'orders'), opts, (s) => onCollection('orders', s), (e) => onListenError(e)),
    onSnapshot(collection(db, 'days'), opts, (s) => onCollection('days', s), (e) => onListenError(e)),
    onSnapshot(collection(db, 'cards'), opts, (s) => onCollection('cards', s), (e) => onListenError(e, 'cards')),
    onSnapshot(collection(db, 'cashMoves'), opts, (s) => onCollection('cashMoves', s), (e) => onListenError(e, 'cashMoves')),
    onSnapshot(
      doc(db, 'settings', 'main'),
      opts,
      (s) => {
        meta.settings = s.metadata;
        const first = !s.metadata.fromCache && !uploadedOnce.settings;
        if (s.exists()) {
          // The shared setup always wins: a spare tablet with default prices
          // and passcodes must never replace the booth's real ones.
          if (first) uploadedOnce.settings = true;
          applyRemote([{ type: 'put', col: 'settings', id: 'main', doc: s.data() }]);
        } else if (first) {
          // First device to connect: its settings (menu, prices, PINs) become the shared ones.
          uploadedOnce.settings = true;
          push({ type: 'put', col: 'settings', id: 'main', doc: getState().settings });
        }
        updateStatus();
      },
      (e) => onListenError(e),
    ),
  ];
}

function onListenError(e: { code?: string; message?: string }, what?: 'cards' | 'cashMoves') {
  if (what === 'cashMoves' && e.code === 'permission-denied') {
    cashBlocked = true;
    console.warn('cash in/out cannot sync yet', e);
    updateStatus();
    return;
  }
  writeError =
    e.code === 'permission-denied'
      ? what === 'cards'
        ? 'Loyalty card names cannot sync yet: the Firebase rules need the "cards" update (see docs/PLAN.md).'
        : 'This login is not allowed to read the booth data. Sign in with the booth account.'
      : `Sync error: ${e.message ?? e.code}`;
  writeFailed = false;
  console.error('sync listen failed', e);
  updateStatus();
}

function detach() {
  for (const u of unsubscribers) u();
  unsubscribers = [];
  setRemote(null);
  for (const k of Object.keys(meta) as Collection[]) delete meta[k];
  for (const k of Object.keys(uploadedOnce) as Collection[]) delete uploadedOnce[k];
  for (const k of Object.keys(replayed) as Collection[]) delete replayed[k];
  cashBlocked = false;
  writeError = null;
  writeFailed = false;
}

export function startSync() {
  const config = useEmulator ? emulatorConfig : localOnly ? null : firebaseConfig;
  if (!config) {
    setAuthState({ enabled: false, ready: true, email: null });
    setSyncStatus(LOCAL_ONLY);
    return;
  }
  setAuthState({ enabled: true, ready: false, email: null });
  // From now on, changes made while signed out wait and are sent on sign-in.
  enableOutbox(true);
  app = initializeApp(config);
  auth = getAuth(app);
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  if (useEmulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  onAuthStateChanged(auth, (user: User | null) => {
    detach();
    setAuthState({ enabled: true, ready: true, email: user?.email ?? null });
    if (user) {
      setSyncStatus({ label: 'Connecting…', detail: 'Loading the latest data from the other devices.', connected: false });
      attach();
    } else {
      setSyncStatus({ label: 'Not signed in · this device only', detail: 'Sign in with the booth account to sync with the other devices.', connected: false, needsSignIn: true });
    }
  });
}

/**
 * The customer page on a customer's phone: no login, no booth data, only the
 * public copy. Starts Firebase without the booth listeners.
 */
export function startPublic(): Firestore | null {
  if (db) return db;
  const config = useEmulator ? emulatorConfig : localOnly ? null : firebaseConfig;
  if (!config) return null;
  app = initializeApp(config);
  db = initializeFirestore(app, {});
  if (useEmulator) connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return db;
}
