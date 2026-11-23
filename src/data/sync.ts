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
  type DocumentSnapshot,
  type Firestore,
  type QuerySnapshot,
  type SnapshotMetadata,
} from 'firebase/firestore';
import { cardStateFor } from '../domain/cards';
import { MENU_VERSION } from '../domain/defaults';
import { waitMinutes } from '../domain/inventory';
import { itemProgress } from '../domain/kitchen';
import { availableRewards, findVoucher, localDate, voucherTerms } from '../domain/loyalty';
import { isAvailable, stockLeft } from '../domain/reports';
import type { DataMode, Order } from '../domain/types';
import { applyRemote, enableOutbox, getState, isWiped, openDay, replayOutbox, requeue, setRemote, type Collection, type Op } from './store';
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
 * for one order (number, first name, status, how many items are done),
 * tracker/card_{mode}_{number} for a Boom Card's stamps, tracker/voucher_{code}
 * for a voucher, and public/booth-{mode} for the queue and the menu. No money,
 * no full names, no phone numbers; each one can only be read by its exact id.
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

/** The last write the server refused, until a later write goes through. */
let writeError: string | null = null;
/** Listeners the server refused, by collection, until they connect again. */
const listenProblem: Partial<Record<Collection, string>> = {};

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
  if (op.col === 'orders') publishOrder(op.id);
  if (op.col === 'cards') publishCardDoc(op.id);
  // A day opening or closing is told to customers at once; the rest at most every 20 seconds.
  if (op.col === 'days') scheduleBoothSummary(true);
  else if (op.col === 'orders' || op.col === 'settings') scheduleBoothSummary();
  done.then(() => {
    // A later write that goes through means the earlier problem is over.
    if (writeError) {
      writeError = null;
      updateStatus();
    }
  }).catch((e: { code?: string; message?: string }) => {
    // Refused for good (wrong login, rules not published): keep the change so
    // it is sent again on the next connection instead of being undone.
    if (e.code === 'permission-denied' || e.code === 'unauthenticated') requeue(op);
    if (e.code === 'permission-denied' && op.col === 'cashMoves') {
      // Rules not published yet: the entry is still saved on this device.
      cashBlocked = true;
      updateStatus();
      return;
    }
    writeError = e.code === 'permission-denied' ? 'This login is not allowed to save. Sign in with the booth account. Changes made meanwhile are kept on this device and sent after signing in again.' : `Sync error: ${e.message ?? e.code}`;
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
/** What was last written to each public document, so the same thing is not written twice. */
const lastPublic = new Map<string, string>();

function publicWrite(path: [string, string], data: Record<string, unknown>) {
  if (!db) return;
  const key = path.join('/');
  const json = JSON.stringify(data);
  if (lastPublic.get(key) === json) return;
  lastPublic.set(key, json);
  setDoc(doc(db, path[0], path[1]), { ...data, updatedAt: Date.now() }).catch((e: { code?: string }) => {
    lastPublic.delete(key);
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

/** Public copy of a Boom Card's stamps: tracker/card_live_CCB-037. */
export function publicCardId(mode: string, number: string): string {
  return `card_${mode}_${number.toUpperCase()}`;
}

/** Public copy of a voucher: tracker/voucher_V-ABCD. */
export function publicVoucherId(code: string): string {
  return `voucher_${code.toUpperCase()}`;
}

export type TrackerDoc = {
  number: string;
  status: Order['status'] | 'voided';
  createdAt: number;
  readyAt: number | null;
  claimedAt: number | null;
  spinsLeft: number;
  updatedAt: number;
  // Added later: a copy written by an older version of the app has none of these.
  /** The customer's first name. */
  name?: string | null;
  /** Items the kitchen has finished, and items in the order. */
  done?: number;
  total?: number;
};

/** A Boom Card as the customer sees it: stamps and rewards only, never the owner's name. */
export type PublicCard = {
  kind: 'card';
  number: string;
  stamps: number;
  size: number;
  /** Rewards that can be used now. */
  ready: string[];
  /** The next reward and how many more stamps it needs. */
  next: { label: string; more: number } | null;
  updatedAt: number;
};

export type PublicVoucher = {
  kind: 'voucher';
  code: string;
  /** False when the prize was undone or its order was voided. */
  valid: boolean;
  label: string;
  minOrder: number;
  needsCombo: boolean;
  validFrom: string;
  validTo: string;
  used: boolean;
  /** Won on a practice order: not a real voucher. */
  practice: boolean;
  updatedAt: number;
};

function ordersOf(mode: DataMode): Order[] {
  return Object.values(getState().orders).filter((o) => o.mode === mode);
}

function publishTracker(o: Order) {
  const p = itemProgress(o);
  const data: Omit<TrackerDoc, 'updatedAt'> = {
    number: o.number,
    status: o.voided ? 'voided' : o.status,
    createdAt: o.createdAt,
    readyAt: o.readyAt ?? null,
    claimedAt: o.claimedAt ?? null,
    spinsLeft: Math.max(0, o.spinsEarned - o.spins.length),
    name: o.customerName ?? null,
    done: p.done,
    total: p.total,
  };
  publicWrite(['tracker', trackerId(o.mode, localDate(o.createdAt), o.number)], data);
}

/** Stamps and rewards of one card, worked out from its orders like everywhere else. */
export function publishCard(mode: DataMode, number: string) {
  if (!db) return;
  const st = getState();
  const s = st.settings;
  const cards = Object.values(st.cards).filter((c) => c.mode === mode);
  const cs = cardStateFor(number, ordersOf(mode), s, cards);
  const next = s.loyalty.rewards.filter((r) => r.at > cs.stamps && !cs.used.includes(r.at)).sort((a, b) => a.at - b.at)[0];
  const data: Omit<PublicCard, 'updatedAt'> = {
    kind: 'card',
    number,
    stamps: cs.stamps,
    size: s.loyalty.cardSize,
    ready: availableRewards(cs, s).map((r) => r.label),
    next: next ? { label: next.label, more: next.at - cs.stamps } : null,
  };
  publicWrite(['tracker', publicCardId(mode, number)], data);
}

/** A change to a card record (name, stamp edit). Its id is "<mode>_<number>". */
function publishCardDoc(cardDocId: string) {
  const i = cardDocId.indexOf('_');
  const mode = cardDocId.slice(0, i);
  if (i > 0 && (mode === 'demo' || mode === 'live')) publishCard(mode, cardDocId.slice(i + 1));
}

function publishVoucher(mode: DataMode, code: string) {
  const s = getState().settings;
  const orders = ordersOf(mode);
  const v = findVoucher(code, orders, s);
  const spin = v ? orders.flatMap((o) => (o.voided ? [] : o.spins)).find((x) => x.voucherCode === v.code) : undefined;
  const t = spin ? voucherTerms(spin, s) : null;
  const data: Omit<PublicVoucher, 'updatedAt'> = {
    kind: 'voucher',
    code,
    valid: !!(v && t),
    label: t?.label ?? '',
    minOrder: t?.minOrder ?? 0,
    needsCombo: t?.needsCombo ?? false,
    validFrom: t?.validFrom ?? '',
    validTo: t?.validTo ?? '',
    used: !!v?.usedBy,
    practice: mode === 'demo',
  };
  publicWrite(['tracker', publicVoucherId(code)], data);
}

/** Voucher codes each order had when it was last published, so an undone prize is taken back too. */
const orderVouchers = new Map<string, string[]>();

/** Everything the customer page shows that this order touches: the order itself, its Boom Card and its vouchers. */
function publishOrder(orderId: string) {
  const o = getState().orders[orderId];
  if (!o) return;
  publishTracker(o);
  if (o.cardId) publishCard(o.mode, o.cardId);
  const codes = [...o.spins.flatMap((x) => (x.voucherCode ? [x.voucherCode] : [])), ...(o.voucher ? [o.voucher.code] : [])];
  for (const code of new Set([...codes, ...(orderVouchers.get(orderId) ?? [])])) publishVoucher(o.mode, code);
  orderVouchers.set(orderId, codes);
}

/** Write the public copies of these cards again (after "Start fresh" removed their orders). */
export function republishCards(mode: DataMode, numbers: string[]) {
  for (const n of new Set(numbers)) publishCard(mode, n);
}

/** Card numbers with a record or an order, for one data mode. */
export function cardNumbers(mode: DataMode): string[] {
  const st = getState();
  const out = new Set<string>();
  for (const c of Object.values(st.cards)) if (c.mode === mode) out.add(c.number);
  for (const o of Object.values(st.orders)) if (o.mode === mode && o.cardId) out.add(o.cardId);
  return [...out];
}

/**
 * Cards and vouchers from before the customer page could show them: each
 * device writes their public copies once, after it has the shared data.
 */
const BACKFILL_KEY = 'ccb:public-copies';
const BACKFILL_VERSION = '1';

function backfillPublic() {
  try {
    if (localStorage.getItem(BACKFILL_KEY) === BACKFILL_VERSION) return;
    localStorage.setItem(BACKFILL_KEY, BACKFILL_VERSION);
  } catch {
    return;
  }
  for (const mode of ['live', 'demo'] as const) {
    for (const n of cardNumbers(mode)) publishCard(mode, n);
    for (const o of ordersOf(mode)) for (const x of o.spins) if (x.voucherCode) publishVoucher(mode, x.voucherCode);
  }
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
  // Added later: a copy written by an older version of the app has none of these.
  /** The menu as customers see it: what is sold, its price and whether it has run out. */
  menu?: BoothMenuItem[];
  /** How Boom Card numbers look, so the customer page can read "37" as CCB-037. */
  card?: { prefix: string; first: number; last: number };
};

export type BoothMenuItem = { name: string; price: number; cat: string; photo?: string; desc?: string; out?: boolean };

/** The menu for the customer page, from settings (and today's stock when a day is open). */
export function publicMenu(st: ReturnType<typeof getState>): BoothMenuItem[] {
  const s = st.settings;
  const day = openDay(st);
  const left = day ? stockLeft(day, Object.values(st.orders).filter((o) => o.mode === s.mode), s) : null;
  const plain = <T extends object>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
  const items = s.menu
    .filter((m) => m.active && m.category !== 'addons')
    .map((m): BoothMenuItem => plain({ name: m.name, price: m.price, cat: m.category, photo: m.photo, desc: m.description, out: left && !isAvailable(m, day, left) ? true : undefined }));
  const partKind = (k: string, kind: string | undefined, regular: boolean | undefined) => (k === 'fries' ? kind === 'fries' && !!regular : kind === k);
  const combos = s.combos
    .filter((c) => c.active)
    .map((c): BoothMenuItem => {
      const out = !!left && !c.parts.every((k) => s.menu.some((m) => partKind(k, m.kind, m.regular) && isAvailable(m, day, left)));
      const desc = c.parts.map((k) => ({ bowl: 'Any bowl', fries: 'Fries with Dip', slushie: 'shake or juice', cookie: 'any cookie' })[k]).join(' + ');
      return plain({ name: c.name, price: c.price, cat: 'combos', photo: c.photo, desc, out: out ? true : undefined });
    });
  return [...items, ...combos];
}

let boothTimer: ReturnType<typeof setTimeout> | null = null;
let lastBooth = '';
const BOOTH_EVERY_MS = 20000;

/** Sold out, queue, ready numbers and wait time for the customer page, at most every 20 seconds. */
let boothSentAt = 0;

function scheduleBoothSummary(now = false) {
  if (boothTimer && !now) return;
  if (boothTimer) clearTimeout(boothTimer);
  // Right away if nothing was sent in the last 20 seconds, otherwise at the end of them.
  const wait = now ? 0 : Math.max(0, BOOTH_EVERY_MS - (Date.now() - boothSentAt));
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
    menu: publicMenu(st),
    card: { prefix: st.settings.loyalty.prefix, first: st.settings.loyalty.first, last: st.settings.loyalty.last },
  };
  const key = `${st.settings.mode}:${JSON.stringify(summary)}`;
  if (key === lastBooth) return;
  lastBooth = key;
  boothSentAt = Date.now();
  publicWrite(['public', `booth-${st.settings.mode}`], summary);
}

// What each listener last told us, to show one combined status.
const meta: Partial<Record<Collection, SnapshotMetadata>> = {};
const LISTEN: Collection[] = ['orders', 'days', 'cards', 'cashMoves', 'settings'];
const unsubscribers = new Map<Collection, () => void>();

function updateStatus() {
  if (!authState.email) return;
  const problem = Object.values(listenProblem)[0] ?? writeError;
  if (problem) return setSyncStatus({ label: 'Sync problem', detail: problem, connected: false });
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

/** The server answered for this collection: any earlier refusal is over. */
function listening(col: Collection, fromCache: boolean) {
  if (fromCache) return;
  retryDelay.delete(col);
  delete listenProblem[col];
  if (col === 'cashMoves') cashBlocked = false;
}

/**
 * "Start fresh" cleared this record, yet the server still has it: a device
 * that missed the clear sent it up again, so remove it for good. But a
 * restored backup lifts the clear in the shared settings, and those can arrive
 * a moment after the records, so look once more before deleting anything.
 */
const WIPE_RECHECK_MS = 8000;
const recheckTimers = new Set<ReturnType<typeof setTimeout>>();

function removeIfStillWiped(col: 'orders' | 'days' | 'cards' | 'cashMoves', id: string, data: Record<string, unknown>) {
  const t = setTimeout(() => {
    recheckTimers.delete(t);
    if (!db || !authState.email) return;
    if (isWiped(col, data)) push({ type: 'remove', col, id });
    else if (!(id in getState()[col])) applyRemote([{ type: 'put', col, id, doc: data }]);
  }, WIPE_RECHECK_MS);
  recheckTimers.add(t);
}

function onCollection(col: 'orders' | 'days' | 'cards' | 'cashMoves', snap: QuerySnapshot) {
  meta[col] = snap.metadata;
  listening(col, snap.metadata.fromCache);
  const ops: Op[] = [];
  const removed = new Set<string>();
  for (const ch of snap.docChanges()) {
    if (ch.type === 'removed') {
      removed.add(ch.doc.id);
      ops.push({ type: 'remove', col, id: ch.doc.id });
    } else if (isWiped(col, ch.doc.data())) {
      removed.add(ch.doc.id);
      removeIfStillWiped(col, ch.doc.id, ch.doc.data());
    } else if (isLeftover(col, ch.doc.data())) {
      // Only a scrap of a document (a late "Ready" or waste entry for something
      // that was already cleared): never show it; remove it once the server has it.
      if (!snap.metadata.fromCache && !ch.doc.metadata.hasPendingWrites) {
        removed.add(ch.doc.id);
        push({ type: 'remove', col, id: ch.doc.id });
      }
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
  // Once this device has the shared orders and cards: the public copies from before this version.
  if (replayed.orders && replayed.cards) backfillPublic();
  updateStatus();
}

/** A real order, day or cash entry always carries its own id; a scrap left by a late change does not. */
function isLeftover(col: Collection, data: Record<string, unknown>): boolean {
  if (col === 'orders') return typeof data.id !== 'string' || typeof data.dayId !== 'string';
  if (col === 'days' || col === 'cashMoves') return typeof data.id !== 'string';
  return false;
}

const replayed: Partial<Record<Collection, boolean>> = {};
/** The old menu version this window already upgraded on the server (so it does it once). */
let upgradedFrom: number | undefined;

function onSettings(s: DocumentSnapshot) {
  meta.settings = s.metadata;
  listening('settings', s.metadata.fromCache);
  const first = !s.metadata.fromCache && !uploadedOnce.settings;
  if (s.exists()) {
    // The shared setup always wins: a spare tablet with default prices
    // and passcodes must never replace the booth's real ones.
    if (first) uploadedOnce.settings = true;
    applyRemote([{ type: 'put', col: 'settings', id: 'main', doc: s.data() }]);
    // The shared copy is still on an older menu: save the upgraded one,
    // or every later Setup change would be upgraded over again and snap back.
    const shared = (s.data().menuVersion as number | undefined) ?? 1;
    if (!s.metadata.fromCache && !s.metadata.hasPendingWrites && shared < MENU_VERSION && upgradedFrom !== shared) {
      upgradedFrom = shared;
      push({ type: 'put', col: 'settings', id: 'main', doc: getState().settings });
    }
  } else if (first) {
    // First device to connect: its settings (menu, prices, PINs) become the shared ones.
    uploadedOnce.settings = true;
    push({ type: 'put', col: 'settings', id: 'main', doc: getState().settings });
  }
  updateStatus();
}

/** Start (or start again) the live listener of one collection. */
function listen(col: Collection) {
  if (!db) return;
  unsubscribers.get(col)?.();
  const opts = { includeMetadataChanges: true };
  const stop =
    col === 'settings'
      ? onSnapshot(doc(db, 'settings', 'main'), opts, onSettings, (e) => onListenError(e, col))
      : onSnapshot(collection(db, col), opts, (s) => onCollection(col, s), (e) => onListenError(e, col));
  unsubscribers.set(col, stop);
}

function attach() {
  if (!db) return;
  setRemote({ push });
  for (const col of LISTEN) listen(col);
}

// A listener the server refused is dead. It is started again by itself (after
// 30 seconds, then longer, up to 5 minutes), so a device left open picks up
// the fixed Firebase rules without anyone reloading it.
const RETRY_FIRST_MS = 30000;
const RETRY_MAX_MS = 300000;
const retryDelay = new Map<Collection, number>();
const retryTimers = new Map<Collection, ReturnType<typeof setTimeout>>();

function onListenError(e: { code?: string; message?: string }, col: Collection) {
  delete meta[col];
  const denied = e.code === 'permission-denied';
  if (col === 'cashMoves' && denied) {
    cashBlocked = true;
    console.warn('cash in/out cannot sync yet', e);
  } else {
    listenProblem[col] = denied
      ? col === 'cards'
        ? 'Loyalty card names cannot sync yet: the Firebase rules need the "cards" update (see docs/PLAN.md). This device tries again by itself every few minutes.'
        : 'This login is not allowed to read the booth data. Sign in with the booth account, or check the email in the Firebase rules. This device tries again by itself every few minutes.'
      : `Sync error: ${e.message ?? e.code}`;
    console.error('sync listen failed', e);
  }
  const delay = Math.min(RETRY_MAX_MS, (retryDelay.get(col) ?? RETRY_FIRST_MS / 2) * 2);
  retryDelay.set(col, delay);
  clearTimeout(retryTimers.get(col));
  retryTimers.set(
    col,
    setTimeout(() => {
      retryTimers.delete(col);
      if (authState.email) listen(col);
    }, delay),
  );
  updateStatus();
}

function detach() {
  for (const u of unsubscribers.values()) u();
  unsubscribers.clear();
  for (const t of retryTimers.values()) clearTimeout(t);
  retryTimers.clear();
  retryDelay.clear();
  for (const t of recheckTimers) clearTimeout(t);
  recheckTimers.clear();
  setRemote(null);
  for (const k of Object.keys(meta) as Collection[]) delete meta[k];
  for (const k of Object.keys(uploadedOnce) as Collection[]) delete uploadedOnce[k];
  for (const k of Object.keys(replayed) as Collection[]) delete replayed[k];
  for (const k of Object.keys(listenProblem) as Collection[]) delete listenProblem[k];
  cashBlocked = false;
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
