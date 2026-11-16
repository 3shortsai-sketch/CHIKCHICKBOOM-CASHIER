import { useMemo, useState } from 'react';
import { peso } from '../domain/pricing';
import { dayXlsx, xlsxFileName } from '../domain/excel';
import { expectedSpinCost, promoStatus } from '../domain/promo';
import { XLSX_MIME } from '../domain/xlsx';
import { ordersCsv, orderNet, stockLeft, summarize } from '../domain/reports';
import type { Order } from '../domain/types';
import { exportBackup, importBackup, latestDay, modeOrders, openDay, patchDay, patchOrder, useStore } from '../data/store';
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
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
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
  const sum = useMemo(() => summarize(day, orders, s), [day, orders, s]);
  const left = useMemo(() => stockLeft(day, orders, s), [day, orders, s]);
  const [counted, setCounted] = useState('');
  const [action, setAction] = useState<{ type: 'void' | 'refund'; order: Order } | null>(null);
  const [search, setSearch] = useState('');
  const [restoreMsg, setRestoreMsg] = useState('');

  if (!day) {
    return (
      <div className="screen">
        <TopBar title="Dashboard" />
        <div className="center-screen">
          <p className="empty">No business day yet. Open one on the cashier screen.</p>
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

  const closeDay = () => {
    if (counted === '') return;
    patchDay(day.id, { countedCash: Number(counted), closedAt: Date.now() });
  };

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
          <button className="btn primary" onClick={() => download(xlsxFileName(day), dayXlsx(day, orders, s), XLSX_MIME)}>
            Export to Excel
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
          <Stat label="Ingredient cost" value={peso(sum.cost)} />
          <Stat label="Profit after ingredients" value={peso(sum.profit)} tone={sum.profit >= 0 ? 'good' : 'bad'} />
          <Stat label="Promo cost" value={peso(sum.promo.total)} sub={`wheel ${peso(sum.promo.wheel)} · vouchers ${peso(sum.promo.vouchers)} · rewards ${peso(sum.promo.rewards)}`} />
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
                    <td>{peso(r.cost)}</td>
                    <td>{peso(r.profit)}</td>
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
                    <td>{p.method === 'cash' ? 'Cash' : p.method === 'gcash' ? 'GCash' : 'Maya'}</td>
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
                    <td>{peso(w.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Cash prizes count the cash given back. Free items count their ingredient cost. ₱20 vouchers count when used (under promo cost).</p>
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
              Wheel prizes + vouchers used: <b>{peso(Math.round(promo.cost))}</b> of {peso(sum.gross)} paid.{' '}
              {promo.level === 'early'
                ? `Not checked until sales reach ${peso(s.promoLimits.minSales)}.`
                : promo.level === 'pause'
                  ? `Over the ${s.promoLimits.pausePct}% limit: the cashier is asked to pause the wheel.`
                  : promo.level === 'warn'
                    ? `Above the ${s.promoLimits.warnPct}% warning.`
                    : 'Within normal range.'}
            </p>
            <p className="muted small">
              With today's menu a spin costs about {peso(Math.round(expected.perSpin))} on average ({expected.pctOfBowl.toFixed(1)}% of a bowl). On a normal day that is roughly 4–5% of sales.
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
                  <td>− Cash given back (wheel + refunds)</td>
                  <td>{peso(sum.cash.paidOut)}</td>
                </tr>
                <tr className="strong">
                  <td>Should be in the drawer</td>
                  <td>{peso(sum.cash.expected)}</td>
                </tr>
                {sum.cash.counted !== undefined && (
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
              <div className="row no-print">
                <input className="input" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ''))} placeholder="Cash counted at close (₱)" />
                <button className="btn danger" disabled={counted === ''} onClick={closeDay}>
                  Close the day
                </button>
              </div>
            ) : (
              <p className="muted small">Day closed {new Date(day.closedAt).toLocaleTimeString()}.</p>
            )}
          </section>

          <section className="panel wide">
            <h2>Orders, voids and refunds</h2>
            <input className="input no-print" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find by order number or card (e.g. A-012, CCB-037)" />
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
                    <td>{new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    <td>
                      {o.lines.map((l) => (
                        <div key={l.id}>
                          {l.qty}× {l.name} <LineDetails line={l} />
                        </div>
                      ))}
                      {o.voided && <div className="error">VOID: {o.voided.reason} ({o.voided.by})</div>}
                      {o.refunds?.map((r, i) => (
                        <div key={i} className="error">
                          Refund {peso(r.amount)}: {r.reason}
                        </div>
                      ))}
                    </td>
                    <td>{peso(o.payment.due)}</td>
                    <td>{peso(orderNet(o))}</td>
                    <td className="no-print">
                      {!o.voided && (
                        <div className="row">
                          <button className="btn small ghost" onClick={() => setAction({ type: 'refund', order: o })}>Refund</button>
                          <button className="btn small danger" onClick={() => setAction({ type: 'void', order: o })}>Void</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!search && dayList.length > 15 && <p className="muted small">Showing the latest 15 of {dayList.length}. Search to find others.</p>}
          </section>

          <section className="panel no-print">
            <h2>Restore a backup</h2>
            <p className="muted small">Loads orders and settings from a backup file into this device. Orders already here are kept.</p>
            <input
              type="file"
              accept="application/json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setRestoreMsg(importBackup(await f.text()).message);
              }}
            />
            {restoreMsg && <p className="ok-note">{restoreMsg}</p>}
          </section>
        </div>
      </div>

      {action && (
        <ManagerConfirm
          title={action.type === 'void' ? `Void ${action.order.number}` : `Refund part of ${action.order.number}`}
          managerPin={s.managerPin}
          needAmount={action.type === 'refund'}
          maxAmount={orderNet(action.order)}
          onClose={() => setAction(null)}
          onConfirm={(reason, amount) => {
            const by = 'Manager';
            if (action.type === 'void') patchOrder(action.order.id, { voided: { reason, at: Date.now(), by } });
            else patchOrder(action.order.id, { refunds: [...(action.order.refunds ?? []), { amount, reason, at: Date.now(), by }] });
            setAction(null);
          }}
        />
      )}
    </div>
  );
}
