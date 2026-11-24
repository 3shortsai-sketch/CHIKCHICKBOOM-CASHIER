import { describe, expect, it } from 'vitest';
import { createOrder } from './checkout';
import { defaultSettings } from './defaults';
import { byPickup, cleanPlace, dueAt, isAhead, walkUpOrders, EMPTY_PICKUP, isDelivery, pickupFrom, pickupOf, pickupProblem, pickupText, slotText } from './pickup';
import { ordersCsv } from './reports';
import type { BusinessDay, Order, OrderLine } from './types';

const s = defaultSettings();
const day: BusinessDay = { id: 'demo-p', mode: 'demo', date: '2026-11-24', openedAt: 0, openedBy: 'Ana', openingFloat: 0, stockStart: Object.fromEntries(s.menu.map((m) => [m.id, m.startStock])), soldOut: {} };
const bowl: OrderLine = { id: 'b1', itemId: 'bowl-original', name: 'OG Chicken Rice Bowl', qty: 1, unitPrice: 139, choices: { side: 'Cucumbers' } };
const order = (pickup: Order['pickup'], createdAt = 1000): Order =>
  createOrder({ lines: [bowl], day, orders: [], prefix: 'A', cashier: 'Ana', customerName: 'Ana', pickup, rewardsRedeemed: [], method: 'cash', tendered: 500, settings: s, now: createdAt });

describe('pickup time', () => {
  it('is required: a break must be picked, and a delivery needs a place', () => {
    expect(pickupProblem(EMPTY_PICKUP)).toMatch(/Recess, Lunch or Dismissal/);
    expect(pickupProblem({ slot: 'lunch', delivery: false, place: '' })).toBeNull();
    expect(pickupProblem({ slot: 'lunch', delivery: true, place: '   ' })).toMatch(/where to deliver/);
    expect(pickupProblem({ slot: 'lunch', delivery: true, place: 'Grade 5' })).toBeNull();
    expect(pickupProblem({ slot: 'snack' as never, delivery: false, place: '' })).not.toBeNull();
    expect(pickupFrom(EMPTY_PICKUP)).toBeUndefined();
    expect(pickupFrom({ slot: 'lunch', delivery: true, place: '' })).toBeUndefined();
  });

  it('saves the break, and the place only for a delivery', () => {
    expect(pickupFrom({ slot: 'recess', delivery: false, place: 'ignored' })).toEqual({ slot: 'recess' });
    expect(pickupFrom({ slot: 'lunch', delivery: true, place: '  Grade 5 -   Rizal ' })).toEqual({ slot: 'lunch', deliverTo: 'Grade 5 - Rizal' });
    expect(cleanPlace('x'.repeat(80))).toHaveLength(40);
    const o = order({ slot: 'dismissal', deliverTo: 'Faculty room' });
    expect(o.pickup).toEqual({ slot: 'dismissal', deliverTo: 'Faculty room' });
    expect(isDelivery(o)).toBe(true);
    expect(isDelivery(order({ slot: 'recess' }))).toBe(false);
  });

  it('reads well, with the clock time when Setup has one', () => {
    expect(pickupText(order({ slot: 'lunch' }), s)).toBe('Pickup at Lunch');
    const timed = { ...s, pickupTimes: { lunch: '11:30', dismissal: '15:05', recess: 'bad' } };
    expect(pickupText(order({ slot: 'lunch', deliverTo: 'Grade 5' }), timed)).toBe('Deliver to Grade 5 at Lunch · 11:30 AM');
    expect(slotText('dismissal', timed)).toBe('Dismissal · 3:05 PM');
    expect(slotText('recess', timed)).toBe('Recess');
    expect(pickupText({ pickup: undefined }, s)).toBe('');
    expect(pickupOf({ pickup: { slot: 'brunch' as never } })).toBeUndefined();
  });

  it('puts the kitchen queue in break order: no time first, then recess, lunch, dismissal, oldest first', () => {
    const list = [order({ slot: 'dismissal' }, 1), order({ slot: 'lunch' }, 5), order({ slot: 'recess' }, 9), order(undefined, 20), order({ slot: 'lunch' }, 2)];
    expect(list.sort(byPickup).map((o) => [o.pickup?.slot ?? 'none', o.createdAt])).toEqual([
      ['none', 20],
      ['recess', 9],
      ['lunch', 2],
      ['lunch', 5],
      ['dismissal', 1],
    ]);
  });

  it('adds the pickup time and place to the export without moving the money columns', () => {
    const rows = ordersCsv(day, [order({ slot: 'lunch', deliverTo: 'Grade 5, Rizal' })], s).split('\n');
    expect(rows[0].split(',').slice(-2)).toEqual(['pickup_time', 'deliver_to']);
    expect(rows[1]).toContain('Lunch,"Grade 5, Rizal"');
    expect(rows[1].split(',')[12]).toBe('139');
  });

  it('treats an order placed ahead as due at its break, not when it was paid', () => {
    const at = (h: number, m = 0) => new Date(2026, 10, 24, h, m).getTime();
    const timed = { ...s, pickupTimes: { lunch: '11:30', recess: '09:30' } };
    const ahead = order({ slot: 'lunch' }, at(8));
    expect(dueAt(ahead, timed)).toBe(at(11, 30));
    expect(isAhead(ahead, timed, at(10))).toBe(true);
    expect(isAhead(ahead, timed, at(11, 45))).toBe(false);
    // Ordered during or after the break, or no clock time in Setup: wanted now.
    const walkUp = order({ slot: 'lunch' }, at(11, 40));
    expect(dueAt(walkUp, timed)).toBe(at(11, 40));
    expect(dueAt(order({ slot: 'dismissal' }, at(8)), timed)).toBe(at(8));
    expect(dueAt(ahead, s)).toBe(at(8));
    expect(walkUpOrders([ahead, walkUp], timed)).toEqual([walkUp]);
  });
});
