import { useSyncExternalStore } from 'react';
import { defaultSettings } from '../domain/defaults';
import type { BusinessDay, MenuItem, Order, Settings } from '../domain/types';

/**
 * Local-first store.
 *  - Every change is saved on this device right away (works with no internet).
 *  - Other windows on the same device (cashier + monitor) get the change
 *    instantly through BroadcastChannel.
 *  - A remote sync (Firebase) can be plugged in with setRemote(); it receives
 *    every local change and feeds back changes made on other devices.
 */

export type Collection = 'settings' | 'days' | 'orders';

export type Op =
  | { type: 'put'; col: Collection; id: string; doc: unknown }
  | { type: 'patch'; col: Collection; id: string; patch: Record<string, unknown> }
  | { type: 'remove'; col: Collection; id: string };

export type State = {
  settings: Settings;
  days: Record<string, BusinessDay>;
  orders: Record<string, Order>;
};

export interface Remote {
  /** Send a change made on this device. */
  push(op: Op): void;
}

const KEY = { settings: 'ccb:settings', days: 'ccb:days', orders: 'ccb:orders' } as const;
const SETTINGS_ID = 'main';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Older versions gave each bowl a long name plus a short one. Items now have
 * one name used everywhere, so the old default names are renamed. Names the
 * team typed themselves are left alone.
 */
const OLD_DEFAULT_NAMES: Record<string, string> = {
  'Ala King Chicken Rice Bowl': 'Ala King',
  'Honey Garlic Chicken Rice Bowl': 'Honey Garlic',
  'Spicy Boom Chicken Rice Bowl': 'Boom Sauce',
  'Boom Sauce Chicken Rice Bowl': 'Boom Sauce',
  'Salted Egg Chicken Rice Bowl': 'Salted Egg',
};

export function migrateMenu(menu: MenuItem[]): MenuItem[] {
  return menu.map((m) => {
    const { short: _short, ...rest } = m as MenuItem & { short?: string };
    void _short;
    return OLD_DEFAULT_NAMES[rest.name] ? { ...rest, name: OLD_DEFAULT_NAMES[rest.name] } : rest;
  });
}

function loadSettings(): Settings {
  const saved = read<Partial<Settings> | null>(KEY.settings, null);
  if (!saved) return defaultSettings();
  // New settings fields get their default value.
  const merged = { ...defaultSettings(), ...saved };
  return { ...merged, menu: migrateMenu(merged.menu) };
}

let state: State = {
  settings: loadSettings(),
  days: read(KEY.days, {}),
  orders: read(KEY.orders, {}),
};

const listeners = new Set<() => void>();
let remote: Remote | null = null;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ccb-pos') : null;

let saveError: string | null = null;
export function lastSaveError() {
  return saveError;
}

function persist(col: Collection) {
  try {
    const value = col === 'settings' ? state.settings : state[col];
    localStorage.setItem(KEY[col], JSON.stringify(value));
    saveError = null;
  } catch (e) {
    saveError = 'This device could not save. Export a backup now from the dashboard.';
    console.error(e);
  }
}

function emit() {
  for (const l of listeners) l();
}

function applyOp(op: Op) {
  if (op.col === 'settings') {
    if (op.type === 'put') state = { ...state, settings: { ...defaultSettings(), ...(op.doc as Settings) } };
    else if (op.type === 'patch') state = { ...state, settings: { ...state.settings, ...(op.patch as Partial<Settings>) } };
  } else {
    const col = { ...(state[op.col] as Record<string, unknown>) };
    if (op.type === 'put') col[op.id] = op.doc;
    else if (op.type === 'patch') col[op.id] = { ...(col[op.id] as object), ...op.patch };
    else delete col[op.id];
    state = { ...state, [op.col]: col };
  }
  persist(op.col);
}

/** A change made on this device. */
export function commit(...ops: Op[]) {
  for (const op of ops) {
    applyOp(op);
    channel?.postMessage(op);
    remote?.push(op);
  }
  emit();
}

/** A change that came from another device (via the remote sync). */
export function applyRemote(ops: Op[]) {
  if (!ops.length) return;
  for (const op of ops) {
    applyOp(op);
    channel?.postMessage(op);
  }
  emit();
}

export function setRemote(r: Remote | null) {
  remote = r;
}

channel?.addEventListener('message', (e: MessageEvent<Op>) => {
  applyOp(e.data);
  emit();
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

export function saveSettings(patch: Partial<Settings>) {
  commit({ type: 'patch', col: 'settings', id: SETTINGS_ID, patch: { ...patch, updatedAt: Date.now() } });
}

export function resetSettings() {
  commit({ type: 'put', col: 'settings', id: SETTINGS_ID, doc: { ...defaultSettings(), updatedAt: Date.now() } });
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

export function modeOrders(s: State): Order[] {
  return Object.values(s.orders).filter((o) => o.mode === s.settings.mode);
}

export function clearDemoData() {
  const s = getState();
  const ops: Op[] = [];
  for (const o of Object.values(s.orders)) if (o.mode === 'demo') ops.push({ type: 'remove', col: 'orders', id: o.id });
  for (const d of Object.values(s.days)) if (d.mode === 'demo') ops.push({ type: 'remove', col: 'days', id: d.id });
  commit(...ops);
}

export function exportBackup(): string {
  return JSON.stringify({ app: 'ccb-pos', version: 1, exportedAt: Date.now(), ...getState() }, null, 1);
}

export function importBackup(json: string): { ok: boolean; message: string } {
  try {
    const data = JSON.parse(json) as Partial<State> & { app?: string };
    if (data.app !== 'ccb-pos') return { ok: false, message: 'Not a Chick Chick Boom backup file.' };
    const ops: Op[] = [];
    for (const [id, d] of Object.entries(data.days ?? {})) ops.push({ type: 'put', col: 'days', id, doc: d });
    for (const [id, o] of Object.entries(data.orders ?? {})) ops.push({ type: 'put', col: 'orders', id, doc: o });
    if (data.settings) ops.push({ type: 'put', col: 'settings', id: SETTINGS_ID, doc: data.settings });
    commit(...ops);
    return { ok: true, message: `Restored ${Object.keys(data.orders ?? {}).length} orders.` };
  } catch {
    return { ok: false, message: 'Could not read that file.' };
  }
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
