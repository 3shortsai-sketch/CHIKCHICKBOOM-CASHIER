import type { DaySummary } from './reports';
import type { Settings } from './types';

/** Share of voucher prizes we assume actually get used the next day. */
export const VOUCHER_USE_RATE = 0.5;

function avg(ns: number[]): number {
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0;
}

/**
 * What one spin costs on average, at cost, from the current menu and wheel.
 * Every item bought spins, so a Free meal costs the ingredients of an
 * average item; free items their ingredients; ₱10 off its cash; vouchers
 * half their value (not all get used); a double stamp one tenth of a free bowl.
 * pctOfBowl is the cost as a % of the average price of an item that spins.
 */
export function expectedSpinCost(s: Settings): { perSpin: number; pctOfBowl: number } {
  const active = s.menu.filter((m) => m.active);
  const bowls = active.filter((m) => m.kind === 'bowl');
  const spinning = active.filter((m) => m.kind !== 'water' && m.category !== 'addons');
  const itemPrice = avg(spinning.map((m) => m.price));
  const cheapest = (kind: string) => {
    const items = active.filter((m) => m.kind === kind).sort((a, b) => a.price - b.price);
    return items[0]?.unitCost ?? 0;
  };
  const cost: Record<string, number> = {
    // Promo cost is counted at cost: a free meal costs the booth its ingredients.
    freeMeal: avg(spinning.map((m) => m.unitCost)),
    freeCookie: cheapest('cookie'),
    freeWater: cheapest('water'),
    freeSauce: cheapest('extraSauce'),
    doubleStamp: avg(bowls.map((m) => m.unitCost)) / Math.max(1, s.loyalty.cardSize),
    tenOff: Math.min(10, itemPrice),
    voucher: s.voucher.amount * VOUCHER_USE_RATE,
    comboVoucher: (s.voucher.comboAmount ?? 15) * VOUCHER_USE_RATE,
    tryAgain: 0,
  };
  const total = s.wheel.slots.reduce((n, w) => n + w.slots, 0) || 1;
  const perSpin = s.wheel.slots.reduce((n, w) => n + w.slots * (cost[w.prize] ?? 0), 0) / total;
  return { perSpin, pctOfBowl: itemPrice ? (perSpin / itemPrice) * 100 : 0 };
}

export type PromoLevel = 'early' | 'ok' | 'warn' | 'pause';

/** Wheel prizes (at cost) + vouchers used, as % of what customers paid today. */
export function promoStatus(sum: DaySummary, s: Settings): { pct: number; cost: number; level: PromoLevel } {
  const cost = sum.promo.wheel + sum.promo.vouchers;
  const pct = sum.gross > 0 ? (cost / sum.gross) * 100 : 0;
  // Compare to two decimals, so 6.499999999999999 counts as 6.5.
  const shown = Math.round(pct * 100) / 100;
  const { warnPct, pausePct, minSales } = s.promoLimits;
  let level: PromoLevel = 'ok';
  if (sum.gross < minSales) level = 'early';
  else if (shown >= pausePct) level = 'pause';
  else if (shown >= warnPct) level = 'warn';
  return { pct, cost, level };
}
