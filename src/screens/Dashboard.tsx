import { useMemo, useState } from 'react';
import { peso } from '../domain/pricing';
import { allDaysFileName, allDaysXlsx, dayXlsx, xlsxFileName } from '../domain/excel';
import { liabilities, type Liabilities } from '../domain/liabilities';
import { localDate } from '../domain/loyalty';
import { expectedSpinCost, promoStatus } from '../domain/promo';
import { XLSX_MIME } from '../domain/xlsx';
import { ordersCsv, orderNet, pendingSpins, stockLeft, summarize, voidReturnAmount } from '../domain/reports';
import type { CashMove, Order, Refund } from '../domain/types';
import { appendToOrder, exportBackup, importBackup, latestDay, modeCards, modeCashMoves, modeOrders, openDay, patchDay, patchOrder, useDevice, useStore } from '../data/store';
import { useAuthState, useSyncStatus } from '../data/sync';
import { TopBar } from '../ui/TopBar';
import { download, ManagerConfirm, PinGate } from '../ui/ui';
import { LineDetails } from './cashier/Cashier';

export function Dashboard() {
  const pin = useStore((s) => s.settings.adminPin);
  return (
    <PinGate pin={pin} label="Dashboard">
      <DashboardInner />
    </PinGate>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span>{label}</span>
      {/* --len lets the CSS shrink long amounts (₱42,725) to fit the tile. */}
      <b style={{ '--len': Math.max(value.length, 3) } as React.CSSProperties}>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

type RestoreMsg = { ok: boolean; message: string } | null;

/**
 * Load a backup file. Works with no business day yet (a fresh laptop).
 * The message is kept by the dashboard, so it stays up when the restored day appears.
 */
function RestorePanel({ msg, setMsg }: { msg: RestoreMsg; setMsg: (m: RestoreMsg) => void }) {
  const [withSettings, setWithSettings] = useState(false);
  const auth = useAuthState();
  const sync = useSyncStatus();
  return (
    <section className="panel no-print restore-panel">
      <h2>Restore a backup</h2>
      <p className="muted small">Only adds orders this device does not have. Nothing here is changed.</p>
      <label className="row small">
        <input type="checkbox" checked={withSettings} onChange={(e) => setWithSettings(e.target.checked)} />
        Also restore menu, prices and passcodes (new laptop only)
      </label>
      <input
        type="file"
        accept="application/json,.json"
        aria-label="Backup file"
        onChange={async (e) => {
          const input = e.target;
          const f = input.files?.[0];
          if (!f) return;
          if (auth.email && !sync.connected) {
            // Restoring before this device has heard from the others could put old copies over newer ones.
            setMsg({ ok: false, message: 'Not restored. Wait until the top bar says Synced, then pick the file again.' });
            input.value = '';
            return;
          }
          try {
            setMsg(importBackup(await f.text(), { withSettings }));
          } catch {
            setMsg({ ok: false, message: 'Could not read that file.' });
          }
          // Let the same file be picked again.
          input.value = '';
        }}
      />
      {msg && (
        <p className={msg.ok ? 'ok-note' : 'error'} role="status">
          {msg.message}
        </p>
      )}
    </section>
  );
}

const METHOD_NAME = { cash: 'Cash', gcash: 'GCash', maya: 'Maya' } as const;
const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const refKey = (r: string | undefined) => (r ?? '').replace(/\s+/g, '').toLowerCase();

/** GCash payments of the day, to tick off against the wallet's own list. */
function WalletCheck({ dayList, all }: { dayList: Order[]; all: Order[] }) {
  const rows = dayList.filter((o) => o.payment.method !== 'cash').sort((a, b) => a.seq - b.seq);
  const byRef = new Map<string, Order[]>();
  for (const o of all) {
    if (o.payment.method === 'cash') continue;
    const k = refKey(o.payment.reference);
    if (k) byRef.set(k, [...(byRef.get(k) ?? []), o]);
  }
  const total = rows.reduce((n, o) => n + o.payment.due, 0);
  const mixed = new Set(rows.map((o) => o.payment.method)).size > 1;
  let flagged = 0;
  return (
    <section className="panel wallet-check">
      <h2>GCash check list</h2>
      {rows.length === 0 ? (
        <p className="muted">No GCash payments yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Order</th>
                <th>Amount</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const k = refKey(o.payment.reference);
                const twins = k ? (byRef.get(k) ?? []).filter((x) => x.id !== o.id) : [];
                const problem = !k ? 'No reference' : twins.length ? `Same as ${twins.map((x) => x.number).join(', ')}` : '';
                if (problem) flagged += 1;
                return (
                  <tr key={o.id} className={problem ? 'warn-row' : ''}>
                    <td>{clock(o.createdAt)}</td>
                    <td>
                      <b>{o.number}</b>
                      {mixed && <span className="muted small"> {METHOD_NAME[o.payment.method]}</span>}
                      {o.voided && <div className="muted small">voided, cash handed back</div>}
                    </td>
                    <td>{peso(o.payment.due)}</td>
                    <td className="wallet-ref">
                      {o.payment.reference || 'none'}
                      {problem && <div className="wallet-flag">{problem}</div>}
                    </td>
                  </tr>
                );
              })}
              <tr className="strong">
                <td colSpan={2}>
                  Total · {rows.length} {rows.length === 1 ? 'payment' : 'payments'}
                </td>
                <td>{peso(total)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        {flagged > 0 ? `${flagged} highlighted: the reference is missing or used twice. Find ${flagged === 1 ? 'it' : 'them'} in the GCash app. ` : ''}
        Each row should match one payment received in the GCash app. Voided orders stay on the list because the money still came in.
      </p>
    </section>
  );
}

const MOVE_NAME: Record<CashMove['type'], string> = { drop: 'Taken out', add: 'Change added', expense: 'Paid out' };

/** Read-only list of the day's drops, change added and expenses. Cancelled ones are crossed out. */
function CashMovesPanel({ moves }: { moves: CashMove[] }) {
  return (
    <section className="panel">
      <h2>Cash in/out today</h2>
      {moves.length === 0 ? (
        <p className="muted">No cash taken out or put in yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Note</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id} className={m.cancelled ? 'voided' : ''}>
                  <td>{clock(m.at)}</td>
                  <td>{MOVE_NAME[m.type]}</td>
                  <td>
                    {m.type === 'add' ? '+' : '−'}
                    {peso(m.amount)}
                  </td>
                  <td>
                    {m.note}
                    {m.cancelled && (
                      <div className="error">
                        Cancelled: {m.cancelled.reason} ({m.cancelled.by})
                      </div>
                    )}
                  </td>
                  <td>{m.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">The cashier records these. Crossed-out entries were cancelled and do not count.</p>
    </section>
  );
}

/** Vouchers, rewards and stamps customers can still claim, at what they cost us. */
function OwePanel({ owe, voucherAmount }: { owe: Liabilities; voucherAmount: number }) {
  const rewardText = owe.rewards.rows.filter((r) => r.count > 0).map((r) => `${r.count}× ${r.label}`).join(', ');
  return (
    <section className="panel owe-panel">
      <h2>What we still owe</h2>
      <div className="owe-stats">
        <Stat label="Vouchers not used yet" value={peso(owe.vouchers.amount)} sub={`${owe.vouchers.count} ${owe.vouchers.count === 1 ? 'code' : 'codes'}`} />
        <Stat label="Rewards ready" value={peso(Math.round(owe.rewards.cost))} sub={`${owe.rewards.count} ${owe.rewards.count === 1 ? 'reward' : 'rewards'}`} />
        <Stat label="Stamps building up" value={peso(Math.round(owe.stamps.cost))} sub={`${owe.stamps.stamps} stamps`} />
        <Stat label="Total" value={peso(Math.round(owe.total))} />
      </div>
      <ul className="owe-notes muted small">
        <li>Vouchers: codes won on the wheel that nobody has used and that have not expired. Each one takes {peso(voucherAmount)} off a later order.</li>
        <li>Rewards ready: free items customers can claim right now with their Boom Cards{rewardText ? ` (${rewardText})` : ''}, at ingredient cost.</li>
        <li>Stamps: a Boom Card part-way to a reward already stands for part of it (3 of 5 stamps counts as 3/5 of the fries). Rewards already ready are not counted twice.</li>
      </ul>
    </section>
  );
}

function DashboardInner() {
  const state = useStore((s) => s);
  const s = state.settings;
  const days = Object.values(state.days)
    .filter((d) => d.mode === s.mode)
    .sort((a, b) => b.openedAt - a.openedAt);
  const [dayId, setDayId] = useState<string | undefined>(undefined);
  const day = (dayId && state.days[dayId]) || openDay(state) || latestDay(state);
  const orders = useMemo(() => modeOrders(state), [state]);
  const allMoves = useMemo(() => modeCashMoves(state), [state]);
  const cards = useMemo(() => modeCards(state), [state]);
  const moves = useMemo(() => allMoves.filter((m) => m.dayId === day?.id).sort((a, b) => a.at - b.at), [allMoves, day]);
  const sum = useMemo(() => summarize(day, orders, s, moves), [day, orders, s, moves]);
  const today = localDate();
  const owe = useMemo(() => liabilities(orders, cards, s, today), [orders, cards, s, today]);
  const left = useMemo(() => stockLeft(day, orders, s), [day, orders, s]);
  const [counted, setCounted] = useState('');
  const [action, setAction] = useState<{ type: 'void' | 'refund'; orderId: string } | null>(null);
  const [search, setSearch] = useState('');
  const [restoreMsg, setRestoreMsg] = useState<RestoreMsg>(null);
  const [closeAsk, setCloseAsk] = useState(false);
  const [reopen, setReopen] = useState(false);
  const device = useDevice();

  if (!day) {
    return (
      <div className="screen dashboard">
        <TopBar title="Dashboard" />
        <div className="dash-body">
          <p className="empty">No business day yet. Open one on the cashier screen.</p>
          <div className="dash-grid">
            <RestorePanel msg={restoreMsg} setMsg={setRestoreMsg} />
          </div>
        </div>
      </div>
    );
  }

  const dayList = orders.filter((o) => o.dayId === day.id).sort((a, b) => b.seq - a.seq);
  const found = search.trim() ? dayList.filter((o) => o.number.toLowerCase().includes(search.trim().toLowerCase()) || o.cardId?.toLowerCase().includes(search.trim().toLowerCase())) : dayList.slice(0, 15);
  const maxHour = Math.max(1, ...sum.hours.map((h) => h.sales));
  const promo = promoStatus(sum, s);
  const expected = expectedSpinCost(s);
  const goalPct = Math.min(100, Math.max(0, sum.goalPct));

  // Things still going on: closing now would leave them hanging.
  const unfinished = dayList.filter((o) => !o.voided && (o.status === 'new' || o.status === 'cooking' || o.status === 'ready')).length;
  const spinsWaiting = pendingSpins(day, orders, Date.now(), Infinity).length;
  const loose = [
    unfinished > 0 ? `${unfinished} ${unfinished === 1 ? 'order is' : 'orders are'} not handed over yet` : '',
    spinsWaiting > 0 ? `${spinsWaiting} ${spinsWaiting === 1 ? 'order still has' : 'orders still have'} a spin waiting` : '',
  ].filter(Boolean);
  const reallyClose = () => {
    if (counted === '') return;
    patchDay(day.id, { countedCash: Number(counted), closedAt: Date.now(), closedBy: device.cashier.trim() || 'Dashboard' });
    setCloseAsk(false);
    setCounted('');
  };
  const closeDay = () => {
    if (counted === '') return;
    if (loose.length > 0) setCloseAsk(true);
    else reallyClose();
  };
  // Only one day can be open at a time.
  const otherOpen = days.find((d) => d.id !== day.id && !d.closedAt);
  const acting = action ? state.orders[action.orderId] : undefined;

  return (
    <div className="screen dashboard">
      <TopBar title="Dashboard" />
      <div className="dash-body">
        <div className="dash-head no-print">
          <label className="field inline">
            <span>Day</span>
            <select className="input" value={day.id} onChange={(e) => setDayId(e.target.value)}>
              {days.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.date} {d.closedAt ? '(closed)' : '(open)'} · {d.openedBy}
                </option>
              ))}
            </select>
          </label>
          <span className="spacer" />
          <button className="btn primary" onClick={() => download(xlsxFileName(day), dayXlsx(day, orders, s, allMoves, cards, today), XLSX_MIME)}>
            Export to Excel
          </button>
          <button className="btn" onClick={() => download(allDaysFileName(s), allDaysXlsx(days, orders, s, allMoves, cards, today), XLSX_MIME)}>
            Export all days
          </button>
          <button className="btn" onClick={() => download(`ccb-${day.date}-orders.csv`, ordersCsv(day, orders, s), 'text/csv')}>Export CSV</button>
          <button className="btn" onClick={() => print()}>Print day-end report</button>
          <button className="btn" onClick={() => download(`ccb-backup-${new Date().toISOString().slice(0, 16).replace(':', '')}.json`, exportBackup(), 'application/json')}>Download backup</button>
        </div>
        <h1 className="print-only">Chick Chick Boom — Day report {day.date}</h1>

        <section className="goal">
          <div className="goal-text">
            <span>Sales vs daily goal</span>
            <b>
              {peso(sum.net)} <span className="muted">/ {peso(sum.goal)}</span>
            </b>
            <span>{sum.goalPct}%</span>
          </div>
          <div className="goal-bar">
            <div style={{ width: `${goalPct}%` }} />
          </div>
        </section>

        <section className="stats">
          <Stat label="Orders" value={String(sum.orders)} />
          <Stat label="Average order" value={peso(sum.average)} />
          <Stat label="Sales at menu price" value={peso(sum.grossSales)} sub="before discounts, free meals left out" />
          <Stat label="Discounts" value={peso(sum.discounts)} sub="vouchers used + ₱10 off" />
          <Stat
            label="Ingredient cost"
            value={peso(Math.round(sum.cost))}
            sub={`food sold ${peso(Math.round(sum.cogsSold))} · giveaways ${peso(Math.round(sum.giveawaysAtCost))} · waste ${peso(Math.round(sum.waste.cost))}`}
          />
          <Stat label="Profit after ingredients" value={peso(Math.round(sum.profit))} tone={sum.profit >= 0 ? 'good' : 'bad'} />
          <Stat
            label="Profit after expenses"
            value={peso(Math.round(sum.netAfterExpenses))}
            sub={`paid out from the drawer ${peso(sum.expenses)}`}
            tone={sum.netAfterExpenses >= 0 ? 'good' : 'bad'}
          />
          <Stat
            label="Promo cost (at cost)"
            value={peso(Math.round(sum.promo.total))}
            sub={`wheel ${peso(Math.round(sum.promo.wheel))} · vouchers ${peso(sum.promo.vouchers)} · rewards ${peso(Math.round(sum.promo.rewards))}`}
          />
          <Stat label="Prize cash handed back" value={peso(sum.promo.cashBack)} sub="free meals and ₱10 off, paid from the drawer" />
          <Stat label="Spins" value={String(sum.spins)} />
        </section>

        <div className="dash-grid">
          <section className="panel">
            <h2>Items</h2>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Sales</th>
                  <th>Cost</th>
                  <th>Profit</th>
                </tr>
              </thead>
              <tbody>
                {sum.items.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.qty}</td>
                    <td>{peso(r.sales)}</td>
                    <td>{peso(Math.round(r.cost))}</td>
                    <td>{peso(Math.round(r.profit))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sum.items.length === 0 && <p className="muted">No sales yet.</p>}
            <p className="muted small">Item sales are before vouchers, wheel paybacks and refunds; the goal bar uses the final amount.</p>
          </section>

          <section className="panel">
            <h2>Payment</h2>
            <table>
              <tbody>
                {sum.payments.filter((p) => p.method === 'cash' || p.orders > 0 || s.payments[p.method]).map((p) => (
                  <tr key={p.method}>
                    <td>{METHOD_NAME[p.method]}</td>
                    <td>{p.orders} {p.orders === 1 ? 'order' : 'orders'}</td>
                    <td>{peso(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h2>Hours</h2>
            <div className="hours">
              {sum.hours.map((h) => (
                <div key={h.hour} className="hour-row">
                  <span>{String(h.hour).padStart(2, '0')}:00</span>
                  <div className="hour-bar">
                    <div style={{ width: `${(h.sales / maxHour) * 100}%` }} />
                  </div>
                  <span>
                    {peso(h.sales)} · {h.orders}
                  </span>
                </div>
              ))}
              {sum.hours.length === 0 && <p className="muted">No sales yet.</p>}
            </div>
          </section>

          <section className="panel">
            <h2>Wheel: what each prize cost</h2>
            <table>
              <thead>
                <tr>
                  <th>Prize</th>
                  <th>Times</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {sum.wheel.map((w) => (
                  <tr key={w.prize}>
                    <td>{w.label}</td>
                    <td>{w.count}</td>
                    <td>{peso(Math.round(w.cost))}</td>
                  </tr>
                ))}
                <tr className="strong">
                  <td>Prize cash handed back</td>
                  <td></td>
                  <td>{peso(sum.promo.cashBack)}</td>
                </tr>
              </tbody>
            </table>
            <p className="muted small">
              Prizes are counted at cost: a FREE MEAL costs the ingredients of the item, not its menu price. ₱10 off counts the cash. Free items count their ingredients. Vouchers count when they are used (under promo cost).
            </p>
          </section>

          <section className="panel">
            <h2>Prize limit</h2>
            <div className={`promo-meter ${promo.level}`}>
              <div className="promo-meter-bar">
                <div style={{ width: `${Math.min(100, (promo.pct / (s.promoLimits.pausePct * 1.25)) * 100)}%` }} />
                <i style={{ left: `${(s.promoLimits.warnPct / (s.promoLimits.pausePct * 1.25)) * 100}%` }} title="warning" />
                <i style={{ left: `${80}%` }} title="pause" />
              </div>
              <b className="display">{promo.pct.toFixed(1)}%</b>
            </div>
            <p className="small">
              Wheel prizes at cost + vouchers used: <b>{peso(Math.round(promo.cost))}</b> of {peso(sum.gross)} paid.{' '}
              {promo.level === 'early'
                ? `Not checked until sales reach ${peso(s.promoLimits.minSales)}.`
                : promo.level === 'pause'
                  ? `Over the ${s.promoLimits.pausePct}% limit: the cashier is asked to pause the wheel.`
                  : promo.level === 'warn'
                    ? `Above the ${s.promoLimits.warnPct}% warning.`
                    : 'Within normal range.'}
            </p>
            <p className="muted small">
              With today's menu a spin costs about {peso(Math.round(expected.perSpin))} on average ({expected.pctOfBowl.toFixed(1)}% of an average item). Every item spins now, so a normal day is roughly 8–10% of sales.
            </p>
          </section>

          <section className="panel">
            <h2>Waste</h2>
            {sum.waste.rows.length === 0 ? (
              <p className="muted">Nothing logged.</p>
            ) : (
              <table>
                <tbody>
                  {sum.waste.rows.map((w) => (
                    <tr key={w.itemId}>
                      <td>{w.name}</td>
                      <td>{w.qty}</td>
                      <td>{peso(w.cost)}</td>
                    </tr>
                  ))}
                  <tr className="strong">
                    <td>Total cost</td>
                    <td></td>
                    <td>{peso(sum.waste.cost)}</td>
                  </tr>
                </tbody>
              </table>
            )}
            {(day.waste?.length ?? 0) > 0 && (
              <p className="muted small">
                {day.waste!.map((w) => `${w.qty}× ${s.menu.find((m) => m.id === w.itemId)?.name ?? w.itemId}: ${w.reason} (${w.by}, ${new Date(w.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`).join(' · ')}
              </p>
            )}
            <p className="muted small">Waste is included in ingredient cost and profit.</p>
          </section>

          <section className="panel">
            <h2>Stock left</h2>
            <table>
              <tbody>
                {s.menu
                  .filter((m) => m.active)
                  .map((m) => (
                    <tr key={m.id} className={left[m.id] <= 5 || day.soldOut[m.id] ? 'warn-row' : ''}>
                      <td>{m.name}</td>
                      <td>
                        {left[m.id]} / {day.stockStart[m.id] ?? m.startStock}
                      </td>
                      <td>{day.soldOut[m.id] ? 'marked sold out' : ''}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <h2>Cash drawer</h2>
            <table>
              <tbody>
                <tr>
                  <td>Opening float</td>
                  <td>{peso(sum.cash.float)}</td>
                </tr>
                <tr>
                  <td>+ Cash sales</td>
                  <td>{peso(sum.cash.cashSales)}</td>
                </tr>
                <tr>
                  <td>− Paybacks (prize cash and refunds)</td>
                  <td>{peso(sum.cash.paidOut)}</td>
                </tr>
                <tr>
                  <td>− Cash handed back for voided GCash orders</td>
                  <td>{peso(sum.cash.voidReturns)}</td>
                </tr>
                <tr>
                  <td>− Taken out to the safe</td>
                  <td>{peso(sum.cash.drops)}</td>
                </tr>
                <tr>
                  <td>+ Change added</td>
                  <td>{peso(sum.cash.added)}</td>
                </tr>
                <tr>
                  <td>− Paid out for things we bought</td>
                  <td>{peso(sum.cash.expenses)}</td>
                </tr>
                <tr className="strong">
                  <td>Should be in the drawer</td>
                  <td>{peso(sum.cash.expected)}</td>
                </tr>
                {sum.cash.counted === undefined ? (
                  <tr>
                    <td>Counted at close</td>
                    <td className="muted">not yet</td>
                  </tr>
                ) : (
                  <>
                    <tr>
                      <td>Counted at close</td>
                      <td>{peso(sum.cash.counted)}</td>
                    </tr>
                    <tr className={`strong ${sum.cash.overShort! < 0 ? 'bad' : 'good'}`}>
                      <td>{sum.cash.overShort! < 0 ? 'SHORT' : sum.cash.overShort! > 0 ? 'OVER' : 'Exact'}</td>
                      <td>{peso(Math.abs(sum.cash.overShort!))}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
            {!day.closedAt ? (
              <>
                <div className="row no-print">
                  <input
                    className="input"
                    inputMode="numeric"
                    value={counted}
                    onChange={(e) => {
                      setCounted(e.target.value.replace(/\D/g, ''));
                      setCloseAsk(false);
                    }}
                    placeholder="Cash counted at close (₱)"
                    aria-label="Cash counted at close"
                  />
                  <button className="btn danger" disabled={counted === ''} onClick={closeDay}>
                    Close the day
                  </button>
                </div>
                {closeAsk && loose.length > 0 && (
                  <div className="banner warn close-ask no-print" role="alert">
                    <p>
                      <b>Not finished yet:</b> {loose.join(' and ')}. Closing now takes them off the kitchen and cashier screens.
                    </p>
                    <div className="row">
                      <button className="btn" onClick={() => setCloseAsk(false)}>
                        Not yet
                      </button>
                      <button className="btn danger" onClick={reallyClose}>
                        Close anyway
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="muted small">
                  Day closed {new Date(day.closedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  {day.closedBy ? ` by ${day.closedBy}` : ''}.
                </p>
                <div className="row no-print">
                  <button className="btn small" disabled={!!otherOpen} onClick={() => setReopen(true)}>
                    Reopen this day
                  </button>
                  {otherOpen && <span className="muted small">Close the day that is open now ({otherOpen.date}) first.</span>}
                </div>
              </>
            )}
          </section>

          <CashMovesPanel moves={moves} />

          <OwePanel owe={owe} voucherAmount={s.voucher.amount} />

          <section className="panel wide">
            <h2>Orders, voids and refunds</h2>
            <input className="input no-print" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find by order number or Boom Card (e.g. A-012, CCB-037)" />
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Time</th>
                  <th>Items</th>
                  <th>Paid</th>
                  <th>Final</th>
                  <th className="no-print"></th>
                </tr>
              </thead>
              <tbody>
                {found.map((o) => (
                  <tr key={o.id} className={o.voided ? 'voided' : ''}>
                    <td>
                      <b>{o.number}</b>
                      <div className="muted small">
                        {o.payment.method}
                        {o.payment.reference ? ` #${o.payment.reference}` : ''} {o.cardId ?? ''}
                      </div>
                    </td>
                    <td>{clock(o.createdAt)}</td>
                    <td>
                      {o.lines.map((l) => (
                        <div key={l.id}>
                          {l.qty}× {l.name} <LineDetails line={l} />
                        </div>
                      ))}
                      {o.voided && <div className="error">VOID: {o.voided.reason} ({o.voided.by})</div>}
                      {o.refunds?.map((r, i) => (
                        <div key={i} className="error">
                          Refund {peso(r.amount)}: {r.reason} ({r.by})
                        </div>
                      ))}
                    </td>
                    <td>{peso(o.payment.due)}</td>
                    <td>{peso(orderNet(o))}</td>
                    <td className="no-print">
                      {!o.voided && (
                        <div className="row">
                          <button className="btn small ghost" onClick={() => setAction({ type: 'refund', orderId: o.id })}>Refund</button>
                          <button className="btn small danger" onClick={() => setAction({ type: 'void', orderId: o.id })}>Void</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!search && dayList.length > 15 && <p className="muted small">Showing the latest 15 of {dayList.length}. Search to find others.</p>}
          </section>

          <WalletCheck dayList={dayList} all={dayList.filter((o) => !o.voided)} />

          <RestorePanel msg={restoreMsg} setMsg={setRestoreMsg} />
        </div>
      </div>

      {action && acting && !acting.voided && (
        <ManagerConfirm
          title={action.type === 'void' ? `Void ${acting.number}` : `Refund part of ${acting.number}`}
          managerPin={s.managerPin}
          needAmount={action.type === 'refund'}
          maxAmount={orderNet(acting)}
          who={device.cashier}
          confirmLabel={action.type === 'void' ? 'Void this order' : 'Refund'}
          note={
            action.type === 'void' ? (
              <p className="banner warn hand-back">
                {voidReturnAmount(acting) > 0 ? (
                  <>
                    Hand back <b>{peso(voidReturnAmount(acting))}</b> in cash.
                  </>
                ) : (
                  'Nothing to hand back: the customer already got it all back.'
                )}
              </p>
            ) : (
              <p className="muted small">The customer paid {peso(orderNet(acting))} for this order so far. Hand the refund back in cash.</p>
            )
          }
          onClose={() => setAction(null)}
          onConfirm={(reason, amount, by) => {
            if (action.type === 'void') patchOrder(acting.id, { voided: { reason, at: Date.now(), by } });
            else {
              // One refund is added, so a refund made on another device at the same time is kept.
              const refund: Refund = { amount, reason, at: Date.now(), by };
              appendToOrder(acting.id, 'refunds', refund);
            }
            setAction(null);
          }}
        />
      )}

      {reopen && day.closedAt && !otherOpen && (
        <ManagerConfirm
          title={`Reopen ${day.date}`}
          managerPin={s.managerPin}
          who={device.cashier}
          confirmLabel="Reopen this day"
          reasonHint="e.g. closed by mistake"
          note={<p className="muted small">The day opens again for selling. The cash count is cleared: count the drawer again when you close.</p>}
          onClose={() => setReopen(false)}
          onConfirm={() => {
            // undefined removes the field, here and on the other devices.
            patchDay(day.id, { closedAt: undefined, countedCash: undefined, closedBy: undefined });
            setReopen(false);
          }}
        />
      )}
    </div>
  );
}
