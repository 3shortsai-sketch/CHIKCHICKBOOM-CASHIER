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
        lock = await navigator.wakeLock.request('screen');
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

export function minutesAgo(ts: number, now: number): string {
  const m = Math.floor((now - ts) / 60000);
  if (m < 1) return 'just now';
  return `${m} min`;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [onClose]);
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

const UNLOCK_KEY = 'ccb:unlocked';

export function PinGate({ pin, label, children }: { pin: string; label: string; children: ReactNode }) {
  const [ok, setOk] = useState(() => sessionStorage.getItem(UNLOCK_KEY) === pin);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  if (ok) return <>{children}</>;
  const submit = () => {
    if (value === pin) {
      sessionStorage.setItem(UNLOCK_KEY, pin);
      setOk(true);
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

/** Asks for the manager PIN and a reason before a void or refund. */
export function ManagerConfirm({
  title,
  managerPin,
  onConfirm,
  onClose,
  needAmount,
  maxAmount,
}: {
  title: string;
  managerPin: string;
  onConfirm: (reason: string, amount: number) => void;
  onClose: () => void;
  needAmount?: boolean;
  maxAmount?: number;
}) {
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const submit = () => {
    if (!reason.trim()) return setError('Type a reason.');
    const n = Number(amount);
    if (needAmount && (!n || n <= 0 || (maxAmount !== undefined && n > maxAmount))) return setError(`Amount must be between ₱1 and ₱${maxAmount}.`);
    if (pin !== managerPin) return setError('Wrong manager PIN.');
    onConfirm(reason.trim(), needAmount ? n : 0);
  };
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        {needAmount && (
          <label className="field">
            <span>Amount to refund (₱)</span>
            <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} autoFocus />
          </label>
        )}
        <label className="field">
          <span>Reason</span>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus={!needAmount} placeholder="e.g. wrong flavor punched" />
        </label>
        <label className="field">
          <span>Manager PIN</span>
          <input className="input" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn danger big" onClick={submit}>
          Confirm
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

export function download(filename: string, text: string, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
