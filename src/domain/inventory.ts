import { itemById, stockUsage } from './pricing';
import type { Ingredient, Order, Settings } from './types';

/** A voided order still used its food if the kitchen had already started on it. */
export function usesStock(o: Order): boolean {
  return !o.voided || o.status !== 'new';
}

/**
 * Does this order come off a count taken at `countAt`? Yes if it was placed
 * after the count, or placed before but not finished yet when the kitchen
 * counted (its food was still in the counted stock). `placedAt` is the
 * order's time, or the spin's time for a free prize item added later.
 */
export function usedAfterCount(o: Order, countAt: number, placedAt: number = o.createdAt): boolean {
  if (placedAt > countAt) return true;
  if (o.status === 'new' || o.status === 'cooking') return true;
  const finishedAt = o.readyAt ?? o.claimedAt;
  return finishedAt !== undefined && finishedAt > countAt;
}

/**
 * Amount of an ingredient on hand: the kitchen's last count, minus what was
 * removed since, minus what orders used since (only when "uses" is set).
 * Returns null when it has never been counted.
 */
export function onHand(ing: Ingredient, orders: Order[]): number | null {
  if (!ing.count) return null;
  let qty = ing.count.qty;
  for (const r of ing.removed ?? []) if (r.at > ing.count.at) qty -= r.qty;
  if (ing.uses && Object.keys(ing.uses).length) {
    for (const o of orders) {
      if (!usesStock(o) || !usedAfterCount(o, ing.count.at)) continue;
      for (const [id, n] of Object.entries(stockUsage(o.lines))) qty -= (ing.uses[id] ?? 0) * n;
    }
  }
  return Math.max(0, Math.round(qty * 1000) / 1000);
}

/** How many more of an item the ingredient covers, e.g. "≈ 80 Ala King bowls". */
export function servingsLeft(ing: Ingredient, orders: Order[], itemId: string): number | null {
  const per = ing.uses?.[itemId];
  const have = onHand(ing, orders);
  if (!per || have === null) return null;
  return Math.floor(have / per);
}

export function isLow(ing: Ingredient, orders: Order[]): boolean {
  const have = onHand(ing, orders);
  return have !== null && ing.low > 0 && have <= ing.low;
}

/** Orders the kitchen works on at the same time. */
const PARALLEL = 3;

/**
 * About how long a customer who orders now waits for their food, in minutes.
 * Uses today's real prep time (payment to ready, middle value of the last 8
 * orders) and adds a share of it for every order already waiting.
 * Prep times of 0 or less, or over an hour, are clock mistakes and ignored.
 */
export function waitMinutes(todays: Order[], _now: number, fallback: number): number {
  const done = todays
    .filter((o) => !o.voided && o.readyAt)
    .map((o) => ({ readyAt: o.readyAt!, prep: (o.readyAt! - o.createdAt) / 60000 }))
    .filter((x) => x.prep > 0 && x.prep <= 60)
    .sort((a, b) => b.readyAt - a.readyAt)
    .slice(0, 8);
  const queue = todays.filter((o) => !o.voided && (o.status === 'new' || o.status === 'cooking')).length;
  if (done.length < 2) return Math.max(1, Math.round(fallback));

  const prep = done.map((x) => x.prep).sort((a, b) => a - b);
  const median = prep[Math.floor(prep.length / 2)];
  const estimate = median * (1 + queue / PARALLEL);
  return Math.min(45, Math.max(1, Math.round(estimate)));
}

export type Margin = { id: string; name: string; price: number; cost: number; profit: number; pct: number };

/** Profit per piece for every menu item, and the lowest/highest for each combo. */
export function margins(s: Settings): { items: Margin[]; combos: { name: string; price: number; low: Margin; high: Margin }[] } {
  const row = (id: string, name: string, price: number, cost: number): Margin => ({ id, name, price, cost, profit: price - cost, pct: price ? ((price - cost) / price) * 100 : 0 });
  const items = s.menu.filter((m) => m.active).map((m) => row(m.id, m.name, m.price, m.unitCost));
  const combos = s.combos
    .filter((c) => c.active)
    .map((c) => {
      const options = c.parts.map((k) => s.menu.filter((m) => m.active && (k === 'fries' ? m.kind === 'fries' && m.regular : m.kind === k)));
      const costs = options.map((opts) => opts.map((m) => m.unitCost));
      const worst = costs.reduce((n, cs) => n + (cs.length ? Math.max(...cs) : 0), 0);
      const best = costs.reduce((n, cs) => n + (cs.length ? Math.min(...cs) : 0), 0);
      return { name: c.name, price: c.price, low: row(c.id, c.name, c.price, worst), high: row(c.id, c.name, c.price, best) };
    });
  return { items, combos };
}

export function itemName(s: Settings, id: string): string {
  return itemById(s, id)?.name ?? id;
}
