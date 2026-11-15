import { useEffect, useMemo, useRef, useState } from 'react';
import { peso } from '../domain/pricing';
import { isAvailable, stockLeft } from '../domain/reports';
import { modeOrders, openDay, useStore } from '../data/store';
import { chime, unlockSound, useNow, useWakeLock } from '../ui/ui';

const CATS = [
  { id: 'bowls', label: 'Rice Bowls' },
  { id: 'fries', label: 'Fries' },
  { id: 'drinks', label: 'Drinks' },
  { id: 'cookies', label: 'Cookies' },
] as const;

export function Serving() {
  const state = useStore((s) => s);
  const s = state.settings;
  const day = openDay(state);
  const now = useNow(5000);
  const [started, setStarted] = useState(false);
  useWakeLock(started);

  const orders = useMemo(() => modeOrders(state).filter((o) => o.dayId === day?.id && !o.voided), [state, day]);
  const left = useMemo(() => stockLeft(day, modeOrders(state), s), [day, state, s]);
  const clearMs = s.servingClearMinutes * 60000;
  const serving = orders
    .filter((o) => o.status === 'ready' && now - (o.readyAt ?? 0) < clearMs)
    .sort((a, b) => (b.readyAt ?? 0) - (a.readyAt ?? 0));
  const preparing = orders.filter((o) => o.status === 'new' || o.status === 'cooking').sort((a, b) => a.createdAt - b.createdAt);

  const seen = useRef<Set<string> | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    const ids = new Set(serving.map((o) => o.id));
    if (seen.current) {
      const fresh = serving.find((o) => !seen.current!.has(o.id));
      if (fresh) {
        chime('ready');
        setFlash(fresh.id);
        setTimeout(() => setFlash(null), 4000);
      }
    }
    seen.current = ids;
  }, [serving]);

  const start = () => {
    unlockSound();
    setStarted(true);
    void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  if (!started) {
    return (
      <div className="serving center-screen">
        <button className="btn primary huge" onClick={start}>
          Tap to start the customer screen
        </button>
        <p>Drag this window onto the monitor first. Tapping turns on the chime and goes full screen.</p>
      </div>
    );
  }

  const prizes = s.wheel.slots.filter((w) => w.prize !== 'tryAgain');
  return (
    <div className="serving">
      {s.mode === 'demo' && <div className="demo-banner">DEMO</div>}
      <div className="serving-top">
        <section className="now-serving">
          <div className="serving-brand">
            <img src="./logo.png" alt="Chick Chick Boom" />
            <h1>NOW SERVING</h1>
          </div>
          <div className="serving-numbers">
            {serving.length === 0 ? <span className="serving-empty">—</span> : serving.slice(0, 6).map((o, i) => (
              <span key={o.id} className={`snum ${i === 0 ? 'first' : ''} ${flash === o.id ? 'flash' : ''}`}>{o.number}</span>
            ))}
          </div>
        </section>
        <section className="preparing">
          <h2>Preparing</h2>
          <div className="prep-numbers">
            {preparing.slice(0, 15).map((o) => (
              <span key={o.id}>{o.number}</span>
            ))}
            {preparing.length > 15 && <span>+{preparing.length - 15}</span>}
          </div>
        </section>
      </div>
      <div className="serving-bottom">
        <section className="serving-menu">
          {CATS.map((c) => (
            <div key={c.id}>
              <h3>{c.label}</h3>
              <ul>
                {s.menu
                  .filter((m) => m.category === c.id && m.active)
                  .map((m) => (
                    <li key={m.id} className={isAvailable(m, day, left) ? '' : 'out'}>
                      <span>{m.name}</span>
                      <b>{isAvailable(m, day, left) ? peso(m.price) : 'SOLD OUT'}</b>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          <div>
            <h3>Combos</h3>
            <ul>
              {s.combos
                .filter((c) => c.active)
                .map((c) => (
                  <li key={c.id}>
                    <span>
                      {c.name}: {c.parts.map((p) => (p === 'fries' ? 'regular fries' : p)).join(' + ')}
                    </span>
                    <b>{peso(c.price)}</b>
                  </li>
                ))}
            </ul>
          </div>
        </section>
        <section className="serving-wheel">
          <h3>🎡 SPIN TO WIN</h3>
          {s.wheel.paused ? (
            <p>The wheel is taking a break today.</p>
          ) : (
            <>
              <p>Every rice bowl (not in a combo) gets 1 spin after paying!</p>
              <ul>
                {prizes.map((p) => (
                  <li key={p.prize}>{p.label}</li>
                ))}
              </ul>
              <p className="small">One prize per meal. Combos and voucher orders don't spin.</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
