import { useEffect, useMemo, useState } from 'react';
import { dayXlsx, xlsxFileName } from '../domain/excel';
import { margins } from '../domain/inventory';
import { XLSX_MIME } from '../domain/xlsx';
import { peso } from '../domain/pricing';
import { summarize } from '../domain/reports';
import { latestDay, modeCards, modeCashMoves, modeOrders, openDay, useStore } from '../data/store';
import { TopBar } from '../ui/TopBar';
import { download, PinGate } from '../ui/ui';

const LOCK_LABEL = 'Team';
const IDLE_LOCK_MS = 60_000;
const REVEAL_MS = 30_000;

/**
 * Team-only day numbers (profit, margins). Deliberately discreet because the
 * cashier laptop faces the counter: neutral name ("Team"), amounts hidden
 * until tapped, quick Hide, and it locks itself after a minute idle.
 */
export function Profit() {
  const s = useStore((st) => st.settings);
  return (
    <PinGate pin={s.teamPin} also={[s.adminPin]} label={LOCK_LABEL}>
      <ProfitInner />
    </PinGate>
  );
}

function lockAndLeave() {
  try {
    sessionStorage.removeItem(`ccb:unlocked:${LOCK_LABEL}`);
  } catch {
    /* ignore */
  }
  location.hash = '#cashier';
}

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

function ProfitInner() {
  const state = useStore((st) => st);
  const s = state.settings;
  const day = openDay(state) ?? latestDay(state);
  const orders = useMemo(() => modeOrders(state), [state]);
  const allMoves = useMemo(() => modeCashMoves(state), [state]);
  const cards = useMemo(() => modeCards(state), [state]);
  const sum = useMemo(() => summarize(day, orders, s, allMoves), [day, orders, s, allMoves]);
  const m = useMemo(() => margins(s), [s]);
  // Profit after ingredients, prizes and waste. Prize cash is already out of
  // "net"; free prize items and waste are in "cost".
  const profit = sum.profit;
  const marginPct = sum.net > 0 ? (profit / sum.net) * 100 : 0;
  const [shown, setShown] = useState(false);

  // Hide numbers again after a while; lock and leave when nobody touches it.
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(false), REVEAL_MS);
    return () => clearTimeout(t);
  }, [shown]);
  useEffect(() => {
    let timer = setTimeout(lockAndLeave, IDLE_LOCK_MS);
    const poke = () => {
      clearTimeout(timer);
      timer = setTimeout(lockAndLeave, IDLE_LOCK_MS);
    };
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' ? lockAndLeave() : poke());
    addEventListener('pointerdown', poke);
    addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      removeEventListener('pointerdown', poke);
      removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className={`screen profit ${shown ? 'shown' : 'masked'}`}>
      <TopBar title="Team">
        <button className="btn small" onClick={() => setShown(!shown)}>
          {shown ? 'Hide numbers' : 'Show numbers'}
        </button>
        {day && (
          <button className="btn small" onClick={() => download(xlsxFileName(day), dayXlsx(day, orders, s, allMoves, cards), XLSX_MIME)}>
            Download Excel
          </button>
        )}
        <button className="btn small" onClick={lockAndLeave}>
          Hide (Esc)
        </button>
      </TopBar>
      <div className="dash-body">
        {!shown && <p className="muted small mask-note">Numbers are hidden. Tap "Show numbers" (they hide again after 30 seconds). This page locks itself after 1 minute.</p>}
        <section className="profit-hero">
          <div>
            <span>Profit today{day ? ` · ${day.date}` : ''}</span>
            <b className={profit < 0 ? 'neg' : ''}>{peso(Math.round(profit))}</b>
            <small>{sum.net > 0 ? `${pct(marginPct)} of sales kept after ingredients, prizes and waste` : 'No sales yet today'}</small>
          </div>
          <div className="profit-flow" aria-label="How profit is worked out">
            <div>
              <span>Customers paid</span>
              <b>{peso(sum.gross)}</b>
            </div>
            <div>
              <span>− Prize cash & refunds</span>
              <b>{peso(sum.prizeRefunds + sum.manualRefunds)}</b>
            </div>
            <div>
              <span>= Sales</span>
              <b>{peso(sum.net)}</b>
            </div>
            <div>
              <span>− Ingredient cost (incl. free items)</span>
              <b>{peso(Math.round((sum.cost - sum.waste.cost) * 100) / 100)}</b>
            </div>
            <div>
              <span>− Waste</span>
              <b>{peso(sum.waste.cost)}</b>
            </div>
            <div className="strong">
              <span>= Profit</span>
              <b>{peso(Math.round(profit * 100) / 100)}</b>
            </div>
            {sum.expenses > 0 && (
              <>
                <div>
                  <span>− Paid out from the drawer</span>
                  <b>{peso(sum.expenses)}</b>
                </div>
                <div className="strong">
                  <span>= After expenses</span>
                  <b>{peso(Math.round(sum.netAfterExpenses * 100) / 100)}</b>
                </div>
              </>
            )}
          </div>
        </section>

        <div className="dash-grid">
          <section className="panel">
            <h2>Sold today</h2>
            {sum.items.length === 0 ? (
              <p className="muted">No sales yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Sales</th>
                    <th>Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sum.items]
                    .sort((a, b) => b.profit - a.profit)
                    .map((r) => (
                      <tr key={r.id}>
                        <td>{r.name}</td>
                        <td>{r.qty}</td>
                        <td>{peso(r.sales)}</td>
                        <td className={r.profit < 0 ? 'neg' : ''}>{peso(Math.round(r.profit))}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
            <p className="muted small">Before vouchers and wheel paybacks; those are in the total above.</p>
          </section>

          <section className="panel">
            <h2>Profit per piece</h2>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Price</th>
                  <th>Cost</th>
                  <th>Profit</th>
                  <th>Margin</th>
                </tr>
              </thead>
              <tbody>
                {m.items
                  .filter((x) => !x.id.startsWith('extra-'))
                  .map((x) => (
                    <tr key={x.id}>
                      <td>{x.name}</td>
                      <td>{peso(x.price)}</td>
                      <td>{peso(x.cost)}</td>
                      <td>{peso(Math.round(x.profit * 100) / 100)}</td>
                      <td>
                        <span className={`margin-pill ${x.pct < 30 ? 'low' : x.pct >= 50 ? 'high' : ''}`}>{pct(x.pct)}</span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <h2>Combos</h2>
            <table>
              <thead>
                <tr>
                  <th>Combo</th>
                  <th>Price</th>
                  <th>Profit</th>
                  <th>Margin</th>
                </tr>
              </thead>
              <tbody>
                {m.combos.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td>{peso(c.price)}</td>
                    <td>
                      {peso(Math.round(c.low.profit))}–{peso(Math.round(c.high.profit))}
                    </td>
                    <td>
                      <span className={`margin-pill ${c.low.pct < 30 ? 'low' : ''}`}>
                        {pct(c.low.pct)}–{pct(c.high.pct)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Range depends on which bowl, drink or cookie the customer picks.</p>
          </section>

          <section className="panel">
            <h2>Promos today</h2>
            <table>
              <tbody>
                <tr>
                  <td>Wheel prizes</td>
                  <td>{peso(Math.round(sum.promo.wheel * 100) / 100)}</td>
                </tr>
                <tr>
                  <td>Vouchers used</td>
                  <td>{peso(sum.promo.vouchers)}</td>
                </tr>
                <tr>
                  <td>Boom Card rewards (ingredient cost)</td>
                  <td>{peso(Math.round(sum.promo.rewards * 100) / 100)}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
