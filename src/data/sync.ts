import { useSyncExternalStore } from 'react';

/**
 * Sync between devices (laptop ⇄ kitchen tablet ⇄ CFO phone).
 *
 * Firebase is not connected yet: everything runs on one device, and windows
 * on the same device (cashier + monitor) already share data. When the
 * Firebase project exists, this file gets its config and a Firestore adapter
 * that plugs into store.setRemote().
 */

export type SyncStatus = { label: string; detail: string; connected: boolean };

let status: SyncStatus = {
  label: 'This device only',
  detail: 'Firebase is not set up yet. The cashier and monitor windows on this laptop are in sync; the kitchen tablet is not.',
  connected: false,
};

const listeners = new Set<() => void>();

export function setSyncStatus(next: SyncStatus) {
  status = next;
  for (const l of listeners) l();
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => status,
  );
}

export function startSync() {
  // Filled in once the Firebase project is created.
}
