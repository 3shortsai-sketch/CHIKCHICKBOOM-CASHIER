import type { DaySummary } from './reports';
import type { Settings } from './types';

/** Share of voucher prizes we assume actually get used the next day. */
export const VOUCHER_USE_RATE = 0.5;

function avg(ns: number[]): number {
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0;
}

/**
 * What one spin costs on average, from the current menu and wheel:
 * cash paid back, ingredient cost of free items, half the voucher value,
 * and one tenth of a free bowl for a double stamp.
 */
export function expectedSpinCost(s: Settings): { perSpin: number; pctOfBowl: number } {
  const active = s.menu.filter((m) => m.active);
  const bowls = active.filter((m) => m.kind === 'bowl');
  const bowlPrice = avg(bowls.map((m) => m.price));
  const cheapest = (kind: string) => {
    const items = active.filter((m) => m.kind === kind).sort((a, b) => a.price - b.price);
    return items[0]?.unitCost ?? 0;
  };
  const cost: Record<string, number> = {
    freeMeal: bowlPrice,
    freeCookie: cheapest('cookie'),
    freeWater: cheapest('water'),
    freeSauce: cheapest('extraSauce'),
    doubleStamp: avg(bowls.map((m) => m.unitCost)) / Math.max(1, s.loyalty.cardSize),
    tenOff: Math.min(10, bowlPrice),
    voucher: s.voucher.amount * VOUCHER_USE_RATE,
    tryAgain: 0,
  };
  const total = s.wheel.slots.reduce((n, w) => n + w.slots, 0) || 1;
  const perSpin = s.wheel.slots.reduce((n, w) => n + w.slots * (cost[w.prize] ?? 0), 0) / total;
  return { perSpin, pctOfBowl: bowlPrice ? (perSpin / bowlPrice) * 100 : 0 };
}

export type PromoLevel = 'early' | 'ok' | 'warn' | 'pause';

/** Wheel prizes + vouchers used, as % of what customers paid today. */
export function promoStatus(sum: DaySummary, s: Settings): { pct: number; cost: number; level: PromoLevel } {
  const cost = sum.promo.wheel + sum.promo.vouchers;
  const pct = sum.gross > 0 ? (cost / sum.gross) * 100 : 0;
  const { warnPct, pausePct, minSales } = s.promoLimits;
  let level: PromoLevel = 'ok';
  if (sum.gross < minSales) level = 'early';
  else if (pct >= pausePct) level = 'pause';
  else if (pct >= warnPct) level = 'warn';
  return { pct, cost, level };
}
