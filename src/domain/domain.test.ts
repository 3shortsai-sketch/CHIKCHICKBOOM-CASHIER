import { describe, expect, it } from 'vitest';
import { createOrder, nextSeq } from './checkout';
import { defaultSettings } from './defaults';
import { availableRewards, canRedeem, cardState, checkVoucher, parseCard } from './loyalty';
import { applyCombo, lineTotal, spinsEarned, stockUsage, subtotal, suggestCombo } from './pricing';
import { ordersCsv, stockLeft, summarize } from './reports';
import type { BusinessDay, MenuItem, Order, OrderLine } from './types';
import { applyPrize, digitalSpin, undoLastSpin } from './wheel';

const s = defaultSettings();

function bowl(qty = 1, extra: Partial<OrderLine> = {}): OrderLine {
  return { id: 'b' + Math.random(), itemId: 'bowl-alaking', name: 'Ala King', qty, unitPrice: 179, choices: { side: 'Corn' }, ...extra };
}
const fries = (): OrderLine => ({ id: 'f' + Math.random(), itemId: 'fries-reg', name: 'Regular Fries', qty: 1, unitPrice: 79, choices: { dip: 'Ranch' } });
const slush = (): OrderLine => ({ id: 's' + Math.random(), itemId: 'slush-blue', name: 'Blue', qty: 1, unitPrice: 89 });
const cookie = (): OrderLine => ({ id: 'c' + Math.random(), itemId: 'cookie-choco', name: 'Cookie', qty: 1, unitPrice: 85 });

const day: BusinessDay = {
  id: 'demo-2026-11-15',
  mode: 'demo',
  date: '2026-11-15',
  openedAt: 0,
  openedBy: 'Ana',
  openingFloat: 2000,
  stockStart: Object.fromEntries(s.menu.map((m) => [m.id, m.startStock])),
  soldOut: {},
};

function order(lines: OrderLine[], over: Partial<Parameters<typeof createOrder>[0]> = {}, existing: Order[] = []): Order {
  const base = { lines, day, orders: existing, prefix: 'A', cashier: 'Ana', rewardsRedeemed: [], method: 'cash' as const, tendered: 10000, settings: s, now: Date.parse('2026-11-15T12:00:00') };
  return createOrder({ ...base, ...over });
}

const pick = (kind: MenuItem['kind']) => s.menu.filter((m) => m.kind === kind).sort((a, b) => a.price - b.price)[0];
const ctx = { settings: s, pickFree: pick, via: 'physical' as const, now: Date.parse('2026-11-15T12:01:00') };

describe('pricing', () => {
  it('charges ₱20 per extra side and ₱10 per extra sauce', () => {
    const l = bowl(2, { choices: { side: 'Corn', extraSides: ['Egg'], extraSauce: 1 } });
    expect(lineTotal(l, s)).toBe((179 + 20 + 10) * 2);
  });

  it('counts stock used, including combo parts and extras', () => {
    const lines = [bowl(1, { choices: { side: 'Corn', extraSauce: 2 } }), fries(), slush()];
    const combo = applyCombo(lines, suggestCombo(lines, s)!, s);
    expect(combo).toHaveLength(1);
    expect(stockUsage(combo)).toEqual({ 'bowl-alaking': 1, 'fries-reg': 1, 'slush-blue': 1, 'extra-sauce': 2 });
  });
});

describe('combo prompt', () => {
  it('offers Combo A when the order has a bowl, regular fries and a slushie', () => {
    const lines = [bowl(), fries(), slush()];
    const sug = suggestCombo(lines, s)!;
    expect(sug.combo.id).toBe('comboA');
    expect(sug.saving).toBe(179 + 79 + 89 - 329);
    const after = applyCombo(lines, sug, s);
    expect(after).toHaveLength(1);
    expect(subtotal(after, s)).toBe(329);
    expect(after[0].combo!.parts.map((p) => p.dip ?? p.side)).toEqual(['Corn', 'Ranch', undefined]);
  });

  it('does not offer a combo for large fries', () => {
    const lg: OrderLine = { ...fries(), itemId: 'fries-lg', unitPrice: 109 };
    expect(suggestCombo([bowl(), lg, slush()], s)).toBeNull();
  });

  it('only takes one bowl out of a line of two', () => {
    const lines = [bowl(2), cookie(), slush()];
    const after = applyCombo(lines, suggestCombo(lines, s)!, s);
    expect(after.find((l) => l.itemId === 'bowl-alaking')!.qty).toBe(1);
    expect(after.some((l) => l.combo?.comboId === 'comboB')).toBe(true);
  });
});

describe('spins', () => {
  it('gives one spin per bowl outside a combo', () => {
    const forCombo = [bowl(), fries(), slush()];
    const lines = [bowl(2), ...applyCombo(forCombo, suggestCombo(forCombo, s)!, s)];
    expect(spinsEarned(lines, s, false)).toBe(2);
  });
  it('gives no spins with a voucher, for reward bowls, or when paused', () => {
    expect(spinsEarned([bowl()], s, true)).toBe(0);
    expect(spinsEarned([bowl(1, { unitPrice: 0, free: { reason: 'reward', stampsAt: 10 } })], s, false)).toBe(0);
    expect(spinsEarned([bowl()], { ...s, wheel: { ...s.wheel, paused: true } }, false)).toBe(0);
  });
  it('has 20 slots and the digital wheel lands on each slot equally', () => {
    expect(s.wheel.slots.reduce((n, x) => n + x.slots, 0)).toBe(20);
    expect(digitalSpin(s.wheel.slots, () => 0)).toBe('freeMeal');
    expect(digitalSpin(s.wheel.slots, () => 0.999)).toBe('tryAgain');
    expect(digitalSpin(s.wheel.slots, () => 1 / 20)).toBe('freeCookie');
  });
});

describe('prizes (spin after paying)', () => {
  it('FREE MEAL pays back the bowl, extras included', () => {
    const o = order([bowl(1, { id: 'b1', choices: { side: 'Corn', extraSauce: 1 } })]);
    const r = applyPrize(o, { lineId: 'b1', unit: 0 }, 'freeMeal', ctx);
    expect(r.ok && r.spin.refund).toBe(189);
  });

  it('blocks a second prize on the same bowl, and spins beyond what was earned', () => {
    const o = order([bowl(1, { id: 'b1' })]);
    const r1 = applyPrize(o, { lineId: 'b1', unit: 0 }, 'tenOff', ctx);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(applyPrize(r1.order, { lineId: 'b1', unit: 0 }, 'freeMeal', ctx).ok).toBe(false);
  });

  it('adds the cheapest cookie at ₱0 and sends it to the kitchen', () => {
    const o = order([bowl(1, { id: 'b1' })]);
    const r = applyPrize(o, { lineId: 'b1', unit: 0 }, 'freeCookie', ctx);
    if (!r.ok) throw new Error(r.message);
    const added = r.order.lines.find((l) => l.id === r.spin.addedLineId)!;
    expect(added.itemId).toBe('cookie-choco');
    expect(added.unitPrice).toBe(0);
    expect(added.addedAfterPay).toBe(true);
    expect(undoLastSpin(r.order).lines).toHaveLength(1);
  });

  it('refuses a free cookie when cookies are sold out', () => {
    const o = order([bowl(1, { id: 'b1' })]);
    const r = applyPrize(o, { lineId: 'b1', unit: 0 }, 'freeCookie', { ...ctx, pickFree: () => undefined });
    expect(r.ok).toBe(false);
  });

  it('double stamp needs a card and adds one stamp', () => {
    const noCard = order([bowl(1, { id: 'b1' })]);
    expect(applyPrize(noCard, { lineId: 'b1', unit: 0 }, 'doubleStamp', ctx).ok).toBe(false);
    const withCard = order([bowl(1, { id: 'b1' })], { cardId: 'CCB-001' });
    const r = applyPrize(withCard, { lineId: 'b1', unit: 0 }, 'doubleStamp', ctx);
    expect(r.ok && r.order.stampsEarned).toBe(2);
  });
});

describe('loyalty', () => {
  it('reads card numbers typed many ways and rejects unknown ones', () => {
    expect(parseCard('37', s)).toBe('CCB-037');
    expect(parseCard('ccb-037', s)).toBe('CCB-037');
    expect(parseCard('CCB37', s)).toBe('CCB-037');
    expect(parseCard('501', s)).toBeNull();
    expect(parseCard('0', s)).toBeNull();
    expect(parseCard('abc', s)).toBeNull();
  });

  it('counts stamps, blocks a reward used twice, and starts a new card after 10', () => {
    const orders: Order[] = [];
    for (let i = 0; i < 5; i++) orders.push({ ...order([bowl()], { cardId: 'CCB-001' }, orders), createdAt: i });
    let st = cardState('CCB-001', orders, s);
    expect(st.stamps).toBe(5);
    expect(availableRewards(st, s).map((r) => r.at)).toEqual([5]);

    orders.push({ ...order([fries()], { cardId: 'CCB-001', rewardsRedeemed: [5] }, orders), createdAt: 6 });
    st = cardState('CCB-001', orders, s);
    expect(st.stamps).toBe(6);
    expect(canRedeem(st, 5, s).ok).toBe(false);

    for (let i = 0; i < 4; i++) orders.push({ ...order([bowl()], { cardId: 'CCB-001' }, orders), createdAt: 10 + i });
    st = cardState('CCB-001', orders, s);
    expect(st.stamps).toBe(10);
    expect(canRedeem(st, 10, s).ok).toBe(true);

    orders.push({ ...order([bowl()], { cardId: 'CCB-001', rewardsRedeemed: [10] }, orders), createdAt: 20 });
    st = cardState('CCB-001', orders, s);
    expect(st.stamps).toBe(1);
    expect(st.cardsCompleted).toBe(1);
    expect(st.used).toEqual([]);
  });

  it('takes stamps back when an order is voided', () => {
    const o = order([bowl()], { cardId: 'CCB-002' });
    expect(cardState('CCB-002', [{ ...o, voided: { reason: 'x', at: 1, by: 'm' } }], s).stamps).toBe(0);
  });
});

describe('vouchers', () => {
  const won = (() => {
    const o = order([bowl(1, { id: 'b1' })]);
    const r = applyPrize(o, { lineId: 'b1', unit: 0 }, 'voucher', { ...ctx, rand: () => 0 });
    if (!r.ok) throw new Error();
    return r.order;
  })();

  it('is valid the next day only, with a ₱150 minimum, once', () => {
    const code = won.spins[0].voucherCode!;
    expect(checkVoucher(code, [won], s, '2026-11-15', 200).ok).toBe(false);
    expect(checkVoucher(code, [won], s, '2026-11-17', 200).ok).toBe(false);
    expect(checkVoucher(code, [won], s, '2026-11-16', 149).ok).toBe(false);
    expect(checkVoucher(code.toLowerCase().replace('-', ''), [won], s, '2026-11-16', 150)).toEqual({ ok: true, amount: 20, code });
    const used = { ...order([bowl()], { voucher: { code, amount: 20 } }), id: 'other', number: 'A-009' };
    const again = checkVoucher(code, [won, used], s, '2026-11-16', 200);
    expect(again.ok).toBe(false);
  });
});

describe('order numbers', () => {
  it('runs A-001, A-002 within a day', () => {
    const a = order([bowl()]);
    const b = order([bowl()], {}, [a]);
    expect([a.number, b.number]).toEqual(['A-001', 'A-002']);
    expect(nextSeq({ ...day, id: 'next-day' }, [a, b], 'A')).toBe(1);
  });
  it('blocks paying with too little cash', () => {
    expect(() => order([bowl()], { tendered: 100 })).toThrow();
  });
});

describe('day summary', () => {
  it('nets out paybacks, refunds and voids, and works out the cash drawer', () => {
    const a = order([bowl(1, { id: 'b1' })]);
    const r = applyPrize(a, { lineId: 'b1', unit: 0 }, 'tenOff', ctx);
    if (!r.ok) throw new Error();
    const b = order([fries()], { method: 'gcash', reference: '1234' }, [a]);
    const c = { ...order([bowl()], {}, [a, b]), voided: { reason: 'mistake', at: 1, by: 'Boss' } };
    const sum = summarize({ ...day, countedCash: 2000 + 179 - 10 - 5 }, [r.order, b, c], s);
    expect(sum.orders).toBe(2);
    expect(sum.net).toBe(179 - 10 + 79);
    expect(sum.cash.expected).toBe(2000 + 179 - 10);
    expect(sum.cash.overShort).toBe(-5);
    expect(sum.wheel.find((w) => w.prize === 'tenOff')!.cost).toBe(10);
    expect(sum.voids).toHaveLength(1);
    expect(stockLeft(day, [r.order, b, c], s)['bowl-alaking']).toBe(79);

    const csv = ordersCsv(day, [r.order, b, c], s).split('\n').slice(1).map((row) => row.split(','));
    const net = csv.filter((row) => row[14] === 'no').reduce((n, row) => n + Number(row[12]), 0);
    expect(net).toBe(sum.net);
  });
});
