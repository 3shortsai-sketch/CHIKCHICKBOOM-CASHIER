import { describe, expect, it } from 'vitest';
import { cashSuggestions, checkCart, cleanName, createOrder, duplicateReference, nextSeq } from './checkout';
import { defaultSettings } from './defaults';
import { availableRewards, canRedeem, cardState, checkVoucher, isLastSellingDay, nextSellingDay, normalizeVoucher, parseCard, voucherWindow } from './loyalty';
import { applyCombo, lineTotal, needsPicker, peso, spinsEarned, stockUsage, subtotal, suggestCombo } from './pricing';
import { allergenHint, allergenText, itemTags } from './allergens';
import { cardDocId, cardRows, cardStateFor, cleanCardName, searchCards } from './cards';
import { isLow, margins, onHand, servingsLeft, waitMinutes } from './inventory';
import { dayXlsx, daySheets } from './excel';
import { colName, crc32 } from './xlsx';
import { bestSellers, csvCell, kitchenMadeCounts, orderCost, ordersCsv, pendingSpins, popularToday, recentWins, stockLeft, summarize, voidReturnAmount } from './reports';
import { expectedSpinCost, promoStatus } from './promo';
import type { BusinessDay, MenuItem, Order, OrderLine } from './types';
import { applyPrize, digitalSpin, makeVoucherCode, undoLastSpin } from './wheel';

const s = defaultSettings();

function bowl(qty = 1, extra: Partial<OrderLine> = {}): OrderLine {
  return { id: 'b' + Math.random(), itemId: 'bowl-alaking', name: 'Ala King Chicken Rice Bowl', qty, unitPrice: 169, choices: { side: 'Butter Corn Carrot' }, ...extra };
}
const fries = (): OrderLine => ({ id: 'f' + Math.random(), itemId: 'fries-reg', name: 'Regular Fries', qty: 1, unitPrice: 79, choices: { dip: 'Ranch' } });
const slush = (): OrderLine => ({ id: 's' + Math.random(), itemId: 'slush-watermelon', name: 'Watermelon Slushie', qty: 1, unitPrice: 129 });
const cookie = (): OrderLine => ({ id: 'c' + Math.random(), itemId: 'cookie-choco', name: 'Choco Chip Cookie', qty: 1, unitPrice: 89 });

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
    const l = bowl(2, { choices: { side: 'Butter Corn Carrot', extraSides: ['Shredded Cabbage'], extraSauce: 1 } });
    expect(lineTotal(l, s)).toBe((169 + 20 + 10) * 2);
  });

  it('counts stock used, including combo parts and extras', () => {
    const lines = [bowl(1, { choices: { side: 'Butter Corn Carrot', extraSauce: 2 } }), fries(), slush()];
    const combo = applyCombo(lines, suggestCombo(lines, s)!, s);
    expect(combo).toHaveLength(1);
    expect(stockUsage(combo)).toEqual({ 'bowl-alaking': 1, 'fries-reg': 1, 'slush-watermelon': 1, 'extra-sauce': 2 });
  });
});

describe('combo prompt', () => {
  it('offers Combo A when the order has a bowl, regular fries and a slushie', () => {
    const lines = [bowl(), fries(), slush()];
    const sug = suggestCombo(lines, s)!;
    expect(sug.combo.id).toBe('comboA');
    expect(sug.saving).toBe(169 + 79 + 129 - 329);
    const after = applyCombo(lines, sug, s);
    expect(after).toHaveLength(1);
    expect(subtotal(after, s)).toBe(329);
    expect(after[0].combo!.parts.map((p) => p.dip ?? p.side)).toEqual(['Butter Corn Carrot', 'Ranch', undefined]);
  });

  it('does not offer a combo for Overload Fries', () => {
    const lg: OrderLine = { ...fries(), itemId: 'fries-overload', unitPrice: 109 };
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
    const o = order([bowl(1, { id: 'b1', choices: { side: 'Butter Corn Carrot', extraSauce: 1 } })]);
    const r = applyPrize(o, { lineId: 'b1', unit: 0 }, 'freeMeal', ctx);
    expect(r.ok && r.spin.refund).toBe(179);
  });

  it('blocks a second prize on the same bowl', () => {
    const o = order([bowl(2, { id: 'b1' })]);
    const r1 = applyPrize(o, { lineId: 'b1', unit: 0 }, 'tenOff', ctx);
    if (!r1.ok) throw new Error(r1.message);
    expect(applyPrize(r1.order, { lineId: 'b1', unit: 0 }, 'freeMeal', ctx)).toEqual({ ok: false, message: 'This bowl already spun. One prize per meal.' });
  });

  it('blocks spins beyond what was earned', () => {
    // Two bowls on the line, but the order only earned one spin.
    const o = { ...order([bowl(2, { id: 'b1' })]), spinsEarned: 1 };
    const r1 = applyPrize(o, { lineId: 'b1', unit: 0 }, 'tryAgain', ctx);
    if (!r1.ok) throw new Error(r1.message);
    expect(applyPrize(r1.order, { lineId: 'b1', unit: 1 }, 'tenOff', ctx)).toEqual({ ok: false, message: 'No spins left on this order.' });
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
    // No selling days set: the plain calendar rule.
    const s = { ...defaultSettings(), sellingDays: [] };
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
    const sum = summarize({ ...day, countedCash: 2000 + 169 - 10 - 5 }, [r.order, b, c], s);
    expect(sum.orders).toBe(2);
    expect(sum.net).toBe(169 - 10 + 79);
    expect(sum.cash.expected).toBe(2000 + 169 - 10);
    expect(sum.cash.overShort).toBe(-5);
    expect(sum.wheel.find((w) => w.prize === 'tenOff')!.cost).toBe(10);
    expect(sum.voids).toHaveLength(1);
    expect(stockLeft(day, [r.order, b, c], s)['bowl-alaking']).toBe(59);

    const csv = ordersCsv(day, [r.order, b, c], s).split('\n').slice(1).map((row) => row.split(','));
    const net = csv.filter((row) => row[14] === 'no').reduce((n, row) => n + Number(row[12]), 0);
    expect(net).toBe(sum.net);
  });
});

describe('cash buttons', () => {
  it('suggests the bills a customer is likely to hand over', () => {
    expect(cashSuggestions(528)).toEqual([550, 600, 1000]);
    expect(cashSuggestions(179)).toEqual([200, 500, 1000]);
    expect(cashSuggestions(500)).toEqual([1000]);
    expect(cashSuggestions(1240)).toEqual([1250, 1300, 1500, 2000]);
    expect(cashSuggestions(0)).toEqual([]);
  });
});

describe('waste log', () => {
  it('takes stock out and counts as cost', () => {
    const d = { ...day, waste: [{ id: 'w1', itemId: 'bowl-alaking', qty: 2, reason: 'dropped', at: 1, by: 'Ana' }] };
    expect(stockLeft(d, [], s)['bowl-alaking']).toBe(58);
    const sum = summarize(d, [], s);
    expect(sum.waste.cost).toBeCloseTo(215.86, 2);
    expect(sum.profit).toBeCloseTo(-215.86, 2);
  });
});

describe('prize limit', () => {
  it('expects about ₱11 per spin at cost with the starting menu', () => {
    const e = expectedSpinCost(s);
    expect(e.perSpin).toBeGreaterThan(10);
    expect(e.perSpin).toBeLessThan(12);
  });

  it('waits for minimum sales, then warns and asks to pause', () => {
    const base = summarize(day, [], s);
    const at = (gross: number, wheel: number) => promoStatus({ ...base, gross, promo: { ...base.promo, wheel, vouchers: 0 } }, s);
    expect(at(1000, 189).level).toBe('early');
    expect(at(10000, 400).level).toBe('ok');
    expect(at(10000, 700).level).toBe('warn');
    expect(at(10000, 800).level).toBe('pause');
    expect(at(10000, 800).pct).toBe(8);
  });
});

describe('customer monitor', () => {
  it('names best sellers only after a few sales, counting combo parts', () => {
    const a = order([bowl(2)]);
    expect(bestSellers(day, [a], s)).toEqual([]);
    const forCombo = [bowl(), fries(), slush()];
    const b = order(applyCombo(forCombo, suggestCombo(forCombo, s)!, s), {}, [a]);
    expect(bestSellers(day, [a, b], s)).toEqual(['bowl-alaking']);
  });

  it('lists recent wins without "Try again", and spins still waiting', () => {
    const o = order([bowl(2, { id: 'b1' })]);
    expect(pendingSpins(day, [o], o.createdAt + 60000).map((x) => x.id)).toEqual([o.id]);
    const r1 = applyPrize(o, { lineId: 'b1', unit: 0 }, 'tryAgain', ctx);
    if (!r1.ok) throw new Error();
    const r2 = applyPrize(r1.order, { lineId: 'b1', unit: 1 }, 'freeMeal', { ...ctx, now: ctx.now + 1 });
    if (!r2.ok) throw new Error();
    expect(recentWins(day, [r2.order]).map((w) => w.prize)).toEqual(['freeMeal']);
    expect(pendingSpins(day, [r2.order], o.createdAt + 60000)).toEqual([]);
    expect(pendingSpins(day, [o], o.createdAt + 50 * 60000)).toEqual([]);
  });
});

describe('one name per item', () => {
  it('uses the same menu name on every screen and in the export', () => {
    const names = s.menu.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    expect(s.menu.filter((m) => m.kind === 'bowl').map((m) => m.name)).toEqual(['Regular (Original) Chicken Rice Bowl', 'Soy Garlic Chicken Rice Bowl', 'Garlic Butter Chicken Rice Bowl', 'Ala King Chicken Rice Bowl']);
    const forCombo = [bowl(), fries(), slush()];
    const combo = applyCombo(forCombo, suggestCombo(forCombo, s)!, s);
    expect(combo[0].name).toBe('Combo A: Ala King Chicken Rice Bowl + Regular Fries + Watermelon Slushie');
    const o = { ...order(combo), status: 'ready' as const };
    expect(kitchenMadeCounts(day, [o], s).map((r) => r.name)).toEqual(['Ala King Chicken Rice Bowl', 'Regular Fries', 'Watermelon Slushie']);
    expect(ordersCsv(day, [o], s)).toContain('Ala King Chicken Rice Bowl + Regular Fries + Watermelon Slushie');
  });
});

describe('real menu and allergens', () => {
  const item = (id: string) => s.menu.find((m) => m.id === id)!;

  it('labels contains and may-contain separately', () => {
    expect(allergenText(itemTags(item('bowl-original')))).toBe('Contains: Egg, Wheat · May contain: Milk, Soy');
    expect(allergenText(itemTags(item('bowl-soygarlic')))).toBe('Contains: Egg, Wheat, Milk, Soy, Sesame, Shellfish');
    expect(allergenText(itemTags(item('fries-overload')))).toContain('Pork');
    expect(allergenText(itemTags(item('slush-mango')))).toBeNull();
    expect(allergenHint(s.sideAllergens['Cucumber Salad'])).toBe('soy, wheat, sesame');
    expect(allergenHint(s.sideAllergens['Shredded Cabbage'])).toBeUndefined();
    expect(allergenHint(s.dipAllergens['Ranch'])).toBe('egg, milk');
  });

  it('asks for a dip on Regular Fries only, and the 10-stamp reward is the Original bowl', () => {
    expect(needsPicker(item('fries-reg'))).toBe(true);
    expect(needsPicker(item('fries-overload'))).toBe(false);
    expect(needsPicker(item('bowl-alaking'))).toBe(true);
    expect(s.loyalty.rewards.find((r) => r.at === 10)?.itemId).toBe('bowl-original');
  });

  it('formats unit costs with centavos and whole prices without', () => {
    expect(peso(96.04)).toBe('₱96.04');
    expect(peso(215.86000000000001)).toBe('₱215.86');
    expect(peso(1234)).toBe('₱1,234');
    expect(peso(-10)).toBe('−₱10');
  });
});

describe('inventory', () => {
  it('counts down from the kitchen count, ignoring sales before it', () => {
    const a = { ...order([cookie(), cookie()]), status: 'claimed' as const, claimedAt: Date.parse('2026-11-15T12:00:00') + 500 }; // sold and handed over before the count
    const counted = { ...day, stockCounts: { 'cookie-choco': { qty: 30, at: a.createdAt + 1000, by: 'Kitchen' } } };
    const b = { ...order([cookie()], {}, [a]), createdAt: a.createdAt + 2000 };
    const broke = { ...counted, waste: [{ id: 'w', itemId: 'cookie-choco', qty: 2, reason: 'Broken', at: a.createdAt + 3000, by: 'Kitchen' }] };
    expect(stockLeft(broke, [a, b], s)['cookie-choco']).toBe(30 - 1 - 2);
    expect(stockLeft(day, [a, b], s)['cookie-choco']).toBe(40 - 3);
  });

  it('tracks ingredients by count, removals and (optionally) per-item use', () => {
    const ing = { id: 'i', name: 'Chicken', unit: 'kg', low: 3, count: { qty: 20, at: 1000, by: 'K' }, removed: [{ qty: 0.5, reason: 'spoiled', at: 2000, by: 'K' }] };
    const o = { ...order([bowl(4)]), createdAt: 3000 };
    expect(onHand(ing, [o])).toBe(19.5);
    const withUse = { ...ing, uses: { 'bowl-alaking': 0.2 } };
    expect(onHand(withUse, [o])).toBe(18.7);
    expect(servingsLeft(withUse, [o], 'bowl-alaking')).toBe(93);
    expect(onHand({ ...ing, count: undefined }, [o])).toBeNull();
    expect(isLow({ ...ing, count: { qty: 3, at: 1, by: 'K' }, removed: [] }, [])).toBe(true);
  });
});

describe('wait estimate', () => {
  const t0 = Date.parse('2026-11-15T12:00:00');
  const done = (i: number, prepMin: number): Order => ({ ...order([bowl()]), id: 'd' + i, createdAt: t0 + i * 120000, readyAt: t0 + i * 120000 + prepMin * 60000, status: 'ready' });
  const waiting = (i: number): Order => ({ ...order([bowl()]), id: 'w' + i, createdAt: t0 + 20 * 60000 + i, status: 'new' });

  it('uses the starting guess until two orders are done', () => {
    expect(waitMinutes([done(0, 5)], t0, 8)).toBe(8);
  });
  it('follows the real prep time, and grows with the queue', () => {
    const recent = [0, 1, 2, 3, 4].map((i) => done(i, 6));
    expect(waitMinutes(recent, t0, 8)).toBe(6);
    const busy = [...recent, ...[0, 1, 2, 3, 4].map(waiting)];
    expect(waitMinutes(busy, t0, 8)).toBe(16); // 6 min × (1 + 5 waiting ÷ 3 cooked at once)
  });
});

describe('profit per item', () => {
  it('works out profit and margin from the unit costs', () => {
    const m = margins(s);
    const ala = m.items.find((x) => x.id === 'bowl-alaking')!;
    expect(ala.profit).toBeCloseTo(61.07, 2);
    expect(Math.round(ala.pct)).toBe(36);
    const a = m.combos.find((c) => c.name === 'Combo A')!;
    expect(a.low.cost).toBeCloseTo(108.22 + 44.98 + 90.49, 2); // Soy Garlic is the costliest bowl
    expect(Math.round(a.low.pct)).toBe(26);
    expect(Math.round(a.high.pct)).toBe(30);
  });
});

describe('Excel export', () => {
  it('uses the standard zip checksum and column letters', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect([0, 25, 26, 27, 51, 52].map(colName)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });

  it('builds a workbook with the day, sales and profit sheets', async () => {
    const a = order([bowl(), cookie()]);
    const r = applyPrize(a, { lineId: a.lines[0].id, unit: 0 }, 'tenOff', ctx);
    if (!r.ok) throw new Error();
    const b = order([fries()], { method: 'gcash', reference: '0042' }, [a]);
    const d = { ...day, waste: [{ id: 'w', itemId: 'cookie-biscoff', qty: 1, reason: 'Broken', at: 5, by: 'Kitchen' }] };
    const sheets = daySheets(d, [r.order, b], s);
    expect(sheets.map((x) => x.name)).toEqual(['Summary', 'Sales by item', 'Profit per piece', 'Orders', 'Hours', 'Payments', 'Wheel', 'Waste']);

    const bytes = dayXlsx(d, [r.order, b], s);
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]); // "PK"
    const text = new TextDecoder().decode(bytes);
    for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet8.xml']) expect(text).toContain(part);
    // GCash reference keeps its leading zeros (stays text).
    expect(text).toContain('>0042<');

    // Set XLSX_OUT=path to save the file and open it in Excel / openpyxl.
    const out = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.XLSX_OUT;
    if (out) {
      const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { writeFileSync: (p: string, d: Uint8Array) => void };
      fs.writeFileSync(out, bytes);
    }
  });
});

describe('Popular tab and customer names', () => {
  it('starts from the menu order, then follows what sells today', () => {
    const empty = popularToday(day, [], s);
    expect(empty.slice(0, 4).map((e) => e.id)).toEqual(['bowl-original', 'bowl-soygarlic', 'bowl-garlicbutter', 'bowl-alaking']);
    expect(empty).toHaveLength(8);
    const a = order([cookie(), cookie(), cookie()]);
    const forCombo = [bowl(), fries(), slush()];
    const b = order(applyCombo(forCombo, suggestCombo(forCombo, s)!, s), {}, [a]);
    const top = popularToday(day, [a, b], s);
    expect(top[0]).toEqual({ type: 'item', id: 'cookie-choco' });
    expect(top[1]).toEqual({ type: 'combo', id: 'comboA' });
  });

  it('keeps only a tidy first name on the order', () => {
    expect(order([bowl()], { customerName: '  Ana   Marie  ' }).customerName).toBe('Ana Marie');
    expect(order([bowl()], { customerName: '   ' }).customerName).toBeUndefined();
    expect(cleanName('x'.repeat(40))).toHaveLength(20);
  });
});

describe('loyalty card list', () => {
  const card = (number: string, name: string) => ({ number, mode: 'demo' as const, name, createdAt: 1, updatedAt: 1, by: 'Ana' });

  it('lists named cards and cards used on orders, with stamps and rewards', () => {
    const orders: Order[] = [];
    for (let i = 0; i < 5; i++) orders.push({ ...order([bowl()], { cardId: 'CCB-037' }, orders), createdAt: 1000 + i });
    orders.push({ ...order([bowl()], { cardId: 'CCB-090' }, orders), createdAt: 9000 });
    const rows = cardRows([card('CCB-037', 'Ana Reyes'), card('CCB-012', 'Ben')], orders, s);
    expect(rows.map((r) => r.number)).toEqual(['CCB-090', 'CCB-037', 'CCB-012']); // newest activity first
    const ana = rows.find((r) => r.number === 'CCB-037')!;
    expect([ana.name, ana.registered, ana.stamps, ana.visits]).toEqual(['Ana Reyes', true, 5, 5]);
    expect(ana.rewardsReady).toEqual(['Free Regular Fries']);
    const unnamed = rows.find((r) => r.number === 'CCB-090')!;
    expect([unnamed.registered, unnamed.name, unnamed.stamps]).toEqual([false, '', 1]);
    expect(rows.find((r) => r.number === 'CCB-012')!.visits).toBe(0);
  });

  it('does not count voided orders and finds cards by number or part of the name', () => {
    const o = { ...order([bowl()], { cardId: 'CCB-005' }), voided: { reason: 'x', at: 1, by: 'm' } };
    expect(cardRows([], [o], s)).toEqual([]);
    const rows = cardRows([card('CCB-037', 'Ana Reyes'), card('CCB-112', 'Joana')], [], s);
    expect(searchCards(rows, '37').map((r) => r.number)).toEqual(['CCB-037']);
    expect(searchCards(rows, 'ccb-112').map((r) => r.number)).toEqual(['CCB-112']);
    expect(searchCards(rows, 'ana').map((r) => r.number).sort()).toEqual(['CCB-037', 'CCB-112']);
    expect(searchCards(rows, '')).toHaveLength(2);
  });

  it('keeps practice and real cards apart and tidies names', () => {
    expect(cardDocId('demo', 'CCB-037')).not.toBe(cardDocId('live', 'CCB-037'));
    expect(cleanCardName('  Ana   Marie  ')).toBe('Ana Marie');
    expect(cleanCardName('x'.repeat(50))).toHaveLength(30);
  });
});

describe('editing stamps by hand', () => {
  const adj = (delta: number, at: number, reason = 'Stamps from the paper card') => ({ delta, reason, at, by: 'Ana' });

  it('adds paper-card stamps in the order things happened', () => {
    // 4 stamps from the paper card, then two paid visits.
    const o1 = { ...order([bowl()], { cardId: 'CCB-050' }), createdAt: 2000 };
    const o2 = { ...order([bowl()], { cardId: 'CCB-050' }, [o1]), createdAt: 3000 };
    const st = cardState('CCB-050', [o1, o2], s, undefined, [adj(4, 1000)]);
    expect(st.stamps).toBe(6);
    expect(availableRewards(st, s).map((r) => r.at)).toEqual([5]);
  });

  it('can remove stamps, never goes below 0 or above a full card', () => {
    expect(cardState('CCB-050', [], s, undefined, [adj(3, 1), adj(-5, 2, 'Wrong stamp given')]).stamps).toBe(0);
    expect(cardState('CCB-050', [], s, undefined, [adj(9, 1), adj(9, 2)]).stamps).toBe(10);
  });

  it('lists a card that only holds adjustments, with the hand-added total', () => {
    const c = { number: 'CCB-060', mode: 'demo' as const, name: '', createdAt: 1, updatedAt: 1, by: 'Ana', adjustments: [adj(4, 5), adj(-1, 6, 'Wrong stamp given')] };
    const row = cardRows([c], [], s)[0];
    expect([row.stamps, row.adjusted, row.registered, row.name]).toEqual([3, 3, false, '']);
    expect(cardStateFor('CCB-060', [], s, [c]).stamps).toBe(3);
  });

  it('a voided order still takes its own stamp back but keeps the hand-added ones', () => {
    const o = { ...order([bowl()], { cardId: 'CCB-070' }), createdAt: 2000, voided: { reason: 'x', at: 1, by: 'm' } };
    expect(cardState('CCB-070', [o], s, undefined, [adj(2, 1000)]).stamps).toBe(2);
  });
});

// ---------- Audit fixes ----------

const at = (iso: string) => Date.parse(iso);
const voidedBy = { reason: 'mistake', at: 1, by: 'Boss' };

describe('wait estimate (prep time, not customer arrivals)', () => {
  const t0 = at('2026-11-15T12:00:00');
  const made = (i: number, gapMin: number, prepMin: number): Order => ({ ...order([bowl()]), id: 'm' + i, createdAt: t0 + i * gapMin * 60000, readyAt: t0 + i * gapMin * 60000 + prepMin * 60000, status: 'ready' });
  const queued = (i: number): Order => ({ ...order([bowl()]), id: 'q' + i, createdAt: t0 + 200 * 60000 + i, status: 'new' });
  const slow = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => made(i, 15, 5)); // a quiet hour: 15 min between customers

  it('shows the prep time when nobody is waiting, however far apart customers came', () => {
    expect(waitMinutes(slow, t0, 8)).toBe(5);
  });
  it('adds a third of the prep time per waiting order', () => {
    expect(waitMinutes([...slow, ...[0, 1, 2, 3, 4].map(queued)], t0, 8)).toBe(13);
  });
  it('ignores impossible prep times and never promises more than 45 minutes', () => {
    const skewed = [...slow, { ...made(20, 15, -3), id: 'x1' }, { ...made(21, 15, 600), id: 'x2' }, { ...made(22, 15, 0), id: 'x3' }];
    expect(waitMinutes(skewed, t0, 8)).toBe(5);
    const long = [0, 1, 2].map((i) => made(i, 1, 30));
    expect(waitMinutes([...long, ...Array.from({ length: 10 }, (_, i) => queued(i))], t0, 8)).toBe(45);
  });
});

describe('prize cash-back limits', () => {
  it('never hands back more than the customer has paid (refund, then a spin)', () => {
    const o = order([bowl(1, { id: 'b1' })]);
    const refunded = { ...o, refunds: [{ amount: 160, reason: 'Wrong order', at: 5, by: 'Boss' }] };
    const r = applyPrize(refunded, { lineId: 'b1', unit: 0 }, 'freeMeal', ctx);
    if (!r.ok) throw new Error(r.message);
    expect(r.spin.refund).toBe(9);
    expect(summarize(day, [r.order], s).net).toBe(0);
    const ten = applyPrize(refunded, { lineId: 'b1', unit: 0 }, 'tenOff', ctx);
    expect(ten.ok && ten.spin.refund).toBe(9);
  });

  it('counts earlier prize cash: two free meals on a voucher-free order cannot exceed what was paid', () => {
    const o = order([bowl(2, { id: 'b1' })]);
    const paidLess = { ...o, payment: { ...o.payment, due: 200 } };
    const r1 = applyPrize(paidLess, { lineId: 'b1', unit: 0 }, 'freeMeal', ctx);
    if (!r1.ok) throw new Error(r1.message);
    const r2 = applyPrize(r1.order, { lineId: 'b1', unit: 1 }, 'freeMeal', ctx);
    expect(r2.ok && r2.spin.refund).toBe(200 - 169);
  });

  it('refuses a voided order and a bowl that is not on the line', () => {
    const o = order([bowl(2, { id: 'b1' })]);
    expect(applyPrize({ ...o, voided: voidedBy }, { lineId: 'b1', unit: 0 }, 'tenOff', ctx)).toEqual({ ok: false, message: 'This order was voided.' });
    for (const unit of [2, -1, 0.5]) expect(applyPrize(o, { lineId: 'b1', unit }, 'tenOff', ctx).ok).toBe(false);
    expect(applyPrize(o, { lineId: 'b1', unit: 1 }, 'tenOff', ctx).ok).toBe(true);
  });

  it('tells the cashier to hand a free item over when the kitchen is already done', () => {
    const o = order([bowl(1, { id: 'b1' })]);
    const cooking = applyPrize(o, { lineId: 'b1', unit: 0 }, 'freeWater', ctx);
    expect(cooking.ok && cooking.message).toBe('Bottled Water added free. Kitchen will see it.');
    for (const status of ['ready', 'claimed'] as const) {
      const r = applyPrize({ ...o, status }, { lineId: 'b1', unit: 0 }, 'freeWater', ctx);
      expect(r.ok && r.message).toBe('Bottled Water is free: hand it over now (the kitchen is already done with this order).');
    }
  });
});

describe('selling days and vouchers', () => {
  const win = (iso: string, settings = s) => {
    const o = { ...order([bowl(1, { id: 'b1' })], { now: at(iso) }) };
    return applyPrize(o, { lineId: 'b1', unit: 0 }, 'voucher', { ...ctx, settings, now: at(iso) + 60000, rand: () => 0 });
  };

  it('knows the bazaar days: Nov 23, 24, 25 and 27', () => {
    expect(s.sellingDays).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-27']);
    expect(nextSellingDay('2026-11-25', s)).toBe('2026-11-27');
    expect(nextSellingDay('2026-11-20', s)).toBe('2026-11-23');
    expect(nextSellingDay('2026-11-27', s)).toBeNull();
    expect(isLastSellingDay('2026-11-25', s)).toBe(false);
    expect(isLastSellingDay('2026-11-27', s)).toBe(true);
    expect(isLastSellingDay('2026-11-27', { ...s, sellingDays: [] })).toBe(false);
  });

  it('a voucher won on Nov 25 is valid on Nov 27, skipping the holiday', () => {
    const r = win('2026-11-25T18:00:00');
    if (!r.ok) throw new Error(r.message);
    const code = r.spin.voucherCode!;
    expect(voucherWindow('2026-11-25', s)).toEqual({ validFrom: '2026-11-27', validTo: '2026-11-27' });
    expect(checkVoucher(code, [r.order], s, '2026-11-26', 200)).toEqual({ ok: false, message: 'Valid from 2026-11-27.' });
    expect(checkVoucher(code, [r.order], s, '2026-11-27', 200).ok).toBe(true);
    expect(checkVoucher(code, [r.order], s, '2026-11-28', 200).ok).toBe(false);
  });

  it('counts validDays in selling days and falls back to the calendar when none are left', () => {
    expect(voucherWindow('2026-11-24', { ...s, voucher: { ...s.voucher, validDays: 2 } })).toEqual({ validFrom: '2026-11-25', validTo: '2026-11-27' });
    expect(voucherWindow('2026-11-25', { ...s, voucher: { ...s.voucher, validDays: 5 } })).toEqual({ validFrom: '2026-11-27', validTo: '2026-11-27' });
    expect(voucherWindow('2026-11-27', s)).toEqual({ validFrom: '2026-11-28', validTo: '2026-11-28' });
    expect(voucherWindow('2026-11-15', { ...s, sellingDays: [] })).toEqual({ validFrom: '2026-11-16', validTo: '2026-11-16' });
  });

  it('on Nov 27 (the last day) a voucher spin becomes ₱10 off instead', () => {
    const r = win('2026-11-27T15:00:00');
    if (!r.ok) throw new Error(r.message);
    expect(r.spin.prize).toBe('tenOff');
    expect(r.spin.refund).toBe(10);
    expect(r.spin.voucherCode).toBeUndefined();
    expect(r.message).toBe('Last day, so no voucher: ₱10 off. Give back ₱10 cash.');
    expect(r.order.spins[0].prize).toBe('tenOff');
  });

  it('the stand-in prize follows the setting, and "voucher" just issues the voucher', () => {
    const water = win('2026-11-27T15:00:00', { ...s, voucher: { ...s.voucher, lastDayPrize: 'freeWater' } });
    expect(water.ok && water.spin.prize).toBe('freeWater');
    expect(water.ok && water.message.startsWith('Last day, so no voucher: Bottled Water')).toBe(true);
    const keep = win('2026-11-27T15:00:00', { ...s, voucher: { ...s.voucher, lastDayPrize: 'voucher' } });
    expect(keep.ok && keep.spin.voucherCode).toBe('V-AAAA');
    expect(keep.ok && keep.message.startsWith('Write this code')).toBe(true);
    // Not the last day: an ordinary voucher.
    const early = win('2026-11-24T15:00:00');
    expect(early.ok && early.spin.prize).toBe('voucher');
  });

  it('reads a typed code whose letters start with V, and new codes never contain V', () => {
    expect(normalizeVoucher('v-vabc')).toBe('V-VABC');
    expect(normalizeVoucher('VVABC')).toBe('V-VABC');
    expect(normalizeVoucher('vabc')).toBe('V-VABC');
    expect(normalizeVoucher(' v abcd ')).toBe('V-ABCD');
    expect(normalizeVoucher('abcd')).toBe('V-ABCD');
    const o = order([bowl(1, { id: 'b1' })], { now: at('2026-11-23T12:00:00') });
    const old = { ...o, spinsEarned: 1, spins: [{ lineId: 'b1', unit: 0, prize: 'voucher' as const, refund: 0, voucherCode: 'V-VABC', via: 'physical' as const, at: at('2026-11-23T12:01:00') }] };
    for (const typed of ['vabc', 'V-VABC', 'vvabc']) expect(checkVoucher(typed, [old], s, '2026-11-24', 200).ok).toBe(true);
    for (let i = 0; i < 100; i++) expect(makeVoucherCode(() => i / 100).slice(2)).not.toContain('V');
  });
});

describe('card numbers and stamp edits', () => {
  it('only reads a clean card number', () => {
    for (const bad of ['3.7', '1e2', 'Ana 7', 'card 12 (2 stamps)', '-', '', 'CCB', '1234567', '12 3']) expect(parseCard(bad, s)).toBeNull();
    for (const ok of ['37', ' 037 ', 'ccb37', 'CCB-037', 'ccb 37', 'Ccb - 37']) expect(parseCard(ok, s)).toBe('CCB-037');
  });

  it('a card over a full card does not drop when one stamp is added or removed', () => {
    const orders: Order[] = [];
    for (let i = 0; i < 12; i++) orders.push({ ...order([bowl()], { cardId: 'CCB-080' }, orders), createdAt: 100 + i });
    const adj = (delta: number) => [{ delta, reason: 'fix', at: 5000, by: 'Ana' }];
    expect(cardState('CCB-080', orders, s).stamps).toBe(12);
    expect(cardState('CCB-080', orders, s, undefined, adj(1)).stamps).toBe(12);
    expect(cardState('CCB-080', orders, s, undefined, adj(-1)).stamps).toBe(11);
  });
});

describe('checking the cart again before paying', () => {
  const left = Object.fromEntries(s.menu.map((m) => [m.id, m.startStock]));
  const base = { settings: s, today: '2026-11-24', rewardsRedeemed: [] as number[], left, soldOut: {} as Record<string, boolean> };
  const wonOrder = (() => {
    const o = order([bowl(1, { id: 'b1' })], { now: at('2026-11-23T12:00:00') });
    const r = applyPrize(o, { lineId: 'b1', unit: 0 }, 'voucher', { ...ctx, now: at('2026-11-23T12:01:00'), rand: () => 0 });
    if (!r.ok) throw new Error(r.message);
    return r.order;
  })();
  const voucher = { code: 'V-AAAA', amount: 20 };

  it('passes a good cart', () => {
    expect(checkCart({ ...base, lines: [bowl()], orders: [wonOrder], voucher })).toBeNull();
  });

  it('catches a voucher that a parked cart or second device already used', () => {
    const lines = [bowl()];
    const first = { ...order([bowl()], { voucher, now: at('2026-11-24T10:00:00') }, [wonOrder]), id: 'first' };
    const problem = checkCart({ ...base, lines, orders: [wonOrder, first], voucher });
    expect(problem).toContain(`Already used on order ${first.number}.`);
    // And a cart that dropped below the minimum after the voucher went on.
    expect(checkCart({ ...base, lines: [fries()], orders: [wonOrder], voucher })).toContain('at least ₱150');
  });

  it('catches a loyalty reward that is no longer there', () => {
    const state = { cardId: 'CCB-001', stamps: 6, used: [5], cardsCompleted: 0, orders: 6 };
    expect(checkCart({ ...base, lines: [fries()], orders: [], cardState: state, rewardsRedeemed: [5] })).toContain('already used');
    expect(checkCart({ ...base, lines: [fries()], orders: [], cardState: null, rewardsRedeemed: [5] })).toContain('loyalty card');
    expect(checkCart({ ...base, lines: [fries()], orders: [], cardState: { ...state, used: [] }, rewardsRedeemed: [5] })).toBeNull();
  });

  it('catches items that sold out or ran short, by name', () => {
    expect(checkCart({ ...base, lines: [cookie()], orders: [], soldOut: { 'cookie-choco': true } })).toContain('Choco Chip Cookie');
    const short = checkCart({ ...base, lines: [bowl(3)], orders: [], left: { ...left, 'bowl-alaking': 2 } });
    expect(short).toBe('Only 2 Ala King Chicken Rice Bowl left, but the order has 3.');
    const sauce = checkCart({ ...base, lines: [bowl(1, { choices: { extraSauce: 2 } })], orders: [], left: { ...left, 'extra-sauce': 0 } });
    expect(sauce).toContain('Extra Sauce');
  });
});

describe('paying', () => {
  it('refuses a cash amount that is not a real number', () => {
    for (const tendered of [NaN, Infinity, 1_000_001]) expect(() => order([bowl()], { tendered })).toThrow();
    expect(order([bowl()], { tendered: 1_000_000 }).payment.change).toBe(1_000_000 - 169);
  });

  it('gives two devices on the same letter different order ids, same number', () => {
    const a = order([bowl()]);
    const b = order([bowl()]);
    expect(a.number).toBe(b.number);
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^demo-2026-11-15_A1_[a-z0-9]{4}$/);
  });

  it('spots a GCash reference typed twice today', () => {
    const a = order([bowl()], { method: 'gcash', reference: 'ab 1234' });
    expect(duplicateReference([a], day.id, 'AB1234')?.id).toBe(a.id);
    expect(duplicateReference([a], day.id, ' ')).toBeUndefined();
    expect(duplicateReference([a], 'other-day', 'AB1234')).toBeUndefined();
    expect(duplicateReference([{ ...a, voided: voidedBy }], day.id, 'AB1234')).toBeUndefined();
    expect(duplicateReference([order([bowl()], { reference: 'AB1234' })], day.id, 'AB1234')).toBeUndefined(); // cash
    expect(duplicateReference([order([bowl()], { method: 'gcash' })], day.id, '')).toBeUndefined();
  });
});

describe('history is not re-priced', () => {
  it('keeps the extras prices and unit costs an order was sold at', () => {
    const cart = [bowl(2, { id: 'b1', choices: { side: 'Butter Corn Carrot', extraSides: ['Shredded Cabbage'], extraSauce: 1 } })];
    const o = order(cart);
    expect(cart[0].costEach).toBeUndefined(); // the cart itself is not changed
    expect(o.lines[0]).toMatchObject({ extraSidePrice: 20, extraSaucePrice: 10 });
    expect(o.lines[0].costEach).toBeCloseTo(107.93 + 7 + 3, 2);

    const before = summarize(day, [o], s);
    const later = { ...s, extraSidePrice: 35, extraSaucePrice: 15, menu: s.menu.map((m) => ({ ...m, unitCost: m.unitCost * 2 })) };
    const after = summarize(day, [o], later);
    expect(lineTotal(o.lines[0], later)).toBe((169 + 20 + 10) * 2);
    expect(after.items[0].sales).toBe(before.items[0].sales);
    expect(after.cost).toBeCloseTo(before.cost, 2);
    expect(after.profit).toBeCloseTo(before.profit, 2);
    // A new cart uses the new prices; an old line without snapshots follows Setup as before.
    expect(lineTotal(cart[0], later)).toBe((169 + 35 + 15) * 2);
    expect(orderCost({ ...o, lines: cart }, later)).toBeCloseTo((107.93 + 7 + 3) * 2 * 2, 2);
  });

  it('remembers the cost of a free wheel item', () => {
    const o = order([bowl(1, { id: 'b1' })]);
    const r = applyPrize(o, { lineId: 'b1', unit: 0 }, 'freeCookie', ctx);
    if (!r.ok) throw new Error(r.message);
    expect(r.order.lines.find((l) => l.id === r.spin.addedLineId)!.costEach).toBeCloseTo(34.08, 2);
  });
});

describe('reports: promo at cost, voids, recounts', () => {
  const spin = (o: Order, prize: Parameters<typeof applyPrize>[2], unit = 0, lineId = 'b1') => {
    const r = applyPrize(o, { lineId, unit }, prize, ctx);
    if (!r.ok) throw new Error(r.message);
    return r.order;
  };

  it('counts a FREE MEAL at the cost of the bowl, and keeps the books adding up', () => {
    const a = spin(order([bowl(1, { id: 'b1', choices: { side: 'Butter Corn Carrot', extraSauce: 1 } })]), 'freeMeal');
    const b = spin(order([bowl(1, { id: 'b1' }), cookie()], {}, [a]), 'tenOff');
    const c = spin(order([bowl(1, { id: 'b1' })], {}, [a, b]), 'freeCookie');
    const won = { ...order([bowl(1, { id: 'b1' })], { now: at('2026-11-14T12:00:00') }), id: 'yesterday', dayId: 'other', spinsEarned: 1, spins: [{ lineId: 'b1', unit: 0, prize: 'voucher' as const, refund: 0, voucherCode: 'V-AAAA', via: 'physical' as const, at: at('2026-11-14T12:00:00') }] };
    const d = order([bowl(), fries()], { voucher: { code: 'V-AAAA', amount: 20 } }, [a, b, c]);
    const reward: OrderLine = { ...fries(), unitPrice: 0, free: { reason: 'reward', stampsAt: 5 } };
    const e = { ...order([bowl(), reward], { cardId: 'CCB-001', rewardsRedeemed: [5] }, [a, b, c, d]), refunds: [{ amount: 30, reason: 'Cold food', at: 9, by: 'Boss' }] };
    const dd = { ...day, waste: [{ id: 'w1', itemId: 'water', qty: 2, reason: 'dropped', at: 1, by: 'Ana' }] };
    const sum = summarize(dd, [won, a, b, c, d, e], s);

    const bowlCost = 107.93 + 3;
    expect(sum.wheel.find((w) => w.prize === 'freeMeal')!.cost).toBeCloseTo(bowlCost, 2);
    expect(sum.wheel.find((w) => w.prize === 'tenOff')!.cost).toBe(10);
    expect(sum.wheel.find((w) => w.prize === 'freeCookie')!.cost).toBeCloseTo(34.08, 2);
    expect(sum.promo.wheel).toBeCloseTo(bowlCost + 10 + 34.08, 2);
    expect(sum.promo.cashBack).toBe(179 + 10);
    expect(sum.prizeRefunds).toBe(179 + 10);
    expect(sum.promo.vouchers).toBe(20);

    expect(sum.grossSales).toBe(179 + (169 + 89) + 169 + (169 + 79) + 169 - 179);
    expect(sum.discounts).toBe(20 + 10);
    expect(sum.giveawaysAtCost).toBeCloseTo(bowlCost + 34.08 + 44.98, 2);
    expect(sum.grossSales - sum.discounts - sum.manualRefunds).toBe(sum.net);
    expect(sum.net - sum.cogsSold - sum.giveawaysAtCost - sum.waste.cost).toBeCloseTo(sum.profit, 6);
    expect(sum.profit).toBeCloseTo(sum.net - sum.cost, 6);
    expect(sum.cogsSold).toBeCloseTo(107.93 * 4 + 34.08 + 44.98, 2);
  });

  it('a GCash order with ₱10 off takes ₱10 out of the drawer', () => {
    const a = spin(order([bowl(1, { id: 'b1' })], { method: 'gcash', reference: '77' }), 'tenOff');
    const sum = summarize(day, [a], s);
    expect(sum.cash.cashSales).toBe(0);
    expect(sum.cash.paidOut).toBe(10);
    expect(sum.cash.expected).toBe(2000 - 10);
    expect(sum.net).toBe(159);
  });

  it('void after a prize: cash nets to zero, GCash is paid back from the drawer', () => {
    const cash = { ...spin(order([bowl(1, { id: 'b1' })]), 'tenOff') };
    expect(voidReturnAmount(cash)).toBe(159);
    const cashSum = summarize(day, [{ ...cash, voided: voidedBy }], s);
    expect(cashSum.cash.voidReturns).toBe(0);
    expect(cashSum.cash.expected).toBe(2000); // 169 in, 10 prize + 159 back out
    expect(cashSum.net).toBe(0);

    const gcash = spin(order([bowl(1, { id: 'b1' })], { method: 'gcash', reference: '77' }), 'tenOff');
    expect(voidReturnAmount(gcash)).toBe(159);
    const gSum = summarize(day, [{ ...gcash, voided: voidedBy }], s);
    expect(gSum.cash.voidReturns).toBe(169); // 10 prize cash + 159 handed back at the void
    expect(gSum.cash.expected).toBe(2000 - 169);
    expect(voidReturnAmount({ ...gcash, refunds: [{ amount: 500, reason: 'x', at: 1, by: 'b' }] })).toBe(0);
  });

  it('an order voided after cooking still used its food and counts as waste', () => {
    const made = { ...order([bowl(2)]), status: 'ready' as const, voided: voidedBy };
    const notMade = { ...order([bowl()], {}, [made]), voided: voidedBy };
    expect(stockLeft(day, [made, notMade], s)['bowl-alaking']).toBe(58);
    const sum = summarize(day, [made, notMade], s);
    expect(sum.waste.rows).toEqual([{ itemId: 'voided', name: 'Voided after cooking', qty: 1, cost: expect.closeTo(215.86, 2) }]);
    expect(sum.cost).toBeCloseTo(215.86, 2);
    expect(sum.profit).toBeCloseTo(-215.86, 2);
    expect(sum.orders).toBe(0);
    expect(sum.net - sum.cogsSold - sum.giveawaysAtCost - sum.waste.cost).toBeCloseTo(sum.profit, 6);
  });

  it('recount: an order still cooking at count time comes off the counted number', () => {
    const t = at('2026-11-15T12:00:00');
    const count = { ...day, stockCounts: { 'cookie-choco': { qty: 30, at: t + 10_000, by: 'Kitchen' } } };
    const o = order([cookie()]); // placed at t, before the count
    expect(stockLeft(count, [{ ...o, status: 'new' }], s)['cookie-choco']).toBe(29);
    expect(stockLeft(count, [{ ...o, status: 'cooking' }], s)['cookie-choco']).toBe(29);
    expect(stockLeft(count, [{ ...o, status: 'ready', readyAt: t + 20_000 }], s)['cookie-choco']).toBe(29);
    expect(stockLeft(count, [{ ...o, status: 'claimed', readyAt: t + 5_000, claimedAt: t + 20_000 }], s)['cookie-choco']).toBe(30);
    expect(stockLeft(count, [{ ...o, status: 'ready', readyAt: t + 5_000 }], s)['cookie-choco']).toBe(30);
    // Ingredients follow the same rule.
    const ing = { id: 'i', name: 'Dough', unit: 'pcs', low: 0, count: { qty: 10, at: t + 10_000, by: 'K' }, uses: { 'cookie-choco': 1 } };
    expect(onHand(ing, [{ ...o, status: 'cooking' }])).toBe(9);
    expect(onHand(ing, [{ ...o, status: 'ready', readyAt: t + 5_000 }])).toBe(10);
  });

  it('recount: a free prize item counts from the spin, not from the order', () => {
    const t = at('2026-11-15T12:00:00');
    const o = { ...order([bowl(1, { id: 'b1' })]), status: 'claimed' as const, readyAt: t + 1000, claimedAt: t + 2000 };
    const r = applyPrize(o, { lineId: 'b1', unit: 0 }, 'freeCookie', { ...ctx, now: t + 60_000 });
    if (!r.ok) throw new Error(r.message);
    const count = { ...day, stockCounts: { 'cookie-choco': { qty: 30, at: t + 30_000, by: 'Kitchen' }, 'bowl-alaking': { qty: 50, at: t + 30_000, by: 'Kitchen' } } };
    const left = stockLeft(count, [r.order], s);
    expect(left['cookie-choco']).toBe(29); // spun after the count
    expect(left['bowl-alaking']).toBe(50); // eaten before the count
  });

  it('does not ask a fully refunded order to spin', () => {
    const o = order([bowl(1, { id: 'b1' })]);
    expect(pendingSpins(day, [o], o.createdAt + 1000)).toHaveLength(1);
    const refunded = { ...o, refunds: [{ amount: 169, reason: 'x', at: 1, by: 'Boss' }] };
    expect(pendingSpins(day, [refunded], o.createdAt + 1000)).toEqual([]);
  });

  it('CSV: text that looks like a formula is defused, amounts stay numbers', () => {
    expect(csvCell('=1+1', true)).toBe("'=1+1");
    expect(csvCell('@SUM(A1)', true)).toBe("'@SUM(A1)");
    expect(csvCell('-cmd', true)).toBe("'-cmd");
    expect(csvCell('\tx', true)).toBe("'\tx");
    expect(csvCell('a\rb', true)).toBe('"a\rb"');
    expect(csvCell('-20')).toBe('-20');
    expect(csvCell(-20)).toBe('-20');
    const o = spin(order([bowl(1, { id: 'b1' }), { ...cookie(), notes: '+63 call me' }], { cashier: '=HYPERLINK("x")', method: 'gcash', reference: '-99' }), 'tenOff');
    const csv = ordersCsv(day, [o], s);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(",'-99,");
    expect(csv).toContain(',-10,'); // the payback amount is still a number
    expect(csv).toContain("'+63 call me");
  });

  it('Excel: adds the new summary lines and drops characters Excel cannot open', () => {
    const o = order([bowl()], { cashier: 'Ana￿￾B' });
    const labels = daySheets(day, [o], s)[0].rows.map((r) => {
      const c = r[0] as string | { v: string | number } | undefined;
      return typeof c === 'object' ? c.v : c;
    });
    for (const label of ['Gross sales', 'Discounts', 'Giveaways at cost', 'COGS of items sold', '− Void returns from drawer']) expect(labels).toContain(label);
    const text = new TextDecoder().decode(dayXlsx(day, [o], s));
    expect(text).toContain('>AnaB<');
  });

  it('promo limit: 6.499999999999999% counts as 6.5%', () => {
    const base = summarize(day, [], s);
    const st = promoStatus({ ...base, gross: 10000, promo: { ...base.promo, wheel: 649.9999999, vouchers: 0 } }, s);
    expect(st.pct).toBeLessThan(6.5);
    expect(st.level).toBe('warn');
  });
});

describe('vouchers before the bazaar (practice runs)', () => {
  it('uses the plain next-day rule before the first selling day', () => {
    expect(voucherWindow('2026-11-21', s)).toEqual({ validFrom: '2026-11-22', validTo: '2026-11-22' });
    expect(voucherWindow('2026-11-25', s)).toEqual({ validFrom: '2026-11-27', validTo: '2026-11-27' });
  });
});

describe('recount after a void', () => {
  it('takes an order voided while cooking off the stock once, not again after every recount', () => {
    const o: Order = { ...order([cookie()]), createdAt: 500, status: 'cooking', voided: { reason: 'left', at: 1000, by: 'Boss' } };
    const item = o.lines[0].itemId;
    const counted = { ...day, stockCounts: { [item]: { qty: 30, at: 5000, by: 'Kitchen' } } };
    expect(stockLeft(counted, [o], s)[item]).toBe(30);
    // Voided after the count: the food was in the counted stock and is now gone.
    const later: Order = { ...o, voided: { reason: 'left', at: 9000, by: 'Boss' } };
    expect(stockLeft(counted, [later], s)[item]).toBe(29);
  });
});
