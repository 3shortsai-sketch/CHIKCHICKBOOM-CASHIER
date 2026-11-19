import { cardStateFor } from './cards';
import { availableRewards, findVoucher } from './loyalty';
import type { Card, Order, Reward, Settings } from './types';

/**
 * What the booth still owes customers: vouchers they can still use, loyalty
 * rewards they can claim now, and stamps on the way to the next reward.
 * Rewards and stamps are counted at ingredient cost; vouchers at their face value.
 */
export type Liabilities = {
  vouchers: { count: number; amount: number };
  rewards: { rows: { at: number; label: string; count: number; unitCost: number; cost: number }[]; count: number; cost: number };
  /** Stamps on cards, and the share of rewards not reached yet that they already stand for. */
  stamps: { stamps: number; cost: number };
  total: number;
};

/** Ingredient cost of one reward: its own item, or the average of its category. */
export function rewardCost(r: Reward, s: Settings): number {
  const item = r.itemId ? s.menu.find((m) => m.id === r.itemId) : undefined;
  if (item) return item.unitCost;
  const same = s.menu.filter((m) => m.active && m.category === r.category);
  return same.length ? same.reduce((n, m) => n + m.unitCost, 0) / same.length : 0;
}

/** Voucher codes won on a live order, not used yet, and not expired by `today`. */
function openVouchers(orders: Order[], s: Settings, today: string): { count: number; amount: number } {
  const codes = new Set<string>();
  for (const o of orders) {
    if (o.voided) continue;
    for (const sp of o.spins) if (sp.voucherCode) codes.add(sp.voucherCode);
  }
  let count = 0;
  for (const code of codes) {
    const v = findVoucher(code, orders, s);
    if (v && !v.usedBy && v.validTo >= today) count += 1;
  }
  return { count, amount: count * s.voucher.amount };
}

/** `orders` and `cards` may hold both modes; only the current mode counts. */
export function liabilities(orders: Order[], cards: Card[], s: Settings, today: string): Liabilities {
  const mine = orders.filter((o) => o.mode === s.mode);
  const myCards = cards.filter((c) => c.mode === s.mode);
  const vouchers = openVouchers(mine, s, today);

  // Every card seen on an order or saved with a name or stamp changes.
  const numbers = new Set<string>([...myCards.map((c) => c.number), ...mine.filter((o) => o.cardId).map((o) => o.cardId!)]);
  const rows = s.loyalty.rewards.map((r) => ({ at: r.at, label: r.label, count: 0, unitCost: rewardCost(r, s), cost: 0 }));
  let stamps = 0;
  let stampsCost = 0;
  for (const number of numbers) {
    const st = cardStateFor(number, mine, s, myCards);
    stamps += st.stamps;
    const ready = availableRewards(st, s);
    for (const r of ready) {
      const row = rows.find((x) => x.at === r.at);
      if (row) row.count += 1;
    }
    // Rewards this card has not reached yet: its stamps already stand for a
    // share of them (3 of 5 stamps = 3/5 of the fries). Ready rewards are
    // counted in full above, so they are not counted again here.
    for (const r of s.loyalty.rewards) {
      if (ready.includes(r) || st.used.includes(r.at) || r.at <= 0) continue;
      stampsCost += (Math.min(st.stamps, r.at) / r.at) * rewardCost(r, s);
    }
  }
  for (const row of rows) row.cost = row.count * row.unitCost;
  const rewardsCost = rows.reduce((n, r) => n + r.cost, 0);


  return {
    vouchers,
    rewards: { rows, count: rows.reduce((n, r) => n + r.count, 0), cost: rewardsCost },
    stamps: { stamps, cost: stampsCost },
    total: vouchers.amount + rewardsCost + stampsCost,
  };
}
