import type { Order, Reward, Settings, StampAdjustment } from './types';

/**
 * Accepts "37", "037", "ccb37", "CCB-037", "ccb 37". Returns "CCB-037", or null
 * if it is not a real card. Anything else around the number ("3.7", "Ana 7") is refused.
 */
export function parseCard(input: string, s: Settings): string | null {
  const letters = s.loyalty.prefix.replace(/-/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^\\s*(?:${letters})?[\\s-]*(\\d{1,6})\\s*$`, 'i').exec(input);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < s.loyalty.first || n > s.loyalty.last) return null;
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
      // Only limit the direction of the edit: a card already over a full card
      // (stamps not redeemed yet) must not drop when one stamp is added or removed.
      const d = ev.adj.delta;
      state.stamps = d > 0 ? Math.max(state.stamps, Math.min(s.loyalty.cardSize, state.stamps + d)) : Math.max(0, state.stamps + d);
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

// ---------- Vouchers (₱20 off on the next selling day) ----------

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

function sellingDays(s: Settings): string[] {
  return [...(s.sellingDays ?? [])].sort();
}

/** The first selling day after `date`, or null when there is none left. */
export function nextSellingDay(date: string, s: Settings): string | null {
  return sellingDays(s).find((d) => d > date) ?? null;
}

/** True on (or after) the last selling day: a voucher won now could never be used. */
export function isLastSellingDay(date: string, s: Settings): boolean {
  const days = sellingDays(s);
  return days.length > 0 && date >= days[days.length - 1];
}

/**
 * The days a voucher won on `issuedDate` can be used: from the next selling
 * day, for `validDays` selling days (holidays in between do not eat the voucher).
 * With no selling days set, none left, or before the bazaar starts (practice
 * runs), it is the plain calendar rule: tomorrow.
 */
export function voucherWindow(issuedDate: string, s: Settings): { validFrom: string; validTo: string } {
  const days = sellingDays(s);
  const after = days.filter((d) => d > issuedDate);
  if (after.length === 0 || issuedDate < days[0]) return { validFrom: addDays(issuedDate, 1), validTo: addDays(issuedDate, s.voucher.validDays) };
  const n = Math.min(after.length, Math.max(1, s.voucher.validDays));
  return { validFrom: after[0], validTo: after[n - 1] };
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
      ...voucherWindow(issuedDate, s),
      usedBy,
    };
  }
  return null;
}

/** "v-abcd", "VABCD" and "abcd" are all the code V-ABCD (the 4 letters may themselves start with V). */
export function normalizeVoucher(code: string): string {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 5 && c.startsWith('V') ? `V-${c.slice(1)}` : `V-${c}`;
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
  if (today < v.validFrom) return { ok: false, message: `Valid from ${v.validFrom}.` };
  if (today > v.validTo) return { ok: false, message: `Expired on ${v.validTo}.` };
  if (orderSubtotal < s.voucher.minOrder) return { ok: false, message: `Order must be at least ₱${s.voucher.minOrder}.` };
  return { ok: true, amount: s.voucher.amount, code: v.code };
}
