import type { ReactNode } from 'react';
import { lastSaveError, useStore } from '../data/store';
import { useSyncStatus } from '../data/sync';
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
        <span className="topbar-title">{title}</span>
        {children && <div className="topbar-extra">{children}</div>}
        <span className="spacer" />
        <span className={`pill ${online ? 'ok' : 'off'}`} title={sync.detail}>
          <span className="pill-dot" aria-hidden="true" />
          {!online ? 'Offline · saving here' : sync.label}
        </span>
      </header>
    </>
  );
}
