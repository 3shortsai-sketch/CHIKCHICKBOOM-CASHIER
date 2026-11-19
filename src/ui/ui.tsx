import { useEffect, useRef, useState, type ReactNode } from 'react';

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useHash(): string {
  const [hash, setHash] = useState(() => location.hash.replace(/^#\/?/, ''));
  useEffect(() => {
    const on = () => setHash(location.hash.replace(/^#\/?/, ''));
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    addEventListener('online', on);
    addEventListener('offline', on);
    return () => {
      removeEventListener('online', on);
      removeEventListener('offline', on);
    };
  }, []);
  return online;
}

/** Keeps the tablet/monitor screen from going to sleep while the page is open. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const get = async () => {
      try {
        const got = await navigator.wakeLock.request('screen');
        // The screen was left while the browser was still answering: let it go.
        if (cancelled) void got.release();
        else lock = got;
      } catch {
        /* not allowed right now */
      }
    };
    void get();
    const onVis = () => {
      if (document.visibilityState === 'visible' && !cancelled) void get();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release();
    };
  }, [active]);
}

let audio: AudioContext | null = null;

/** Browsers only allow sound after a tap, so screens call this from a "Start" button. */
export function unlockSound() {
  audio ??= new AudioContext();
  void audio.resume();
}

export function chime(kind: 'ready' | 'new' = 'ready') {
  if (!audio) return;
  const notes = kind === 'ready' ? [880, 1175, 1568] : [660, 880];
  const t0 = audio.currentTime;
  notes.forEach((f, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    const t = t0 + i * 0.16;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t);
    osc.stop(t + 0.5);
  });
}

/**
 * A hen's "buk-buk-buk-buk ba-GAWK!", built from oscillators so it works
 * offline with no sound file. Each note is a buzzy tone that drops in pitch,
 * shaped by two filters (the "beak" formants), with a short click at the end.
 * Returns how long it lasts, in seconds.
 */
export function cluck(target: BaseAudioContext | null = audio): number {
  if (!target) return 0;
  const ctx = target;
  const out = ctx.createGain();
  out.gain.value = 0.85;
  out.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.02;

  const note = (start: number, dur: number, pitch: number[], rough: number, level: number, endClick = true) => {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(pitch[0], start);
    pitch.slice(1).forEach((f, i) => osc.frequency.linearRampToValueAtTime(f, start + (dur * (i + 1)) / (pitch.length - 1)));

    // Two formant bands give it a throaty, beaky colour instead of a pure buzz.
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 1200;
    f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 2600;
    f2.Q.value = 5;

    // Fast flutter makes it sound like a bird, not a synth.
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(level, start + 0.008);
    env.gain.setValueAtTime(level, start + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    // Flutter goes through the envelope, so it fades out with the note.
    const am = ctx.createGain();
    am.gain.value = 1 - rough / 2;
    const flutter = ctx.createOscillator();
    flutter.frequency.value = 55;
    const depth = ctx.createGain();
    depth.gain.value = rough / 2;
    flutter.connect(depth).connect(am.gain);

    osc.connect(f1).connect(env);
    osc.connect(f2).connect(env);
    env.connect(am).connect(out);
    osc.start(start);
    osc.stop(start + dur + 0.02);
    flutter.start(start);
    flutter.stop(start + dur + 0.02);

    // Little "k" click at the end of the note.
    if (!endClick) return;
    const len = Math.floor(ctx.sampleRate * 0.012);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const click = ctx.createBufferSource();
    click.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const cg = ctx.createGain();
    cg.gain.value = level * 0.5;
    click.connect(hp).connect(cg).connect(out);
    click.start(start + dur - 0.01);
  };

  // buk, buk, buk, buk ... ba-GAWK!
  note(t0, 0.07, [430, 330], 0.35, 0.7);
  note(t0 + 0.16, 0.07, [450, 340], 0.35, 0.7);
  note(t0 + 0.32, 0.07, [440, 330], 0.35, 0.7);
  note(t0 + 0.48, 0.08, [460, 350], 0.35, 0.75);
  note(t0 + 0.66, 0.06, [520, 470], 0.3, 0.7);
  note(t0 + 0.75, 0.42, [650, 1050, 980, 620], 0.5, 1, false);
  return 1.25;
}

/** Say something out loud through the speakers (browser's built-in voice). */
export function announce(text: string) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  // Prefer a voice installed on the device, so it also works offline.
  const voices = speechSynthesis.getVoices();
  const voice = voices.find((v) => v.localService && v.lang.startsWith('en')) ?? voices.find((v) => v.lang.startsWith('en'));
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? 'en-US';
  u.rate = 0.92;
  u.volume = 1;
  speechSynthesis.speak(u);
}

/** "A-012" → "A 12", which voices read more naturally. */
export function spokenNumber(n: string): string {
  const [letter, digits] = n.split('-');
  return digits ? `${letter}, ${Number(digits)}` : n;
}

export function minutesAgo(ts: number, now: number): string {
  const m = Math.floor((now - ts) / 60000);
  if (m < 1) return 'just now';
  return `${m} min`;
}

/** Open modals, oldest first. Escape closes only the newest one. */
const openModals: object[] = [];

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const close = useLatest(onClose);
  useEffect(() => {
    const me = {};
    openModals.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || openModals[openModals.length - 1] !== me) return;
      // Stop here: the modal underneath and the screen's own Escape key must not also react.
      e.stopImmediatePropagation();
      e.preventDefault();
      close.current();
    };
    addEventListener('keydown', onKey, true);
    return () => {
      removeEventListener('keydown', onKey, true);
      const i = openModals.indexOf(me);
      if (i >= 0) openModals.splice(i, 1);
    };
  }, [close]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            Esc ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Locks a page behind one or more passcodes. Each page remembers its own
 * unlock for this browser tab, so unlocking Profit doesn't lock Setup.
 * Extra passcodes (e.g. the admin PIN on the team Profit page) also open it.
 */
/**
 * What the tab remembers after an unlock: a scrambled mark of the PIN that
 * was used, never the PIN. A changed PIN no longer matches, so the page locks again.
 */
function pinFlag(label: string, pin: string): string {
  let h = 5381;
  for (const ch of `ccb|${label}|${pin}`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `u${h.toString(36)}`;
}

function readFlag(label: string): string {
  try {
    return sessionStorage.getItem(`ccb:unlocked:${label}`) ?? '';
  } catch {
    return '';
  }
}

/**
 * Keep a page open in this tab across a PIN change made right here (Setup
 * calls it just before saving a new PIN, so the person changing it is not locked out).
 */
export function keepUnlocked(label: string, newPin: string) {
  try {
    sessionStorage.setItem(`ccb:unlocked:${label}`, pinFlag(label, newPin));
  } catch {
    /* private mode: the page will ask for the new PIN */
  }
}

export function PinGate({ pin, also = [], label, children }: { pin: string; also?: string[]; label: string; children: ReactNode }) {
  const key = `ccb:unlocked:${label}`;
  const pins = [pin, ...also];
  // Kept in memory too, for browsers that will not store anything (private mode).
  const [memFlag, setFlag] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  // Checked on every draw: when the PIN is changed (here or on another device) the page locks again.
  const flag = readFlag(label) || memFlag;
  if (flag && pins.some((p) => pinFlag(label, p) === flag)) return <>{children}</>;
  const submit = () => {
    if (pins.includes(value)) {
      const mark = pinFlag(label, value);
      try {
        sessionStorage.setItem(key, mark);
      } catch {
        /* private mode: unlock for this view only */
      }
      setFlag(mark);
      setValue('');
      setError('');
    } else {
      setError('Wrong PIN');
      setValue('');
    }
  };
  return (
    <div className="center-screen">
      <div className="card pin-card">
        <h1>{label}</h1>
        <p className="muted">Enter the PIN</p>
        <input
          className="input pin-input"
          type="password"
          inputMode="numeric"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {error && <p className="error">{error}</p>}
        <button className="btn primary big" onClick={submit}>
          Unlock
        </button>
        <p className="muted small">
          <a href="#">← Back to screens</a>
        </p>
      </div>
    </div>
  );
}

/**
 * Asks for the manager PIN and a reason before a void or refund.
 * With `who` (even an empty text) it also asks who is approving, and passes the name on.
 */
export function ManagerConfirm({
  title,
  managerPin,
  onConfirm,
  onClose,
  needAmount,
  maxAmount,
  who,
  note,
  confirmLabel = 'Confirm',
  reasonHint = 'e.g. wrong flavor punched',
}: {
  title: string;
  managerPin: string;
  onConfirm: (reason: string, amount: number, by: string) => void;
  onClose: () => void;
  needAmount?: boolean;
  maxAmount?: number;
  /** Name to start the "Who is approving?" box with. Leave out to not ask. */
  who?: string;
  /** Shown at the top, e.g. how much cash to hand back. */
  note?: ReactNode;
  confirmLabel?: string;
  reasonHint?: string;
}) {
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [amount, setAmount] = useState('');
  const [by, setBy] = useState(who ?? '');
  const [error, setError] = useState('');
  const submit = () => {
    const n = Number(amount);
    if (needAmount && (!n || n <= 0 || (maxAmount !== undefined && n > maxAmount))) return setError(`Amount must be between ₱1 and ₱${maxAmount}.`);
    if (!reason.trim()) return setError('Type a reason.');
    if (who !== undefined && !by.trim()) return setError('Type the name of the person approving.');
    if (pin !== managerPin) return setError('Wrong manager PIN.');
    onConfirm(reason.trim(), needAmount ? n : 0, by.trim());
  };
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        {note}
        {needAmount && (
          <label className="field">
            <span>Amount to refund (₱)</span>
            <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} autoFocus />
          </label>
        )}
        <label className="field">
          <span>Reason</span>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus={!needAmount} placeholder={reasonHint} />
        </label>
        {who !== undefined && (
          <label className="field">
            <span>Who is approving?</span>
            <input className="input" value={by} onChange={(e) => setBy(e.target.value)} maxLength={30} placeholder="Your name" />
          </label>
        )}
        <label className="field">
          <span>Manager PIN</span>
          <input className="input" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn danger big" onClick={submit}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export function download(filename: string, content: string | Uint8Array, type = 'text/plain') {
  const blob = new Blob([content as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
