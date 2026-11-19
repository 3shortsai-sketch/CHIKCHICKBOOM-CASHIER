import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startSync } from './data/sync';
import { exportBackup } from './data/store';
import './styles.css';

/**
 * If a screen crashes, show what to do instead of a blank page. The orders
 * are safe on the device; a reload almost always brings the screen back.
 */
class CrashScreen extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Screen crashed', error);
  }

  saveBackup = () => {
    const url = URL.createObjectURL(new Blob([exportBackup()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `chick-chick-boom-backup-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash-screen" role="alert">
        <h1>This screen hit a problem</h1>
        <p>Your orders are still saved on this device. Reload to carry on.</p>
        <div className="row">
          <button className="btn primary big" onClick={() => location.reload()}>
            Reload
          </button>
          <button className="btn" onClick={this.saveBackup}>
            Download a backup first
          </button>
          <a className="btn ghost" href="#" onClick={() => setTimeout(() => location.reload(), 0)}>
            Go to the list of screens
          </a>
        </div>
        <p className="muted small">If it keeps happening, tell the manager this message: {this.state.error.message}</p>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashScreen>
      <App />
    </CrashScreen>
  </StrictMode>,
);

startSync();

// Offline support: after the first visit the app opens without internet.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Offline mode not available', e));
  });
}

// Ask the browser not to clear our saved orders when space runs low.
void navigator.storage?.persist?.();
