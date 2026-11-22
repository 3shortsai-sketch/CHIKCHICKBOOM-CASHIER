import { usedAfterCount, usesStock } from './inventory';
import { itemById, lineCostEach, lineTotal, money2, stockUsage } from './pricing';
import { paidSoFar, PRIZE_LABEL, prizeRefundTotal } from './wheel';
import type { BusinessDay, CashMove, MenuItem, Order, OrderLine, PaymentMethod, PrizeId, Settings } from './types';

export function dayOrders(day: BusinessDay | undefined, orders: Order[]): Order[] {
  if (!day) return [];
  return orders.filter((o) => o.dayId === day.id);
}

export function liveOrders(orders: Order[]): Order[] {
  return orders.filter((o) => !o.voided);
}

/**
 * Pieces left of each menu item: opening stock, or the kitchen's latest
 * count, minus what sold and what was wasted after that.
 * A voided order still counts if its food was already being made. An order
 * placed before a count but not finished at count time comes off the count.
 * A free wheel item counts from the moment of the spin.
 */
export function stockLeft(day: BusinessDay | undefined, orders: Order[], s: Settings): Record<string, number> {
  const left: Record<string, number> = {};
  const since: Record<string, number> = {};
  for (const m of s.menu) {
    const count = day?.stockCounts?.[m.id];
    left[m.id] = count ? count.qty : (day?.stockStart[m.id] ?? m.startStock);
    since[m.id] = count ? count.at : -Infinity;
  }
  for (const o of dayOrders(day, orders).filter(usesStock)) {
    for (const line of o.lines) {
      const placedAt = o.spins.find((sp) => sp.addedLineId === line.id)?.at ?? o.createdAt;
      for (const [id, n] of Object.entries(stockUsage([line]))) {
        if (id in left && usedAfterCount(o, since[id], placedAt)) left[id] -= n;
      }
    }
  }
  for (const w of day?.waste ?? []) {
    if (w.itemId in left && w.at > since[w.itemId]) left[w.itemId] -= w.qty;
  }
  return left;
}

export function isAvailable(item: MenuItem, day: BusinessDay | undefined, left: Record<string, number>): boolean {
  return item.active && !day?.soldOut[item.id] && (left[item.id] ?? 0) > 0;
}

/** Cost of the line: what it cost when sold if the line remembers it, else today's unit costs. */
function lineCost(line: OrderLine, s: Settings): number {
  if (line.costEach !== undefined) return line.costEach * line.qty;
  let cost = 0;
  for (const [id, n] of Object.entries(stockUsage([line]))) cost += (itemById(s, id)?.unitCost ?? 0) * n;
  return cost;
}

/** Cost of one unit of the line. */
function unitCost(line: OrderLine, s: Settings): number {
  return line.costEach ?? lineCostEach(line, s);
}

export function orderCost(o: Order, s: Settings): number {
  return o.lines.reduce((n, l) => n + lineCost(l, s), 0);
}

export function manualRefundTotal(o: Order): number {
  return (o.refunds ?? []).reduce((n, r) => n + r.amount, 0);
}

/**
 * Cash to hand back when voiding this order: what was paid, minus prize cash
 * and refunds the customer already got.
 */
export function voidReturnAmount(o: Order): number {
  return paidSoFar(o);
}

/** What the customer finally paid for this order, after prize payback and refunds. */
export function orderNet(o: Order): number {
  if (o.voided) return 0;
  return o.payment.due - prizeRefundTotal(o) - manualRefundTotal(o);
}

export type ItemRow = { id: string; name: string; qty: number; sales: number; cost: number; profit: number };

export type DaySummary = {
  orders: number;
  /** What customers paid at the till (after vouchers), before paybacks and refunds. */
  gross: number;
  /** Menu-price sales of live orders, with FREE MEAL bowls taken out (a giveaway, not a sale). */
  grossSales: number;
  /** Vouchers used + ₱10-off and 30%-off cash given back. grossSales − discounts − manualRefunds = net. */
  discounts: number;
  /** Free-meal bowls, free prize items and loyalty reward items, at ingredient cost. */
  giveawaysAtCost: number;
  /** Ingredient cost of what was really sold: cost − waste − giveawaysAtCost. */
  cogsSold: number;
  prizeRefunds: number;
  manualRefunds: number;
  net: number;
  average: number;
  cost: number;
  profit: number;
  /** Things bought with drawer cash today (ice, LPG). An operating cost, not ingredients. */
  expenses: number;
  /** profit − expenses. */
  netAfterExpenses: number;
  goal: number;
  goalPct: number;
  /** wheel is at cost (free meal = cost of the bowl); cashBack is the prize cash handed back. */
  promo: { wheel: number; vouchers: number; rewards: number; total: number; cashBack: number };
  waste: { rows: { itemId: string; name: string; qty: number; cost: number }[]; cost: number };
  items: ItemRow[];
  payments: { method: PaymentMethod; orders: number; amount: number }[];
  hours: { hour: number; orders: number; sales: number }[];
  wheel: { prize: PrizeId; label: string; count: number; cost: number }[];
  spins: number;
  /**
   * voidReturns: money handed back from the drawer for voided GCash/Maya orders.
   * drops: taken out to the safe; added: change put in; expenses: paid out for something.
   */
  cash: {
    float: number;
    cashSales: number;
    paidOut: number;
    voidReturns: number;
    drops: number;
    added: number;
    expenses: number;
    expected: number;
    counted?: number;
    overShort?: number;
  };
  voids: Order[];
};

/** Cash moves of this day that were not cancelled, added up by type. */
export function cashMoveTotals(day: BusinessDay | undefined, moves: CashMove[]): { drops: number; added: number; expenses: number } {
  const mine = moves.filter((m) => day && m.dayId === day.id && !m.cancelled);
  const sum = (type: CashMove['type']) => mine.filter((m) => m.type === type).reduce((n, m) => n + m.amount, 0);
  return { drops: sum('drop'), added: sum('add'), expenses: sum('expense') };
}

export function summarize(day: BusinessDay | undefined, all: Order[], s: Settings, cashMoves: CashMove[] = []): DaySummary {
  const todays = dayOrders(day, all);
  const live = liveOrders(todays);

  const gross = live.reduce((n, o) => n + o.payment.due, 0);
  const prizeRefunds = live.reduce((n, o) => n + prizeRefundTotal(o), 0);
  const manualRefunds = live.reduce((n, o) => n + manualRefundTotal(o), 0);
  const net = gross - prizeRefunds - manualRefunds;
  const wasteMap = new Map<string, { itemId: string; name: string; qty: number; cost: number }>();
  for (const w of day?.waste ?? []) {
    const item = itemById(s, w.itemId);
    const row = wasteMap.get(w.itemId) ?? { itemId: w.itemId, name: item?.name ?? w.itemId, qty: 0, cost: 0 };
    row.qty += w.qty;
    row.cost += w.qty * (item?.unitCost ?? 0);
    wasteMap.set(w.itemId, row);
  }
  // A voided order whose food was already made is wasted food.
  const voidedMade = todays.filter((o) => o.voided && o.status !== 'new');
  if (voidedMade.length) {
    wasteMap.set('voided', { itemId: 'voided', name: 'Voided after cooking', qty: voidedMade.length, cost: voidedMade.reduce((n, o) => n + orderCost(o, s), 0) });
  }
  const waste = { rows: [...wasteMap.values()], cost: [...wasteMap.values()].reduce((n, r) => n + r.cost, 0) };
  const cost = live.reduce((n, o) => n + orderCost(o, s), 0) + waste.cost;

  // Items
  const rows = new Map<string, ItemRow>();
  for (const o of live) {
    for (const l of o.lines) {
      const id = l.combo ? l.combo.comboId : l.itemId;
      const name = l.combo ? (s.combos.find((c) => c.id === l.combo!.comboId)?.name ?? id) : (itemById(s, id)?.name ?? l.name);
      const row = rows.get(id) ?? { id, name, qty: 0, sales: 0, cost: 0, profit: 0 };
      row.qty += l.qty;
      row.sales += lineTotal(l, s);
      row.cost += lineCost(l, s);
      row.profit = row.sales - row.cost;
      rows.set(id, row);
    }
  }
  const items = [...rows.values()].sort((a, b) => b.sales - a.sales);

  // Payments
  const methods: PaymentMethod[] = ['cash', 'gcash', 'maya'];
  const payments = methods.map((method) => {
    const os = live.filter((o) => o.payment.method === method);
    return { method, orders: os.length, amount: os.reduce((n, o) => n + o.payment.due, 0) };
  });

  // Hours
  const hourMap = new Map<number, { hour: number; orders: number; sales: number }>();
  for (const o of live) {
    const hour = new Date(o.createdAt).getHours();
    const h = hourMap.get(hour) ?? { hour, orders: 0, sales: 0 };
    h.orders += 1;
    h.sales += orderNet(o);
    hourMap.set(hour, h);
  }
  const hours = [...hourMap.values()].sort((a, b) => a.hour - b.hour);

  // Wheel, at cost: a FREE MEAL costs the ingredients of that item (not its
  // menu price); ₱10 off and 30% off cost the cash; a free item its ingredients. Vouchers
  // cost nothing until someone uses one (counted under promo.vouchers).
  let freeMealRefunds = 0;
  let freeMealCost = 0;
  let freeItemCost = 0;
  const wheelMap = new Map<PrizeId, { prize: PrizeId; label: string; count: number; cost: number }>();
  for (const sl of s.wheel.slots) wheelMap.set(sl.prize, { prize: sl.prize, label: PRIZE_LABEL[sl.prize], count: 0, cost: 0 });
  let spins = 0;
  for (const o of live) {
    for (const sp of o.spins) {
      spins += 1;
      const w = wheelMap.get(sp.prize) ?? { prize: sp.prize, label: PRIZE_LABEL[sp.prize], count: 0, cost: 0 };
      w.count += 1;
      if (sp.prize === 'freeMeal' && !sp.pct) {
        const spun = o.lines.find((l) => l.id === sp.lineId);
        // Nothing handed back (order already refunded) = nothing given away.
        const c = spun && sp.refund > 0 ? unitCost(spun, s) : 0;
        freeMealRefunds += sp.refund;
        freeMealCost += c;
        w.cost += c;
      } else {
        w.cost += sp.refund;
      }
      if (sp.addedLineId) {
        const added = o.lines.find((l) => l.id === sp.addedLineId);
        const c = added ? lineCost(added, s) : 0;
        freeItemCost += c;
        w.cost += c;
      }
      wheelMap.set(sp.prize, w);
    }
  }
  const wheel = [...wheelMap.values()];
  const wheelCost = wheel.reduce((n, w) => n + w.cost, 0);
  const vouchers = live.reduce((n, o) => n + (o.voucher?.amount ?? 0), 0);
  const rewards = live.reduce(
    (n, o) => n + o.lines.filter((l) => l.free?.reason === 'reward').reduce((c, l) => c + lineCost(l, s), 0),
    0,
  );

  // Sales the accountant's way. A free meal is a giveaway, not a sale;
  // vouchers and ₱10 off are discounts. (subtotal − due is the voucher part.)
  const grossSales = live.reduce((n, o) => n + o.subtotal, 0) - freeMealRefunds;
  const discounts = live.reduce((n, o) => n + (o.subtotal - o.payment.due), 0) + (prizeRefunds - freeMealRefunds);
  const giveawaysAtCost = freeMealCost + freeItemCost + rewards;
  const cogsSold = cost - waste.cost - giveawaysAtCost;

  // Cash drawer. Every payback and refund is handed out in cash. A voided
  // GCash/Maya order is paid back from the drawer too; a voided cash order
  // nets to zero (money in, same money out) and is left out.
  const float = day?.openingFloat ?? 0;
  const cashSales = live.filter((o) => o.payment.method === 'cash').reduce((n, o) => n + o.payment.due, 0);
  const paidOut = prizeRefunds + manualRefunds;
  const voidReturns = todays.filter((o) => o.voided && o.payment.method !== 'cash').reduce((n, o) => n + o.payment.due, 0);
  // Drops and expenses leave the drawer; change added goes in.
  const { drops, added, expenses } = cashMoveTotals(day, cashMoves);
  const expected = float + cashSales - paidOut - voidReturns - drops - expenses + added;
  const counted = day?.countedCash;

  return {
    orders: live.length,
    gross,
    grossSales,
    discounts,
    giveawaysAtCost,
    cogsSold,
    prizeRefunds,
    manualRefunds,
    net,
    average: live.length ? Math.round(net / live.length) : 0,
    cost,
    profit: net - cost,
    expenses,
    netAfterExpenses: net - cost - expenses,
    goal: s.dailyGoal,
    goalPct: s.dailyGoal ? Math.round((net / s.dailyGoal) * 100) : 0,
    promo: { wheel: wheelCost, vouchers, rewards, total: wheelCost + vouchers + rewards, cashBack: prizeRefunds },
    waste,
    items,
    payments,
    hours,
    wheel,
    spins,
    cash: { float, cashSales, paidOut, voidReturns, drops, added, expenses, expected, counted, overShort: counted === undefined ? undefined : counted - expected },
    voids: todays.filter((o) => o.voided),
  };
}

/** Bowls, fries, etc. finished by the kitchen today, by menu name. */
export function kitchenMadeCounts(day: BusinessDay | undefined, all: Order[], s: Settings): { name: string; made: number; waiting: number }[] {
  const made = new Map<string, { name: string; made: number; waiting: number }>();
  for (const o of liveOrders(dayOrders(day, all))) {
    const done = o.status === 'ready' || o.status === 'claimed';
    for (const [id, n] of Object.entries(stockUsage(o.lines))) {
      const item = itemById(s, id);
      if (!item || item.category === 'addons') continue;
      const row = made.get(id) ?? { name: item.name, made: 0, waiting: 0 };
      if (done) row.made += n;
      else row.waiting += n;
      made.set(id, row);
    }
  }
  return [...made.values()].sort((a, b) => b.made + b.waiting - (a.made + a.waiting));
}

// ---------- CSV ----------

/**
 * One CSV cell. With `text` on, a cell that a spreadsheet would run as a
 * formula (starts with = + - @, tab or return) gets a leading ' so it stays
 * text. Amounts are passed with `text` off, so -20 stays a number.
 */
export function csvCell(v: string | number | undefined, text = false): string {
  let s = v === undefined ? '' : String(v);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function time(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * One row per item, discount, payback and refund. Adding up the "amount"
 * column of rows where voided = no gives the day's net sales.
 */
export type Cell = string | number;

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One row per item, discount, payback, refund and waste. Adding up the
 * "amount" column of rows where voided = no gives the day's net sales.
 * Amounts are numbers (for Excel); text stays text.
 */
export function orderRows(day: BusinessDay | undefined, all: Order[], s: Settings): Cell[][] {
  const header = ['date', 'order', 'time', 'cashier', 'payment', 'reference', 'card', 'row_type', 'item', 'details', 'qty', 'unit_price', 'amount', 'cost', 'voided', 'void_reason'];
  const out: Cell[][] = [header];
  for (const o of dayOrders(day, all).sort((a, b) => a.seq - b.seq)) {
    const base: Cell[] = [day?.date ?? '', o.number, time(o.createdAt), o.cashier, o.payment.method, o.payment.reference ?? '', o.cardId ?? ''];
    const tail: Cell[] = [o.voided ? 'yes' : 'no', o.voided?.reason ?? ''];
    for (const l of o.lines) {
      const details = [
        l.choices?.side && `side: ${l.choices.side}`,
        l.choices?.extraSides?.length && `extra sides: ${l.choices.extraSides.join('/')}`,
        l.choices?.extraSauce && `extra sauce x${l.choices.extraSauce}`,
        l.choices?.dip && `dip: ${l.choices.dip}`,
        (l.choices?.topping === 'fries' || l.combo?.parts.some((p) => p.topping === 'fries')) && 'fries on top',
        l.combo && l.combo.parts.map((p) => itemById(s, p.itemId)?.name ?? p.itemId).join(' + '),
        l.free && (l.free.reason === 'prize' ? `wheel: ${PRIZE_LABEL[l.free.prize]}` : `reward: ${l.free.stampsAt} stamps`),
        l.notes,
      ]
        .filter(Boolean)
        .join('; ');
      const name = l.combo ? (s.combos.find((c) => c.id === l.combo!.comboId)?.name ?? l.itemId) : (itemById(s, l.itemId)?.name ?? l.name);
      out.push([...base, 'item', name, details, l.qty, l.unitPrice, lineTotal(l, s), r2(lineCost(l, s)), ...tail]);
    }
    if (o.voucher) out.push([...base, 'voucher', o.voucher.code, '', 1, '', -o.voucher.amount, 0, ...tail]);
    for (const sp of o.spins) {
      if (sp.refund) out.push([...base, 'prize_payback', PRIZE_LABEL[sp.prize], 'cash given back', 1, '', -sp.refund, 0, ...tail]);
    }
    for (const r of o.refunds ?? []) out.push([...base, 'refund', 'Refund', r.reason, 1, '', -r.amount, 0, ...tail]);
  }
  for (const w of day?.waste ?? []) {
    const item = itemById(s, w.itemId);
    out.push([day?.date ?? '', '', time(w.at), w.by, '', '', '', 'waste', item?.name ?? w.itemId, w.reason, w.qty, 0, 0, r2((item?.unitCost ?? 0) * w.qty), 'no', '']);
  }
  return out;
}

export function ordersCsv(day: BusinessDay | undefined, all: Order[], s: Settings): string {
  return orderRows(day, all, s)
    .map((r) => r.map((c) => (typeof c === 'number' ? csvCell(money2(c)) : csvCell(c, true))).join(','))
    .join('\n');
}

// ---------- Customer monitor ----------

/**
 * Today's best sellers by pieces sold (combo parts count for their item).
 * Only items that sold at least `min` qualify, so one early sale doesn't
 * crown a "best seller".
 */
export function bestSellers(day: BusinessDay | undefined, all: Order[], s: Settings, top = 2, min = 3): string[] {
  const sold: Record<string, number> = {};
  for (const o of liveOrders(dayOrders(day, all))) {
    for (const l of o.lines) {
      if (l.free) continue;
      const ids = l.combo ? l.combo.parts.map((p) => p.itemId) : [l.itemId];
      for (const id of ids) sold[id] = (sold[id] ?? 0) + l.qty;
    }
  }
  return Object.entries(sold)
    .filter(([id, n]) => n >= min && itemById(s, id)?.category !== 'addons')
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([id]) => id);
}

export type Win = { orderId: string; number: string; prize: PrizeId; at: number };

/** Latest wheel wins today, newest first ("Try again" is not a win). */
export function recentWins(day: BusinessDay | undefined, all: Order[], n = 5): Win[] {
  const wins: Win[] = [];
  for (const o of liveOrders(dayOrders(day, all))) {
    for (const sp of o.spins) {
      if (sp.prize !== 'tryAgain') wins.push({ orderId: o.id, number: o.number, prize: sp.prize, at: sp.at });
    }
  }
  return wins.sort((a, b) => b.at - a.at).slice(0, n);
}

/** Paid orders whose customer has not spun yet (wheel is at the pickup spot). */
export function pendingSpins(day: BusinessDay | undefined, all: Order[], now: number, maxAgeMin = 45): Order[] {
  return liveOrders(dayOrders(day, all))
    .filter((o) => o.spinsEarned > o.spins.length && orderNet(o) > 0 && now - o.createdAt < maxAgeMin * 60000)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// ---------- Cashier: Popular tab ----------

export type PopularEntry = { type: 'item'; id: string } | { type: 'combo'; id: string };

/**
 * Today's most ordered items and combos for the cashier's Popular tab.
 * Before anything sells (or to fill it up), it uses the menu's own order:
 * bowls, combos, regular fries, slushies.
 */
export function popularToday(day: BusinessDay | undefined, all: Order[], s: Settings, n = 8): PopularEntry[] {
  const counts = new Map<string, { e: PopularEntry; qty: number; first: number }>();
  const bump = (e: PopularEntry, qty: number, at: number) => {
    const key = `${e.type}:${e.id}`;
    const row = counts.get(key) ?? { e, qty: 0, first: at };
    row.qty += qty;
    counts.set(key, row);
  };
  for (const o of liveOrders(dayOrders(day, all))) {
    for (const l of o.lines) {
      if (l.free) continue;
      if (l.combo) bump({ type: 'combo', id: l.combo.comboId }, l.qty, o.createdAt);
      else if (itemById(s, l.itemId)?.category !== 'addons') bump({ type: 'item', id: l.itemId }, l.qty, o.createdAt);
    }
  }
  const ranked = [...counts.values()].sort((a, b) => b.qty - a.qty || a.first - b.first).map((r) => r.e);
  const active = (e: PopularEntry) => (e.type === 'item' ? !!s.menu.find((m) => m.id === e.id && m.active) : !!s.combos.find((c) => c.id === e.id && c.active));
  const defaults: PopularEntry[] = [
    ...s.menu.filter((m) => m.active && m.kind === 'bowl').map((m): PopularEntry => ({ type: 'item', id: m.id })),
    ...s.combos.filter((c) => c.active).map((c): PopularEntry => ({ type: 'combo', id: c.id })),
    ...s.menu.filter((m) => m.active && ((m.kind === 'fries' && m.regular) || m.kind === 'slushie')).map((m): PopularEntry => ({ type: 'item', id: m.id })),
  ];
  const out: PopularEntry[] = [];
  for (const e of [...ranked, ...defaults]) {
    if (out.length >= n) break;
    if (active(e) && !out.some((x) => x.type === e.type && x.id === e.id)) out.push(e);
  }
  return out;
}
