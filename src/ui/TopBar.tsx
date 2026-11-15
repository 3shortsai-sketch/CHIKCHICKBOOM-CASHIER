import { lastSaveError, useStore } from '../data/store';
import { useSyncStatus } from '../data/sync';
import { useOnline } from './ui';

export function TopBar({ title, dark }: { title: string; dark?: boolean }) {
  const mode = useStore((s) => s.settings.mode);
  const online = useOnline();
  const sync = useSyncStatus();
  const saveError = lastSaveError();
  return (
    <>
      {mode === 'demo' && <div className="demo-banner">DEMO MODE — practice data, not real sales. Switch to real data in Setup.</div>}
      {saveError && <div className="demo-banner error-banner">{saveError}</div>}
      <header className={`topbar ${dark ? 'dark' : ''}`}>
        <a href="#" className="brand">
          <img src="./icon.svg" alt="" width={28} height={28} />
          <span>Chick Chick Boom</span>
        </a>
        <span className="topbar-title">{title}</span>
        <span className="spacer" />
        <span className={`pill ${online ? 'ok' : 'off'}`} title={sync.detail}>
          {!online ? 'Offline: saving on this device' : sync.label}
        </span>
      </header>
    </>
  );
}
