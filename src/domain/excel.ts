import { margins } from './inventory';
import { liabilities, type Liabilities } from './liabilities';
import { localDate } from './loyalty';
import { promoStatus } from './promo';
import { orderRows, summarize } from './reports';
import type { BusinessDay, Card, CashMove, Order, Settings } from './types';
import { buildXlsx, type Sheet, type XCell } from './xlsx';

const money = (v: number): XCell => ({ v: Math.round(v * 100) / 100, s: 'money' });
const boldMoney = (v: number): XCell => ({ v: Math.round(v * 100) / 100, s: 'boldMoney' });
const pct = (v: number): XCell => ({ v: Math.round(v * 10) / 1000, s: 'pct' }); // 34.2 → 0.342 shown as 34.2%
const head = (...cols: string[]): XCell[] => cols.map((c) => ({ v: c, s: 'header' }));
const bold = (v: string): XCell => ({ v, s: 'bold' });

const MOVE_NAME: Record<CashMove['type'], string> = { drop: 'Taken out', add: 'Change added', expense: 'Paid out' };
const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Summary rows for what the booth still owes customers, as of `today`. */
function oweRows(l: Liabilities, today: string): XCell[][] {
  return [
    head(`Still owed (as of ${today})`, 'Amount', 'Notes'),
    ['Vouchers not used yet', money(l.vouchers.amount), `${l.vouchers.count} ${l.vouchers.count === 1 ? 'code' : 'codes'} that can still be used, at face value`],
    ['Rewards ready', money(l.rewards.cost), `${l.rewards.rows.map((r) => `${r.count}× ${r.label}`).join(', ')}; at ingredient cost`],
    ['Stamps building up', money(l.stamps.cost), `${l.stamps.stamps} stamps on cards: their share of rewards not reached yet`],
    [bold('Total still owed'), boldMoney(l.total)],
  ];
}

/**
 * All the sheets for one business day: sales, profit and the details behind them.
 * `cashMoves` and `cards` may hold other days and modes; only what fits is used.
 * The "Cash in out" sheet is added when cash moves are passed (even none).
 */
export function daySheets(day: BusinessDay, all: Order[], s: Settings, cashMoves?: CashMove[], cards: Card[] = [], today: string = localDate()): Sheet[] {
  const sum = summarize(day, all, s, cashMoves);
  const owe = liabilities(all, cards, s, today);
  const promo = promoStatus(sum, s);
  const ingredients = sum.cost - sum.waste.cost;
  const marginPct = sum.net > 0 ? (sum.profit / sum.net) * 100 : 0;

  const summary: Sheet = {
    name: 'Summary',
    widths: [38, 16, 44],
    rows: [
      [{ v: `Chick Chick Boom · ${day.date}`, s: 'title' }],
      [`${day.mode === 'demo' ? 'DEMO data (practice)' : 'Real data'} · opened by ${day.openedBy}${day.closedAt ? ' · closed' : ' · still open'}`],
      [],
      head('Sales', 'Amount', 'Notes'),
      ['Orders', sum.orders],
      ['Gross sales', money(sum.grossSales), 'menu prices; free-meal bowls are giveaways, not sales'],
      ['Discounts', money(-sum.discounts), 'vouchers used + ₱10 off'],
      ['Customers paid', money(sum.gross), 'after vouchers'],
      ['Wheel prize cash given back', money(-sum.prizeRefunds)],
      ['Refunds', money(-sum.manualRefunds)],
      [bold('Sales'), boldMoney(sum.net), 'counts toward the daily goal'],
      ['Average order', money(sum.average)],
      ['Daily goal', money(sum.goal)],
      ['Goal reached', pct(sum.goal ? (sum.net / sum.goal) * 100 : 0)],
      [],
      head('Profit', 'Amount', 'Notes'),
      ['Sales', money(sum.net)],
      ['Ingredient cost', money(-ingredients), 'the next two lines together'],
      ['COGS of items sold', money(-sum.cogsSold), 'ingredients of what customers paid for'],
      ['Giveaways at cost', money(-sum.giveawaysAtCost), 'free meals, free prize items and loyalty rewards'],
      ['Waste (broken, spoiled…)', money(-sum.waste.cost), 'incl. orders voided after cooking'],
      [bold('Profit after ingredients'), boldMoney(sum.profit)],
      ['Profit margin', pct(marginPct), 'share of sales kept'],
      ['Expenses paid from the drawer', money(-sum.expenses), 'ice, LPG and other things bought with drawer cash'],
      [bold('Profit after expenses'), boldMoney(sum.netAfterExpenses)],
      [],
      head('Promos', 'Amount', 'Notes'),
      ['Wheel prizes', money(sum.promo.wheel), 'at cost: free meals and free items at ingredient cost, ₱10 off as cash'],
      ['Wheel cash given back', money(sum.promo.cashBack), 'cash handed back for free meals and ₱10 off'],
      ['Vouchers used', money(sum.promo.vouchers)],
      ['Loyalty rewards', money(sum.promo.rewards), 'ingredient cost'],
      ['Wheel + vouchers vs sales', pct(promo.pct), `warn at ${s.promoLimits.warnPct}%, pause at ${s.promoLimits.pausePct}%`],
      [],
      head('Cash drawer', 'Amount', 'Notes'),
      ['Opening float', money(sum.cash.float)],
      ['+ Cash sales', money(sum.cash.cashSales)],
      ['− Cash given back (wheel + refunds)', money(-sum.cash.paidOut)],
      ['− Void returns from drawer', money(-sum.cash.voidReturns), 'voided GCash/Maya orders paid back in cash'],
      ['− Taken out (drops)', money(-sum.cash.drops), 'moved to the safe'],
      ['+ Change added', money(sum.cash.added)],
      ['− Paid out (expenses)', money(-sum.cash.expenses), 'see the Cash in out sheet'],
      [bold('Should be in the drawer'), boldMoney(sum.cash.expected)],
      ['Counted at close', sum.cash.counted === undefined ? 'not closed yet' : money(sum.cash.counted)],
      ['Over (+) / short (−)', sum.cash.overShort === undefined ? '' : money(sum.cash.overShort)],
      [],
      ...oweRows(owe, today),
    ],
  };

  const moves = (cashMoves ?? []).filter((m) => m.dayId === day.id).sort((a, b) => a.at - b.at);
  const cashInOut: Sheet = {
    name: 'Cash in out',
    widths: [9, 14, 12, 36, 14, 40],
    freezeHeader: true,
    rows: [
      head('Time', 'Type', 'Amount', 'Note', 'By', 'Cancelled'),
      ...moves.map((m): XCell[] => [
        clock(m.at),
        MOVE_NAME[m.type],
        money(m.type === 'add' ? m.amount : -m.amount),
        m.note,
        m.by,
        m.cancelled ? `yes, by ${m.cancelled.by}: ${m.cancelled.reason}` : '',
      ]),
    ],
  };

  const items: Sheet = {
    name: 'Sales by item',
    widths: [40, 8, 14, 14, 14, 10],
    freezeHeader: true,
    rows: [
      head('Item', 'Qty', 'Sales', 'Cost', 'Profit', 'Margin'),
      ...sum.items.map((r): XCell[] => [r.name, r.qty, money(r.sales), money(r.cost), money(r.profit), pct(r.sales ? (r.profit / r.sales) * 100 : 0)]),
      [bold('Total'), sum.items.reduce((n, r) => n + r.qty, 0), boldMoney(sum.items.reduce((n, r) => n + r.sales, 0)), boldMoney(sum.items.reduce((n, r) => n + r.cost, 0)), boldMoney(sum.items.reduce((n, r) => n + r.profit, 0))],
      [],
      ['Item sales are before vouchers, wheel paybacks and refunds (see Summary).'],
    ],
  };

  const m = margins(s);
  const perPiece: Sheet = {
    name: 'Profit per piece',
    widths: [40, 12, 12, 12, 10],
    freezeHeader: true,
    rows: [
      head('Item', 'Price', 'Unit cost', 'Profit', 'Margin'),
      ...m.items.map((x): XCell[] => [x.name, money(x.price), money(x.cost), money(x.profit), pct(x.pct)]),
      [],
      head('Combo', 'Price', 'Lowest profit', 'Highest profit', 'Margin range'),
      ...m.combos.map((c): XCell[] => [c.name, money(c.price), money(c.low.profit), money(c.high.profit), `${Math.round(c.low.pct)}%–${Math.round(c.high.pct)}%`]),
    ],
  };

  const rows = orderRows(day, all, s);
  const moneyCols = new Set([11, 12, 13]);
  const orders: Sheet = {
    name: 'Orders',
    widths: [11, 8, 7, 12, 9, 12, 10, 13, 36, 40, 6, 11, 11, 11, 7, 20],
    freezeHeader: true,
    rows: [head(...(rows[0] as string[])), ...rows.slice(1).map((r) => r.map((c, i): XCell => (typeof c === 'number' && moneyCols.has(i) ? money(c) : c)))],
  };

  const hours: Sheet = {
    name: 'Hours',
    widths: [10, 10, 14],
    freezeHeader: true,
    rows: [head('Hour', 'Orders', 'Sales'), ...sum.hours.map((h): XCell[] => [`${String(h.hour).padStart(2, '0')}:00`, h.orders, money(h.sales)])],
  };

  const payments: Sheet = {
    name: 'Payments',
    widths: [12, 10, 14],
    rows: [head('Method', 'Orders', 'Amount'), ...sum.payments.filter((p) => p.orders > 0 || p.method === 'cash' || s.payments[p.method]).map((p): XCell[] => [p.method === 'cash' ? 'Cash' : p.method === 'gcash' ? 'GCash' : 'Maya', p.orders, money(p.amount)])],
  };

  const wheel: Sheet = {
    name: 'Wheel',
    widths: [22, 8, 14],
    rows: [head('Prize', 'Times', 'Cost'), ...sum.wheel.map((w): XCell[] => [w.label, w.count, money(w.cost)]), [], ['Spins', sum.spins]],
  };

  const waste: Sheet = {
    name: 'Waste',
    widths: [9, 36, 6, 18, 14, 12],
    freezeHeader: true,
    rows: [
      head('Time', 'Item', 'Qty', 'Reason', 'By', 'Cost'),
      ...(day.waste ?? []).map((w): XCell[] => {
        const item = s.menu.find((x) => x.id === w.itemId);
        return [clock(w.at), item?.name ?? w.itemId, w.qty, w.reason, w.by, money((item?.unitCost ?? 0) * w.qty)];
      }),
      ...sum.waste.rows.filter((r) => r.itemId === 'voided').map((r): XCell[] => ['', r.name, r.qty, 'Order voided', '', money(r.cost)]),
    ],
  };

  return [summary, items, perPiece, orders, hours, payments, wheel, waste, ...(cashMoves ? [cashInOut] : [])];
}

export function dayXlsx(day: BusinessDay, all: Order[], s: Settings, cashMoves?: CashMove[], cards: Card[] = [], today?: string): Uint8Array {
  return buildXlsx(daySheets(day, all, s, cashMoves, cards, today));
}

/** One summary row per business day of the current mode, oldest first, then totals and what is still owed. */
export function allDaysSheets(days: BusinessDay[], all: Order[], s: Settings, cashMoves: CashMove[] = [], cards: Card[] = [], today: string = localDate()): Sheet[] {
  const mine = days.filter((d) => d.mode === s.mode).sort((a, b) => a.date.localeCompare(b.date) || a.openedAt - b.openedAt);
  const sums = mine.map((d) => ({ d, sum: summarize(d, all, s, cashMoves) }));
  const add = (f: (x: (typeof sums)[number]['sum']) => number) => sums.reduce((n, x) => n + f(x.sum), 0);
  const counted = sums.filter((x) => x.sum.cash.counted !== undefined);
  const sheet: Sheet = {
    name: 'All days',
    widths: [14, 9, 14, 14, 14, 14, 16, 14, 14],
    freezeHeader: true,
    rows: [
      head('Date', 'Orders', 'Net sales', 'Cost', 'Profit', 'Expenses', 'Expected cash', 'Counted', 'Over/short'),
      ...sums.map(({ d, sum }): XCell[] => [
        d.date,
        sum.orders,
        money(sum.net),
        money(sum.cost),
        money(sum.profit),
        money(sum.expenses),
        money(sum.cash.expected),
        sum.cash.counted === undefined ? 'not closed' : money(sum.cash.counted),
        sum.cash.overShort === undefined ? '' : money(sum.cash.overShort),
      ]),
      [
        bold('Total'),
        add((x) => x.orders),
        boldMoney(add((x) => x.net)),
        boldMoney(add((x) => x.cost)),
        boldMoney(add((x) => x.profit)),
        boldMoney(add((x) => x.expenses)),
        '',
        counted.length ? boldMoney(counted.reduce((n, x) => n + x.sum.cash.counted!, 0)) : '',
        counted.length ? boldMoney(counted.reduce((n, x) => n + x.sum.cash.overShort!, 0)) : '',
      ],
      [],
      ['Expected cash is per day (each day starts from its own float), so it has no total.'],
      [],
      ...oweRows(liabilities(all, cards, s, today), today),
    ],
  };
  return [sheet];
}

export function allDaysXlsx(days: BusinessDay[], all: Order[], s: Settings, cashMoves: CashMove[] = [], cards: Card[] = [], today?: string): Uint8Array {
  return buildXlsx(allDaysSheets(days, all, s, cashMoves, cards, today));
}

export function allDaysFileName(s: Settings): string {
  return `chick-chick-boom-all-days${s.mode === 'demo' ? '-DEMO' : ''}.xlsx`;
}

export function xlsxFileName(day: BusinessDay): string {
  return `chick-chick-boom-${day.date}${day.mode === 'demo' ? '-DEMO' : ''}.xlsx`;
}
