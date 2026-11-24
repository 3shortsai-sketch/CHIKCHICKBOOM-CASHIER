import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { allTicked, itemProgress, liveTicks, NO_SIDE } from '../domain/kitchen';
import { itemById } from '../domain/pricing';
import { byPickup, dueAt, pickupOf, slotRank, slotText } from '../domain/pickup';
import { kitchenMadeCounts } from '../domain/reports';
import type { ComboPart, Order, OrderLine, Settings } from '../domain/types';
import { modeOrders, openDay, patchOrder, tickItem, undoReady, untickItem, useStore } from '../data/store';
import { TopBar } from '../ui/TopBar';
import { chime, minutesAgo, unlockSound, useNow, useWakeLock } from '../ui/ui';

/** One choice on a kitchen card. `loud` ones are the easy-to-miss ones: shown bold on a highlight. */
type Bit = { text: string; loud?: boolean };

function partBits(p: ComboPart | OrderLine['choices']): Bit[] {
  if (!p) return [];
  const out: Bit[] = [];
  if (p.side === NO_SIDE) out.push({ text: 'NO SIDE', loud: true });
  else if (p.side) out.push({ text: `side: ${p.side}` });
  if (p.extraSides?.length) out.push({ text: `EXTRA ${p.extraSides.join(', ')}`, loud: true });
  if (p.extraSauce) out.push({ text: `+${p.extraSauce} SAUCE`, loud: true });
  if (p.extraRice) out.push({ text: `EXTRA RICE${p.extraRice > 1 ? ` ×${p.extraRice}` : ''}`, loud: true });
  if (p.dip) out.push({ text: `dip: ${p.dip}` });
  if (p.topping === 'fries') out.push({ text: 'FRIES ON TOP', loud: true });
  return out;
}

function Bits({ bits }: { bits: Bit[] }) {
  if (!bits.length) return null;
  return (
    <span className="k-detail">
      {bits.map((b, i) => (
        <span key={i} className={b.loud ? 'k-loud' : 'k-plain'}>
          {b.text}
        </span>
      ))}
    </span>
  );
}

/** One thing to make, as a big tick box: tap when it is done, tap again to untick. */
function TickRow({ done, onTick, label, children }: { done: boolean; onTick: () => void; label: string; children: ReactNode }) {
  return (
    <button type="button" className={`ktick ${done ? 'done' : ''}`} role="checkbox" aria-checked={done} aria-label={`${label}: ${done ? 'done' : 'not done yet'}`} onClick={onTick}>
      <span className="ktick-box" aria-hidden="true">
        {done ? '✓' : ''}
      </span>
      <span className="ktick-text">{children}</span>
    </button>
  );
}

function KitchenLine({ line, s, ticked, onTick }: { line: OrderLine; s: Settings; ticked: Set<string>; onTick: (key: string) => void }) {
  const name = (id: string) => itemById(s, id)?.name ?? id;
  if (line.combo) {
    return (
      <li className={line.addedAfterPay ? 'added' : ''}>
        <b className="k-combo">
          {line.qty}× {s.combos.find((c) => c.id === line.combo!.comboId)?.name}
        </b>
        {line.notes && <div className="k-note">📝 {line.notes}</div>}
        <ul>
          {line.combo.parts.map((p, i) => {
            const key = `${line.id}#${i}`;
            return (
              <li key={i}>
                <TickRow done={ticked.has(key)} onTick={() => onTick(key)} label={`${line.qty} ${name(p.itemId)}`}>
                  <b>
                    {line.qty > 1 ? `${line.qty}× ` : ''}
                    {name(p.itemId)}
                  </b>
                  <Bits bits={partBits(p)} />
                </TickRow>
              </li>
            );
          })}
        </ul>
      </li>
    );
  }
  return (
    <li className={line.addedAfterPay ? 'added' : ''}>
      <TickRow done={ticked.has(line.id)} onTick={() => onTick(line.id)} label={`${line.qty} ${name(line.itemId)}`}>
        <b>
          {line.qty}× {name(line.itemId)}
        </b>
        {line.free?.reason === 'prize' && <span className="k-tag">FREE – wheel</span>}
        {line.free?.reason === 'reward' && <span className="k-tag">REWARD</span>}
        <Bits bits={partBits(line.choices)} />
        {line.notes && <span className="k-note">📝 {line.notes}</span>}
      </TickRow>
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
  // The next break first: a lunch order is not made while recess orders are waiting.
  const queue = todays.filter((o) => o.status === 'new' || o.status === 'cooking').sort(byPickup);
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

  /**
   * Tick one item done (or untick it). The first tick starts Cooking; the
   * last one makes the whole order READY, so nobody has to tap twice.
   */
  const tick = (o: Order, key: string) => {
    const ticked = liveTicks(o);
    if (ticked.includes(key)) {
      untickItem(o.id, key);
      return;
    }
    const t = Date.now();
    if (allTicked({ lines: o.lines, done: [...ticked, key] })) tickItem(o.id, key, { status: 'ready', readyAt: t, ...(o.cookingAt ? {} : { cookingAt: t }) });
    else tickItem(o.id, key, o.status === 'new' ? { status: 'cooking', cookingAt: t } : undefined);
  };

  // Two tablets ticking the last two items at the same moment each see one
  // item still open. Whichever screen then sees every item ticked finishes it.
  const stuck = queue.filter((o) => allTicked(o)).map((o) => o.id).join(' ');
  useEffect(() => {
    if (!stuck || !started) return;
    const t = Date.now();
    for (const id of stuck.split(' ')) patchOrder(id, { status: 'ready', readyAt: t });
  }, [stuck, started]);

  /** "Ready" tapped by mistake. An order that became ready by its last tick gets its ticks back to tick again. */
  const sendBack = (o: Order) => undoReady(o.id, allTicked(o) ? liveTicks(o).at(-1) : undefined);

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
        {queue.map((o, i) => {
          const p = pickupOf(o);
          // A heading where a new break starts in the list.
          const heading =
            i === 0 || slotRank(queue[i - 1]) !== slotRank(o) ? (
              <h2 key={`h-${slotRank(o)}`} className="kslot-head">
                {p ? slotText(p.slot, s) : 'Now'}
                <span>{queue.filter((x) => slotRank(x) === slotRank(o)).length} order{queue.filter((x) => slotRank(x) === slotRank(o)).length === 1 ? '' : 's'}</span>
              </h2>
            ) : null;
          // An order placed ahead for a later break is late only once its break time has passed.
          const late = now - dueAt(o, s) > s.kitchenLateMinutes * 60000;
          const ticked = new Set(liveTicks(o));
          const prog = itemProgress(o);
          return [
            heading,
            <article key={o.id} className={`kcard ${o.status} ${late ? 'late' : ''} ${p?.deliverTo ? 'deliver' : ''}`}>
              <header>
                <span className="knum-wrap">
                  {o.customerName ? (
                    <>
                      <b className="kname">{o.customerName}</b>
                      <span className="knum">{o.number}</span>
                    </>
                  ) : (
                    <b className="kname">{o.number}</b>
                  )}
                </span>
                <span className="kage">{minutesAgo(o.createdAt, now)}</span>
              </header>
              {p && (
                <p className={`k-when ${p.deliverTo ? 'deliver' : ''}`}>
                  {p.deliverTo ? `🚚 ${p.deliverTo}` : '🕒 Pickup'} · {slotText(p.slot, s)}
                </p>
              )}
              {o.note && <p className="k-order-note">📝 {o.note}</p>}
              <ul className="klines">
                {o.lines.map((l) => (
                  <KitchenLine key={l.id} line={l} s={s} ticked={ticked} onTick={(key) => tick(o, key)} />
                ))}
              </ul>
              <footer>
                <span className={`kprog ${prog.done > 0 ? 'some' : ''}`} aria-label={`${prog.done} of ${prog.total} items ready`}>
                  <b>
                    {prog.done} of {prog.total}
                  </b>{' '}
                  ready
                </span>
                {o.status === 'new' && (
                  <button className="btn big" onClick={() => setStatus(o, 'cooking')}>
                    Cooking
                  </button>
                )}
                <button className="btn big success" onClick={() => setStatus(o, 'ready')}>
                  All ready
                </button>
              </footer>
            </article>,
          ];
        })}
      </div>
      {recent.length > 0 && (
        <div className="kitchen-recent">
          <span>Just sent to the monitor:</span>
          {recent.map((o) => (
            <button key={o.id} className="btn small ghost" onClick={() => sendBack(o)} title="Tapped Ready by mistake? Send it back.">
              {o.number}
              {o.customerName ? ` · ${o.customerName}` : ''} ↩ undo
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
