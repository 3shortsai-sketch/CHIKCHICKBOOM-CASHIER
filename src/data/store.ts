import { useSyncExternalStore } from 'react';
import { defaultSettings, MENU_VERSION } from '../domain/defaults';
import { cardDocId, cleanCardName } from '../domain/cards';
import type { BusinessDay, Card, CashMove, DataMode, Order, Settings } from '../domain/types';

/**
 * Local-first store.
 *  - Every change is saved on this device right away (works with no internet).
 *  - Other windows on the same device (cashier + monitor) get the change
 *    instantly through BroadcastChannel.
 *  - A remote sync (Firebase) can be plugged in with setRemote(); it receives
 *    every local change and feeds back changes made on other devices.
 */

export type Collection = 'settings' | 'days' | 'orders' | 'cards' | 'cashMoves';

export type Op =
  | { type: 'put'; col: Collection; id: string; doc: unknown }
  | { type: 'patch'; col: Collection; id: string; patch: Record<string, unknown> }
  /** Add one entry to a list field (waste, refunds). Two devices adding at once both keep their entry. */
  | { type: 'append'; col: Collection; id: string; field: string; item: unknown }
  | { type: 'remove'; col: Collection; id: string };

export type State = {
  settings: Settings;
  days: Record<string, BusinessDay>;
  orders: Record<string, Order>;
  /** Loyalty card owners, keyed by cardDocId(mode, number). */
  cards: Record<string, Card>;
  /** Drops, change added and expenses paid from the drawer. */
  cashMoves: Record<string, CashMove>;
};

export interface Remote {
  /** Send a change made on this device. */
  push(op: Op): void;
}

const KEY = { settings: 'ccb:settings', days: 'ccb:days', orders: 'ccb:orders', cards: 'ccb:cards', cashMoves: 'ccb:cashMoves' } as const;
const SETTINGS_ID = 'main';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? (JSON.parse(raw) as T | null) : null;
    // A damaged save ("null", a number...) must not replace the whole list.
    return value !== null && typeof value === 'object' ? value : fallback;
  } catch {
    return fallback;
  }
}

/** Saved or synced settings, brought up to date with this version of the app. */
function upgradeSettings(saved: Partial<Settings> | null | undefined): Settings {
  if (!saved) return defaultSettings();
  // New settings fields get their default value.
  const merged = { ...defaultSettings(), ...saved };
  merged.voucher = { ...defaultSettings().voucher, ...saved.voucher };
  // A device saved before the real menu was added still has the placeholder
  // menu: give it the real menu, sides, dips and rewards. Everything else
  // (PINs, goal, wheel, cashiers...) is kept.
  const version = saved.menuVersion ?? 1;
  if (version === 2) {
    // Menu page names, prices, descriptions and photos; combos, sides, dips,
    // the 20-slot wheel and the new prize limits. Costs, starting stock and
    // which items are on (edited in Setup) are kept.
    const fresh = defaultSettings();
    const old = new Map((saved.menu ?? []).map((m) => [m.id, m]));
    const menu = fresh.menu.map((m) => {
      const was = old.get(m.id);
      return was ? { ...m, unitCost: was.unitCost, startStock: was.startStock, active: was.active } : m;
    });
    for (const m of saved.menu ?? []) if (!fresh.menu.some((f) => f.id === m.id)) menu.push(m);
    const oldLimits = !saved.promoLimits || (saved.promoLimits.warnPct === 6.5 && saved.promoLimits.pausePct === 8);
    return {
      ...merged,
      menu,
      combos: fresh.combos,
      sides: fresh.sides,
      dips: fresh.dips,
      sideAllergens: fresh.sideAllergens,
      dipAllergens: fresh.dipAllergens,
      wheel: { ...merged.wheel, slots: fresh.wheel.slots },
      loyalty: { ...merged.loyalty, rewards: fresh.loyalty.rewards },
      // The booth chose to switch the prize warning off with the new wheel.
      promoLimits: { ...(oldLimits ? fresh.promoLimits : merged.promoLimits), off: true },
      ingredients: merged.ingredients.map((i) => (i.id === 'ing-fries' && i.uses?.['topping-fries'] === undefined ? { ...i, uses: { ...i.uses, 'topping-fries': 0.08 } } : i)),
      menuVersion: MENU_VERSION,
    };
  }
  if (version < MENU_VERSION) {
    const fresh = defaultSettings();
    return {
      ...merged,
      menu: fresh.menu,
      sides: fresh.sides,
      dips: fresh.dips,
      sideAllergens: fresh.sideAllergens,
      dipAllergens: fresh.dipAllergens,
      loyalty: { ...merged.loyalty, rewards: fresh.loyalty.rewards },
      menuVersion: MENU_VERSION,
    };
  }
  return merged;
}

function loadSettings(): Settings {
  return upgradeSettings(read<Partial<Settings> | null>(KEY.settings, null));
}

let state: State = {
  settings: loadSettings(),
  days: read(KEY.days, {}),
  orders: read(KEY.orders, {}),
  cards: read(KEY.cards, {}),
  cashMoves: read(KEY.cashMoves, {}),
};

const listeners = new Set<() => void>();
queueMicrotask(() => dropWiped() && emit());
let remote: Remote | null = null;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ccb-pos') : null;

// ---------- Saving on this device ----------
// Writing a whole list to storage is slow once there are hundreds of orders,
// so changes are saved together a moment after the last one (and right away
// when the window is hidden or closed) instead of once per change.

const SAVE_DELAY_MS = 250;
const dirty = new Set<Collection>();
const failed = new Set<Collection>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function lastSaveError() {
  return failed.size ? 'This device could not save. Export a backup now from the dashboard.' : null;
}

/** Write everything that changed to this device's storage now. */
export function flushSaves() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const hadError = failed.size > 0;
  for (const col of [...dirty]) {
    dirty.delete(col);
    try {
      const value = col === 'settings' ? state.settings : state[col];
      localStorage.setItem(KEY[col], JSON.stringify(value));
      failed.delete(col);
    } catch (e) {
      failed.add(col);
      console.error(e);
    }
  }
  if (hadError !== failed.size > 0) {
    state = { ...state }; // new reference so the top bar shows or hides the warning
    emit();
  }
}

function persist(col: Collection) {
  dirty.add(col);
  if (!saveTimer) saveTimer = setTimeout(flushSaves, SAVE_DELAY_MS);
}

if (typeof addEventListener === 'function') {
  addEventListener('pagehide', flushSaves);
  addEventListener('visibilitychange', () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flushSaves();
  });
}

function emit() {
  for (const l of listeners) l();
}

/** Same entry already in the list (re-delivered by sync or sent twice)? */
function hasEntry(list: unknown[], item: unknown): boolean {
  const id = (item as { id?: unknown } | null)?.id;
  if (id !== undefined) return list.some((x) => (x as { id?: unknown } | null)?.id === id);
  const json = JSON.stringify(item);
  return list.some((x) => JSON.stringify(x) === json);
}

/** Was this document removed by "Start fresh"? Then it must never come back. */
export function isWiped(col: Collection, doc: unknown, s: Settings = state.settings): boolean {
  const w = s.wiped;
  if (!w || !doc || typeof doc !== 'object') return false;
  const d = doc as { id?: string; dayId?: string; mode?: DataMode; updatedAt?: number };
  if (col === 'days') return !!d.id && w.days.includes(d.id);
  if (col === 'orders' || col === 'cashMoves') return !!d.dayId && w.days.includes(d.dayId);
  if (col === 'cards') {
    const before = d.mode ? w.cardsBefore[d.mode] : undefined;
    return before !== undefined && (d.updatedAt ?? 0) <= before;
  }
  return false;
}

/** Remove from this device anything a "Start fresh" on another device cleared. */
function dropWiped(): boolean {
  if (!state.settings.wiped) return false;
  let changed = false;
  for (const col of ['days', 'orders', 'cashMoves', 'cards'] as const) {
    const list = state[col] as Record<string, unknown>;
    const keep = Object.fromEntries(Object.entries(list).filter(([, d]) => !isWiped(col, d)));
    if (Object.keys(keep).length !== Object.keys(list).length) {
      state = { ...state, [col]: keep };
      persist(col);
      changed = true;
    }
  }
  return changed;
}

/** Returns false when the change does not apply (e.g. a patch for a document this device does not have). */
function applyOp(op: Op): boolean {
  if (op.col === 'settings') {
    if (op.type === 'put') state = { ...state, settings: upgradeSettings(op.doc as Partial<Settings>) };
    else if (op.type === 'patch') state = { ...state, settings: { ...state.settings, ...(op.patch as Partial<Settings>) } };
    else return false;
    dropWiped();
  } else {
    const col = { ...(state[op.col] as Record<string, unknown>) };
    if (op.type === 'put') {
      if (!op.doc || typeof op.doc !== 'object' || isWiped(op.col, op.doc)) return false;
      col[op.id] = op.doc;
    } else if (op.type === 'patch') {
      // Never invent a half-empty document from a patch.
      if (!col[op.id]) return false;
      col[op.id] = { ...(col[op.id] as object), ...op.patch };
    } else if (op.type === 'append') {
      const doc = col[op.id] as Record<string, unknown> | undefined;
      if (!doc) return false;
      const list = Array.isArray(doc[op.field]) ? (doc[op.field] as unknown[]) : [];
      if (hasEntry(list, op.item)) return false;
      col[op.id] = { ...doc, [op.field]: [...list, op.item] };
    } else delete col[op.id];
    state = { ...state, [op.col]: col };
  }
  persist(op.col);
  return true;
}

// ---------- Changes waiting to be sent ----------
// While sync is set up but this window is not connected (signed out, or
// before signing in), changes are kept in an outbox and sent when it
// connects. Without it, edits to existing orders made while signed out
// (a void, Ready, a closed day) would be replaced by the shared copy.

const OUTBOX_KEY = 'ccb:outbox';
const OUTBOX_MAX = 3000;
let outboxOn = false;

/**
 * Only changes to documents are queued. New documents (an order or a day made
 * while signed out) need no queue: on connecting, the sync uploads every
 * document the server does not have. Settings are never queued: the shared
 * setup always wins over a device that was signed out.
 */
function queueable(op: Op): boolean {
  return op.col !== 'settings' && op.type !== 'put';
}

/** Read from storage every time: two windows on one device share the outbox. */
function readOutbox(): Op[] {
  try {
    const v = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]');
    return Array.isArray(v) ? (v as Op[]) : [];
  } catch {
    return [];
  }
}

function writeOutbox(ops: Op[]) {
  try {
    if (ops.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(ops.slice(-OUTBOX_MAX)));
    else localStorage.removeItem(OUTBOX_KEY);
  } catch {
    /* nothing more can be done; the change is still saved on this device */
  }
}

/** Called by the sync once it is set up on this app: from then on, changes made while not connected wait in the outbox. */
export function enableOutbox(on: boolean) {
  outboxOn = on;
}

/** How many changes are waiting to be sent. */
export function outboxSize() {
  return readOutbox().length;
}

const STATUS_RANK: Record<string, number> = { new: 0, cooking: 1, ready: 2, claimed: 3 };

/**
 * After the sync has loaded the shared copy of a collection, send the changes
 * this device made to it while signed out. A change that would move an order
 * backwards (Ready after it was already picked up elsewhere) is dropped.
 */
export function replayOutbox(col: Collection) {
  if (!remote) return;
  const all = readOutbox();
  const mine = all.filter((op) => op.col === col);
  if (!mine.length) return;
  writeOutbox(all.filter((op) => op.col !== col));
  const ops: Op[] = [];
  for (const op of mine) {
    if (op.type === 'patch' && col === 'orders') {
      const now = state.orders[op.id];
      const to = op.patch.status as string | undefined;
      if (now && to !== undefined && STATUS_RANK[now.status] > STATUS_RANK[to]) {
        const { status: _s, cookingAt: _c, readyAt: _r, claimedAt: _p, ...rest } = op.patch;
        if (Object.keys(rest).length) ops.push({ ...op, patch: rest });
        continue;
      }
    }
    ops.push(op);
  }
  commit(...ops);
}

/** A change made on this device. */
export function commit(...ops: Op[]) {
  const applied = ops.filter(applyOp);
  if (!applied.length) return;
  // One message for the whole batch: the other windows save and redraw once.
  channel?.postMessage(applied);
  if (remote) for (const op of applied) remote.push(op);
  else if (outboxOn) {
    const waiting = applied.filter(queueable);
    if (waiting.length) writeOutbox([...readOutbox(), ...waiting]);
  }
  emit();
}

/**
 * Changes that came from another device (via the remote sync). Other windows
 * on this device are not told: each has its own connection and hears the same
 * news itself, so passing it on would make every window do the work twice.
 */
export function applyRemote(ops: Op[]) {
  if (!ops.length) return;
  for (const op of ops) applyOp(op);
  emit();
}

export function setRemote(r: Remote | null) {
  remote = r;
}

channel?.addEventListener('message', (e: MessageEvent<Op | Op[]>) => {
  const ops = Array.isArray(e.data) ? e.data : [e.data];
  let changed = false;
  for (const op of ops) changed = applyOp(op) || changed;
  if (changed) emit();
});

export function getState(): State {
  return state;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Re-renders when anything changes. Do derived work in the component (useMemo). */
export function useStore<T>(select: (s: State) => T): T {
  const s = useSyncExternalStore(subscribe, getState);
  return select(s);
}

// ---------- Helpers ----------

export function putOrder(o: Order) {
  commit({ type: 'put', col: 'orders', id: o.id, doc: o });
}

export function patchOrder(id: string, patch: Partial<Order>) {
  commit({ type: 'patch', col: 'orders', id, patch: patch as Record<string, unknown> });
}

export function putDay(d: BusinessDay) {
  commit({ type: 'put', col: 'days', id: d.id, doc: d });
}

export function patchDay(id: string, patch: Partial<BusinessDay>) {
  commit({ type: 'patch', col: 'days', id, patch: patch as Record<string, unknown> });
}

/** Add one entry to a list on the day (e.g. a waste entry) without overwriting entries from other devices. */
export function appendToDay(id: string, field: 'waste', item: { id: string }) {
  commit({ type: 'append', col: 'days', id, field, item });
}

/** Add one entry to a list on an order (e.g. a refund) without overwriting entries from other devices. */
export function appendToOrder(id: string, field: 'refunds', item: object) {
  commit({ type: 'append', col: 'orders', id, field, item });
}

export function saveSettings(patch: Partial<Settings>) {
  commit({ type: 'patch', col: 'settings', id: SETTINGS_ID, patch: { ...patch, updatedAt: Date.now() } });
}

/** Back to the built-in menu, prices and passcodes. Demo/real data mode stays as it is. */
export function resetSettings() {
  commit({ type: 'put', col: 'settings', id: SETTINGS_ID, doc: { ...defaultSettings(), mode: getState().settings.mode, updatedAt: Date.now() } });
}

/** The day currently open for the current data mode (demo or live). */
export function openDay(s: State): BusinessDay | undefined {
  return Object.values(s.days)
    .filter((d) => d.mode === s.settings.mode && !d.closedAt)
    .sort((a, b) => b.openedAt - a.openedAt)[0];
}

/** Most recent day (open or closed) for the current mode. */
export function latestDay(s: State): BusinessDay | undefined {
  return Object.values(s.days)
    .filter((d) => d.mode === s.settings.mode)
    .sort((a, b) => b.openedAt - a.openedAt)[0];
}

export function ordersList(s: State): Order[] {
  return Object.values(s.orders);
}

/** Loyalty cards (number + name) for the current data mode. */
export function modeCards(s: State): Card[] {
  return Object.values(s.cards).filter((c) => c.mode === s.settings.mode);
}

/** Add or remove stamps by hand. Kept in the card's history with who, when and why. */
export function adjustStamps(number: string, delta: number, reason: string, by: string) {
  if (!delta) return;
  const s = getState();
  const mode = s.settings.mode;
  const id = cardDocId(mode, number);
  const old = s.cards[id];
  const now = Date.now();
  const entry = { delta, reason: reason.trim(), at: now, by };
  // A card nobody has named yet needs a record to hold its stamp history.
  if (!old) commit({ type: 'put', col: 'cards', id, doc: { number, mode, name: '', createdAt: now, updatedAt: now, by, adjustments: [] } satisfies Card });
  // Added as one entry, so two devices editing the same card both keep theirs.
  commit({ type: 'append', col: 'cards', id, field: 'adjustments', item: entry }, { type: 'patch', col: 'cards', id, patch: { updatedAt: now } });
}

/** Save or rename a card owner. An empty name removes the record. */
export function saveCard(number: string, name: string, by: string) {
  const s = getState();
  const mode = s.settings.mode;
  const id = cardDocId(mode, number);
  const clean = cleanCardName(name);
  const now = Date.now();
  const old = s.cards[id];
  if (!clean) {
    // Keep the record if it holds stamp adjustments; only the name goes.
    if (old?.adjustments?.length) commit({ type: 'put', col: 'cards', id, doc: { ...old, name: '', updatedAt: now } satisfies Card });
    else if (old) commit({ type: 'remove', col: 'cards', id });
    return;
  }
  commit({ type: 'put', col: 'cards', id, doc: { ...old, number, mode, name: clean, createdAt: old?.createdAt ?? now, updatedAt: now, by } satisfies Card });
}

export function modeOrders(s: State): Order[] {
  return Object.values(s.orders).filter((o) => o.mode === s.settings.mode);
}

/** Drops, change added and expenses for the current data mode. */
export function modeCashMoves(s: State): CashMove[] {
  return Object.values(s.cashMoves).filter((m) => m.mode === s.settings.mode);
}

/** Record cash taken out of or put into the drawer (not a sale). */
export function addCashMove(m: Omit<CashMove, 'id' | 'at' | 'mode'> & { at?: number }) {
  const at = m.at ?? Date.now();
  const id = `${m.dayId}_cash_${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const doc: CashMove = { ...m, id, at, mode: getState().settings.mode, amount: Math.round(m.amount), note: m.note.trim() };
  commit({ type: 'put', col: 'cashMoves', id, doc });
  return doc;
}

/** Cancel a mistaken cash entry. It stays in the list, crossed out. */
export function cancelCashMove(id: string, by: string, reason: string) {
  commit({ type: 'patch', col: 'cashMoves', id, patch: { cancelled: { at: Date.now(), by, reason: reason.trim() } } });
}

/**
 * Start fresh: remove every order, business day, cash entry and loyalty card
 * record of one data mode, on every device. What was removed is remembered in
 * the shared settings, so a device that was offline cannot bring it back.
 * Settings (menu, prices, passcodes) are kept.
 */
export function startFresh(mode: DataMode): { orders: number; days: number } {
  const s = getState();
  const now = Date.now();
  const days = Object.values(s.days).filter((d) => d.mode === mode);
  const dayIds = new Set(days.map((d) => d.id));
  const ops: Op[] = [];
  let orders = 0;
  for (const o of Object.values(s.orders))
    if (o.mode === mode || dayIds.has(o.dayId)) {
      dayIds.add(o.dayId);
      ops.push({ type: 'remove', col: 'orders', id: o.id });
      orders += 1;
    }
  for (const m of Object.values(s.cashMoves))
    if (m.mode === mode || dayIds.has(m.dayId)) {
      dayIds.add(m.dayId);
      ops.push({ type: 'remove', col: 'cashMoves', id: m.id });
    }
  for (const d of days) ops.push({ type: 'remove', col: 'days', id: d.id });
  for (const [id, c] of Object.entries(s.cards)) if (c.mode === mode) ops.push({ type: 'remove', col: 'cards', id });
  const before = s.settings.wiped ?? { days: [], cardsBefore: {} };
  const wiped = { days: [...new Set([...before.days, ...dayIds])], cardsBefore: { ...before.cardsBefore, [mode]: now } };
  ops.push({ type: 'patch', col: 'settings', id: SETTINGS_ID, patch: { wiped, updatedAt: now } });
  commit(...ops);
  flushSaves();
  // Set-aside and half-rung orders on this device belong to the cleared data too.
  try {
    localStorage.removeItem('ccb:parked');
    localStorage.removeItem('ccb:draft');
    sessionStorage.removeItem('ccb:afterpay');
  } catch {
    /* ignore */
  }
  return { orders, days: days.length };
}

export function exportBackup(): string {
  return JSON.stringify({ app: 'ccb-pos', version: 1, exportedAt: Date.now(), ...getState() }, null, 1);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function validOrder(id: string, v: unknown): boolean {
  if (!isObj(v) || v.id !== id) return false;
  const pay = v.payment;
  return (
    typeof v.dayId === 'string' &&
    (v.mode === 'demo' || v.mode === 'live') &&
    typeof v.number === 'string' &&
    Array.isArray(v.lines) &&
    Array.isArray(v.spins) &&
    Array.isArray(v.rewardsRedeemed) &&
    isObj(pay) &&
    typeof pay.due === 'number' &&
    typeof v.createdAt === 'number'
  );
}

function validDay(id: string, v: unknown): boolean {
  return isObj(v) && v.id === id && (v.mode === 'demo' || v.mode === 'live') && typeof v.date === 'string' && typeof v.openedAt === 'number' && isObj(v.stockStart) && isObj(v.soldOut);
}

function validCashMove(id: string, v: unknown): boolean {
  return isObj(v) && v.id === id && typeof v.dayId === 'string' && (v.mode === 'demo' || v.mode === 'live') && (v.type === 'drop' || v.type === 'add' || v.type === 'expense') && typeof v.amount === 'number' && Number.isFinite(v.amount) && v.amount > 0;
}

function validCard(v: unknown): boolean {
  return isObj(v) && typeof v.number === 'string' && (v.mode === 'demo' || v.mode === 'live') && typeof v.name === 'string';
}

/**
 * Restore a backup file. Only adds what this device does not have: orders,
 * days and cards already here are kept as they are (they may be newer).
 * Settings come along only when asked (a brand-new laptop).
 */
export function importBackup(json: string, opts: { withSettings?: boolean } = {}): { ok: boolean; message: string } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, message: 'Could not read that file.' };
  }
  if (!isObj(data) || data.app !== 'ccb-pos') return { ok: false, message: 'Not a Chick Chick Boom backup file.' };
  const have = getState();
  const ops: Op[] = [];
  let added = 0;
  let kept = 0;
  let bad = 0;
  const take = (col: 'days' | 'orders' | 'cards' | 'cashMoves', valid: (id: string, v: unknown) => boolean) => {
    const group = data[col];
    if (group === undefined) return;
    if (!isObj(group)) {
      bad += 1;
      return;
    }
    for (const [id, doc] of Object.entries(group)) {
      if (!valid(id, doc)) bad += 1;
      else if (id in have[col]) kept += 1;
      else {
        ops.push({ type: 'put', col, id, doc });
        if (col === 'orders') added += 1;
      }
    }
  };
  take('days', validDay);
  take('orders', validOrder);
  take('cards', (_id, v) => validCard(v));
  take('cashMoves', validCashMove);
  if (opts.withSettings && isObj(data.settings) && Array.isArray(data.settings.menu)) ops.push({ type: 'put', col: 'settings', id: SETTINGS_ID, doc: { ...data.settings, updatedAt: Date.now() } });
  if (!ops.length && bad) return { ok: false, message: 'Nothing in that file could be read as booth data.' };
  try {
    commit(...ops);
  } catch (e) {
    console.error(e);
    return { ok: false, message: 'Restore stopped part-way. Check the orders, then try the file again.' };
  }
  flushSaves();
  const parts = [`Restored ${added} order${added === 1 ? '' : 's'}.`];
  if (kept) parts.push(`${kept} record${kept === 1 ? '' : 's'} already here were kept.`);
  if (bad) parts.push(`${bad} damaged record${bad === 1 ? '' : 's'} skipped.`);
  return { ok: true, message: parts.join(' ') };
}

// ---------- This device only (not synced) ----------

export type DevicePrefs = { orderLetter: string; cashier: string };
const DEVICE_KEY = 'ccb:device';

export function getDevice(): DevicePrefs {
  return { orderLetter: 'A', cashier: '', ...read<Partial<DevicePrefs>>(DEVICE_KEY, {}) };
}

export function setDevice(patch: Partial<DevicePrefs>) {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ ...getDevice(), ...patch }));
  } catch {
    /* ignore */
  }
  state = { ...state }; // new reference so screens re-render
  emit();
}

export function useDevice(): DevicePrefs {
  // Re-read on every store change; cheap.
  useStore((s) => s);
  return getDevice();
}
