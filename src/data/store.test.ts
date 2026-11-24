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

  it('starts fresh: clears one mode everywhere, and nothing cleared can come back', () => {
    const day = (id: string, mode: string) => ({ id, mode, date: '2026-11-20', openedAt: 1, openedBy: 'Ana', openingFloat: 0, stockStart: {}, soldOut: {} });
    store.putDay(day('live-1', 'live') as never);
    store.putDay(day('demo-1', 'demo') as never);
    store.putOrder(order('L1', { mode: 'live', dayId: 'live-1' }) as never);
    store.putOrder(order('D1', { mode: 'demo', dayId: 'demo-1' }) as never);
    store.addCashMove({ dayId: 'live-1', type: 'drop', amount: 500, note: '', by: 'Ana' });
    store.saveSettings({ mode: 'live' });
    store.saveCard('CCB-010', 'Test', 'Ana');
    const r = store.startFresh('live');
    expect(r).toEqual({ orders: 1, days: 1 });
    const st = store.getState();
    expect(st.orders.L1).toBeUndefined();
    expect(st.days['live-1']).toBeUndefined();
    expect(Object.values(st.cashMoves).some((m) => m.dayId === 'live-1')).toBe(false);
    expect(Object.values(st.cards).some((c) => c.mode === 'live')).toBe(false);
    expect(st.orders.D1).toBeTruthy(); // practice data untouched
    // A device that missed it uploads the old order again: it is refused.
    store.applyRemote([{ type: 'put', col: 'orders', id: 'L1', doc: order('L1', { mode: 'live', dayId: 'live-1' }) }]);
    expect(store.getState().orders.L1).toBeUndefined();
    // New sales after starting fresh are kept.
    store.putDay(day('live-2', 'live') as never);
    store.putOrder(order('L2', { mode: 'live', dayId: 'live-2' }) as never);
    expect(store.getState().orders.L2).toBeTruthy();
    store.saveSettings({ mode: 'demo' });
  });

  it('removes cleared data when the news arrives from another device', () => {
    store.putOrder(order('X1', { mode: 'demo', dayId: 'demo-x' }) as never);
    const settings = store.getState().settings;
    store.applyRemote([{ type: 'put', col: 'settings', id: 'main', doc: { ...settings, wiped: { days: [...(settings.wiped?.days ?? []), 'demo-x'], cardsBefore: {} } } }]);
    expect(store.getState().orders.X1).toBeUndefined();
  });

  it('moves a device to the menu page names and prices, keeping costs and stock edited in Setup', () => {
    const old = { ...store.getState().settings, menuVersion: 2, promoLimits: { warnPct: 6.5, pausePct: 8, minSales: 5000 } };
    old.menu = old.menu.map((m) => (m.id === 'bowl-original' ? { ...m, name: 'Regular (Original) Chicken Rice Bowl', price: 149, unitCost: 90, startStock: 33 } : m));
    store.applyRemote([{ type: 'put', col: 'settings', id: 'main', doc: old }]);
    const now = store.getState().settings;
    const og = now.menu.find((m) => m.id === 'bowl-original')!;
    expect([og.name, og.price, og.unitCost, og.startStock, og.photo]).toEqual(['OG Chicken Rice Bowl', 139, 90, 33, 'menu/og.webp']);
    expect(now.menuVersion).toBe(4);
    expect(now.menu.some((m) => m.id === 'extra-rice')).toBe(true);
    expect(now.combos.map((c) => c.price)).toEqual([339, 359]);
    expect(now.promoLimits.pausePct).toBe(12);
    expect(now.wheel.slots.find((w) => w.prize === 'comboVoucher')?.slots).toBe(1);
  });
  it('adds extra rice to a menu saved before it existed, keeping everything edited in Setup', () => {
    const before = store.getState().settings;
    const old = { ...before, menuVersion: 3, extraRicePrice: undefined, menu: before.menu.filter((m) => m.id !== 'extra-rice').map((m) => (m.id === 'water' ? { ...m, price: 30, unitCost: 11, startStock: 7 } : m)) };
    store.applyRemote([{ type: 'put', col: 'settings', id: 'main', doc: JSON.parse(JSON.stringify(old)) }]);
    const now = store.getState().settings;
    expect(now.menuVersion).toBe(4);
    expect(now.extraRicePrice).toBe(20);
    expect(now.menu.filter((m) => m.id === 'extra-rice')).toHaveLength(1);
    expect(now.menu.find((m) => m.id === 'water')).toMatchObject({ price: 30, unitCost: 11, startStock: 7 });
    // A second pass changes nothing more.
    store.applyRemote([{ type: 'put', col: 'settings', id: 'main', doc: JSON.parse(JSON.stringify(now)) }]);
    expect(store.getState().settings.menu.filter((m) => m.id === 'extra-rice')).toHaveLength(1);
  });

  it('ticks items one by one, with Cooking or Ready saved in the same step', () => {
    store.putOrder(order('t1') as never);
    store.tickItem('t1', 'l1', { status: 'cooking', cookingAt: 5 });
    store.tickItem('t1', 'l1');
    store.tickItem('t1', 'l2', { status: 'ready', readyAt: 9 });
    expect(store.getState().orders.t1).toMatchObject({ done: ['l1', 'l2'], status: 'ready', cookingAt: 5, readyAt: 9 });
  });

  it('sends a reopened day and a kitchen undo made while signed out', () => {
    const dayDoc = { id: 'demo-r', mode: 'demo', date: '2026-11-23', openedAt: 1, openedBy: 'Ana', openingFloat: 0, stockStart: {}, soldOut: {}, closedAt: 50, countedCash: 10, closedBy: 'Ana' };
    store.putDay(dayDoc as never);
    store.putOrder(order('u1', { status: 'ready', readyAt: 7 }) as never);
    store.putOrder(order('u2', { status: 'ready', readyAt: 7 }) as never);
    store.enableOutbox(true);
    store.patchDay('demo-r', { closedAt: undefined, countedCash: undefined, closedBy: undefined });
    store.patchOrder('u1', { status: 'cooking', readyAt: undefined });
    store.patchOrder('u2', { status: 'cooking', readyAt: undefined });
    const sent: Op[] = [];
    store.setRemote({ push: (op) => sent.push(op) });
    // Sign-in: the shared copies arrive first (day still closed, u1 still ready, u2 picked up meanwhile).
    store.applyRemote([
      { type: 'put', col: 'days', id: 'demo-r', doc: dayDoc },
      { type: 'put', col: 'orders', id: 'u1', doc: order('u1', { status: 'ready', readyAt: 7 }) },
      { type: 'put', col: 'orders', id: 'u2', doc: order('u2', { status: 'claimed', readyAt: 7, claimedAt: 8 }) },
    ]);
    store.replayOutbox('days');
    store.replayOutbox('orders');
    const st = store.getState();
    expect(st.days['demo-r'].closedAt).toBeUndefined();
    expect('closedAt' in (sent.find((op) => op.col === 'days') as { patch: object }).patch).toBe(true);
    expect(st.orders.u1).toMatchObject({ status: 'cooking' });
    expect(st.orders.u1.readyAt).toBeUndefined();
    expect(st.orders.u2.status).toBe('claimed'); // picked up elsewhere: never goes back
    expect(store.outboxSize()).toBe(0);
    store.setRemote(null);
    store.enableOutbox(false);
  });

  it('keeps a change the server refused, and sends a card rename made while signed out', () => {
    store.saveCard('CCB-020', 'Ana', 'Ben');
    store.enableOutbox(true);
    store.saveCard('CCB-020', 'Ana Cruz', 'Ben');
    expect(store.outboxSize()).toBe(1);
    store.requeue({ type: 'patch', col: 'orders', id: 'r1', patch: { status: 'ready' } });
    store.requeue({ type: 'put', col: 'orders', id: 'new', doc: order('new') }); // new documents are uploaded on connect, not queued
    expect(store.outboxSize()).toBe(2);
    const sent: Op[] = [];
    store.setRemote({ push: (op) => sent.push(op) });
    store.replayOutbox('cards');
    store.replayOutbox('orders');
    expect(sent.map((op) => op.col)).toEqual(['cards', 'orders']);
    expect(Object.values(store.getState().cards).find((c) => c.number === 'CCB-020')?.name).toBe('Ana Cruz');
    store.setRemote(null);
    store.enableOutbox(false);
  });

  it('renames a card without losing its stamp edits', () => {
    store.adjustStamps('CCB-021', 3, 'paper card', 'Ana');
    store.saveCard('CCB-021', 'Carla', 'Ana');
    store.saveCard('CCB-021', '', 'Ana');
    const card = Object.values(store.getState().cards).find((c) => c.number === 'CCB-021');
    expect(card).toMatchObject({ name: '' });
    expect(card?.adjustments).toHaveLength(1);
  });

  it('remembers what Start fresh cleared when settings are reset', () => {
    const cleared = store.getState().settings.wiped;
    expect(cleared?.days.length).toBeGreaterThan(0);
    store.resetSettings();
    expect(store.getState().settings.wiped).toEqual(cleared);
    store.applyRemote([{ type: 'put', col: 'orders', id: 'L1', doc: order('L1', { mode: 'live', dayId: 'live-1' }) }]);
    expect(store.getState().orders.L1).toBeUndefined();
  });

  it('restoring the backup brings back what Start fresh cleared, and says how much really came back', () => {
    const dayDoc = { id: 'live-9', mode: 'live', date: '2026-11-21', openedAt: 1, openedBy: 'Ana', openingFloat: 0, stockStart: {}, soldOut: {} };
    store.putDay(dayDoc as never);
    store.putOrder(order('B1', { mode: 'live', dayId: 'live-9' }) as never);
    store.putOrder(order('B2', { mode: 'live', dayId: 'live-9' }) as never);
    store.saveSettings({ mode: 'live' });
    store.saveCard('CCB-030', 'Dan', 'Ana');
    const backup = store.exportBackup();
    store.startFresh('live');
    expect(store.getState().orders.B1).toBeUndefined();
    expect(store.getState().settings.wiped?.days).toContain('live-9');

    const r = store.importBackup(backup, { withSettings: true });
    expect(r.ok).toBe(true);
    // B1 and B2, plus L2 from the earlier test: it was a live order in the file too.
    expect(r.message).toMatch(/Restored 3 orders\./);
    expect(r.message).toMatch(/brought back/);
    const st = store.getState();
    expect(st.orders.B1).toBeTruthy();
    expect(st.days['live-9']).toBeTruthy();
    expect(Object.values(st.cards).some((c) => c.number === 'CCB-030' && c.mode === 'live')).toBe(true);
    expect(st.settings.wiped?.days).not.toContain('live-9');
    // Days cleared earlier and not in this file stay cleared.
    expect(st.settings.wiped?.days).toContain('live-1');
    store.saveSettings({ mode: 'demo' });
  });
  it('unticks one item without touching the other ticks, and keeps line details clean in the outbox', () => {
    store.putOrder(order('p1', { done: ['a', 'b', 'c'] }) as never);
    store.untickItem('p1', 'b');
    store.untickItem('p1', 'zzz');
    expect(store.getState().orders.p1.done).toEqual(['a', 'c']);
    // A line with no note saved while signed out must not come back with a junk note.
    store.enableOutbox(true);
    store.patchOrder('p1', { lines: [{ id: 'l1', itemId: 'water', name: 'Water', qty: 1, unitPrice: 24, notes: undefined, free: undefined }] });
    const sent: Op[] = [];
    store.setRemote({ push: (op) => sent.push(op) });
    store.replayOutbox('orders');
    const line = store.getState().orders.p1.lines[0];
    expect(line.notes).toBeUndefined();
    expect(line.free).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain('field-removed');
    store.setRemote(null);
    store.enableOutbox(false);
  });
  it('undoing a Ready that came from the last tick takes back only that tick', () => {
    store.putOrder(order('k1', { status: 'ready', readyAt: 9, done: ['a', 'b', 'c'] }) as never);
    store.undoReady('k1', 'c');
    expect(store.getState().orders.k1).toMatchObject({ status: 'cooking', done: ['a', 'b'] });
    expect(store.getState().orders.k1.readyAt).toBeUndefined();
    store.putOrder(order('k2', { status: 'ready', readyAt: 9, done: ['a'] }) as never);
    store.undoReady('k2');
    expect(store.getState().orders.k2.done).toEqual(['a']);
  });
});
