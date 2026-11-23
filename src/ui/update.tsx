import { useSyncExternalStore } from 'react';
import { flushSaves } from '../data/store';

/**
 * "New version, tap to reload". Each build has its own id, baked into the
 * app and written to version.json beside it. A device that has been open
 * since before a new version went live reads version.json now and then;
 * when the id there is not its own, it shows the banner. Nothing reloads by
 * itself: a cashier in the middle of an order chooses the moment.
 */

declare const __BUILD_ID__: string;

const CHECK_EVERY_MS = 5 * 60 * 1000;
/** A check is skipped when the last one was less than this long ago. */
const CHECK_GAP_MS = 60 * 1000;

let newer = false;
let lastCheck = 0;
const listeners = new Set<() => void>();

async function check() {
  if (newer || Date.now() - lastCheck < CHECK_GAP_MS) return;
  lastCheck = Date.now();
  try {
    const res = await fetch(`./version.json?t=${lastCheck}`, { cache: 'no-store' });
    if (!res.ok) return;
    const live = (await res.json()) as { id?: unknown };
    if (typeof live.id === 'string' && live.id && live.id !== __BUILD_ID__) {
      newer = true;
      for (const l of listeners) l();
    }
  } catch {
    /* offline, or the file is not there: try again later */
  }
}

/** Start looking for a newer version (only in the built app, not while developing). */
export function watchForNewVersion() {
  if (!import.meta.env.PROD || typeof __BUILD_ID__ !== 'string') return;
  setInterval(() => {
    if (document.visibilityState === 'visible') void check();
  }, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
  addEventListener('online', () => void check());
  // Soon after opening too: a device opened from its saved offline copy may already be behind.
  setTimeout(() => void check(), 15000);
}

function useNewVersion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => newer,
  );
}

export function UpdateBanner() {
  const show = useNewVersion();
  if (!show) return null;
  const reload = () => {
    // Everything is saved first; an order being rung up comes back after the reload.
    flushSaves();
    location.reload();
  };
  return (
    <button className="update-banner" onClick={reload}>
      <b>New version</b> · tap to reload
    </button>
  );
}
