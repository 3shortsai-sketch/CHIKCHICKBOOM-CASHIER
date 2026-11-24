import type { Order, Settings } from './types';

/**
 * When the customer gets the order: at a school break. Every new order has
 * one (the cashier must pick it), and a delivery also needs the place.
 */
export const PICKUP_SLOTS = ['recess', 'lunch', 'dismissal'] as const;
export type PickupSlot = (typeof PICKUP_SLOTS)[number];

export const SLOT_LABEL: Record<PickupSlot, string> = { recess: 'Recess', lunch: 'Lunch', dismissal: 'Dismissal' };

/** Longest delivery place the cashier can type ("Grade 5 - Rizal, room 204"). */
export const PLACE_MAX = 40;

export type Pickup = {
  slot: PickupSlot;
  /** Where to bring it. Set only for a delivery. */
  deliverTo?: string;
};

/** A place as typed: single spaces, at most PLACE_MAX characters. Empty = none. */
export function cleanPlace(text: string | undefined): string | undefined {
  const p = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, PLACE_MAX).trim();
  return p || undefined;
}

/** What the cashier has chosen so far: a slot (or none yet), and the place when it is a delivery. */
export type PickupDraft = { slot?: PickupSlot; delivery: boolean; place: string };

export const EMPTY_PICKUP: PickupDraft = { delivery: false, place: '' };

/** The first thing still missing, as a sentence for the cashier, or null when it can be saved. */
export function pickupProblem(d: PickupDraft): string | null {
  if (!d.slot || !PICKUP_SLOTS.includes(d.slot)) return 'Pick when the customer gets the order: Recess, Lunch or Dismissal.';
  if (d.delivery && !cleanPlace(d.place)) return 'Type where to deliver it (e.g. Grade 5 - Rizal).';
  return null;
}

/** The pickup to save on the order, or undefined when something is missing. */
export function pickupFrom(d: PickupDraft): Pickup | undefined {
  if (pickupProblem(d) || !d.slot) return undefined;
  const place = d.delivery ? cleanPlace(d.place) : undefined;
  return place ? { slot: d.slot, deliverTo: place } : { slot: d.slot };
}

/** A saved order's pickup, checked: one written by another device or an older version may be missing or odd. */
export function pickupOf(o: Pick<Order, 'pickup'>): Pickup | undefined {
  const p = o.pickup;
  return p && PICKUP_SLOTS.includes(p.slot) ? p : undefined;
}

export function isDelivery(o: Pick<Order, 'pickup'>): boolean {
  return !!pickupOf(o)?.deliverTo;
}

/** The clock time set in Setup for a break ("11:30"), if any. */
export function slotTime(slot: PickupSlot, s: Settings): string | undefined {
  const t = s.pickupTimes?.[slot];
  return t && /^\d{1,2}:\d{2}$/.test(t) ? t : undefined;
}

/** "11:30" as "11:30 AM". */
export function niceTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Lunch" or "Lunch · 11:30 AM". */
export function slotText(slot: PickupSlot, s: Settings): string {
  const t = slotTime(slot, s);
  return t ? `${SLOT_LABEL[slot]} · ${niceTime(t)}` : SLOT_LABEL[slot];
}

/** "Pickup at Lunch" or "Deliver to Grade 5 at Lunch". Empty for an order saved before pickup times existed. */
export function pickupText(o: Pick<Order, 'pickup'>, s: Settings): string {
  const p = pickupOf(o);
  if (!p) return '';
  return p.deliverTo ? `Deliver to ${p.deliverTo} at ${slotText(p.slot, s)}` : `Pickup at ${slotText(p.slot, s)}`;
}

/**
 * Kitchen order: the earliest break first, oldest order first within a break.
 * An order with no pickup time (saved before they existed) is wanted now.
 */
export function slotRank(o: Pick<Order, 'pickup'>): number {
  const p = pickupOf(o);
  return p ? PICKUP_SLOTS.indexOf(p.slot) + 1 : 0;
}

export function byPickup<T extends Pick<Order, 'pickup' | 'createdAt'>>(a: T, b: T): number {
  return slotRank(a) - slotRank(b) || a.createdAt - b.createdAt;
}
