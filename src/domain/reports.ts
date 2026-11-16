import { itemById, lineTotal, stockUsage } from './pricing';
import { PRIZE_LABEL, prizeRefundTotal } from './wheel';
import type { BusinessDay, MenuItem, Order, OrderLine, PaymentMethod, PrizeId, Settings } from './types';

export function dayOrders(day: BusinessDay | undefined, orders: Order[]): Order[] {
  if (!day) return [];
  return orders.filter((o) => o.dayId === day.id);
}

export function liveOrders(orders: Order[]): Order[] {
  return orders.filter((o) => !o.voided);
}

export function stockLeft(day: BusinessDay | undefined, orders: Order[], s: Settings): Record<string, number> {
  const left: Record<string, number> = {};
  for (const m of s.menu) left[m.id] = day?.stockStart[m.id] ?? m.startStock;
  for (const o of liveOrders(dayOrders(day, orders))) {
    for (const [id, n] of Object.entries(stockUsage(o.lines))) {
      if (id in left) left[id] -= n;
    }
  }
  for (const w of day?.waste ?? []) {
    if (w.itemId in left) left[w.itemId] -= w.qty;
  }
  return left;
}

export function isAvailable(item: MenuItem, day: BusinessDay | undefined, left: Record<string, number>): boolean {
  return item.active && !day?.soldOut[item.id] && (left[item.id] ?? 0) > 0;
}

function lineCost(line: OrderLine, s: Settings): number {
  let cost = 0;
  for (const [id, n] of Object.entries(stockUsage([line]))) cost += (itemById(s, id)?.unitCost ?? 0) * n;
  return cost;
}

export function orderCost(o: Order, s: Settings): number {
  return o.lines.reduce((n, l) => n + lineCost(l, s), 0);
}

export function manualRefundTotal(o: Order): number {
  return (o.refunds ?? []).reduce((n, r) => n + r.amount, 0);
}

/** What the customer finally paid for this order, after prize payback and refunds. */
export function orderNet(o: Order): number {
  if (o.voided) return 0;
  return o.payment.due - prizeRefundTotal(o) - manualRefundTotal(o);
}

export type ItemRow = { id: string; name: string; qty: number; sales: number; cost: number; profit: number };

export type DaySummary = {
  orders: number;
  gross: number;
  prizeRefunds: number;
  manualRefunds: number;
  net: number;
  average: number;
  cost: number;
  profit: number;
  goal: number;
  goalPct: number;
  promo: { wheel: number; vouchers: number; rewards: number; total: number };
  waste: { rows: { itemId: string; name: string; qty: number; cost: number }[]; cost: number };
  items: ItemRow[];
  payments: { method: PaymentMethod; orders: number; amount: number }[];
  hours: { hour: number; orders: number; sales: number }[];
  wheel: { prize: PrizeId; label: string; count: number; cost: number }[];
  spins: number;
  cash: { float: number; cashSales: number; paidOut: number; expected: number; counted?: number; overShort?: number };
  voids: Order[];
};

export function summarize(day: BusinessDay | undefined, all: Order[], s: Settings): DaySummary {
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

  // Wheel: cash paid back, or ingredient cost of the free item. Vouchers cost
  // nothing until someone uses one (counted under promo.vouchers).
  const wheelMap = new Map<PrizeId, { prize: PrizeId; label: string; count: number; cost: number }>();
  for (const sl of s.wheel.slots) wheelMap.set(sl.prize, { prize: sl.prize, label: PRIZE_LABEL[sl.prize], count: 0, cost: 0 });
  let spins = 0;
  for (const o of live) {
    for (const sp of o.spins) {
      spins += 1;
      const w = wheelMap.get(sp.prize) ?? { prize: sp.prize, label: PRIZE_LABEL[sp.prize], count: 0, cost: 0 };
      w.count += 1;
      w.cost += sp.refund;
      if (sp.addedLineId) {
        const added = o.lines.find((l) => l.id === sp.addedLineId);
        if (added) w.cost += lineCost(added, s);
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

  // Cash drawer. Every payback and refund is handed out in cash.
  const float = day?.openingFloat ?? 0;
  const cashSales = live.filter((o) => o.payment.method === 'cash').reduce((n, o) => n + o.payment.due, 0);
  const paidOut = prizeRefunds + manualRefunds;
  const expected = float + cashSales - paidOut;
  const counted = day?.countedCash;

  return {
    orders: live.length,
    gross,
    prizeRefunds,
    manualRefunds,
    net,
    average: live.length ? Math.round(net / live.length) : 0,
    cost,
    profit: net - cost,
    goal: s.dailyGoal,
    goalPct: s.dailyGoal ? Math.round((net / s.dailyGoal) * 100) : 0,
    promo: { wheel: wheelCost, vouchers, rewards, total: wheelCost + vouchers + rewards },
    waste,
    items,
    payments,
    hours,
    wheel,
    spins,
    cash: { float, cashSales, paidOut, expected, counted, overShort: counted === undefined ? undefined : counted - expected },
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

function csvCell(v: string | number | undefined): string {
  const s = v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function time(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * One row per item, discount, payback and refund. Adding up the "amount"
 * column of rows where voided = no gives the day's net sales.
 */
export function ordersCsv(day: BusinessDay | undefined, all: Order[], s: Settings): string {
  const header = ['date', 'order', 'time', 'cashier', 'payment', 'reference', 'card', 'row_type', 'item', 'details', 'qty', 'unit_price', 'amount', 'cost', 'voided', 'void_reason'];
  const out: string[][] = [header];
  for (const o of dayOrders(day, all).sort((a, b) => a.seq - b.seq)) {
    const base = [day?.date ?? '', o.number, time(o.createdAt), o.cashier, o.payment.method, o.payment.reference ?? '', o.cardId ?? ''];
    const tail = [o.voided ? 'yes' : 'no', o.voided?.reason ?? ''];
    for (const l of o.lines) {
      const details = [
        l.choices?.side && `side: ${l.choices.side}`,
        l.choices?.extraSides?.length && `extra sides: ${l.choices.extraSides.join('/')}`,
        l.choices?.extraSauce && `extra sauce x${l.choices.extraSauce}`,
        l.choices?.dip && `dip: ${l.choices.dip}`,
        l.combo && l.combo.parts.map((p) => itemById(s, p.itemId)?.name ?? p.itemId).join(' + '),
        l.free && (l.free.reason === 'prize' ? `wheel: ${PRIZE_LABEL[l.free.prize]}` : `reward: ${l.free.stampsAt} stamps`),
        l.notes,
      ]
        .filter(Boolean)
        .join('; ');
      out.push([...base, 'item', l.combo ? (s.combos.find((c) => c.id === l.combo!.comboId)?.name ?? l.itemId) : (itemById(s, l.itemId)?.name ?? l.name), details, String(l.qty), String(l.unitPrice), String(lineTotal(l, s)), String(lineCost(l, s)), ...tail]);
    }
    if (o.voucher) out.push([...base, 'voucher', o.voucher.code, '', '1', '', String(-o.voucher.amount), '0', ...tail]);
    for (const sp of o.spins) {
      if (sp.refund) out.push([...base, 'prize_payback', PRIZE_LABEL[sp.prize], 'cash given back', '1', '', String(-sp.refund), '0', ...tail]);
    }
    for (const r of o.refunds ?? []) out.push([...base, 'refund', 'Refund', r.reason, '1', '', String(-r.amount), '0', ...tail]);
  }
  for (const w of day?.waste ?? []) {
    const item = itemById(s, w.itemId);
    out.push([day?.date ?? '', '', time(w.at), w.by, '', '', '', 'waste', item?.name ?? w.itemId, w.reason, String(w.qty), '0', '0', String((item?.unitCost ?? 0) * w.qty), 'no', '']);
  }
  return out.map((r) => r.map(csvCell).join(',')).join('\n');
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
    .filter((o) => o.spinsEarned > o.spins.length && now - o.createdAt < maxAgeMin * 60000)
    .sort((a, b) => a.createdAt - b.createdAt);
}
