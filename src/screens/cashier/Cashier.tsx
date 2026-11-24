import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { amountDue, checkCart, cleanName, createOrder, duplicateReference, nextSeq, orderNumber } from '../../domain/checkout';
import { cleanNote, NOTE_MAX } from '../../domain/kitchen';
import { lineBits } from '../../domain/lineText';
import { EMPTY_PICKUP, pickupFrom, pickupText, pickupProblem, type PickupDraft, type Pickup } from '../../domain/pickup';
import { PickupChooser } from './PickupChooser';
import { cardStateFor } from '../../domain/cards';
import { availableRewards, canRedeem, checkVoucher, localDate, parseCard } from '../../domain/loyalty';
import { applyCombo, itemById, newId, lineTotal, lineUnitTotal, peso, spinsEarned, stockUsage, subtotal, suggestCombo } from '../../domain/pricing';
import { allergenText, itemTags } from '../../domain/allergens';
import { promoStatus } from '../../domain/promo';
import { isAvailable, orderNet, pendingSpins, popularToday, stockLeft, summarize } from '../../domain/reports';
import type { Category, Combo, MenuItem, Order, OrderLine, PaymentMethod, Reward, Settings } from '../../domain/types';
import { publishCart } from '../../data/live';
import { modeCards, modeOrders, openDay, patchDay, patchOrder, putOrder, saveSettings, useDevice, useStore } from '../../data/store';
import { TopBar } from '../../ui/TopBar';
import { OpenDayForm } from './OpenDay';
import { AfterPay, PayModal, StampDots, type AfterPayMode } from './payflow';
import { ComboPicker, ItemPicker, NoteEditor, opensPicker } from './pickers';
import { PickupModal } from './Pickup';
import { CardNameField, useCardName } from './CardName';
import { CardLookup, WasteLog, WinnerAdd } from './tools';
import { CashMoves } from './CashMoves';
import { minutesAgo } from '../../ui/ui';

type TabId = Category | 'popular';

/** How a combo's parts read on its tile, in the menu page's words. */
const COMBO_PART: Record<Combo['parts'][number], string> = { bowl: 'bowl', fries: 'Fries with Dip', slushie: 'shake or juice', cookie: 'cookie' };

const TABS: { id: TabId; label: string }[] = [
  { id: 'popular', label: '★ Popular' },
  { id: 'bowls', label: 'Bowls' },
  { id: 'fries', label: 'Fries' },
  { id: 'drinks', label: 'Drinks' },
  { id: 'cookies', label: 'Cookies' },
  { id: 'combos', label: 'Combos' },
  { id: 'addons', label: 'Add-ons' },
];

/** An undecided customer's order, set aside on this device. */
type Parked = {
  id: string;
  lines: OrderLine[];
  cardId?: string;
  voucher?: { code: string; amount: number };
  name?: string;
  /** The note for the kitchen about the whole order. */
  note?: string;
  /** Pickup time and delivery place chosen so far. */
  pickup?: PickupDraft;
  /** The name was filled in from the Boom Card, not typed. */
  nameFromCard?: boolean;
  at: number;
  /** Demo or real data, and the day it was parked on: it only comes back there. */
  mode: Settings['mode'];
  dayId: string;
};
const PARKED_KEY = 'ccb:parked';

function loadParked(): Parked[] {
  try {
    const list = JSON.parse(localStorage.getItem(PARKED_KEY) ?? '[]') as Parked[];
    return Array.isArray(list) ? list.filter((p) => p && Array.isArray(p.lines)) : [];
  } catch {
    return [];
  }
}

/** The stale-day warning was dismissed for this day ("keep selling"), until the browser is closed. */
const STALE_OK_KEY = 'ccb:stale-day-ok';

function staleDayOk(dayId: string): boolean {
  try {
    return sessionStorage.getItem(STALE_OK_KEY) === dayId;
  } catch {
    return false;
  }
}

/** "2026-11-23" as "Mon, Nov 23". */
function niceDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function saveParked(p: Parked[]) {
  try {
    localStorage.setItem(PARKED_KEY, JSON.stringify(p));
  } catch {
    /* parked orders still work for this session */
  }
}

/** The order being rung up, kept so a reload (F5) or a wrong tap on another screen does not lose it. */
const DRAFT_KEY = 'ccb:draft';

function loadDraft(): Parked | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Parked | null;
    return d && Array.isArray(d.lines) && d.lines.length ? d : null;
  } catch {
    return null;
  }
}

function saveDraft(d: Parked | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* the order still works, it just won't survive a reload */
  }
}

/** The change screen of the order just paid, kept for this browser tab so a reload comes back to it. */
const AFTERPAY_KEY = 'ccb:afterpay';

function loadAfterPay(exists: (id: string) => boolean): { id: string; mode: AfterPayMode } | null {
  try {
    const a = JSON.parse(sessionStorage.getItem(AFTERPAY_KEY) ?? 'null') as { id?: unknown; mode?: unknown } | null;
    return a && typeof a.id === 'string' && a.mode === 'fresh' && exists(a.id) ? { id: a.id, mode: 'fresh' } : null;
  } catch {
    return null;
  }
}

function saveAfterPay(a: { id: string; mode: AfterPayMode } | null) {
  try {
    if (a?.mode === 'fresh') sessionStorage.setItem(AFTERPAY_KEY, JSON.stringify(a));
    else sessionStorage.removeItem(AFTERPAY_KEY);
  } catch {
    /* the change screen still works until a reload */
  }
}

type Picking =
  | { type: 'item'; item: MenuItem; free?: OrderLine['free']; initial?: OrderLine }
  | { type: 'combo'; combo: Combo }
  | { type: 'reward'; reward: Reward }
  | null;

export function Cashier() {
  const state = useStore((s) => s);
  const s = state.settings;
  const device = useDevice();
  const day = openDay(state);
  const orders = useMemo(() => modeOrders(state), [state]);
  const left = useMemo(() => stockLeft(day, orders, s), [day, orders, s]);

  const [tab, setTab] = useState<TabId>('popular');
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [picking, setPicking] = useState<Picking>(null);
  const [paying, setPaying] = useState(false);
  const [afterPay, setAfterPay] = useState<{ id: string; mode: AfterPayMode } | null>(() => loadAfterPay((id) => !!state.orders[id]));
  const [soldOutMode, setSoldOutMode] = useState(false);
  const [cardInput, setCardInput] = useState('');
  const [cardId, setCardId] = useState<string | undefined>();
  const [voucherInput, setVoucherInput] = useState('');
  const [voucher, setVoucher] = useState<{ code: string; amount: number } | undefined>();
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [comboDismissed, setComboDismissed] = useState<string>('');
  const [escArmed, setEscArmed] = useState(false);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [tool, setTool] = useState<'card' | 'waste' | 'cash' | 'winner' | null>(null);
  /** The ready order whose details are open, before "Picked up". */
  const [pickup, setPickup] = useState<string | null>(null);
  const [orderNote, setOrderNote] = useState('');
  const [pickupDraft, setPickupDraft] = useState<PickupDraft>(EMPTY_PICKUP);
  /** Pay was tried with the pickup time or delivery place missing. */
  const [pickupMissing, setPickupMissing] = useState(false);
  /** Pay was tried with no name: the name box is marked until one is typed. */
  const [nameMissing, setNameMissing] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const [promoDismissed, setPromoDismissed] = useState<string>('');
  const [customerName, setCustomerName] = useState('');
  /** The name the Boom Card filled in (empty when the cashier typed it). */
  const [cardFilledName, setCardFilledName] = useState('');
  const [staleOk, setStaleOk] = useState('');
  const [parked, setParkedState] = useState<Parked[]>(loadParked);
  const setParked = (p: Parked[]) => {
    setParkedState(p);
    saveParked(p);
  };
  // Parked orders belong to one day and one kind of data (demo or real).
  // Once another day is open, or the data mode changed, the old ones go.
  const dayId = day?.id;
  useEffect(() => {
    const keep = parked.filter((p) => p.mode === s.mode && (!dayId || p.dayId === dayId));
    if (keep.length !== parked.length) setParked(keep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayId, s.mode]);
  const parkedHere = parked.filter((p) => p.mode === s.mode && p.dayId === dayId);

  // Leaving the cashier screen clears "Your order" on the customer monitor.
  useEffect(() => () => publishCart({ stage: 'idle' }), []);

  const cartUse = useMemo(() => stockUsage(lines), [lines]);
  const remaining = useCallback((id: string) => (left[id] ?? 0) - (cartUse[id] ?? 0), [left, cartUse]);
  const canUse = useCallback(
    (id: string) => {
      const it = itemById(s, id);
      return !!it && isAvailable(it, day, left) && remaining(id) > 0;
    },
    [s, day, left, remaining],
  );

  const cardList = useMemo(() => modeCards(state), [state]);
  const card = useMemo(() => (cardId ? cardStateFor(cardId, orders, s, cardList) : null), [cardId, orders, s, cardList]);
  // A registered card fills in the customer's first name, so the kitchen and
  // the monitor can call them (only when the cashier hasn't typed one).
  const registeredName = useCardName(cardId);
  const fillNameFromCard = (full: string) => {
    const first = full.split(' ')[0];
    setCustomerName(first);
    setCardFilledName(first);
  };
  const removeCard = () => {
    setCardId(undefined);
    setLines(lines.filter((l) => l.free?.reason !== 'reward'));
    if (cardFilledName && customerName === cardFilledName) setCustomerName('');
    setCardFilledName('');
  };
  useEffect(() => {
    if (registeredName && !customerName.trim()) fillNameFromCard(registeredName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registeredName, cardId]);
  const rewardsInCart = lines.flatMap((l) => (l.free?.reason === 'reward' ? [l.free.stampsAt] : []));
  const sub = subtotal(lines, s);
  const due = amountDue(lines, s, voucher?.amount ?? 0);
  const spins = spinsEarned(lines, s, !!voucher);
  const combo = suggestCombo(lines, s);
  const comboKey = combo ? combo.combo.id + combo.lineIds.join() : '';

  const flash = (text: string, bad = false) => {
    setNotice({ text, bad });
    setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 4000);
  };

  // ----- Adding items -----
  const addLine = (line: OrderLine) => {
    const existing = lines.find((l) => l.id === line.id);
    const freed = existing ? stockUsage([existing]) : {};
    const use = stockUsage([line]);
    for (const [id, n] of Object.entries(use)) {
      // Only menu items have a stock count (fries on top of a drink comes from the fries ingredient).
      if (!(id in left)) continue;
      const avail = remaining(id) + (freed[id] ?? 0);
      if (avail < n) {
        flash(`Not enough ${itemById(s, id)?.name ?? id} left (${Math.max(0, avail)}).`, true);
        return;
      }
    }
    if (existing) {
      setLines(lines.map((l) => (l.id === line.id ? line : l)));
      setPicking(null);
      return;
    }
    // Same item with the same choices: bump quantity.
    const same = lines.find((l) => !l.combo && !l.free && !line.free && !line.combo && l.itemId === line.itemId && JSON.stringify(l.choices ?? {}) === JSON.stringify(line.choices ?? {}) && (l.notes ?? '') === (line.notes ?? ''));
    if (same) setLines(lines.map((l) => (l === same ? { ...l, qty: l.qty + 1 } : l)));
    else setLines([...lines, line]);
    setPicking(null);
  };

  const tapItem = (item: MenuItem) => {
    if (soldOutMode) {
      if (!day) return;
      patchDay(day.id, { soldOut: { ...day.soldOut, [item.id]: !day.soldOut[item.id] } });
      return;
    }
    if (!canUse(item.id)) return flash(`${item.name} is sold out.`, true);
    if (opensPicker(item)) setPicking({ type: 'item', item });
    else addLine({ id: newId('l'), itemId: item.id, name: item.name, qty: 1, unitPrice: item.price });
  };

  /** Smallest saving a combo gives versus buying its cheapest parts separately. */
  /** Most a combo saves versus buying its dearest parts separately (the menu page's "Save up to ₱38"). */
  const comboSaving = (c: Combo) =>
    c.parts.reduce((sum, k) => {
      const prices = s.menu.filter((m) => m.active && (k === 'fries' ? m.kind === 'fries' && m.regular : m.kind === k)).map((m) => m.price);
      return sum + (prices.length ? Math.max(...prices) : 0);
    }, 0) - c.price;

  const editLine = (l: OrderLine) => {
    if (l.combo) return flash('To change a combo, remove it and add it again.');
    const item = itemById(s, l.itemId);
    if (!item || !opensPicker(item)) return;
    setPicking({ type: 'item', item, initial: l });
  };

  const comboAvailable = (c: Combo) =>
    c.parts.every((k) => s.menu.some((m) => (k === 'fries' ? m.kind === 'fries' && m.regular : m.kind === k) && canUse(m.id)));

  const changeQty = (id: string, d: number) => {
    const line = lines.find((l) => l.id === id)!;
    if (d > 0) {
      if (line.free) return flash('Free items are one each.', true);
      for (const [itemId, n] of Object.entries(stockUsage([{ ...line, qty: 1 }]))) {
        if (itemId in left && remaining(itemId) < n) return flash(`No more ${itemById(s, itemId)?.name ?? itemId} left.`, true);
      }
    }
    setLines(lines.flatMap((l) => (l.id !== id ? [l] : l.qty + d <= 0 ? [] : [{ ...l, qty: l.qty + d }])));
  };

  // ----- Card & voucher -----
  const applyCard = () => {
    if (!cardInput.trim()) return;
    const id = parseCard(cardInput, s);
    if (!id) return flash(`Unknown Boom Card number. Boom Cards run ${s.loyalty.prefix}${String(s.loyalty.first).padStart(3, '0')}–${s.loyalty.prefix}${s.loyalty.last}.`, true);
    setCardId(id);
    setCardInput('');
  };

  const useReward = (r: Reward) => {
    if (!card) return;
    if (rewardsInCart.includes(r.at)) return flash('That reward is already in this order.', true);
    const ok = canRedeem(card, r.at, s);
    if (!ok.ok) return flash(ok.message, true);
    if (r.itemId) {
      const item = itemById(s, r.itemId);
      if (!item || !canUse(item.id)) return flash(`${item?.name ?? 'Item'} is sold out.`, true);
      setPicking({ type: 'item', item, free: { reason: 'reward', stampsAt: r.at } });
    } else setPicking({ type: 'reward', reward: r });
  };

  const applyVoucher = () => {
    const r = checkVoucher(voucherInput, orders, s, localDate(), sub, lines);
    if (!r.ok) return flash(r.message, true);
    setVoucher({ code: r.code, amount: r.amount });
    setVoucherInput('');
    flash('Voucher applied.');
  };

  // Drop the voucher when the order no longer fits it: under the ₱20 voucher's
  // minimum, or the combo taken out of an order with a ₱15-off-a-combo voucher.
  useEffect(() => {
    if (!voucher) return;
    const r = checkVoucher(voucher.code, orders, s, localDate(), sub, lines);
    if (!r.ok) {
      setVoucher(undefined);
      flash(`Voucher removed: ${r.message}`, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, lines, voucher]);

  const clearOrder = () => {
    setLines([]);
    setOrderNote('');
    setPickupDraft(EMPTY_PICKUP);
    setPickupMissing(false);
    setNameMissing(false);
    setCustomerName('');
    setCardFilledName('');
    setCardId(undefined);
    setCardInput('');
    setVoucher(undefined);
    setVoucherInput('');
    setEscArmed(false);
  };

  // ----- Park an undecided customer's order -----
  const parkCurrent = (d: { id: string }): Parked => ({
    id: newId('p'),
    lines,
    cardId,
    voucher,
    name: customerName.trim() || undefined,
    note: cleanNote(orderNote),
    pickup: pickupDraft,
    nameFromCard: (!!cardFilledName && customerName === cardFilledName) || undefined,
    at: Date.now(),
    mode: s.mode,
    dayId: d.id,
  });

  const parkOrder = () => {
    if (!lines.length || !day) return;
    const p = parkCurrent(day);
    setParked([...parked, p]);
    clearOrder();
    flash(`Order parked${p.name ? ` for ${p.name}` : ''}. Tap it below to continue.`);
  };

  /**
   * Put a set-aside order (parked, or kept over a reload) back on screen.
   * Things may have changed meanwhile: the reward, the voucher and the stock
   * are checked again. Returns the problems found (already fixed where it can).
   */
  const bringBack = (p: Parked): string[] => {
    const problems: string[] = [];
    const cardNow = p.cardId ? cardStateFor(p.cardId, orders, s, cardList) : null;
    const seen: number[] = [];
    const kept = p.lines.filter((l) => {
      if (l.free?.reason !== 'reward') return true;
      const at = l.free.stampsAt;
      const ok = !!cardNow && !seen.includes(at) && canRedeem(cardNow, at, s).ok;
      if (ok) seen.push(at);
      else problems.push(`${l.name} removed: the Boom Card's reward is not there any more.`);
      return ok;
    });
    let v = p.voucher;
    if (v) {
      const r = checkVoucher(v.code, orders, s, localDate(), subtotal(kept, s), kept);
      if (!r.ok) {
        problems.push(`Voucher ${v.code} removed: ${r.message}`);
        v = undefined;
      }
    }
    const short = Object.entries(stockUsage(kept)).filter(([id, n]) => id in left && left[id] < n);
    if (short.length) problems.push(`Not enough left now: ${short.map(([id]) => itemById(s, id)?.name ?? id).join(', ')}. Check the order.`);

    setLines(kept);
    setCardId(p.cardId);
    setVoucher(v);
    setCustomerName(p.name ?? '');
    setOrderNote(p.note ?? '');
    setPickupDraft(p.pickup && typeof p.pickup === 'object' ? { ...EMPTY_PICKUP, ...p.pickup } : EMPTY_PICKUP);
    setCardFilledName(p.nameFromCard ? (p.name ?? '') : '');
    setCardInput('');
    setVoucherInput('');
    return problems;
  };

  const resumeOrder = (p: Parked) => {
    if (!day) return;
    let rest = parked.filter((x) => x.id !== p.id);
    // Whatever is on screen now gets parked, so nothing is lost.
    if (lines.length) rest = [...rest, parkCurrent(day)];
    setParked(rest);
    const problems = bringBack(p);
    if (problems.length) flash(problems.join(' '), true);
  };

  // ----- Keep the order over a reload -----
  // Once, when the day is known: bring back the order that was on screen,
  // but only on the same day and the same kind of data (demo or real).
  const draftChecked = useRef(false);
  useEffect(() => {
    if (draftChecked.current || !day) return;
    draftChecked.current = true;
    const d = loadDraft();
    if (!d || d.mode !== s.mode || d.dayId !== day.id) {
      saveDraft(null);
      return;
    }
    const problems = bringBack(d);
    flash(['Order brought back after a reload.', ...problems].join(' '), problems.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayId]);
  // Every change is saved; an empty order removes it (paying, Cancel and Park all empty it).
  useEffect(() => {
    if (!draftChecked.current || !day) return;
    saveDraft(lines.length ? parkCurrent(day) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, cardId, voucher, customerName, orderNote, pickupDraft, cardFilledName, s.mode, dayId]);
  useEffect(() => saveAfterPay(afterPay), [afterPay]);

  // ----- Pay -----
  /** Returns the problem (also shown as a notice) when the order could not be saved. */
  /** Open the payment screen. The customer's name comes first: the monitor and the kitchen call it. */
  const startPay = () => {
    if (!lines.length) return;
    if (!cleanName(customerName)) {
      setNameMissing(true);
      flash("Type the customer's first name first. It is called out when the order is ready.", true);
      nameInput.current?.focus();
      return;
    }
    const problem = pickupProblem(pickupDraft);
    if (problem) {
      setPickupMissing(true);
      flash(problem, true);
      return;
    }
    setPaying(true);
  };

  const pay = (method: Order['payment']['method'], tendered: number, reference: string): string | undefined => {
    if (!day) return;
    if (!cleanName(customerName)) {
      const problem = "The customer's first name is missing. Close this and type it first.";
      flash(problem, true);
      return problem;
    }
    const pickup: Pickup | undefined = pickupFrom(pickupDraft);
    if (!pickup) {
      const problem = `${pickupProblem(pickupDraft)} Close this and choose it first.`;
      flash(problem, true);
      return problem;
    }
    // Look at everything once more: another device or a parked order may have
    // used the voucher, the reward or the last pieces since this cart was built.
    const problem = checkCart({ lines, orders, settings: s, today: localDate(), voucher, cardState: card, rewardsRedeemed: rewardsInCart, left, soldOut: day.soldOut });
    if (problem) {
      flash(problem, true);
      return problem;
    }
    try {
      const o = createOrder({
        lines,
        day,
        orders,
        prefix: device.orderLetter || 'A',
        cashier: device.cashier || day.openedBy,
        cardId,
        customerName,
        note: orderNote,
        pickup,
        rewardsRedeemed: rewardsInCart,
        voucher,
        method,
        tendered,
        reference,
        settings: s,
        now: Date.now(),
      });
      putOrder(o);
      setPaying(false);
      setPayMethod('cash');
      setAfterPay({ id: o.id, mode: 'fresh' });
      clearOrder();
    } catch (e) {
      flash((e as Error).message, true);
      return (e as Error).message;
    }
  };

  const pickFree = (kind: MenuItem['kind']) =>
    s.menu.filter((m) => m.kind === kind && isAvailable(m, day, left)).sort((a, b) => a.price - b.price)[0];

  // ----- Customer monitor: show the order as it is rung up -----
  const afterOrder = afterPay ? state.orders[afterPay.id] : undefined;
  // The order on the after-payment screen was deleted on another device: go back to the menu.
  useEffect(() => {
    if (afterPay && !afterOrder) setAfterPay(null);
  }, [afterPay, afterOrder]);
  useEffect(() => {
    if (afterOrder && afterPay?.mode === 'fresh') {
      publishCart({
        stage: 'paid',
        number: afterOrder.number,
        spins: afterOrder.spinsEarned - afterOrder.spins.length,
        change: afterOrder.payment.method === 'cash' ? afterOrder.payment.change : 0,
        paid: afterOrder.payment.due,
        method: afterOrder.payment.method,
        name: afterOrder.customerName,
      });
      return;
    }
    if (!lines.length) {
      publishCart({ stage: 'idle' });
      return;
    }
    publishCart({
      stage: paying ? 'paying' : 'ordering',
      lines: lines.map((l) => ({ qty: l.qty, name: l.name, details: [...lineBits(l), ...(l.notes ? [l.notes] : [])].join(' · '), total: lineTotal(l, s), free: !!l.free })),
      subtotal: sub,
      voucher: voucher?.amount,
      due,
      spins,
      method: paying ? payMethod : undefined,
      name: customerName.trim() || undefined,
      when: pickupText({ pickup: pickupFrom(pickupDraft) }, s) || undefined,
    });
  }, [lines, paying, payMethod, voucher, afterOrder, afterPay?.mode, s, sub, due, spins, customerName, pickupDraft]);

  // ----- Keyboard -----
  type Entry = { type: 'item'; m: MenuItem } | { type: 'combo'; c: Combo };
  const entries = useMemo((): Entry[] => {
    const shown = (m: MenuItem) => m.active && (soldOutMode || !day?.soldOut[m.id]);
    if (tab === 'combos') return s.combos.filter((c) => c.active).map((c) => ({ type: 'combo', c }));
    if (tab === 'popular') {
      return popularToday(day, orders, s).flatMap((e): Entry[] => {
        if (e.type === 'combo') {
          const c = s.combos.find((x) => x.id === e.id);
          return c ? [{ type: 'combo', c }] : [];
        }
        const m = s.menu.find((x) => x.id === e.id);
        return m && shown(m) ? [{ type: 'item', m }] : [];
      });
    }
    return s.menu.filter((m) => m.category === tab && shown(m)).map((m) => ({ type: 'item', m }));
  }, [s, tab, soldOutMode, day, orders]);
  const activate = (e: Entry) => {
    if (e.type === 'item') return tapItem(e.m);
    if (soldOutMode) return;
    if (comboAvailable(e.c)) setPicking({ type: 'combo', combo: e.c });
    else flash(`${e.c.name} is sold out.`, true);
  };

  // The day was opened on an earlier date and never closed (left open overnight).
  const staleDay = !!day && day.date !== localDate() && staleOk !== day.id && !staleDayOk(day.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The pickup details close by themselves when the order stops being ready (undone, voided, picked up elsewhere).
      const pickupOpen = !!pickup && state.orders[pickup]?.status === 'ready' && !state.orders[pickup]?.voided;
      if (picking || paying || afterPay || tool || pickupOpen || staleDay) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        e.preventDefault();
        if (entries[n - 1]) activate(entries[n - 1]);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const i = TABS.findIndex((t) => t.id === tab);
        setTab(TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id);
      } else if (e.key === 'Enter' && lines.length) {
        e.preventDefault();
        startPay();
      } else if (e.key === 'Escape' && lines.length) {
        if (escArmed) clearOrder();
        else {
          setEscArmed(true);
          setTimeout(() => setEscArmed(false), 2500);
        }
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  if (!day) return <OpenDayForm />;

  const after = afterPay ? state.orders[afterPay.id] : undefined;
  const todays = orders.filter((o) => o.dayId === day.id && !o.voided);
  const readyToClaim = todays.filter((o) => o.status === 'ready').sort((a, b) => (a.readyAt ?? 0) - (b.readyAt ?? 0));
  const inKitchen = todays.filter((o) => o.status === 'new' || o.status === 'cooking').length;
  const recent = [...todays].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const waitingSpins = pendingSpins(day, orders, Date.now());
  const myLetter = device.orderLetter || 'A';
  // Two devices on the same letter give two orders the same number.
  const numbersSeen = new Set<string>();
  const letterClash = todays.some((o) => {
    if (!o.number.startsWith(myLetter + '-')) return false;
    if (numbersSeen.has(o.number)) return true;
    numbersSeen.add(o.number);
    return false;
  });
  const nextNumber = orderNumber(device.orderLetter || 'A', nextSeq(day, orders, device.orderLetter || 'A'));
  const soldOutCount = s.menu.filter((m) => m.active && day.soldOut[m.id]).length;
  const promo = promoStatus(summarize(day, orders, s), s);
  const promoKey = `${day.id}:${promo.level}`;
  const methods: PaymentMethod[] = ['cash', ...(s.payments.gcash ? (['gcash'] as const) : [])];
  // "+ Water" is offered while the order has no drink in it (a combo's shake or juice counts).
  const isDrink = (id: string) => itemById(s, id)?.category === 'drinks';
  const hasDrink = lines.some((l) => (l.combo ? l.combo.parts.some((p) => isDrink(p.itemId)) : isDrink(l.itemId)));
  const water = s.menu.find((m) => m.kind === 'water' && m.active);
  const offerWater = lines.length > 0 && !hasDrink && !!water && canUse(water.id);
  const pickupOrder = pickup ? readyToClaim.find((o) => o.id === pickup) : undefined;
  const tabCount = (id: TabId) =>
    id === 'popular' ? 0 : lines.reduce((n, l) => n + (id === 'combos' ? (l.combo ? l.qty : 0) : !l.combo && itemById(s, l.itemId)?.category === id ? l.qty : 0), 0);

  return (
    <div className="screen cashier">
      <TopBar title="Cashier">
        <div className="status-strip" aria-label="Booth status">
          <span>
            Next <b>{nextNumber}</b>
          </span>
          <span>
            Kitchen <b>{inKitchen}</b>
          </span>
          <span className={readyToClaim.length ? 'hot' : ''}>
            Ready <b>{readyToClaim.length}</b>
          </span>
          <span>
            Today <b>{todays.length}</b>
          </span>
        </div>
      </TopBar>
      {after ? (
        <AfterPay key={after.id} mode={afterPay?.mode ?? 'fresh'} order={after} orders={orders} s={s} pickFree={pickFree} onPatch={(patch) => patchOrder(after.id, patch)} onDone={() => setAfterPay(null)} />
      ) : staleDay ? (
        <div className="center-screen">
          <div className="card stale-day" role="alert">
            <h1>An earlier day is still open</h1>
            <p>
              The day opened on <b>{niceDate(day.date)}</b> was never closed. Close it on the Dashboard (count the cash), then open today.
            </p>
            <a className="btn primary big full" href="#dashboard">
              Go to the Dashboard
            </a>
            <button
              className="btn ghost full"
              onClick={() => {
                try {
                  sessionStorage.setItem(STALE_OK_KEY, day.id);
                } catch {
                  /* still dismissed while this screen stays open */
                }
                setStaleOk(day.id);
              }}
            >
              Keep selling on that day
            </button>
          </div>
        </div>
      ) : (
        <div className="cashier-body">
          <section className="menu-side">
            <nav className="tabs" role="tablist" aria-label="Menu">
              {TABS.map((t) => {
                const n = tabCount(t.id);
                return (
                  <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab tab-${t.id} ${tab === t.id ? 'selected' : ''}`} onClick={() => setTab(t.id)}>
                    {t.label}
                    {n > 0 && <span className="tab-count">{n}</span>}
                  </button>
                );
              })}
            </nav>
            {!s.wheel.paused && (promo.level === 'warn' || promo.level === 'pause') && promoDismissed !== promoKey && (
              <div className={`promo-alert ${promo.level}`} role="alert">
                <span>
                  {promo.level === 'pause' ? <b>Pause the wheel?</b> : <b>Prizes are running high.</b>} Prizes cost {promo.pct.toFixed(1)}% of today's sales (
                  {promo.level === 'pause' ? `limit ${s.promoLimits.pausePct}%` : `warning at ${s.promoLimits.warnPct}%`}).
                </span>
                <div className="row">
                  {promo.level === 'pause' && (
                    <button className="btn small danger" onClick={() => saveSettings({ wheel: { ...s.wheel, paused: true } })}>
                      Pause wheel
                    </button>
                  )}
                  <button className="btn small ghost" onClick={() => setPromoDismissed(promoKey)}>
                    Keep spinning
                  </button>
                </div>
              </div>
            )}
            {letterClash && (
              <p className="banner warn" role="alert">
                Another device is also using order letter {myLetter}. Change this device's letter in Setup → This device.
              </p>
            )}
            {soldOutMode && <p className="banner warn">Tap an item to mark it sold out. Tap it again to bring it back.</p>}

            <div className={`tiles ${soldOutMode ? 'marking' : ''}`}>
              {entries.map((e, i) =>
                e.type === 'combo' ? (
                  (() => {
                    const c = e.c;
                    const ok = comboAvailable(c);
                    const save = comboSaving(c);
                    return (
                      <button key={`c-${c.id}`} className={`tile tile-combos ${ok ? '' : 'out'}`} onClick={() => activate(e)}>
                        {i < 9 && <kbd>{i + 1}</kbd>}
                        <span className="tile-head">
                          <TilePhoto src={c.photo} />
                          <span className="tile-name">{c.name}</span>
                        </span>
                        <span className="tile-sub">{c.parts.map((p) => COMBO_PART[p]).join(' + ')}</span>
                        <span className="tile-foot">
                          <span className="tile-price">{peso(c.price)}</span>
                          {ok ? save > 0 && <span className="tile-save">save up to {peso(save)}</span> : <span className="tile-out">sold out</span>}
                        </span>
                      </button>
                    );
                  })()
                ) : (
                  (() => {
                    const m = e.m;
                    const n = remaining(m.id);
                    const start = day.stockCounts?.[m.id]?.qty ?? day.stockStart[m.id] ?? m.startStock;
                    const marked = !!day.soldOut[m.id];
                    const out = marked || n <= 0;
                    const pct = start > 0 ? Math.max(0, Math.min(100, (n / start) * 100)) : 0;
                    return (
                      <button key={m.id} className={`tile tile-${m.category} ${out ? 'out' : ''} ${!out && n <= 5 ? 'low' : ''}`} onClick={() => activate(e)} aria-label={`${m.name}, ${peso(m.price)}, ${out ? 'sold out' : `${n} left`}`}>
                        {i < 9 && <kbd>{i + 1}</kbd>}
                        <span className="tile-head">
                          <TilePhoto src={m.photo} />
                          <span className="tile-name">{m.name}</span>
                        </span>
                        {allergenText(itemTags(m), true) && <span className="tile-allergens">{allergenText(itemTags(m), true)}</span>}
                        <span className="tile-foot">
                          <span className="tile-price">{peso(m.price)}</span>
                          <span className="tile-left">{marked ? 'sold out' : n <= 0 ? '0 left' : `${n} left`}</span>
                        </span>
                        <span className="stock-meter" aria-hidden="true">
                          <span style={{ width: `${out ? 0 : pct}%` }} />
                        </span>
                      </button>
                    );
                  })()
                ),
              )}
            </div>

            <div className="orders-bar">
              {parkedHere.length > 0 && (
                <div className="orders-group">
                  <span className="orders-label">⏸ Parked · tap to continue</span>
                  {parkedHere.map((p, i) => {
                    const total = amountDue(p.lines, s, p.voucher?.amount ?? 0);
                    const items = p.lines.reduce((n, l) => n + l.qty, 0);
                    return (
                      <button key={p.id} className="btn small parked-chip" onClick={() => resumeOrder(p)} title={p.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}>
                        <b>{p.name ?? `Parked ${i + 1}`}</b>
                        <span>
                          {items} item{items > 1 ? 's' : ''} · {peso(total)} · {minutesAgo(p.at, Date.now())}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {readyToClaim.length > 0 && (
                <div className="orders-group">
                  <span className="orders-label">Ready · tap to see the order, then Picked up</span>
                  {readyToClaim.map((o) => (
                    <button key={o.id} className="btn small success ready-chip" onClick={() => setPickup(o.id)}>
                      {o.pickup?.deliverTo && '🚚 '}
                      {o.number}
                      {o.customerName && <b> · {o.customerName}</b>}
                      {o.pickup?.deliverTo && <span className="ready-place"> → {o.pickup.deliverTo}</span>}
                    </button>
                  ))}
                </div>
              )}
              {waitingSpins.length > 0 && (
                <div className="orders-group">
                  <span className="orders-label">🎡 Spins waiting · tap to log the prize</span>
                  {waitingSpins.map((o) => {
                    const left = o.spinsEarned - o.spins.length;
                    return (
                      <button key={o.id} className="btn small recent spin-waiting" onClick={() => setAfterPay({ id: o.id, mode: 'spin' })}>
                        {o.number}
                        {o.customerName && ` · ${o.customerName}`}
                        {left > 1 && <span className="recent-spin">×{left}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              {recent.length > 0 && (
                <div className="orders-group">
                  <span className="orders-label">Recent · tap to see voucher, stamps</span>
                  {recent.map((o) => (
                    <button key={o.id} className="btn small recent" onClick={() => setAfterPay({ id: o.id, mode: o.spinsEarned > o.spins.length && orderNet(o) > 0 ? 'spin' : 'past' })}>
                      {o.number}
                    </button>
                  ))}
                </div>
              )}
              <div className="tools-row">
                <div className="tools" aria-label="Tools">
              <button className="btn small ghost tool-btn" title="Check a Boom Card's stamps" onClick={() => setTool('card')}>
                    Boom Card
                  </button>
                  <button className="btn small ghost tool-btn" title="Log dropped or spoiled items" onClick={() => setTool('waste')}>
                    Waste
                  </button>
                  <button className="btn small ghost tool-btn" title="Cash taken out, added or paid out (manager PIN)" onClick={() => setTool('cash')}>
                    Cash
                  </button>
                  <button className="btn small ghost tool-btn" title="Add a spin winner to the monitor by hand (manager PIN)" onClick={() => setTool('winner')}>
                    Winner
                  </button>
                  <a className="btn small ghost tool-btn" title="Team page (passcode)" href="#team">
                    Team
                  </a>
                  <button className={`btn small tool-btn ${soldOutMode ? 'danger' : 'ghost'}`} title="Mark items sold out" onClick={() => setSoldOutMode(!soldOutMode)}>
                    {soldOutMode ? 'Done' : `Sold out${soldOutCount ? ` · ${soldOutCount}` : ''}`}
                  </button>
                </div>
                <p className="key-help">
                <kbd>1</kbd>–<kbd>9</kbd> add · <kbd>←</kbd>
                <kbd>→</kbd> tab · <kbd>Enter</kbd> pay · <kbd>Esc</kbd>×2 cancel
              </p>
              </div>
            </div>
          </section>

          <section className="order-side" aria-label="Current order">
            <div className="order-head">
              <h2>Order</h2>
              <span className="order-next">{nextNumber}</span>
            </div>
            <div className="order-scroll">
              {lines.length === 0 ? (
                <div className="empty-order">
                  <img src="./logo.png" alt="" width={120} height={120} />
                  <p>Tap an item to start an order.</p>
                </div>
              ) : (
                <ul className="lines">
                  {lines.map((l) => {
                    const lineItem = itemById(s, l.itemId);
                    const editable = !l.combo && !!lineItem && opensPicker(lineItem);
                    return (
                      <li key={l.id} className={`line ${l.free ? 'free' : ''}`}>
                        <div className="line-main">
                          <button className="line-name" onClick={() => editLine(l)} disabled={!editable} title={editable ? 'Tap to change side, dip or extras' : undefined}>
                            <b>{l.name}</b>
                            <LineDetails line={l} />
                            {l.notes && <span className="note">Note: {l.notes}</span>}
                            {editable && <span className="edit-hint">Edit</span>}
                          </button>
                          <div className="line-price">{peso(lineTotal(l, s))}</div>
                        </div>
                        <div className="line-actions">
                          <div className="stepper">
                            <button className="btn small" onClick={() => changeQty(l.id, -1)} aria-label={`One less ${l.name}`}>
                              −
                            </button>
                            <b>{l.qty}</b>
                            <button className="btn small" onClick={() => changeQty(l.id, 1)} aria-label={`One more ${l.name}`}>
                              +
                            </button>
                          </div>
                          {l.qty > 1 && <span className="muted small">{peso(lineUnitTotal(l, s))} each</span>}
                          <span className="spacer" />
                          <button className={`btn ghost small ${l.notes ? 'has-note' : ''}`} aria-expanded={editingNote === l.id} onClick={() => setEditingNote(editingNote === l.id ? null : l.id)}>
                            Note
                          </button>
                          <button className="btn ghost small danger-text" onClick={() => setLines(lines.filter((x) => x.id !== l.id))}>
                            Remove
                          </button>
                        </div>
                        {editingNote === l.id && (
                          <NoteEditor
                            line={l}
                            s={s}
                            value={l.notes ?? ''}
                            autoFocus
                            onChange={(v) => setLines(lines.map((x) => (x.id === l.id ? { ...x, notes: v || undefined } : x)))}
                            onDone={() => {
                              setLines(lines.map((x) => (x.id === l.id ? { ...x, notes: cleanNote(x.notes) } : x)));
                              setEditingNote(null);
                            }}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {combo && comboDismissed !== comboKey && (
                <div className="combo-offer">
                  <span>
                    This order has everything in <b>{combo.combo.name}</b>. Switch and save <b>{peso(combo.saving)}</b>?
                  </span>
                  <div className="row">
                    <button className="btn primary small" onClick={() => setLines(applyCombo(lines, combo, s))}>
                      Make it {combo.combo.name}
                    </button>
                    <button className="btn ghost small" onClick={() => setComboDismissed(comboKey)}>
                      No thanks
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="order-extras">
              {offerWater && water && (
                <button className="btn small water-btn" onClick={() => addLine({ id: newId('l'), itemId: water.id, name: water.name, qty: 1, unitPrice: water.price })}>
                  + Water {peso(water.price)}
                </button>
              )}
              <div className="mini-form name-form">
                <input
                  ref={nameInput}
                  className={`input ${nameMissing && !customerName.trim() ? 'missing' : ''}`}
                  value={customerName}
                  maxLength={20}
                  onChange={(e) => setCustomerName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), (e.target as HTMLInputElement).blur())}
                  placeholder="First name (required)"
                  aria-label="Customer first name (needed to pay)"
                  aria-required="true"
                  aria-invalid={nameMissing && !customerName.trim()}
                />
              </div>
              <PickupChooser s={s} value={pickupDraft} onChange={setPickupDraft} missing={pickupMissing} />
              <div className="mini-form order-note-form">
                <input
                  className="input"
                  value={orderNote}
                  maxLength={NOTE_MAX}
                  onChange={(e) => setOrderNote(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), (e.target as HTMLInputElement).blur())}
                  placeholder="Kitchen note (whole order)"
                  aria-label="Note for the kitchen about the whole order"
                />
              </div>
              {card ? (
                <div className="card-row">
                  <div>
                    <b>{card.cardId}</b> <span className="muted">{card.stamps}/{s.loyalty.cardSize} stamps</span>
                    <StampDots n={card.stamps} size={s.loyalty.cardSize} />
                    <CardNameField number={card.cardId} by={device.cashier || day.openedBy} onSaved={(n) => !customerName.trim() && fillNameFromCard(n)} />
                  </div>
                  <button className="btn ghost small" aria-label="Remove Boom Card" onClick={removeCard}>
                    ✕
                  </button>
                </div>
              ) : (
                <div className="mini-form">
                  <input className="input" value={cardInput} onChange={(e) => setCardInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), applyCard())} placeholder="Boom Card no." aria-label="Boom Card number" />
                  <button className="btn small" onClick={applyCard} disabled={!cardInput.trim()}>
                    Add
                  </button>
                </div>
              )}
              {card &&
                availableRewards(card, s).map((r) => (
                  <button key={r.at} className="btn reward" disabled={rewardsInCart.includes(r.at)} onClick={() => useReward(r)}>
                    🎁 Use reward: {r.label}
                  </button>
                ))}
              {voucher ? (
                <div className="card-row">
                  <span>
                    Voucher <b>{voucher.code}</b> −{peso(voucher.amount)}
                  </span>
                  <button className="btn ghost small" aria-label="Remove voucher" onClick={() => setVoucher(undefined)}>
                    ✕
                  </button>
                </div>
              ) : (
                <div className="mini-form">
                  <input className="input" value={voucherInput} onChange={(e) => setVoucherInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), applyVoucher())} placeholder="Voucher code" aria-label="Voucher code" />
                  <button className="btn small" onClick={applyVoucher} disabled={!voucherInput.trim()}>
                    Apply
                  </button>
                </div>
              )}
            </div>

            <div className="totals">
              {voucher && (
                <div className="totals-row">
                  <span>Subtotal</span>
                  <span>{peso(sub)}</span>
                </div>
              )}
              {voucher && (
                <div className="totals-row">
                  <span>Voucher</span>
                  <span>−{peso(voucher.amount)}</span>
                </div>
              )}
              <div className="grand">
                <span>Total</span>
                <b className="display">{peso(due)}</b>
              </div>
              {lines.length > 0 && <div className="spin-hint">{spins > 0 ? `🎡 ${spins} spin${spins > 1 ? 's' : ''} after paying` : s.wheel.paused ? 'Wheel paused today' : 'No spins on this order'}</div>}
              <div className="pay-row">
                <button className="btn ghost" disabled={!lines.length} onClick={clearOrder}>
                  Cancel
                </button>
                <button className="btn" disabled={!lines.length} onClick={parkOrder} title="Set this order aside and serve the next customer">
                  ⏸ Park
                </button>
                <button className="btn primary pay-btn" disabled={!lines.length} onClick={startPay}>
                  {lines.length ? `Pay ${peso(due)}` : 'Pay'} <kbd>↵</kbd>
                </button>
              </div>
            </div>

            <div className="toast-zone" aria-live="polite">
              {escArmed && <p className="toast-msg bad">Press Esc again to cancel this order.</p>}
              {notice && <p className={`toast-msg ${notice.bad ? 'bad' : ''}`}>{notice.text}</p>}
            </div>
          </section>
        </div>
      )}

      {picking?.type === 'item' && <ItemPicker item={picking.item} s={s} free={picking.free} initial={picking.initial} onAdd={addLine} onClose={() => setPicking(null)} />}
      {picking?.type === 'combo' && <ComboPicker combo={picking.combo} s={s} canUse={canUse} onAdd={addLine} onClose={() => setPicking(null)} />}
      {picking?.type === 'reward' && (
        <RewardBowlPicker
          items={s.menu.filter((m) => m.category === picking.reward.category && m.active)}
          canUse={canUse}
          onPick={(item) => setPicking({ type: 'item', item, free: { reason: 'reward', stampsAt: picking.reward.at } })}
          onClose={() => setPicking(null)}
        />
      )}
      {paying && (
        <PayModal
          due={due}
          methods={methods}
          duplicateOf={(ref) => duplicateReference(orders, day.id, ref)?.number}
          onMethod={setPayMethod}
          onPay={pay}
          onClose={() => {
            setPaying(false);
            setPayMethod('cash');
          }}
        />
      )}
      {tool === 'card' && <CardLookup s={s} orders={orders} cashier={device.cashier || day.openedBy} onClose={() => setTool(null)} />}
      {tool === 'cash' && <CashMoves s={s} day={day} cashier={device.cashier || day.openedBy} onClose={() => setTool(null)} />}
      {tool === 'waste' && <WasteLog s={s} day={day} cashier={device.cashier || day.openedBy} onClose={() => setTool(null)} />}
      {tool === 'winner' && <WinnerAdd s={s} day={day} cashier={device.cashier || day.openedBy} onClose={() => setTool(null)} />}
      {pickupOrder && (
        <PickupModal
          order={pickupOrder}
          s={s}
          onPickedUp={(thenSpins) => {
            patchOrder(pickupOrder.id, { status: 'claimed', claimedAt: Date.now() });
            setPickup(null);
            if (thenSpins) setAfterPay({ id: pickupOrder.id, mode: 'spin' });
          }}
          onClose={() => setPickup(null)}
        />
      )}
    </div>
  );
}

/** Small photo beside a menu tile's name. No photo (bottled water): nothing, so no gap. */
function TilePhoto({ src }: { src?: string }) {
  if (!src) return null;
  return <img className="tile-photo" src={`./${src}`} alt="" loading="lazy" decoding="async" draggable={false} />;
}

export function LineDetails({ line }: { line: OrderLine }) {
  const bits = lineBits(line);
  return bits.length ? <span className="details">{bits.join(' · ')}</span> : null;
}

function RewardBowlPicker({ items, canUse, onPick, onClose }: { items: MenuItem[]; canUse: (id: string) => boolean; onPick: (m: MenuItem) => void; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Pick the free item">
        <div className="modal-head">
          <h2>Reward: pick the flavor</h2>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        <div className="option-grid">
          {items.map((m) => (
            <button key={m.id} className="option" disabled={!canUse(m.id)} onClick={() => onPick(m)}>
              {m.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
