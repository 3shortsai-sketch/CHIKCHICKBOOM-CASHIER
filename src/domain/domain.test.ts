import { describe, expect, it } from 'vitest';
import { cashSuggestions, cleanName, createOrder, nextSeq } from './checkout';
import { defaultSettings } from './defaults';
import { availableRewards, canRedeem, cardState, checkVoucher, parseCard } from './loyalty';
import { applyCombo, lineTotal, needsPicker, peso, spinsEarned, stockUsage, subtotal, suggestCombo } from './pricing';
import { allergenHint, allergenText, itemTags } from './allergens';
import { isLow, margins, onHand, servingsLeft, waitMinutes } from './inventory';
import { dayXlsx, daySheets } from './excel';
import { colName, crc32 } from './xlsx';
import { bestSellers, kitchenMadeCounts, ordersCsv, pendingSpins, popularToday, recentWins, stockLeft, summarize } from './reports';
import { expectedSpinCost, promoStatus } from './promo';
import type { BusinessDay, MenuItem, Order, OrderLine } from './types';
import { applyPrize, digitalSpin, undoLastSpin } from './wheel';

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
  it('expects about ₱14 per spin with the starting menu', () => {
    const e = expectedSpinCost(s);
    expect(e.perSpin).toBeGreaterThan(13);
    expect(e.perSpin).toBeLessThan(15);
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
    const a = order([cookie(), cookie()]); // sold before the count
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
    expect(waitMinutes(busy, t0, 8)).toBe(12); // 6 orders ahead incl. yours × 2 min apart
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
