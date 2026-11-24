import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc, onSnapshot, type Firestore } from 'firebase/firestore';
import { defaultSettings } from '../domain/defaults';
import { localDate, normalizeVoucher, parseCard } from '../domain/loyalty';
import { peso } from '../domain/pricing';
import type { DataMode, Settings } from '../domain/types';
import { getState } from '../data/store';
import { publicCardId, publicDb, publicMenu, publicVoucherId, startPublic, trackerId, type BoothDoc, type BoothMenuItem, type PublicCard, type PublicVoucher, type TrackerDoc } from '../data/sync';
import { cluck, unlockSound, useNow, useOnline, useWakeLock } from '../ui/ui';

/**
 * The customer's own page, opened from the QR code on the monitor: no login,
 * no booth data. It only reads the public copies the booth writes
 * (tracker/{id} for one order, public/booth-{mode} for the queue).
 */

const STORE_KEY = 'ccb:track';
const MAX_TRACKED = 8;
/** How often the queue ("2 orders ahead of you") is read: while an order is being made, and otherwise. */
const BOOTH_WAITING_MS = 20000;
const BOOTH_IDLE_MS = 60000;
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

const PICKUP_STEPS = ['Received', 'Cooking', 'READY', 'Picked up'] as const;
const DELIVERY_STEPS = ['Received', 'Cooking', 'READY', 'Delivered'] as const;
const STEP_OF: Record<string, number> = { new: 0, cooking: 1, ready: 2, claimed: 3 };

/** Received → Cooking → READY → Picked up, with the step the order is on marked. */
function Steps({ status, delivery }: { status: string; delivery?: boolean }) {
  const STEPS = delivery ? DELIVERY_STEPS : PICKUP_STEPS;
  const at = STEP_OF[status] ?? 0;
  return (
    <ol className="trk-steps" aria-label={`Step ${at + 1} of ${STEPS.length}: ${STEPS[at]}`}>
      {STEPS.map((label, i) => (
        <li key={label} className={i < at || at === STEPS.length - 1 ? 'done' : i === at ? 'now' : ''} aria-current={i === at ? 'step' : undefined}>
          <span className="trk-step-dot" aria-hidden="true">
            {i < at || at === STEPS.length - 1 ? '✓' : i + 1}
          </span>
          <span className="trk-step-label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

/** "Ana, 4 of 6 items ready" (or without the name). Null when this copy has no item counts. */
function progressText(t: TrackerDoc): string | null {
  if (typeof t.done !== 'number' || typeof t.total !== 'number' || t.total <= 0) return null;
  const text = `${t.done} of ${plural(t.total, 'item', 'items')} ready`;
  return t.name ? `${t.name}, ${text}` : text;
}

function OrderCard({ number, info, practice, booth, now, onRemove }: { number: string; info: Info | undefined; practice: boolean; booth: BoothDoc | null; now: number; onRemove: () => void }) {
  const t = info?.doc ?? null;
  const status = t?.status;
  const kind = !t ? 'missing' : status === 'new' || status === 'cooking' ? 'preparing' : status;
  const ahead = t ? ordersAhead(t, booth) : null;
  const mins = t ? minutesLeft(t, booth, now) : null;
  const spins = t && t.status !== 'voided' ? t.spinsLeft : 0;
  const progress = t ? progressText(t) : null;
  // Ordered ahead for a later break: "2 orders ahead, about 1 minute" would be wrong for hours.
  const early = !!t && typeof t.dueAt === 'number' && now < t.dueAt;
  return (
    <section className={`trk-card trk-${kind}`} aria-live="polite">
      <div className="trk-card-head">
        <span className="trk-who">
          <b className="trk-number">{number}</b>
          {t?.name && <span className="trk-name">{t.name}</span>}
          {practice && <span className="trk-practice">practice</span>}
        </span>
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
      ) : kind === 'voided' ? (
        <>
          <p className="trk-state">Please ask at the counter</p>
          <p className="trk-line">Something changed with this order.</p>
        </>
      ) : (
        <>
          <Steps status={t.status} delivery={t.delivery} />
          {t.when && <p className="trk-when">{t.delivery ? `🚚 We bring it to you at ${t.when}` : `🕒 Pickup at ${t.when}`}</p>}
          {kind === 'preparing' ? (
            <>
              <p className="trk-state">{t.status === 'cooking' ? 'Cooking' : 'Received'}</p>
              {progress && <p className="trk-line trk-progress">{progress}</p>}
              {ahead !== null && !early && <p className="trk-line">{ahead === 0 ? "You're next!" : `${plural(ahead, 'order', 'orders')} ahead of you`}</p>}
              {mins !== null && !early && <p className="trk-line">About {plural(mins, 'minute', 'minutes')}</p>}
            </>
          ) : kind === 'ready' ? (
            <>
              <p className="trk-state trk-big">READY</p>
              <p className="trk-line">{t.delivery ? 'On its way to you' : t.name ? `${t.name}, pick it up at the counter` : 'Pick it up at the counter'}</p>
            </>
          ) : (
            <>
              <p className="trk-state">{t.delivery ? 'Delivered' : 'Picked up'}</p>
              <p className="trk-line">Enjoy{t.name ? `, ${t.name}` : ''}!</p>
            </>
          )}
        </>
      )}
      {spins > 0 && <p className="trk-spin">🎡 You have {plural(spins, 'spin', 'spins')} waiting at the wheel.</p>}
    </section>
  );
}

// ---------- Booth info (queue, ready numbers, sold out) ----------

function BoothInfo({ booth, alsoReady, active }: { booth: BoothDoc | null; alsoReady: string[]; active: boolean }) {
  if (!booth) return null;
  // The summary can be a few seconds behind: never say "closed" to someone whose order is being made.
  if (!booth.open && active) return null;
  // The booth summary can be a little old: add the customer's own ready numbers we just heard about.
  const ready = [...new Set([...alsoReady, ...booth.ready])];
  // A day left open overnight is still an open booth: only "no day open" means closed.
  if (!booth.open) {
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

// ---------- Menu, Boom Card and voucher ----------

/** "2026-11-24" as "Tue, Nov 24". */
function niceDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

/** A section that stays closed until tapped. Its contents (and photos) load only when it is opened. */
function Fold({ title, children }: { title: string; children: () => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="trk-fold" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>{title}</summary>
      {open && <div className="trk-fold-body">{children()}</div>}
    </details>
  );
}

const MENU_GROUPS = [
  { cat: 'bowls', label: 'Rice bowls' },
  { cat: 'fries', label: 'Fries' },
  { cat: 'drinks', label: 'Drinks' },
  { cat: 'cookies', label: 'Cookies' },
  { cat: 'combos', label: 'Combos' },
];

/** Small versions of the food photos, so the menu costs little mobile data. */
function thumb(photo: string): string {
  return `./${photo.replace(/^menu\//, 'menu/thumb/')}`;
}

function MenuList({ items, live }: { items: BoothMenuItem[]; live: boolean }) {
  return (
    <>
      {MENU_GROUPS.map((g) => {
        const rows = items.filter((m) => m.cat === g.cat);
        if (!rows.length) return null;
        return (
          <div key={g.cat} className="trk-menu-group">
            <h3>{g.label}</h3>
            <ul className="trk-menu">
              {rows.map((m) => (
                <li key={m.name} className={m.out ? 'out' : ''}>
                  {m.photo ? <img src={thumb(m.photo)} alt="" width={64} height={64} loading="lazy" decoding="async" /> : <span className="trk-menu-nophoto" aria-hidden="true" />}
                  <span className="trk-menu-text">
                    <b>{m.name}</b>
                    {m.desc && <small>{m.desc}</small>}
                  </span>
                  <b className="trk-menu-price">{m.out ? 'SOLD OUT' : peso(m.price)}</b>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <p className="muted small">{live ? 'Prices and sold-out items are from the booth right now.' : "Today's sold-out items show here once the booth is open."} Food allergy? Please ask our cashier.</p>
    </>
  );
}

type Found<T> = { state: 'idle' } | { state: 'loading' } | { state: 'error' } | { state: 'missing'; asked: string } | { state: 'ok'; doc: T; practice: boolean };

/** Read one public document, trying the real data first and practice data second. */
async function readPublic<T>(db: Firestore, ids: { id: string; practice: boolean }[]): Promise<{ doc: T; practice: boolean } | null> {
  for (const { id, practice } of ids) {
    const snap = await getDoc(doc(db, 'tracker', id));
    if (snap.exists()) return { doc: snap.data() as T, practice };
  }
  return null;
}

const CARD_KEY = 'ccb:track-card';

function CardCheck({ db, modes, card }: { db: Firestore; modes: DataMode[]; card: BoothDoc['card'] }) {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(CARD_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [found, setFound] = useState<Found<PublicCard>>({ state: 'idle' });
  const [error, setError] = useState('');
  // How card numbers look comes from the booth; before it is known, the usual CCB-001 style.
  const loyalty = { ...defaultSettings().loyalty, ...card };

  const check = async () => {
    const number = parseCard(text, { loyalty } as Settings);
    if (!number) return setError(`Type the number on your Boom Card, like ${loyalty.prefix}${String(loyalty.first).padStart(3, '0')} or just ${loyalty.first}.`);
    setError('');
    setText(number);
    setFound({ state: 'loading' });
    try {
      localStorage.setItem(CARD_KEY, number);
    } catch {
      /* private mode: the number is just not remembered */
    }
    try {
      const hit = await readPublic<PublicCard>(db, modes.map((m) => ({ id: publicCardId(m, number), practice: m === 'demo' })));
      setFound(hit ? { state: 'ok', ...hit } : { state: 'missing', asked: number });
    } catch {
      setFound({ state: 'error' });
    }
  };

  const c = found.state === 'ok' ? found.doc : null;
  return (
    <form
      className="trk-check"
      onSubmit={(e) => {
        e.preventDefault();
        void check();
      }}
    >
      <label htmlFor="trk-card">Your Boom Card number</label>
      <div className="trk-form-row">
        <input id="trk-card" className="input trk-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={`${loyalty.prefix}037`} autoComplete="off" autoCapitalize="characters" enterKeyHint="go" />
        <button className="btn primary big" type="submit" disabled={found.state === 'loading'}>
          Check
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <div aria-live="polite">
        {found.state === 'loading' && <p className="trk-msg">Looking up your card…</p>}
        {found.state === 'error' && <p className="trk-msg">Could not check right now. Check your internet and try again.</p>}
        {found.state === 'missing' && <p className="trk-msg">No stamps on {found.asked} yet. Stamps show here after the card's next order. Not right? Ask at the counter.</p>}
        {c && found.state === 'ok' && (
          <div className="trk-result">
            <p className="trk-result-head">
              <b>{c.number}</b>
              {found.practice && <span className="trk-practice">practice</span>}
            </p>
            <p className="trk-stamps">
              <b>{c.stamps}</b> of {c.size} stamps
            </p>
            <div className="trk-dots" aria-hidden="true">
              {Array.from({ length: c.size }, (_, i) => (
                <span key={i} className={i < c.stamps ? 'on' : ''} />
              ))}
            </div>
            {c.ready.length > 0 && <p className="trk-good">🎁 Reward ready: {c.ready.join(', ')}. Show your card to the cashier.</p>}
            {c.next ? (
              <p className="trk-line">
                {plural(c.next.more, 'more stamp', 'more stamps')} to {c.next.label}.
              </p>
            ) : (
              c.ready.length === 0 && <p className="trk-line">All rewards on this card are used. Ask the cashier for a new card.</p>
            )}
          </div>
        )}
      </div>
    </form>
  );
}

function VoucherCheck({ db, modes, today }: { db: Firestore; modes: DataMode[]; today: string }) {
  const [text, setText] = useState('');
  const [found, setFound] = useState<Found<PublicVoucher>>({ state: 'idle' });
  const [error, setError] = useState('');

  const check = async () => {
    const code = normalizeVoucher(text);
    // "V-" and four letters or digits.
    if (!/^V-[A-Z0-9]{4}$/.test(code)) return setError('Type the code on your voucher slip, like V-AB3D.');
    setError('');
    setText(code);
    setFound({ state: 'loading' });
    try {
      const hit = await readPublic<PublicVoucher>(db, modes.map((m) => ({ id: publicVoucherId(m, code), practice: m === 'demo' })));
      setFound(hit ? { state: 'ok', ...hit } : { state: 'missing', asked: code });
    } catch {
      setFound({ state: 'error' });
    }
  };

  const v = found.state === 'ok' ? found.doc : null;
  const days = v ? (v.validTo > v.validFrom ? `${niceDate(v.validFrom)} to ${niceDate(v.validTo)}` : niceDate(v.validFrom)) : '';
  const verdict = !v
    ? null
    : !v.valid
      ? { good: false, text: 'This voucher was cancelled. Please ask at the counter.' }
      : v.used
        ? { good: false, text: 'Already used.' }
        : today > v.validTo
          ? { good: false, text: `Expired. It was valid ${days}.` }
          : today < v.validFrom
            ? { good: true, text: `Not used yet. You can use it ${v.validTo > v.validFrom ? `from ${days}` : `on ${days}`}.` }
            : { good: true, text: v.validTo > today ? `Not used yet. Use it today, or until ${niceDate(v.validTo)}.` : 'Not used yet. Use it today!' };
  return (
    <form
      className="trk-check"
      onSubmit={(e) => {
        e.preventDefault();
        void check();
      }}
    >
      <label htmlFor="trk-voucher">Your voucher code</label>
      <div className="trk-form-row">
        <input id="trk-voucher" className="input trk-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="V-AB3D" autoComplete="off" autoCapitalize="characters" enterKeyHint="go" />
        <button className="btn primary big" type="submit" disabled={found.state === 'loading'}>
          Check
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <div aria-live="polite">
        {found.state === 'loading' && <p className="trk-msg">Looking up your voucher…</p>}
        {found.state === 'error' && <p className="trk-msg">Could not check right now. Check your internet and try again.</p>}
        {found.state === 'missing' && <p className="trk-msg">We can't find {found.asked}. Check the code on your slip, or ask at the counter.</p>}
        {v && verdict && (
          <div className="trk-result">
            <p className="trk-result-head">
              <b>{v.code}</b>
              {found.state === 'ok' && found.practice && <span className="trk-practice">practice</span>}
            </p>
            {v.valid && (
              <>
                <p className="trk-stamps">
                  <b>{v.label}</b>
                </p>
                <p className="trk-line">
                  Valid {v.validTo > v.validFrom ? days : `on ${days}`}
                  {v.needsCombo ? ', on an order with a combo' : v.minOrder > 0 ? `, on orders of ${peso(v.minOrder)} and up` : ''}.
                </p>
              </>
            )}
            <p className={verdict.good ? 'trk-good' : 'trk-bad'}>{verdict.text}</p>
          </div>
        )}
      </div>
    </form>
  );
}

// ---------- The page ----------

export function Track({ mode }: { mode: DataMode }) {
  const [today] = useState(() => localDate());
  const [numbers, setNumbers] = useState(() => loadNumbers(mode, today));
  /** What each listener last said, by "<mode>:<number>". */
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

  // The QR code opens the real-orders page. While no real day is open (a
  // practice run), practice orders are looked for as well, so they are found
  // without a special link. Once real selling is on, only real orders show.
  const [practiceToo, setPracticeToo] = useState(false);
  const modes = useMemo((): DataMode[] => (mode === 'demo' ? ['demo'] : practiceToo ? ['live', 'demo'] : ['live']), [mode, practiceToo]);

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

  // One live listener per tracked order and kind of data, added and removed with the list.
  const subs = useRef(new Map<string, () => void>());
  const seenMissing = useRef(new Set<string>());
  useEffect(() => {
    if (!db) return;
    const want = new Set(numbers.flatMap((n) => modes.map((m) => `${m}:${n}`)));
    for (const key of want) {
      if (subs.current.has(key)) continue;
      const [m, n] = key.split(':');
      const stop = onSnapshot(
        doc(db, 'tracker', trackerId(m, today, n)),
        { includeMetadataChanges: true },
        (snap) => {
          const t = snap.exists() ? (snap.data() as TrackerDoc) : null;
          if (t) seenMissing.current.delete(key);
          else if (!snap.metadata.fromCache) seenMissing.current.add(key);
          if (!snap.metadata.fromCache) setLastServer(Date.now());
          // Offline, the saved copy can't tell "not found" from "not loaded": keep what the server last said.
          setInfos((all) => ({ ...all, [key]: { doc: t, fromCache: snap.metadata.fromCache, denied: false, missing: !t && seenMissing.current.has(key) } }));
        },
        (e) => setInfos((all) => ({ ...all, [key]: { doc: all[key]?.doc ?? null, fromCache: true, denied: e.code === 'permission-denied', missing: false } })),
      );
      subs.current.set(key, stop);
    }
    for (const [key, stop] of subs.current) {
      if (want.has(key)) continue;
      stop();
      subs.current.delete(key);
      seenMissing.current.delete(key);
    }
  }, [db, numbers, modes, today]);
  useEffect(() => {
    const all = subs.current;
    return () => {
      for (const stop of all.values()) stop();
      all.clear();
    };
  }, []);

  /** One answer per number: the real order if there is one, else the practice order. */
  const found = useMemo(() => {
    const out: Record<string, { info: Info | undefined; mode: DataMode }> = {};
    for (const n of numbers) {
      const hit = modes.find((m) => infos[`${m}:${n}`]?.doc);
      if (hit) {
        out[n] = { info: infos[`${hit}:${n}`], mode: hit };
        continue;
      }
      const all = modes.map((m) => infos[`${m}:${n}`]);
      const heard = all.filter((i): i is Info => !!i);
      out[n] = {
        mode: modes[0],
        info: heard.length
          ? { doc: null, fromCache: heard.some((i) => i.fromCache), denied: heard.some((i) => i.denied), missing: heard.length === all.length && heard.every((i) => i.missing) }
          : undefined,
      };
    }
    return out;
  }, [numbers, modes, infos]);
  const statusOf = (n: string) => found[n]?.info?.doc?.status;

  // A tracked order just turned ready while this page is open: buzz, cluck and flash the tab.
  const lastStatus = useRef(new Map<string, string>());
  const statusKey = numbers.map((n) => `${n}=${statusOf(n) ?? ''}`).join(' ');
  useEffect(() => {
    for (const n of numbers) {
      const status = statusOf(n);
      if (!status) continue;
      const was = lastStatus.current.get(n);
      if (was && was !== 'ready' && status === 'ready') {
        navigator.vibrate?.([400, 200, 400, 200, 600]);
        if (soundRef.current) cluck();
        setFlashing((f) => (f.includes(n) ? f : [...f, n]));
      }
      lastStatus.current.set(n, status);
    }
    for (const n of [...lastStatus.current.keys()]) if (!numbers.includes(n)) lastStatus.current.delete(n);
    // statusKey changes exactly when a tracked order's status changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey]);

  // The queue and menu come from the booth's summary of the same kind of data as the customer's orders.
  const tracked = numbers.filter((n) => found[n]?.info?.doc);
  const boothMode: DataMode = mode === 'demo' || (tracked.length > 0 && tracked.every((n) => found[n].mode === 'demo')) ? 'demo' : 'live';
  // Read now, then every 20 seconds while an order is being made (so "orders
  // ahead" keeps up), every minute otherwise, and only while the page is on screen.
  const making = numbers.some((n) => statusOf(n) === 'new' || statusOf(n) === 'cooking');
  const every = making ? BOOTH_WAITING_MS : BOOTH_IDLE_MS;
  useEffect(() => {
    if (!db) return;
    let last = 0;
    let stopped = false;
    const read = () => {
      last = Date.now();
      const get = (m: DataMode) => getDoc(doc(db, 'public', `booth-${m}`)).then((s) => (s.exists() ? (s.data() as BoothDoc) : null));
      // On the real-orders link, the real booth decides whether practice orders are looked for,
      // even while this phone only follows practice orders: once real selling starts, they stop.
      const live = mode === 'live' ? get('live') : null;
      const shown = boothMode === 'live' && live ? live : get(boothMode);
      Promise.all([live, shown])
        .then(([l, b]) => {
          if (stopped) return;
          setBooth(b);
          if (mode === 'live') setPracticeToo(!l?.open);
        })
        .catch(() => {
          /* offline or not switched on: keep what we have */
        });
    };
    read();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') read();
    }, every);
    const onVis = () => {
      if (document.visibilityState === 'visible' && Date.now() - last >= every) read();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [db, mode, boothMode, every]);

  // Flash the tab title until the customer touches the page (or the order is no longer ready).
  const stillReady = flashing.filter((n) => statusOf(n) === 'ready');
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
    const s = statusOf(n);
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
      for (const m of modes) delete next[`${m}:${n}`];
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
  const offline = !online || (lastServer !== null && numbers.length > 0 && numbers.every((n) => found[n]?.info?.fromCache && !found[n]?.info?.denied));
  // The booth's own menu when we have it; before that, the printed menu that ships with the page.
  const menu = booth?.menu ?? publicMenu({ ...getState(), settings: defaultSettings(), days: {}, orders: {} });

  return (
    <div className="trk">
      {mode === 'demo' && <div className="trk-demo">PRACTICE · not real orders</div>}
      <header className="trk-head">
        <img src="./logo-small.png" alt="Chick Chick Boom" width={64} height={64} />
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
            <OrderCard key={n} number={n} info={found[n]?.info} practice={mode !== 'demo' && !!found[n]?.info?.doc && found[n].mode === 'demo'} booth={booth} now={now} onRemove={() => remove(n)} />
          ))}

          {numbers.length > 0 && <p className="muted small trk-note">Keep this page open. Your phone buzzes when your order is ready.</p>}

          <BoothInfo booth={booth} alsoReady={numbers.filter((n) => statusOf(n) === 'ready')} active={making || numbers.some((n) => statusOf(n) === 'ready')} />

          <Fold title="Menu and prices">{() => <MenuList items={menu} live={!!booth?.menu} />}</Fold>
          {db && <Fold title="Check your Boom Card stamps">{() => <CardCheck db={db} modes={modes} card={booth?.card} />}</Fold>}
          {db && <Fold title="Check a voucher">{() => <VoucherCheck db={db} modes={modes} today={today} />}</Fold>}
        </>
      )}
    </div>
  );
}
