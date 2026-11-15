import { itemById, lineUnitTotal, newId } from './pricing';
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

const VOUCHER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

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

function freeLine(item: MenuItem, prize: PrizeId): OrderLine {
  return {
    id: newId('l'),
    itemId: item.id,
    name: `${item.name} (FREE – wheel)`,
    qty: 1,
    unitPrice: 0,
    free: { reason: 'prize', prize },
    addedAfterPay: true,
  };
}

/**
 * Record what the wheel landed on for one bowl, after payment.
 * Money prizes are paid back in cash; item prizes are added to the order at ₱0.
 */
export function applyPrize(order: Order, bowl: { lineId: string; unit: number }, prize: PrizeId, ctx: PrizeContext): PrizeOutcome {
  const s = ctx.settings;
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

  const spin: SpinResult = { lineId: bowl.lineId, unit: bowl.unit, prize, refund: 0, via: ctx.via, at: ctx.now };
  let lines = order.lines;
  let stampsEarned = order.stampsEarned;
  let message = '';

  switch (prize) {
    case 'freeMeal': {
      spin.refund = lineUnitTotal(line, s);
      message = `FREE MEAL! Give back ₱${spin.refund} cash.`;
      break;
    }
    case 'tenOff': {
      spin.refund = Math.min(10, lineUnitTotal(line, s));
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
        return { ok: false, message: `${what} sold out. Give a sticker and log "Try again" instead.` };
      }
      const added = freeLine(item, prize);
      spin.addedLineId = added.id;
      lines = [...lines, added];
      message = `${item.name} added free. Kitchen will see it.`;
      break;
    }
    case 'doubleStamp': {
      if (!order.cardId) return { ok: false, message: 'Double stamp needs a loyalty card. Add the card number first.' };
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

  return { ok: true, order: { ...order, lines, stampsEarned, spins: [...order.spins, spin] }, spin, message };
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
