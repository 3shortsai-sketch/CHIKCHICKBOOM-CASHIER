import type { Order, Reward, Settings, StampAdjustment } from './types';

/** Accepts "37", "037", "ccb37", "CCB-037". Returns "CCB-037", or null if not a real card. */
export function parseCard(input: string, s: Settings): string | null {
  const digits = input.trim().toUpperCase().replace(s.loyalty.prefix.toUpperCase().replace('-', ''), '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isInteger(n) || n < s.loyalty.first || n > s.loyalty.last) return null;
  const width = String(s.loyalty.last).length;
  return `${s.loyalty.prefix}${String(n).padStart(Math.max(3, width), '0')}`;
}

export type CardState = { cardId: string; stamps: number; used: number[]; cardsCompleted: number; orders: number };

function counted(o: Order): boolean {
  return !o.voided;
}

/**
 * A card's stamps are worked out from its orders, so a voided order takes
 * its stamps (and any reward it used) back automatically.
 */
export function cardState(cardId: string, orders: Order[], s: Settings, excludeOrderId?: string, adjustments: StampAdjustment[] = []): CardState {
  const state: CardState = { cardId, stamps: 0, used: [], cardsCompleted: 0, orders: 0 };
  const mine = orders
    .filter((o) => o.cardId === cardId && counted(o) && o.id !== excludeOrderId)
    .sort((a, b) => a.createdAt - b.createdAt);
  // Manual adjustments and orders are applied in the order they happened.
  const events: ({ at: number; order: Order } | { at: number; adj: StampAdjustment })[] = [
    ...mine.map((order) => ({ at: order.createdAt, order })),
    ...adjustments.map((adj) => ({ at: adj.at, adj })),
  ].sort((a, b) => a.at - b.at);
  for (const ev of events) {
    if ('adj' in ev) {
      state.stamps = Math.min(s.loyalty.cardSize, Math.max(0, state.stamps + ev.adj.delta));
      continue;
    }
    const o = ev.order;
    state.orders += 1;
    for (const at of [...o.rewardsRedeemed].sort((a, b) => a - b)) {
      state.used.push(at);
      if (at >= s.loyalty.cardSize) {
        state.stamps = Math.max(0, state.stamps - s.loyalty.cardSize);
        state.used = [];
        state.cardsCompleted += 1;
      }
    }
    state.stamps += o.stampsEarned;
  }
  return state;
}

export function availableRewards(state: CardState, s: Settings): Reward[] {
  return s.loyalty.rewards.filter((r) => state.stamps >= r.at && !state.used.includes(r.at));
}

export function canRedeem(state: CardState, at: number, s: Settings): { ok: true } | { ok: false; message: string } {
  const r = s.loyalty.rewards.find((x) => x.at === at);
  if (!r) return { ok: false, message: 'No such reward.' };
  if (state.used.includes(at)) return { ok: false, message: `The ${at}-stamp reward on this card was already used.` };
  if (state.stamps < at) return { ok: false, message: `Card has ${state.stamps} stamps; this reward needs ${at}.` };
  return { ok: true };
}

/** Stamps an order adds: 1 per order (if a card was given) plus double-stamp prizes. */
export function baseStamps(cardId: string | undefined, rewardsRedeemed: number[], s: Settings): number {
  if (!cardId) return 0;
  if (rewardsRedeemed.length > 0 && !s.loyalty.rewardOrderEarnsStamp) return 0;
  return 1;
}

// ---------- Vouchers (₱20 off tomorrow) ----------

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function localDate(ts: number = Date.now()): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type VoucherInfo = { code: string; issuedOrder: string; issuedDate: string; validFrom: string; validTo: string; usedBy?: string };

export function findVoucher(code: string, orders: Order[], s: Settings): VoucherInfo | null {
  const want = normalizeVoucher(code);
  for (const o of orders) {
    if (o.voided) continue;
    const spin = o.spins.find((x) => x.voucherCode === want);
    if (!spin) continue;
    const issuedDate = localDate(spin.at);
    const usedBy = orders.find((u) => !u.voided && u.voucher?.code === want)?.number;
    return {
      code: want,
      issuedOrder: o.number,
      issuedDate,
      validFrom: addDays(issuedDate, 1),
      validTo: addDays(issuedDate, s.voucher.validDays),
      usedBy,
    };
  }
  return null;
}

export function normalizeVoucher(code: string): string {
  const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.startsWith('V') ? `V-${c.slice(1)}` : `V-${c}`;
}

export function checkVoucher(
  code: string,
  orders: Order[],
  s: Settings,
  today: string,
  orderSubtotal: number,
): { ok: true; amount: number; code: string } | { ok: false; message: string } {
  const v = findVoucher(code, orders, s);
  if (!v) return { ok: false, message: 'Unknown voucher code.' };
  if (v.usedBy) return { ok: false, message: `Already used on order ${v.usedBy}.` };
  if (today < v.validFrom) return { ok: false, message: `Valid from ${v.validFrom} (starts the day after it was won).` };
  if (today > v.validTo) return { ok: false, message: `Expired on ${v.validTo}.` };
  if (orderSubtotal < s.voucher.minOrder) return { ok: false, message: `Order must be at least ₱${s.voucher.minOrder}.` };
  return { ok: true, amount: s.voucher.amount, code: v.code };
}
