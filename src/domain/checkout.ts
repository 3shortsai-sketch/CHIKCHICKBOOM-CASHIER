import { cleanNote } from './kitchen';
import { baseStamps, canRedeem, checkVoucher, type CardState } from './loyalty';
import { itemById, newId, snapshotLine, spinsEarned, stockUsage, subtotal } from './pricing';
import type { BusinessDay, Order, OrderLine, PaymentMethod, Settings } from './types';

/** First name only: trimmed, single spaces, at most 20 characters. */
export function cleanName(name: string | undefined): string | undefined {
  const n = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return n || undefined;
}

export function orderNumber(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

/** Order numbers restart at 001 for each business day and each device letter. */
export function nextSeq(day: BusinessDay, orders: Order[], prefix: string): number {
  // A second day opened on the same date carries on the numbering, so an
  // order number (and the customer page's link) is never used twice in a day.
  const sameDate = `${day.mode}-${day.date}-`;
  let max = 0;
  for (const o of orders) {
    if ((o.dayId === day.id || o.dayId.startsWith(sameDate)) && o.number.startsWith(prefix + '-')) max = Math.max(max, o.seq);
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
  customerName?: string;
  /** A note for the kitchen about the whole order. */
  note?: string;
  rewardsRedeemed: number[];
  voucher?: { code: string; amount: number };
  method: PaymentMethod;
  tendered: number;
  reference?: string;
  settings: Settings;
  now: number;
};

/** More cash than anyone hands over at a food booth: a typing mistake. */
const MAX_TENDERED = 1_000_000;

export type CartCheck = {
  lines: OrderLine[];
  orders: Order[];
  settings: Settings;
  /** YYYY-MM-DD */
  today: string;
  voucher?: { code: string; amount: number };
  /** The card's state right now (null/undefined = no card on the cart). */
  cardState?: CardState | null;
  rewardsRedeemed: number[];
  /** Pieces left of each item (see stockLeft). */
  left: Record<string, number>;
  soldOut: Record<string, boolean>;
};

/**
 * Look at the cart again just before paying. A parked cart or a second
 * device may have used the voucher, the reward or the last pieces meanwhile.
 * Returns the first problem as a sentence for the cashier, or null if all is fine.
 */
export function checkCart(i: CartCheck): string | null {
  const s = i.settings;
  if (i.voucher) {
    const v = checkVoucher(i.voucher.code, i.orders, s, i.today, subtotal(i.lines, s), i.lines);
    if (!v.ok) return `Voucher ${i.voucher.code}: ${v.message} Remove it from the order.`;
  }
  for (const at of i.rewardsRedeemed) {
    if (!i.cardState) return `The ${at}-stamp reward needs a Boom Card. Add the card or remove the free item.`;
    const r = canRedeem(i.cardState, at, s);
    if (!r.ok) return `${r.message} Remove the free item.`;
  }
  for (const [id, n] of Object.entries(stockUsage(i.lines))) {
    const name = itemById(s, id)?.name ?? id;
    if (i.soldOut[id]) return `${name} is marked sold out. Remove it from the order.`;
    if (id in i.left && n > i.left[id]) {
      const have = Math.max(0, i.left[id]);
      return have === 0 ? `${name} just ran out. Remove it from the order.` : `Only ${have} ${name} left, but the order has ${n}.`;
    }
  }
  return null;
}

/** Another order today paid with the same GCash/Maya reference (ignoring case and spaces), if any. */
export function duplicateReference(orders: Order[], dayId: string, reference: string): Order | undefined {
  const clean = (r: string | undefined) => (r ?? '').replace(/\s+/g, '').toUpperCase();
  const want = clean(reference);
  if (!want) return undefined;
  return orders.find((o) => o.dayId === dayId && !o.voided && o.payment.method !== 'cash' && clean(o.payment.reference) === want);
}

export function createOrder(i: CheckoutInput): Order {
  // Keep today's extras prices and unit costs on each line (copies: the cart is not changed).
  const lines = i.lines.map((l) => snapshotLine(l, i.settings));
  const due = amountDue(lines, i.settings, i.voucher?.amount ?? 0);
  if (i.method === 'cash' && (!Number.isFinite(i.tendered) || i.tendered > MAX_TENDERED)) {
    throw new Error('Check the cash amount typed in: it is not a real amount.');
  }
  const tendered = i.method === 'cash' ? i.tendered : due;
  if (tendered < due) throw new Error(`Not enough cash: due ₱${due}, got ₱${tendered}.`);
  const seq = nextSeq(i.day, i.orders, i.prefix);
  return {
    // The random ending keeps two devices on the same letter from overwriting each other's order.
    id: `${i.day.id}_${i.prefix}${seq}_${newId().slice(-4)}`,
    dayId: i.day.id,
    mode: i.day.mode,
    number: orderNumber(i.prefix, seq),
    seq,
    createdAt: i.now,
    cashier: i.cashier,
    lines,
    subtotal: subtotal(lines, i.settings),
    voucher: i.voucher,
    cardId: i.cardId,
    customerName: cleanName(i.customerName),
    note: cleanNote(i.note),
    stampsEarned: baseStamps(i.cardId, i.rewardsRedeemed, i.settings),
    rewardsRedeemed: i.rewardsRedeemed,
    payment: { method: i.method, due, tendered, change: tendered - due, reference: i.reference || undefined },
    spins: [],
    spinsEarned: spinsEarned(lines, i.settings, !!i.voucher),
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
