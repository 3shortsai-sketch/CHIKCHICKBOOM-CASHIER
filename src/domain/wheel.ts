import { isLastSellingDay, localDate } from './loyalty';
import { itemById, lineUnitTotal, newId, snapshotLine } from './pricing';
import type { MenuItem, Order, OrderLine, PrizeId, Settings, SpinResult, WheelSlot } from './types';

export const PRIZE_LABEL: Record<PrizeId, string> = {
  freeMeal: 'FREE MEAL',
  freeCookie: 'Free cookie',
  freeWater: 'Free water',
  freeSauce: 'Free extra sauce',
  doubleStamp: 'Double stamp',
  tenOff: '₱10 off',
  voucher: '₱20 off tomorrow',
  tryAgain: 'Try again',
};

/** Digital backup wheel: each slot has the same chance (1 in 20 with the default wheel). */
export function digitalSpin(slots: WheelSlot[], rand: () => number = Math.random): PrizeId {
  const total = slots.reduce((n, s) => n + s.slots, 0);
  let r = Math.floor(rand() * total);
  for (const s of slots) {
    if (r < s.slots) return s.prize;
    r -= s.slots;
  }
  return slots[slots.length - 1].prize;
}

// No I, L, O, 0, 1 (look alike) and no V (a typed code starts with V already).
const VOUCHER_ALPHABET = 'ABCDEFGHJKMNPQRSTUWXYZ23456789';

export function makeVoucherCode(rand: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += VOUCHER_ALPHABET[Math.floor(rand() * VOUCHER_ALPHABET.length)];
  return `V-${code}`;
}

export type PrizeContext = {
  settings: Settings;
  /** Returns the cheapest in-stock item of a kind, or undefined if none left. */
  pickFree: (kind: MenuItem['kind']) => MenuItem | undefined;
  via: 'physical' | 'digital';
  now: number;
  rand?: () => number;
};

export type PrizeOutcome =
  | { ok: true; order: Order; spin: SpinResult; message: string }
  | { ok: false; message: string };

function freeLine(item: MenuItem, prize: PrizeId, s: Settings): OrderLine {
  const line: OrderLine = {
    id: newId('l'),
    itemId: item.id,
    name: `${item.name} (FREE – wheel)`,
    qty: 1,
    unitPrice: 0,
    free: { reason: 'prize', prize },
    addedAfterPay: true,
  };
  // Remember today's cost, so the report does not change if Setup does.
  return snapshotLine(line, s);
}

/** What the customer has really paid for this order so far: due, minus prize cash and refunds already handed back. */
function paidSoFar(order: Order): number {
  const refunds = (order.refunds ?? []).reduce((n, r) => n + r.amount, 0);
  return Math.max(0, order.payment.due - prizeRefundTotal(order) - refunds);
}

/**
 * Record what the wheel landed on for one bowl, after payment.
 * Money prizes are paid back in cash (never more than the customer paid);
 * item prizes are added to the order at ₱0.
 * On the last selling day a voucher is swapped for settings.voucher.lastDayPrize.
 */
export function applyPrize(order: Order, bowl: { lineId: string; unit: number }, landed: PrizeId, ctx: PrizeContext): PrizeOutcome {
  const s = ctx.settings;
  if (order.voided) return { ok: false, message: 'This order was voided.' };
  if (order.spins.some((x) => x.lineId === bowl.lineId && x.unit === bowl.unit)) {
    return { ok: false, message: 'This bowl already spun. One prize per meal.' };
  }
  if (order.spins.length >= order.spinsEarned) {
    return { ok: false, message: 'No spins left on this order.' };
  }
  const line = order.lines.find((l) => l.id === bowl.lineId);
  if (!line || line.combo || line.free || itemById(s, line.itemId)?.kind !== 'bowl') {
    return { ok: false, message: 'Only bowls outside a combo can spin.' };
  }
  if (!Number.isInteger(bowl.unit) || bowl.unit < 0 || bowl.unit >= line.qty) {
    return { ok: false, message: 'That bowl is not on this order.' };
  }

  // A voucher won on the last selling day could never be used: give the stand-in prize.
  const standIn = s.voucher.lastDayPrize ?? 'tenOff';
  const swapped = landed === 'voucher' && standIn !== 'voucher' && isLastSellingDay(localDate(ctx.now), s);
  const prize: PrizeId = swapped ? standIn : landed;
  const lead = swapped ? 'Last day, so no voucher: ' : '';

  const spin: SpinResult = { lineId: bowl.lineId, unit: bowl.unit, prize, refund: 0, via: ctx.via, at: ctx.now };
  let lines = order.lines;
  let stampsEarned = order.stampsEarned;
  let message = '';
  const paid = paidSoFar(order);

  switch (prize) {
    case 'freeMeal': {
      spin.refund = Math.min(lineUnitTotal(line, s), paid);
      message = `FREE MEAL! Give back ₱${spin.refund} cash.`;
      break;
    }
    case 'tenOff': {
      spin.refund = Math.min(10, lineUnitTotal(line, s), paid);
      message = `₱10 off. Give back ₱${spin.refund} cash.`;
      break;
    }
    case 'freeCookie':
    case 'freeWater':
    case 'freeSauce': {
      const kind = prize === 'freeCookie' ? 'cookie' : prize === 'freeWater' ? 'water' : 'extraSauce';
      const item = ctx.pickFree(kind);
      if (!item) {
        const what = prize === 'freeCookie' ? 'Cookies are' : prize === 'freeWater' ? 'Water is' : 'Sauce is';
        return { ok: false, message: `${lead}${what} sold out. Give a sticker and log "Try again" instead.` };
      }
      const added = freeLine(item, prize, s);
      spin.addedLineId = added.id;
      lines = [...lines, added];
      const kitchenDone = order.status === 'ready' || order.status === 'claimed';
      message = kitchenDone
        ? `${item.name} is free: hand it over now (the kitchen is already done with this order).`
        : `${item.name} added free. Kitchen will see it.`;
      break;
    }
    case 'doubleStamp': {
      if (!order.cardId) return { ok: false, message: `${lead}Double stamp needs a loyalty card. Add the card number first.` };
      stampsEarned += 1;
      message = '+1 extra stamp on the card.';
      break;
    }
    case 'voucher': {
      spin.voucherCode = makeVoucherCode(ctx.rand);
      message = `Write this code on a voucher slip: ${spin.voucherCode}`;
      break;
    }
    case 'tryAgain': {
      message = 'Try again. Give a sticker.';
      break;
    }
  }

  return { ok: true, order: { ...order, lines, stampsEarned, spins: [...order.spins, spin] }, spin, message: lead + message };
}

/** Undo the last spin (wrong prize tapped). */
export function undoLastSpin(order: Order): Order {
  const last = order.spins[order.spins.length - 1];
  if (!last) return order;
  return {
    ...order,
    spins: order.spins.slice(0, -1),
    lines: last.addedLineId ? order.lines.filter((l) => l.id !== last.addedLineId) : order.lines,
    stampsEarned: last.prize === 'doubleStamp' ? order.stampsEarned - 1 : order.stampsEarned,
  };
}

export function prizeRefundTotal(order: Order): number {
  return order.spins.reduce((n, s) => n + s.refund, 0);
}
