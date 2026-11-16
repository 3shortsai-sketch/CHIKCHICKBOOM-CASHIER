import type { FirebaseOptions } from 'firebase/app';

/**
 * Paste the `firebaseConfig = { ... }` block from the Firebase console here
 * (Project settings → Your apps → Web app). It is not a secret: it only says
 * which Firebase project the app talks to. Access is protected by the booth
 * login and the rules in firestore.rules.
 *
 * While this is null the app runs on this device only (no sync).
 */
export const firebaseConfig: FirebaseOptions | null = null;

/**
 * For local testing only: `VITE_FIREBASE_EMULATOR=1 npm run build` talks to
 * the Firebase emulators on this computer instead of the real project.
 */
export const useEmulator = import.meta.env.VITE_FIREBASE_EMULATOR === '1';

export const emulatorConfig: FirebaseOptions = { apiKey: 'demo-key', authDomain: 'demo-ccb.firebaseapp.com', projectId: 'demo-ccb', appId: 'demo-app' };
