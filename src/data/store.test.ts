import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A tiny stand-in for the browser's storage that counts writes.
const saved = new Map<string, string>();
let writes = 0;
const storage = {
  getItem: (k: string) => saved.get(k) ?? null,
  setItem: (k: string, v: string) => {
    writes += 1;
    saved.set(k, v);
  },
  removeItem: (k: string) => void saved.delete(k),
};

type Store = typeof import('./store');
type Op = import('./store').Op;
let store: Store;

beforeAll(async () => {
  saved.set('ccb:orders', 'null'); // a damaged save must not break the app
  vi.stubGlobal('localStorage', storage);
  store = await import('./store');
});

beforeEach(() => {
  store.flushSaves();
  writes = 0;
});

const order = (id: string, extra: object = {}) => ({
  id,
  dayId: 'd1',
  mode: 'demo',
  number: 'A-001',
  seq: 1,
  createdAt: 1,
  cashier: 'Ana',
  lines: [],
  subtotal: 0,
  stampsEarned: 0,
  rewardsRedeemed: [],
  payment: { method: 'cash', due: 0, tendered: 0, change: 0 },
  spins: [],
  spinsEarned: 0,
  status: 'new',
  ...extra,
});

describe('store', () => {
  it('starts with an empty list when the saved orders are damaged', () => {
    expect(store.getState().orders).toEqual({});
  });

  it('saves many changes with one write per list, not one per change', () => {
    const ops = Array.from({ length: 200 }, (_, i) => ({ type: 'put' as const, col: 'orders' as const, id: `o${i}`, doc: order(`o${i}`) }));
    store.applyRemote(ops);
    expect(writes).toBe(0);
    store.flushSaves();
    expect(writes).toBe(1);
    expect(Object.keys(JSON.parse(saved.get('ccb:orders')!))).toHaveLength(200);
  });

  it('ignores a patch for an order this device does not have', () => {
    store.patchOrder('ghost', { status: 'ready' });
    expect(store.getState().orders.ghost).toBeUndefined();
  });

  it('adds refunds one by one and never twice', () => {
    store.putOrder(order('r1') as never);
    const refund = { amount: 20, reason: 'spill', at: 5, by: 'Ana' };
    store.appendToOrder('r1', 'refunds', refund);
    store.appendToOrder('r1', 'refunds', refund);
    store.appendToOrder('r1', 'refunds', { ...refund, at: 6 });
    expect(store.getState().orders.r1.refunds).toHaveLength(2);
  });

  it('keeps the data mode when settings are reset', () => {
    store.saveSettings({ mode: 'live' });
    store.resetSettings();
    expect(store.getState().settings.mode).toBe('live');
    store.saveSettings({ mode: 'demo' });
  });

  it('restores only valid records and keeps what is already here', () => {
    store.putOrder(order('keep', { voided: { reason: 'x', at: 1, by: 'M' } }) as never);
    const file = JSON.stringify({
      app: 'ccb-pos',
      orders: { keep: order('keep'), fresh: order('fresh'), broken: null, wrong: order('other-id'), nopay: { ...order('nopay'), payment: undefined } },
      settings: { mode: 'live', menu: [] },
    });
    const r = store.importBackup(file);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Restored 1 order\./);
    expect(r.message).toMatch(/3 damaged/);
    const s = store.getState();
    expect(s.orders.keep.voided).toBeTruthy();
    expect(s.orders.fresh).toBeTruthy();
    expect(s.orders.broken).toBeUndefined();
    expect(s.settings.mode).toBe('demo');
  });

  it('refuses files that are not a backup', () => {
    expect(store.importBackup('{"orders":[]}').ok).toBe(false);
    expect(store.importBackup('not json').ok).toBe(false);
    expect(store.importBackup(JSON.stringify({ app: 'ccb-pos', orders: [order('a')] })).ok).toBe(false);
  });

  it('restores settings only when asked (new laptop)', () => {
    const file = JSON.stringify({ app: 'ccb-pos', orders: {}, settings: { ...store.getState().settings, dailyGoal: 12345 } });
    store.importBackup(file);
    expect(store.getState().settings.dailyGoal).not.toBe(12345);
    store.importBackup(file, { withSettings: true });
    expect(store.getState().settings.dailyGoal).toBe(12345);
  });

  it('keeps every hand stamp edit on a card, including the first on a new card', () => {
    store.adjustStamps('CCB-900', 2, 'paper card', 'Ana');
    store.adjustStamps('CCB-900', -1, 'mistake', 'Ben');
    const card = Object.values(store.getState().cards).find((c) => c.number === 'CCB-900');
    expect(card?.adjustments?.map((a) => a.delta)).toEqual([2, -1]);
    expect(card?.name).toBe('');
  });

  it('keeps changes made while signed out and sends them once the shared copy is loaded', () => {
    store.putOrder(order('ob1') as never);
    store.putOrder(order('ob2') as never);
    store.enableOutbox(true);
    store.patchOrder('ob1', { status: 'ready' });
    store.patchOrder('ob2', { status: 'ready', readyAt: 5, customerName: 'Ana' });
    store.saveSettings({ dailyGoal: 1 }); // settings are never queued: the shared setup wins
    store.addCashMove({ dayId: 'd1', type: 'drop', amount: 1000, note: 'to the safe', by: 'Ana' }); // new: uploaded, not queued
    expect(store.outboxSize()).toBe(2);
    const sent: Op[] = [];
    store.setRemote({ push: (op) => sent.push(op) });
    expect(sent).toHaveLength(0); // nothing goes out before the shared copy arrives
    // The shared copy says ob2 was already picked up on another device.
    store.applyRemote([{ type: 'put', col: 'orders', id: 'ob2', doc: order('ob2', { status: 'claimed' }) }]);
    store.replayOutbox('orders');
    expect(sent.map((op) => (op.type === 'patch' ? op.patch : null))).toEqual([{ status: 'ready' }, { customerName: 'Ana' }]);
    expect(store.getState().orders.ob2.status).toBe('claimed');
    expect(store.outboxSize()).toBe(0);
    store.setRemote(null);
    store.enableOutbox(false);
  });

  it('cancels a cash entry without deleting it', () => {
    const m = store.addCashMove({ dayId: 'd1', type: 'expense', amount: 120.4, note: ' ice ', by: 'Ana' });
    expect(m.amount).toBe(120);
    expect(m.note).toBe('ice');
    store.cancelCashMove(m.id, 'Ben', 'typed twice');
    expect(store.getState().cashMoves[m.id].cancelled?.by).toBe('Ben');
  });
});
