import { useSyncExternalStore } from 'react';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, type Auth, type User } from 'firebase/auth';
import {
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
import { applyRemote, getState, setRemote, type Collection, type Op } from './store';
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
 * Layout in Firestore: settings/main, days/{dayId}, orders/{orderId}, cards/{cardId}.
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

function push(op: Op) {
  if (!db) return;
  const r = ref(op.col, op.id);
  const done =
    op.type === 'put'
      ? setDoc(r, plain(op.doc) as Record<string, unknown>)
      : op.type === 'patch'
        ? setDoc(r, patchFields(op.patch), { merge: true })
        : deleteDoc(r);
  done.catch((e: { code?: string; message?: string }) => {
    writeError = e.code === 'permission-denied' ? 'This login is not allowed to save. Sign in with the booth account.' : `Sync error: ${e.message ?? e.code}`;
    console.error('sync write failed', e);
    updateStatus();
  });
}

// What each listener last told us, to show one combined status.
const meta: Partial<Record<Collection, SnapshotMetadata>> = {};
let unsubscribers: (() => void)[] = [];

function updateStatus() {
  if (!authState.email) return;
  if (writeError) return setSyncStatus({ label: 'Sync problem', detail: writeError, connected: false });
  const all = Object.values(meta);
  const pending = all.some((m) => m?.hasPendingWrites);
  const offline = all.length < 4 || all.some((m) => m?.fromCache);
  if (offline) setSyncStatus({ label: pending ? 'Offline · will sync' : 'Offline · up to date here', detail: 'Changes are saved on this device and will be sent when the internet is back.', connected: false });
  else if (pending) setSyncStatus({ label: 'Syncing…', detail: 'Sending the latest changes to the other devices.', connected: true });
  else setSyncStatus({ label: 'Synced', detail: `All devices up to date. Signed in as ${authState.email}.`, connected: true });
}

/**
 * The first time we hear from the server, upload anything this device has
 * that the server doesn't (e.g. orders taken offline before sync was set up).
 * After that, the server's copy wins for every document.
 */
const uploadedOnce: Partial<Record<Collection, boolean>> = {};

function onCollection(col: 'orders' | 'days' | 'cards', snap: QuerySnapshot) {
  meta[col] = snap.metadata;
  const ops: Op[] = [];
  for (const ch of snap.docChanges()) {
    if (ch.type === 'removed') ops.push({ type: 'remove', col, id: ch.doc.id });
    else ops.push({ type: 'put', col, id: ch.doc.id, doc: ch.doc.data() });
  }
  if (!snap.metadata.fromCache && !uploadedOnce[col]) {
    uploadedOnce[col] = true;
    const onServer = new Set(snap.docs.map((d) => d.id));
    for (const [id, d] of Object.entries(getState()[col])) {
      if (!onServer.has(id)) push({ type: 'put', col, id, doc: d });
    }
  }
  applyRemote(ops);
  updateStatus();
}

function attach() {
  if (!db) return;
  setRemote({ push });
  const opts = { includeMetadataChanges: true };
  unsubscribers = [
    onSnapshot(collection(db, 'orders'), opts, (s) => onCollection('orders', s), (e) => onListenError(e)),
    onSnapshot(collection(db, 'days'), opts, (s) => onCollection('days', s), (e) => onListenError(e)),
    onSnapshot(collection(db, 'cards'), opts, (s) => onCollection('cards', s), (e) => onListenError(e, 'cards')),
    onSnapshot(
      doc(db, 'settings', 'main'),
      opts,
      (s) => {
        meta.settings = s.metadata;
        if (s.exists()) applyRemote([{ type: 'put', col: 'settings', id: 'main', doc: s.data() }]);
        else if (!s.metadata.fromCache && !uploadedOnce.settings) {
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

function onListenError(e: { code?: string; message?: string }, what?: 'cards') {
  writeError =
    e.code === 'permission-denied'
      ? what === 'cards'
        ? 'Loyalty card names cannot sync yet: the Firebase rules need the "cards" update (see docs/PLAN.md).'
        : 'This login is not allowed to read the booth data. Sign in with the booth account.'
      : `Sync error: ${e.message ?? e.code}`;
  console.error('sync listen failed', e);
  updateStatus();
}

function detach() {
  for (const u of unsubscribers) u();
  unsubscribers = [];
  setRemote(null);
  for (const k of Object.keys(meta) as Collection[]) delete meta[k];
  for (const k of Object.keys(uploadedOnce) as Collection[]) delete uploadedOnce[k];
  writeError = null;
}

export function startSync() {
  const config = useEmulator ? emulatorConfig : localOnly ? null : firebaseConfig;
  if (!config) {
    setAuthState({ enabled: false, ready: true, email: null });
    setSyncStatus(LOCAL_ONLY);
    return;
  }
  setAuthState({ enabled: true, ready: false, email: null });
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
