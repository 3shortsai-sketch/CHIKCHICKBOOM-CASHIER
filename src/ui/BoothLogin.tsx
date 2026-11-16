import { useState, type ReactNode } from 'react';
import { signInBooth, useAuthState } from '../data/sync';

const SKIP_KEY = 'ccb:skip-signin';

export function skipSignInForNow(): boolean {
  try {
    return sessionStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

export function askToSignIn() {
  try {
    sessionStorage.removeItem(SKIP_KEY);
  } catch {
    /* ignore */
  }
  location.reload();
}

/**
 * Asks each device to sign in once with the shared booth account, so it can
 * sync. Never blocks the booth: "Continue on this device only" keeps
 * working offline and sync starts after signing in later.
 */
export function BoothLoginGate({ children }: { children: ReactNode }) {
  const auth = useAuthState();
  const [skipped, setSkipped] = useState(skipSignInForNow);
  if (!auth.enabled || auth.email || skipped) return <>{children}</>;
  if (!auth.ready) {
    return (
      <div className="center-screen">
        <img src="./logo.png" alt="" width={120} height={120} className="login-logo" />
        <p className="muted">Starting…</p>
      </div>
    );
  }
  return (
    <BoothLogin
      onSkip={() => {
        try {
          sessionStorage.setItem(SKIP_KEY, '1');
        } catch {
          /* ignore */
        }
        setSkipped(true);
      }}
    />
  );
}

function BoothLogin({ onSkip }: { onSkip: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!email.trim() || !password) return setError('Type the booth email and password.');
    setBusy(true);
    setError('');
    const r = await signInBooth(email, password);
    setBusy(false);
    if (!r.ok) setError(r.message);
  };

  return (
    <div className="center-screen">
      <form
        className="card login-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <img src="./logo.png" alt="" width={96} height={96} className="login-logo" />
        <h1>Booth sign-in</h1>
        <p className="muted small">Once per device. After this, the app remembers it and works offline.</p>
        <label className="field">
          <span>Booth email</span>
          <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary big full" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button className="btn ghost small" type="button" onClick={onSkip}>
          No internet? Continue on this device only
        </button>
      </form>
    </div>
  );
}
