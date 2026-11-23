import { describe, expect, it } from 'vitest';
import { createOrder } from './checkout';
import { defaultSettings } from './defaults';
import { allTicked, cleanNote, hasNote, itemProgress, kitchenUnits, liveTicks, NO_SIDE, quickNotes, toggleNote } from './kitchen';
import { lineBits } from './lineText';
import { lineCostEach, lineTotal, makeComboLine, stockUsage } from './pricing';
import { recentWins, stockLeft, winnerName } from './reports';
import type { BusinessDay, Order, OrderLine } from './types';

const s = defaultSettings();

const bowl = (over: Partial<OrderLine> = {}): OrderLine => ({ id: 'b1', itemId: 'bowl-original', name: 'OG Chicken Rice Bowl', qty: 1, unitPrice: 139, choices: { side: 'Cucumbers' }, ...over });
const water = (over: Partial<OrderLine> = {}): OrderLine => ({ id: 'w1', itemId: 'water', name: 'Bottled Water', qty: 1, unitPrice: 24, ...over });
const combo = (qty = 1): OrderLine => ({
  ...makeComboLine(s.combos[0], [{ itemId: 'bowl-original', side: NO_SIDE, extraRice: 1 }, { itemId: 'fries-reg', dip: 'Ranch' }, { itemId: 'slush-mango', topping: 'fruit' }], s),
  id: 'c1',
  qty,
});

const day: BusinessDay = { id: 'demo-d', mode: 'demo', date: '2026-11-23', openedAt: 0, openedBy: 'Ana', openingFloat: 0, stockStart: Object.fromEntries(s.menu.map((m) => [m.id, m.startStock])), soldOut: {} };

function order(lines: OrderLine[], over: Partial<Parameters<typeof createOrder>[0]> = {}): Order {
  return createOrder({ lines, day, orders: [], prefix: 'A', cashier: 'Ana', customerName: 'Ana', rewardsRedeemed: [], method: 'cash', tendered: 10000, settings: s, now: 1000, ...over });
}

describe('extra rice and no side', () => {
  it('charges ₱20 for each extra rice and nothing for "No side"', () => {
    expect(lineTotal(bowl({ choices: { side: NO_SIDE } }), s)).toBe(139);
    expect(lineTotal(bowl({ choices: { side: 'Cucumbers', extraRice: 1 } }), s)).toBe(159);
    expect(lineTotal(bowl({ qty: 2, choices: { side: 'Cucumbers', extraRice: 2, extraSauce: 1 } }), s)).toBe((139 + 40 + 10) * 2);
  });

  it('charges extra rice on a combo bowl too', () => {
    expect(lineTotal(combo(), s)).toBe(339 + 20);
  });

  it('keeps the extra rice price the order was sold at', () => {
    const o = order([bowl({ choices: { side: 'Cucumbers', extraRice: 1 } })]);
    expect(o.lines[0].extraRicePrice).toBe(20);
    expect(lineTotal(o.lines[0], { ...s, extraRicePrice: 35 })).toBe(159);
    expect(o.payment.due).toBe(159);
  });

  it('still prices old settings that have no extra rice price', () => {
    const old = { ...s } as Partial<typeof s>;
    delete old.extraRicePrice;
    expect(lineTotal(bowl({ choices: { side: 'Cucumbers', extraRice: 1 } }), old as typeof s)).toBe(159);
  });

  it('takes extra rice out of stock and counts its cost', () => {
    const line = bowl({ qty: 2, choices: { side: 'Cucumbers', extraRice: 1 } });
    expect(stockUsage([line])).toEqual({ 'bowl-original': 2, 'extra-rice': 2 });
    const rice = s.menu.find((m) => m.id === 'extra-rice')!;
    expect(lineCostEach(line, s)).toBeCloseTo(96.04 + rice.unitCost, 2);
    const left = stockLeft(day, [order([line])], s);
    expect(left['extra-rice']).toBe(rice.startStock - 2);
  });

  it('shows extra rice and No side in the line details', () => {
    expect(lineBits(bowl({ choices: { side: NO_SIDE, extraRice: 2 } }))).toEqual(['No side', '+ 2 extra rice']);
    expect(lineBits(combo())).toEqual(['No side', '+ 1 extra rice', 'dip: Ranch']);
  });
});

describe('ticking items in the kitchen', () => {
  it('has one tick per line, and one per part of a combo', () => {
    expect(kitchenUnits([bowl({ qty: 2 }), combo(), water()]).map((u) => [u.key, u.qty])).toEqual([
      ['b1', 2],
      ['c1#0', 1],
      ['c1#1', 1],
      ['c1#2', 1],
      ['w1', 1],
    ]);
  });

  it('counts pieces: "4 of 6 ready"', () => {
    const o = { ...order([bowl({ qty: 2 }), combo(), water()]), done: ['b1', 'c1#0', 'w1'] };
    expect(itemProgress(o)).toEqual({ done: 4, total: 6 });
    expect(allTicked(o)).toBe(false);
    expect(allTicked({ ...o, done: [...o.done, 'c1#1', 'c1#2'] })).toBe(true);
  });

  it('shows a ready or picked-up order as all done, ticked or not', () => {
    const o = order([bowl({ qty: 2 }), water()]);
    expect(itemProgress(o)).toEqual({ done: 0, total: 3 });
    expect(itemProgress({ ...o, status: 'ready' })).toEqual({ done: 3, total: 3 });
    expect(itemProgress({ ...o, status: 'claimed' })).toEqual({ done: 3, total: 3 });
  });

  it('is not finished when a wheel prize is added after every item was ticked', () => {
    const o = { ...order([bowl()]), done: ['b1'] };
    expect(allTicked(o)).toBe(true);
    const withPrize = { ...o, lines: [...o.lines, water({ id: 'prize', unitPrice: 0 })] };
    expect(allTicked(withPrize)).toBe(false);
    expect(itemProgress(withPrize)).toEqual({ done: 1, total: 2 });
  });

  it('drops the tick of an item that is no longer on the order', () => {
    expect(liveTicks({ lines: [bowl()], done: ['b1', 'gone'] })).toEqual(['b1']);
    expect(allTicked({ lines: [], done: [] })).toBe(false);
  });
});

describe('notes', () => {
  it('offers one-tap notes that fit the item', () => {
    expect(quickNotes(bowl(), s)).toContain('No sauce');
    expect(quickNotes({ ...bowl(), itemId: 'fries-overload' }, s)).toEqual(expect.arrayContaining(['No bacon', 'Less fries']));
    expect(quickNotes({ ...bowl(), itemId: 'fries-reg' }, s)).not.toContain('No bacon');
    expect(quickNotes({ ...bowl(), itemId: 'slush-mango' }, s)).toContain('Less ice');
    expect(quickNotes({ ...bowl(), itemId: 'cookie-choco' }, s)).toEqual(['Warm it up']);
    expect(quickNotes(combo(), s)).toEqual(expect.arrayContaining(['No sauce', 'Less fries', 'Less ice']));
    expect(quickNotes({ ...bowl(), itemId: 'extra-sauce' }, s)).toEqual([]);
  });

  it('adds a one-tap note, takes it out on a second tap, and keeps typed text', () => {
    expect(toggleNote(undefined, 'No sauce')).toBe('No sauce');
    expect(toggleNote('no egg', 'Less rice')).toBe('no egg, Less rice');
    expect(toggleNote('no egg, Less rice', 'less rice')).toBe('no egg');
    expect(toggleNote('No sauce', 'No sauce')).toBeUndefined();
    expect(hasNote('no egg, No Sauce', 'No sauce')).toBe(true);
    expect(hasNote('No sauce please', 'No sauce')).toBe(false);
  });

  it('cleans a note: single spaces, 80 characters at most, empty means none', () => {
    expect(cleanNote('  teacher,   please hurry ')).toBe('teacher, please hurry');
    expect(cleanNote('   ')).toBeUndefined();
    expect(cleanNote('x'.repeat(200))).toHaveLength(80);
  });

  it('saves the note for the whole order on the order', () => {
    expect(order([bowl()], { note: ' teacher, please hurry ' }).note).toBe('teacher, please hurry');
    expect(order([bowl()]).note).toBeUndefined();
  });
});

describe('recent winners', () => {
  it('shows names, and winners added by hand, newest first', () => {
    const o: Order = { ...order([bowl()]), spins: [{ lineId: 'b1', unit: 0, prize: 'tenOff', refund: 10, via: 'physical', at: 2000 }] };
    const anon: Order = { ...order([bowl()]), id: 'x2', number: 'A-002', customerName: undefined, spins: [{ lineId: 'b1', unit: 0, prize: 'tryAgain', refund: 0, via: 'physical', at: 2500 }, { lineId: 'b1', unit: 1, prize: 'freeWater', refund: 0, via: 'physical', at: 1500 }] };
    const d: BusinessDay = { ...day, manualWins: [{ id: 'm1', name: 'Ben', prize: 'freeMeal', at: 3000, by: 'Ana' }] };
    const wins = recentWins(d, [o, anon]);
    expect(wins.map((w) => [winnerName(w), w.prize])).toEqual([
      ['Ben', 'freeMeal'],
      ['Ana', 'tenOff'],
      ['A-002', 'freeWater'],
    ]);
    expect(new Set(wins.map((w) => `${w.orderId}:${w.at}`)).size).toBe(3);
  });
});
