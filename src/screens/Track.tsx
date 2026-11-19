import { useEffect, useRef, useState } from 'react';
import { doc, getDoc, onSnapshot, type Firestore } from 'firebase/firestore';
import { localDate } from '../domain/loyalty';
import type { DataMode } from '../domain/types';
import { publicDb, startPublic, trackerId, type BoothDoc, type TrackerDoc } from '../data/sync';
import { cluck, unlockSound, useNow, useOnline, useWakeLock } from '../ui/ui';

/**
 * The customer's own page, opened from the QR code on the monitor: no login,
 * no booth data. It only reads the public copies the booth writes
 * (tracker/{id} for one order, public/booth-{mode} for the queue).
 */

const STORE_KEY = 'ccb:track';
const MAX_TRACKED = 8;
const BOOTH_EVERY_MS = 60000;
const PAGE_TITLE = 'Track your order · Chick Chick Boom';

/** "a12", "A-12", "A012", "a-012" → "A-012". Null when it does not look like an order number. */
export function normalizeNumber(text: string): string | null {
  const m = /^\s*([a-z])\s*-?\s*(\d{1,4})\s*$/i.exec(text);
  if (!m || Number(m[2]) === 0) return null;
  return `${m[1].toUpperCase()}-${String(Number(m[2])).padStart(3, '0')}`;
}

// ---------- Saved numbers (only for today) ----------

type Saved = { date: string; numbers: Partial<Record<DataMode, string[]>> };

function loadNumbers(mode: DataMode, today: string): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Saved | null;
    // Yesterday's numbers mean nothing today: drop them.
    if (!saved || saved.date !== today) return [];
    return (saved.numbers[mode] ?? []).filter((n) => normalizeNumber(n) === n).slice(0, MAX_TRACKED);
  } catch {
    return [];
  }
}

function saveNumbers(mode: DataMode, today: string, numbers: string[]) {
  try {
    const old = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Saved | null;
    const keep = old && old.date === today ? old.numbers : {};
    localStorage.setItem(STORE_KEY, JSON.stringify({ date: today, numbers: { ...keep, [mode]: numbers } } satisfies Saved));
  } catch {
    /* private mode: the list just won't survive a reload */
  }
}

// ---------- Small helpers ----------

/** missing: the server said this number does not exist (yet). */
type Info = { doc: TrackerDoc | null; fromCache: boolean; denied: boolean; missing: boolean };

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** How many orders the kitchen makes before this one, or null when we can't tell. */
function ordersAhead(t: TrackerDoc, booth: BoothDoc | null): number | null {
  if (!booth) return null;
  const i = booth.queue.indexOf(t.number);
  if (i >= 0) return i;
  // The queue list is older than this order: everyone in it is ahead.
  if (booth.updatedAt < t.createdAt) return booth.queue.length;
  return null;
}

function minutesLeft(t: TrackerDoc, booth: BoothDoc | null, now: number): number | null {
  if (!booth) return null;
  const waited = (now - t.createdAt) / 60000;
  return Math.max(1, Math.round(booth.waitMinutes - waited));
}

// ---------- One tracked order ----------

function OrderCard({ number, info, booth, now, onRemove }: { number: string; info: Info | undefined; booth: BoothDoc | null; now: number; onRemove: () => void }) {
  const t = info?.doc ?? null;
  const status = t?.status;
  const kind = !t ? 'missing' : status === 'new' || status === 'cooking' ? 'preparing' : status;
  const ahead = t ? ordersAhead(t, booth) : null;
  const mins = t ? minutesLeft(t, booth, now) : null;
  const spins = t && t.status !== 'voided' ? t.spinsLeft : 0;
  return (
    <section className={`trk-card trk-${kind}`} aria-live="polite">
      <div className="trk-card-head">
        <b className="trk-number">{number}</b>
        <button className="trk-remove" onClick={onRemove} aria-label={`Stop tracking ${number}`}>
          ✕
        </button>
      </div>
      {info?.denied ? (
        <p className="trk-msg">Order tracking is not switched on yet. Please ask at the counter.</p>
      ) : !t ? (
        !info?.missing ? (
          <p className="trk-msg">Looking for your order…</p>
        ) : (
          <p className="trk-msg">We can't see this number yet. Check it, or keep this page open: it appears within a minute of paying.</p>
        )
      ) : kind === 'preparing' ? (
        <>
          <p className="trk-state">Preparing</p>
          {ahead !== null && <p className="trk-line">{ahead === 0 ? "You're next!" : `${plural(ahead, 'order', 'orders')} ahead of you`}</p>}
          {mins !== null && <p className="trk-line">About {plural(mins, 'minute', 'minutes')}</p>}
        </>
      ) : kind === 'ready' ? (
        <>
          <p className="trk-state trk-big">READY</p>
          <p className="trk-line">Pick it up at the counter</p>
        </>
      ) : kind === 'claimed' ? (
        <>
          <p className="trk-state">Picked up</p>
          <p className="trk-line">Enjoy!</p>
        </>
      ) : (
        <>
          <p className="trk-state">Please ask at the counter</p>
          <p className="trk-line">Something changed with this order.</p>
        </>
      )}
      {spins > 0 && <p className="trk-spin">🎡 You have {plural(spins, 'spin', 'spins')} waiting at the wheel.</p>}
    </section>
  );
}

// ---------- Booth info (queue, ready numbers, sold out) ----------

function BoothInfo({ booth, today, alsoReady }: { booth: BoothDoc | null; today: string; alsoReady: string[] }) {
  if (!booth) return null;
  // The booth summary can be a minute old: add the customer's own ready numbers we just heard about.
  const ready = [...new Set([...alsoReady, ...booth.ready])];
  if (!booth.open || booth.date !== today) {
    return (
      <section className="trk-booth">
        <p>The booth is closed now. See you later!</p>
      </section>
    );
  }
  return (
    <section className="trk-booth">
      <h2>At the booth</h2>
      <p>
        <b>Now ready:</b> {ready.length
          ? ready.map((n, i) => (
              <span key={n}>
                {i > 0 && ', '}
                <span className="trk-nowrap">{n}</span>
              </span>
            ))
          : 'none right now'}
      </p>
      {booth.soldOut.length > 0 && (
        <p>
          <b>Sold out:</b> {booth.soldOut.join(', ')}
        </p>
      )}
    </section>
  );
}

// ---------- The page ----------

export function Track({ mode }: { mode: DataMode }) {
  const [today] = useState(() => localDate());
  const [numbers, setNumbers] = useState(() => loadNumbers(mode, today));
  const [infos, setInfos] = useState<Record<string, Info>>({});
  const [db, setDb] = useState<Firestore | null | undefined>(undefined);
  const [booth, setBooth] = useState<BoothDoc | null>(null);
  const [lastServer, setLastServer] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [soundOn, setSoundOn] = useState(false);
  const [flashing, setFlashing] = useState<string[]>([]);
  const online = useOnline();
  const now = useNow(15000);
  const soundRef = useRef(false);
  const lastStatus = useRef(new Map<string, string>());

  // Firebase is started by main.tsx; this only reuses it (or starts the public part).
  useEffect(() => setDb(publicDb() ?? startPublic()), []);

  useEffect(() => saveNumbers(mode, today, numbers), [mode, today, numbers]);

  useEffect(() => {
    const before = document.title;
    document.title = PAGE_TITLE;
    return () => {
      document.title = before;
    };
  }, []);

  // A tracked order just turned ready while this page is open: buzz, cluck and flash the tab.
  const alertReady = (n: string) => {
    navigator.vibrate?.([400, 200, 400, 200, 600]);
    if (soundRef.current) cluck();
    setFlashing((f) => (f.includes(n) ? f : [...f, n]));
  };
  const alertRef = useRef(alertReady);
  alertRef.current = alertReady;

  // One live listener per tracked order, added and removed with the list.
  const subs = useRef(new Map<string, () => void>());
  useEffect(() => {
    if (!db) return;
    for (const n of numbers) {
      if (subs.current.has(n)) continue;
      const stop = onSnapshot(
        doc(db, 'tracker', trackerId(mode, today, n)),
        { includeMetadataChanges: true },
        (snap) => {
          const t = snap.exists() ? (snap.data() as TrackerDoc) : null;
          const was = lastStatus.current.get(n);
          if (t) {
            if (was && was !== 'ready' && t.status === 'ready') alertRef.current(n);
            lastStatus.current.set(n, t.status);
          } else if (!snap.metadata.fromCache) lastStatus.current.set(n, 'missing');
          if (!snap.metadata.fromCache) setLastServer(Date.now());
          // Offline, the saved copy can't tell "not found" from "not loaded": keep what the server last said.
          const missing = !t && lastStatus.current.get(n) === 'missing';
          setInfos((all) => ({ ...all, [n]: { doc: t, fromCache: snap.metadata.fromCache, denied: false, missing } }));
        },
        (e) => setInfos((all) => ({ ...all, [n]: { doc: all[n]?.doc ?? null, fromCache: true, denied: e.code === 'permission-denied', missing: false } })),
      );
      subs.current.set(n, stop);
    }
    for (const [n, stop] of subs.current) {
      if (numbers.includes(n)) continue;
      stop();
      subs.current.delete(n);
      lastStatus.current.delete(n);
    }
  }, [db, numbers, mode, today]);
  useEffect(() => {
    const all = subs.current;
    return () => {
      for (const stop of all.values()) stop();
      all.clear();
    };
  }, []);

  // Booth summary: read once now, then every minute only while the page is on screen.
  useEffect(() => {
    if (!db) return;
    let last = 0;
    const read = () => {
      last = Date.now();
      getDoc(doc(db, 'public', `booth-${mode}`))
        .then((s) => setBooth(s.exists() ? (s.data() as BoothDoc) : null))
        .catch(() => {
          /* offline or not switched on: keep what we have */
        });
    };
    read();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') read();
    }, BOOTH_EVERY_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible' && Date.now() - last >= BOOTH_EVERY_MS) read();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [db, mode]);

  // Flash the tab title until the customer touches the page (or the order is no longer ready).
  const stillReady = flashing.filter((n) => infos[n]?.doc?.status === 'ready');
  const flashKey = stillReady.join(', ');
  useEffect(() => {
    if (!flashKey) return;
    let on = true;
    document.title = `READY: ${flashKey}`;
    const timer = setInterval(() => {
      on = !on;
      document.title = on ? `READY: ${flashKey}` : PAGE_TITLE;
    }, 1000);
    const stop = () => {
      if (document.visibilityState === 'visible') setFlashing([]);
    };
    addEventListener('pointerdown', stop);
    addEventListener('keydown', stop);
    return () => {
      clearInterval(timer);
      removeEventListener('pointerdown', stop);
      removeEventListener('keydown', stop);
      document.title = PAGE_TITLE;
    };
  }, [flashKey]);

  // Keep the phone screen on while any order is still to be picked up.
  const waiting = numbers.some((n) => {
    const s = infos[n]?.doc?.status;
    return s !== 'claimed' && s !== 'voided';
  });
  useWakeLock(waiting);

  const add = () => {
    const n = normalizeNumber(text);
    if (!n) return setError('Type the number on your receipt, like A-012.');
    if (!numbers.includes(n)) {
      if (numbers.length >= MAX_TRACKED) return setError(`You can follow up to ${MAX_TRACKED} orders.`);
      setNumbers([...numbers, n]);
    }
    setText('');
    setError('');
  };

  const remove = (n: string) => {
    setNumbers(numbers.filter((x) => x !== n));
    setFlashing((f) => f.filter((x) => x !== n));
    setInfos((all) => {
      const next = { ...all };
      delete next[n];
      return next;
    });
  };

  const turnOnSound = () => {
    unlockSound();
    soundRef.current = true;
    setSoundOn(true);
    cluck();
  };

  // Offline: the phone says so, or every listener that once reached the server is back on the saved copy.
  const offline = !online || (lastServer !== null && numbers.length > 0 && numbers.every((n) => infos[n]?.fromCache && !infos[n]?.denied));

  return (
    <div className="trk">
      {mode === 'demo' && <div className="trk-demo">PRACTICE · not real orders</div>}
      <header className="trk-head">
        <img src="./logo.png" alt="Chick Chick Boom" width={64} height={64} />
        <h1>Track your order</h1>
      </header>

      {db === null ? (
        <p className="trk-msg trk-panel">Order tracking is not available on this link. Please watch the screen at the booth.</p>
      ) : (
        <>
          <form
            className="trk-form trk-panel"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <label htmlFor="trk-input">Your order number</label>
            <div className="trk-form-row">
              <input
                id="trk-input"
                className="input trk-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="A-012"
                autoCapitalize="characters"
                autoComplete="off"
                inputMode="text"
                enterKeyHint="go"
              />
              <button className="btn primary big" type="submit">
                Track
              </button>
            </div>
            {error && <p className="error">{error}</p>}
            {numbers.length === 0 && <p className="muted small">It's on your receipt. Ordering for a group? Add each number.</p>}
          </form>

          {offline && numbers.length > 0 && (
            <p className="trk-offline" role="status">
              No internet: {lastServer ? `showing the last update from ${clock(lastServer)}` : 'waiting for the first update'}
            </p>
          )}

          {waiting && !soundOn && (
            <button className="btn big full trk-sound" onClick={turnOnSound}>
              🔊 Tap to turn on the sound
            </button>
          )}

          {numbers.map((n) => (
            <OrderCard key={n} number={n} info={infos[n]} booth={booth} now={now} onRemove={() => remove(n)} />
          ))}

          {numbers.length > 0 && <p className="muted small trk-note">Keep this page open. Your phone buzzes when your order is ready.</p>}

          <BoothInfo booth={booth} today={today} alsoReady={numbers.filter((n) => infos[n]?.doc?.status === 'ready')} />
        </>
      )}
    </div>
  );
}
