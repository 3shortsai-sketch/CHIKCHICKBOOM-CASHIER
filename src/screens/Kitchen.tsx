import { useEffect, useMemo, useRef, useState } from 'react';
import { itemById } from '../domain/pricing';
import { kitchenMadeCounts } from '../domain/reports';
import type { ComboPart, Order, OrderLine, Settings } from '../domain/types';
import { modeOrders, openDay, patchOrder, useStore } from '../data/store';
import { TopBar } from '../ui/TopBar';
import { chime, minutesAgo, unlockSound, useNow, useWakeLock } from '../ui/ui';

function partText(p: ComboPart | OrderLine['choices']): string[] {
  if (!p) return [];
  const out: string[] = [];
  if (p.side) out.push(`side: ${p.side}`);
  if (p.extraSides?.length) out.push(`EXTRA ${p.extraSides.join(', ')}`);
  if (p.extraSauce) out.push(`+${p.extraSauce} SAUCE`);
  if (p.dip) out.push(`dip: ${p.dip}`);
  if (p.topping === 'fries') out.push('FRIES ON TOP');
  return out;
}

function KitchenLine({ line, s }: { line: OrderLine; s: Settings }) {
  const name = (id: string) => itemById(s, id)?.name ?? id;
  if (line.combo) {
    return (
      <li className={line.addedAfterPay ? 'added' : ''}>
        <b>
          {line.qty}× {s.combos.find((c) => c.id === line.combo!.comboId)?.name}
        </b>
        <ul>
          {line.combo.parts.map((p, i) => (
            <li key={i}>
              {name(p.itemId)} {partText(p).length > 0 && <span className="k-detail">({partText(p).join(', ')})</span>}
            </li>
          ))}
        </ul>
        {line.notes && <div className="k-note">📝 {line.notes}</div>}
      </li>
    );
  }
  return (
    <li className={line.addedAfterPay ? 'added' : ''}>
      <b>
        {line.qty}× {name(line.itemId)}
      </b>
      {line.free?.reason === 'prize' && <span className="k-tag">FREE – wheel</span>}
      {line.free?.reason === 'reward' && <span className="k-tag">REWARD</span>}
      {partText(line.choices).length > 0 && <div className="k-detail">{partText(line.choices).join(', ')}</div>}
      {line.notes && <div className="k-note">📝 {line.notes}</div>}
    </li>
  );
}

export function Kitchen() {
  const state = useStore((s) => s);
  const s = state.settings;
  const day = openDay(state);
  const now = useNow(15000);
  const [started, setStarted] = useState(false);
  useWakeLock(started);

  const todays = useMemo(() => modeOrders(state).filter((o) => o.dayId === day?.id && !o.voided), [state, day]);
  const queue = todays.filter((o) => o.status === 'new' || o.status === 'cooking').sort((a, b) => a.createdAt - b.createdAt);
  const recent = todays
    .filter((o) => o.status === 'ready')
    .sort((a, b) => (b.readyAt ?? 0) - (a.readyAt ?? 0))
    .slice(0, 6);
  const counts = useMemo(() => kitchenMadeCounts(day, todays, s), [day, todays, s]);

  // Chime when a new order arrives.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(queue.map((o) => o.id));
    if (seen.current && [...ids].some((id) => !seen.current!.has(id))) chime('new');
    seen.current = ids;
  }, [queue]);

  const setStatus = (o: Order, status: Order['status']) => {
    const t = Date.now();
    if (status === 'cooking') patchOrder(o.id, { status, cookingAt: t });
    else if (status === 'ready') patchOrder(o.id, { status, readyAt: t });
  };

  if (!started) {
    return (
      <div className="screen kitchen">
        <TopBar title="Kitchen" />
        <div className="center-screen">
          <button className="btn primary huge" onClick={() => { unlockSound(); setStarted(true); }}>
            Tap to start the kitchen screen
          </button>
          <p className="muted">This turns on the new-order sound and keeps the screen awake.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen kitchen">
      <TopBar title="Kitchen">
        <a className="btn small" href="#inventory">
          Inventory
        </a>
      </TopBar>
      {!day && <p className="banner warn">The cashier has not opened the day yet.</p>}
      <div className="kitchen-counts">
        {counts.map((c) => (
          <span key={c.name}>
            <b>{c.name}</b>: {c.made} made{c.waiting > 0 && <em> · {c.waiting} to do</em>}
          </span>
        ))}
      </div>
      <div className="kitchen-grid">
        {queue.length === 0 && <p className="empty">No orders waiting. 🎉</p>}
        {queue.map((o) => {
          const late = now - o.createdAt > s.kitchenLateMinutes * 60000;
          return (
            <article key={o.id} className={`kcard ${o.status} ${late ? 'late' : ''}`}>
              <header>
                <span className="knum-wrap">
                  <b className="knum">{o.number}</b>
                  {o.customerName && <span className="kname">{o.customerName}</span>}
                </span>
                <span className="kage">{minutesAgo(o.createdAt, now)}</span>
              </header>
              <ul className="klines">
                {o.lines.map((l) => (
                  <KitchenLine key={l.id} line={l} s={s} />
                ))}
              </ul>
              <footer>
                <button className={`btn big ${o.status === 'cooking' ? 'selected-cooking' : ''}`} disabled={o.status === 'cooking'} onClick={() => setStatus(o, 'cooking')}>
                  {o.status === 'cooking' ? 'Cooking…' : 'Cooking'}
                </button>
                <button className="btn big success" onClick={() => setStatus(o, 'ready')}>
                  Ready
                </button>
              </footer>
            </article>
          );
        })}
      </div>
      {recent.length > 0 && (
        <div className="kitchen-recent">
          <span>Just sent to the monitor:</span>
          {recent.map((o) => (
            <button key={o.id} className="btn small ghost" onClick={() => patchOrder(o.id, { status: 'cooking', readyAt: undefined })} title="Tapped Ready by mistake? Send it back.">
              {o.number} ↩ undo
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
