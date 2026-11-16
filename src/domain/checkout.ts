import { baseStamps } from './loyalty';
import { spinsEarned, subtotal } from './pricing';
import type { BusinessDay, Order, OrderLine, PaymentMethod, Settings } from './types';

export function orderNumber(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

/** Order numbers restart at 001 for each business day and each device letter. */
export function nextSeq(day: BusinessDay, orders: Order[], prefix: string): number {
  let max = 0;
  for (const o of orders) {
    if (o.dayId === day.id && o.number.startsWith(prefix + '-')) max = Math.max(max, o.seq);
  }
  return max + 1;
}

export function amountDue(lines: OrderLine[], s: Settings, voucherAmount = 0): number {
  return Math.max(0, subtotal(lines, s) - voucherAmount);
}

export type CheckoutInput = {
  lines: OrderLine[];
  day: BusinessDay;
  orders: Order[];
  prefix: string;
  cashier: string;
  cardId?: string;
  rewardsRedeemed: number[];
  voucher?: { code: string; amount: number };
  method: PaymentMethod;
  tendered: number;
  reference?: string;
  settings: Settings;
  now: number;
};

export function createOrder(i: CheckoutInput): Order {
  const due = amountDue(i.lines, i.settings, i.voucher?.amount ?? 0);
  const tendered = i.method === 'cash' ? i.tendered : due;
  if (tendered < due) throw new Error(`Not enough cash: due ₱${due}, got ₱${tendered}.`);
  const seq = nextSeq(i.day, i.orders, i.prefix);
  return {
    id: `${i.day.id}_${i.prefix}${seq}`,
    dayId: i.day.id,
    mode: i.day.mode,
    number: orderNumber(i.prefix, seq),
    seq,
    createdAt: i.now,
    cashier: i.cashier,
    lines: i.lines,
    subtotal: subtotal(i.lines, i.settings),
    voucher: i.voucher,
    cardId: i.cardId,
    stampsEarned: baseStamps(i.cardId, i.rewardsRedeemed, i.settings),
    rewardsRedeemed: i.rewardsRedeemed,
    payment: { method: i.method, due, tendered, change: tendered - due, reference: i.reference || undefined },
    spins: [],
    spinsEarned: spinsEarned(i.lines, i.settings, !!i.voucher),
    status: 'new',
  };
}

/**
 * Cash buttons a customer is likely to hand over for this amount:
 * the next ₱50, the next ₱100, then ₱500 and ₱1,000 bills. Exact is a separate button.
 */
export function cashSuggestions(due: number): number[] {
  if (due <= 0) return [];
  const up = (step: number) => Math.ceil(due / step) * step;
  const picks = [up(50), up(100), up(500), up(1000)].filter((n) => n > due);
  return [...new Set(picks)].slice(0, 4);
}
