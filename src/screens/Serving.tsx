import { useEffect, useMemo, useRef, useState } from 'react';
import { allergenHint, allergenText, itemTags } from '../domain/allergens';
import { waitMinutes } from '../domain/inventory';
import { peso } from '../domain/pricing';
import { bestSellers, isAvailable, recentWins, stockLeft, type Win } from '../domain/reports';
import type { MenuItem, Settings } from '../domain/types';
import { PRIZE_LABEL } from '../domain/wheel';
import { useLiveCart, type LiveCart } from '../data/live';
import { modeOrders, openDay, useStore } from '../data/store';
import { announce, cluck, spokenNumber, unlockSound, useNow, useWakeLock } from '../ui/ui';

const CATS = [
  { id: 'bowls', label: 'Rice Bowls' },
  { id: 'fries', label: 'Fries' },
  { id: 'drinks', label: 'Drinks' },
  { id: 'cookies', label: 'Cookies' },
] as const;

const METHOD_LABEL = { cash: 'Cash', gcash: 'GCash', maya: 'Maya' } as const;

function formatPhone(n: string): string {
  const d = n.replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : n;
}

/** The order the cashier is ringing up, shown to the customer at the counter. */
function YourOrder({ cart, gcashNumber }: { cart: LiveCart; gcashNumber: string }) {
  if (cart.stage === 'idle') return null;
  if (cart.stage === 'paid') {
    return (
      <section className="your-order paid" aria-live="polite">
        <div className="paid-check">
          <span className="paid-tick" aria-hidden="true">
            ✓
          </span>
          <div>
            <b>Payment received</b>
            <span>
              {peso(cart.paid)} · {METHOD_LABEL[cart.method]}
            </span>
          </div>
        </div>
        <p>{cart.name ? `${cart.name}, your number` : 'Your number'}</p>
        <b className="your-number">{cart.number}</b>
        {cart.change > 0 && <p className="your-change">Change: {peso(cart.change)}</p>}
        {cart.spins > 0 && <p className="your-spin">🎡 Spin the wheel at the pickup counter! {cart.spins > 1 ? `(${cart.spins} spins)` : ''}</p>}
      </section>
    );
  }
  if (cart.stage === 'paying' && cart.method === 'gcash') {
    return (
      <section className="your-order qr" aria-live="polite">
        <div className="qr-head">
          <span className="gcash-badge">GCash</span>
          <span>Scan to pay</span>
        </div>
        <b className="qr-amount">{peso(cart.due)}</b>
        <img src="./gcash-qr.jpg" alt="GCash QR code" className="qr-img" />
        {gcashNumber && <p className="qr-number">or send to {formatPhone(gcashNumber)}</p>}
        <p className="qr-note">Show the cashier your receipt screen</p>
      </section>
    );
  }
  return (
    <section className="your-order" aria-live="polite">
      <h2>{cart.name ? `${cart.name}'s order` : 'Your order'}</h2>
      <ul>
        {cart.lines.map((l, i) => (
          <li key={i} className={l.free ? 'free' : ''}>
            <span className="yo-qty">{l.qty}×</span>
            <span className="yo-name">
              {l.name}
              {l.details && <small>{l.details}</small>}
            </span>
            <b>{l.free ? 'FREE' : peso(l.total)}</b>
          </li>
        ))}
      </ul>
      {cart.voucher ? (
        <div className="yo-row">
          <span>Voucher</span>
          <span>−{peso(cart.voucher)}</span>
        </div>
      ) : null}
      <div className="yo-total">
        <span>Total</span>
        <b>{peso(cart.due)}</b>
      </div>
      {cart.spins > 0 && <p className="your-spin">🎡 {cart.spins} spin{cart.spins > 1 ? 's' : ''} after paying!</p>}
    </section>
  );
}

function MenuRow({ m, available, best, left, lowAt }: { m: MenuItem; available: boolean; best: boolean; left: number; lowAt: number }) {
  const few = available && lowAt > 0 && left <= lowAt;
  return (
    <li className={`menu-row ${available ? '' : 'out'}`}>
      {m.photo && <img className="menu-photo" src={`./${m.photo}`} alt="" loading="lazy" />}
      <div className="menu-text">
        <div className="menu-line">
          <span className="menu-name">
            {m.name}
            {best && available && !few && <span className="best-badge">★ Best seller</span>}
            {few && <span className="few-badge">Only {left} left!</span>}
          </span>
          <b>{available ? peso(m.price) : 'SOLD OUT'}</b>
        </div>
        {m.description && <small className="menu-desc">{m.description}</small>}
        {allergenText(itemTags(m)) && <small className="menu-allergens">{allergenText(itemTags(m))}</small>}
      </div>
    </li>
  );
}

function ChoiceLine({ label, options, tags }: { label: string; options: string[]; tags: Settings['sideAllergens'] }) {
  return (
    <p className="menu-choices">
      <b>{label}:</b>{' '}
      {options.map((o, i) => {
        const h = allergenHint(tags[o]);
        return (
          <span key={o}>
            {i > 0 && ' · '}
            {o}
            {h && <span className="menu-choice-allergens"> ({h})</span>}
          </span>
        );
      })}
    </p>
  );
}

export function Serving() {
  const state = useStore((s) => s);
  const s = state.settings;
  const day = openDay(state);
  const now = useNow(5000);
  const cart = useLiveCart();
  const [started, setStarted] = useState(false);
  useWakeLock(started);

  const all = useMemo(() => modeOrders(state), [state]);
  const orders = useMemo(() => all.filter((o) => o.dayId === day?.id && !o.voided), [all, day]);
  const left = useMemo(() => stockLeft(day, all, s), [day, all, s]);
  const best = useMemo(() => new Set(bestSellers(day, all, s)), [day, all, s]);
  const wins = useMemo(() => recentWins(day, all, 4), [day, all]);
  const wait = waitMinutes(orders, now, s.defaultWaitMinutes);
  const clearMs = s.servingClearMinutes * 60000;
  const serving = orders
    .filter((o) => o.status === 'ready' && now - (o.readyAt ?? 0) < clearMs)
    .sort((a, b) => (b.readyAt ?? 0) - (a.readyAt ?? 0));
  const preparing = orders.filter((o) => o.status === 'new' || o.status === 'cooking').sort((a, b) => a.createdAt - b.createdAt);

  // A new "ready" number: cluck, then say it out loud.
  const seen = useRef<Set<string> | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    const ids = new Set(serving.map((o) => o.id));
    if (seen.current) {
      const fresh = serving.filter((o) => !seen.current!.has(o.id));
      fresh.forEach((o, i) => {
        setTimeout(() => {
          const secs = cluck();
          setTimeout(() => announce(`Order ${spokenNumber(o.number)}${o.customerName ? ` for ${o.customerName}` : ''} is ready!`), secs * 1000 + 150);
        }, i * 3500);
      });
      if (fresh[0]) {
        setFlash(fresh[0].id);
        setTimeout(() => setFlash(null), 4000);
      }
    }
    seen.current = ids;
  }, [serving]);

  // A new FREE MEAL: big celebration banner for a few seconds.
  const seenWins = useRef<Set<string> | null>(null);
  const [celebrate, setCelebrate] = useState<Win | null>(null);
  useEffect(() => {
    const keys = new Set(wins.map((w) => `${w.orderId}:${w.at}`));
    if (seenWins.current) {
      const big = wins.find((w) => w.prize === 'freeMeal' && !seenWins.current!.has(`${w.orderId}:${w.at}`));
      if (big) {
        setCelebrate(big);
        setTimeout(() => setCelebrate(null), 7000);
      }
    }
    seenWins.current = keys;
  }, [wins]);

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
        <p>Drag this window onto the monitor first. Tapping turns on the sound and goes full screen.</p>
        <button
          className="btn"
          onClick={() => {
            unlockSound();
            const secs = cluck();
            setTimeout(() => announce('Order A, 1, is ready!'), secs * 1000 + 150);
          }}
        >
          🔊 Test the sound
        </button>
      </div>
    );
  }

  const prizes = s.wheel.slots.filter((w) => w.prize !== 'tryAgain');
  return (
    <div className="serving">
      {s.mode === 'demo' && <div className="demo-banner">DEMO</div>}
      {celebrate && (
        <div className="win-banner" role="status">
          <div className="burst" aria-hidden="true" />
          <div className="win-text">
            <b>{celebrate.number}</b>
            <span>won a FREE MEAL! 🎉</span>
          </div>
        </div>
      )}
      <div className="serving-top">
        <section className="now-serving">
          <div className="serving-brand">
            <img src="./logo.png" alt="Chick Chick Boom" />
            <h1>NOW SERVING</h1>
          </div>
          <div className="serving-numbers">
            {serving.length === 0 ? (
              <span className="serving-empty">Your number will show here</span>
            ) : (
              serving.slice(0, 6).map((o, i) => (
                <span key={o.id} className={`snum ${i === 0 ? 'first' : ''} ${flash === o.id ? 'flash' : ''}`}>
                  {o.number}
                  {o.customerName && <small className="snum-name">{o.customerName}</small>}
                </span>
              ))
            )}
          </div>
        </section>
        <section className={`preparing ${cart.stage !== 'idle' ? 'with-order' : ''} ${cart.stage === 'paying' && cart.method === 'gcash' ? 'with-qr' : ''}`}>
          <YourOrder cart={cart} gcashNumber={s.payments.gcashNumber} />
          <div className="prep-head">
            <h2>Preparing</h2>
            {day && <span className="wait-chip">Wait ≈ {wait} min</span>}
          </div>
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
            <div key={c.id} className={`menu-col menu-col-${c.id}`}>
              <h3>{c.label}</h3>
              <ul>
                {s.menu
                  .filter((m) => m.category === c.id && m.active)
                  .map((m) => (
                    <MenuRow key={m.id} m={m} available={isAvailable(m, day, left)} best={best.has(m.id)} left={left[m.id] ?? 0} lowAt={s.lowStockAlert} />
                  ))}
              </ul>
              {c.id === 'bowls' && <ChoiceLine label="Free side" options={s.sides} tags={s.sideAllergens} />}
              {c.id === 'fries' && <ChoiceLine label="Free dip (Regular Fries)" options={s.dips} tags={s.dipAllergens} />}
            </div>
          ))}
          <div className="menu-col">
            <h3>Combos</h3>
            <ul>
              {s.combos
                .filter((c) => c.active)
                .map((c) => (
                  <li key={c.id} className="menu-row">
                    <div className="menu-text">
                      <div className="menu-line">
                        <span className="menu-name">{c.name}</span>
                        <b>{peso(c.price)}</b>
                      </div>
                      <small className="menu-desc">{c.parts.map((p) => (p === 'fries' ? 'regular fries' : p)).join(' + ')}</small>
                    </div>
                  </li>
                ))}
            </ul>
            <p className="menu-allergy-note">Food allergy? Please ask our cashier. Brand ingredients can vary.</p>
          </div>
        </section>
        <section className="serving-wheel">
          <h3>🎡 SPIN TO WIN</h3>
          {s.wheel.paused ? (
            <p>The wheel is taking a break today.</p>
          ) : (
            <>
              <p>Every rice bowl (not in a combo) gets 1 spin. Spin at the pickup counter!</p>
              {wins.length > 0 ? (
                <div className="winners">
                  <span className="winners-label">Recent winners</span>
                  <ul>
                    {wins.map((w) => (
                      <li key={`${w.orderId}:${w.at}`} className={w.prize === 'freeMeal' ? 'big' : ''}>
                        <b>{w.number}</b> {PRIZE_LABEL[w.prize]}
                        {w.prize === 'freeMeal' ? ' 🎉' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <ul className="prize-list">
                  {prizes.map((p) => (
                    <li key={p.prize}>{p.label}</li>
                  ))}
                </ul>
              )}
              <p className="small">One prize per meal. Combos and voucher orders don't spin.</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
