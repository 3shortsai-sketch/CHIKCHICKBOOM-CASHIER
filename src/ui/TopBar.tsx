import type { ReactNode } from 'react';
import { lastSaveError, useStore } from '../data/store';
import { useSyncStatus } from '../data/sync';
import { askToSignIn } from './BoothLogin';
import { useOnline } from './ui';

export function TopBar({ title, children }: { title: string; children?: ReactNode }) {
  const mode = useStore((s) => s.settings.mode);
  const online = useOnline();
  const sync = useSyncStatus();
  const saveError = lastSaveError();
  return (
    <>
      {mode === 'demo' && <div className="demo-banner">DEMO MODE · practice data, not real sales · switch to real data in Setup</div>}
      {saveError && <div className="demo-banner error-banner">{saveError}</div>}
      <header className="topbar">
        <a href="#" className="brand" aria-label="Chick Chick Boom: all screens">
          <img src="./logo-small.png" alt="" width={48} height={48} />
          <span className="wordmark">Chick Chick Boom</span>
        </a>
        <a href="#" className="home-btn" title="Back to the list of screens">
          <span aria-hidden="true">⌂</span> Screens
        </a>
        <span className="topbar-title">{title}</span>
        {children && <div className="topbar-extra">{children}</div>}
        <span className="spacer" />
        {sync.needsSignIn ? (
          <button className="pill off pill-btn" title={sync.detail} onClick={askToSignIn}>
            <span className="pill-dot" aria-hidden="true" />
            Not synced · sign in
          </button>
        ) : (
          <span className={`pill ${sync.connected ? 'ok' : online && sync.label === 'This device only' ? 'ok' : 'off'}`} title={sync.detail}>
            <span className="pill-dot" aria-hidden="true" />
            {!online && sync.label === 'This device only' ? 'Offline · saving here' : sync.label}
          </span>
        )}
      </header>
    </>
  );
}
