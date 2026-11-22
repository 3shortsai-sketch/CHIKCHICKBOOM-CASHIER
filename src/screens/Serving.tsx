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

/** Preparing numbers shown (3 across, 5 rows). With more, the last cell says "+N more". */
const PREP_MAX = 15;

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

/** Leave the customer screen: exit full screen and go to the list of screens. */
function goHome() {
  // Wait for full screen to close first: changing page at the same moment can cancel it.
  const exit = document.fullscreenElement && document.exitFullscreen ? document.exitFullscreen().catch(() => {}) : Promise.resolve();
  void exit.finally(() => {
    location.hash = '';
  });
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

  // When THIS screen first saw each order ready. The kitchen tablet's clock can
  // be minutes off, so "stays up for N minutes" is counted on this screen's own clock.
  const firstReady = useRef(new Map<string, number>());
  const sawWaiting = useRef(new Set<string>());
  {
    const t = Date.now();
    const ready = new Set<string>();
    for (const o of orders) {
      if (o.status === 'ready') {
        ready.add(o.id);
        // Watched it turn ready: it starts now. Already ready when first seen
        // (screen just opened, or it was offline): trust the kitchen's time, but never a future one.
        if (!firstReady.current.has(o.id)) firstReady.current.set(o.id, sawWaiting.current.has(o.id) ? t : Math.min(o.readyAt ?? t, t));
      } else if (o.status === 'new' || o.status === 'cooking') sawWaiting.current.add(o.id);
    }
    // Sent back to cooking, claimed or voided: forget it, so a second "ready" counts again.
    for (const id of [...firstReady.current.keys()]) if (!ready.has(id)) firstReady.current.delete(id);
  }
  const readyAtHere = (id: string) => firstReady.current.get(id) ?? 0;
  const serving = orders
    .filter((o) => o.status === 'ready' && now - readyAtHere(o.id) < clearMs)
    .sort((a, b) => readyAtHere(b.id) - readyAtHere(a.id) || (b.readyAt ?? 0) - (a.readyAt ?? 0));
  const preparing = orders.filter((o) => o.status === 'new' || o.status === 'cooking').sort((a, b) => a.createdAt - b.createdAt);

  // Every timer this screen starts, so they can all be stopped when it closes.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  };
  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all) clearTimeout(t);
      all.clear();
    };
  }, []);

  // A new "ready" number: cluck, then say it out loud. Each number is called
  // once, and several at once wait their turn instead of talking over each other.
  const announced = useRef<Set<string> | null>(null);
  const waiting = useRef<{ id: string; text: string }[]>([]);
  const speaking = useRef(false);
  const [flash, setFlash] = useState<string | null>(null);
  const callNext = () => {
    if (speaking.current) return;
    let next = waiting.current.shift();
    // Skip a number that was sent back or voided while it waited.
    while (next && !announced.current?.has(next.id)) next = waiting.current.shift();
    if (!next) return;
    const { id, text } = next;
    speaking.current = true;
    setFlash(id);
    const secs = cluck();
    later(() => announce(text), secs * 1000 + 150);
    later(() => {
      speaking.current = false;
      setFlash((f) => (f === id ? null : f));
      callNext();
    }, 3500);
  };
  const readyIds = serving.map((o) => o.id).join(' ');
  useEffect(() => {
    const known = announced.current;
    const stillReady = new Set(orders.filter((o) => o.status === 'ready').map((o) => o.id));
    if (!known || !started) {
      // Numbers already up when the screen starts are not called out again.
      announced.current = new Set([...(known ?? []), ...stillReady]);
      return;
    }
    for (const id of [...known]) if (!stillReady.has(id)) known.delete(id);
    for (const o of [...serving].reverse()) {
      if (known.has(o.id)) continue;
      known.add(o.id);
      waiting.current.push({ id: o.id, text: `Order ${spokenNumber(o.number)}${o.customerName ? ` for ${o.customerName}` : ''} is ready!` });
    }
    callNext();
    // readyIds changes exactly when the list of ready numbers changes.
  }, [readyIds, started]);

  // A new FREE MEAL: big celebration banner for a few seconds.
  const seenWins = useRef<Set<string> | null>(null);
  const [celebrate, setCelebrate] = useState<Win | null>(null);
  useEffect(() => {
    const keys = new Set(wins.map((w) => `${w.orderId}:${w.at}`));
    if (seenWins.current) {
      const big = wins.find((w) => w.prize === 'freeMeal' && !seenWins.current!.has(`${w.orderId}:${w.at}`));
      if (big) {
        setCelebrate(big);
        later(() => setCelebrate((c) => (c === big ? null : c)), 7000);
      }
    }
    seenWins.current = keys;
  }, [wins]);

  // A home button for the team that customers don't see: it appears when the
  // mouse moves (or the screen is tapped) and hides again after 3 seconds.
  const [showHome, setShowHome] = useState(false);
  useEffect(() => {
    if (!started) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      setShowHome(true);
      clearTimeout(t);
      t = setTimeout(() => setShowHome(false), 3000);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'h' || e.key === 'H') goHome();
    };
    addEventListener('mousemove', wake);
    addEventListener('pointerdown', wake);
    addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      removeEventListener('mousemove', wake);
      removeEventListener('pointerdown', wake);
      removeEventListener('keydown', onKey);
    };
  }, [started]);

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
        <p className="small">To leave the customer screen later: move the mouse and click ⌂ in the top-left corner, or press H.</p>
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
        <a className="btn ghost serving-back" href="#">
          ← Back to screens
        </a>
      </div>
    );
  }

  const prizes = s.wheel.slots.filter((w) => w.prize !== 'tryAgain');
  return (
    <div className="serving">
      <button className={`serving-home ${showHome ? 'show' : ''}`} onClick={goHome} aria-label="Back to the list of screens (H)" title="Back to screens (H)">
        ⌂
      </button>
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
            {/* Hidden while the GCash QR is up, so nobody scans the wrong code to pay. */}
            {!(cart.stage === 'paying' && cart.method === 'gcash') && (
              <div className="serving-track">
                <img src="./track-qr.png" alt="QR code to track your order" />
                <span>Track your order on your phone</span>
              </div>
            )}
          </div>
          <div className={`serving-numbers n${Math.min(serving.length, 3)}`}>
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
            {(preparing.length > PREP_MAX ? preparing.slice(0, PREP_MAX - 1) : preparing).map((o) => (
              <span key={o.id}>{o.number}</span>
            ))}
            {preparing.length > PREP_MAX && <span>+{preparing.length - (PREP_MAX - 1)} more</span>}
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
                  <li key={c.id} className="menu-row combo-row">
                    {c.photo && <img className="menu-photo menu-photo-combo" src={`./${c.photo}`} alt="" loading="lazy" />}
                    <div className="menu-text">
                      <div className="menu-line">
                        <span className="menu-name">{c.name}</span>
                        <b>{peso(c.price)}</b>
                      </div>
                      <small className="menu-desc">{c.parts.map((p) => ({ bowl: 'bowl', fries: 'Fries with Dip', slushie: 'shake or juice', cookie: 'cookie' })[p]).join(' + ')}</small>
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
              <p>Every item gets 1 spin, and a combo gets 3. Spin at the pickup counter!</p>
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
              <p className="small">One prize per spin. Bottled water and add-ons don't spin.</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
