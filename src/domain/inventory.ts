import { itemById, stockUsage } from './pricing';
import type { Ingredient, Order, Settings } from './types';

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
      if (o.voided || o.createdAt <= ing.count.at) continue;
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

/**
 * About how long a customer who orders now waits for their food, in minutes.
 * Uses today's real pace: how long recent orders took from payment to ready,
 * and how fast the kitchen is finishing orders compared with the queue.
 */
export function waitMinutes(todays: Order[], now: number, fallback: number): number {
  const done = todays
    .filter((o) => !o.voided && o.readyAt && o.readyAt > o.createdAt)
    .sort((a, b) => (b.readyAt ?? 0) - (a.readyAt ?? 0))
    .slice(0, 8);
  const queue = todays.filter((o) => !o.voided && (o.status === 'new' || o.status === 'cooking')).length;
  if (done.length < 2) return Math.max(1, Math.round(fallback));

  const prep = done.map((o) => (o.readyAt! - o.createdAt) / 60000).sort((a, b) => a - b);
  const median = prep[Math.floor(prep.length / 2)];
  // Minutes between finished orders (the kitchen's pace), from the recent ones.
  const span = ((done[0].readyAt ?? now) - (done[done.length - 1].readyAt ?? now)) / 60000;
  const perOrder = span > 0 ? span / (done.length - 1) : median;
  const estimate = Math.max(median, (queue + 1) * perOrder);
  return Math.max(1, Math.round(estimate));
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
