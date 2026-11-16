import type { FirebaseOptions } from 'firebase/app';

/**
 * Paste the `firebaseConfig = { ... }` block from the Firebase console here
 * (Project settings → Your apps → Web app). It is not a secret: it only says
 * which Firebase project the app talks to. Access is protected by the booth
 * login and the rules in firestore.rules.
 *
 * Set to null to run on this device only (no sync).
 */
export const firebaseConfig: FirebaseOptions | null = {
  apiKey: 'AIzaSyDP2NHk6Sn3SKEr2I9ZADTl7XJK2pWyRuw',
  authDomain: 'chick-chick-boom.firebaseapp.com',
  projectId: 'chick-chick-boom',
  storageBucket: 'chick-chick-boom.firebasestorage.app',
  messagingSenderId: '325983973659',
  appId: '1:325983973659:web:c494eeedde42d0aa2aa3be',
};

/**
 * For local testing only: `VITE_FIREBASE_EMULATOR=1 npm run build` talks to
 * the Firebase emulators on this computer instead of the real project.
 */
export const useEmulator = import.meta.env.VITE_FIREBASE_EMULATOR === '1';

/** For local testing only: `VITE_LOCAL_ONLY=1 npm run build` ignores Firebase entirely. */
export const localOnly = import.meta.env.VITE_LOCAL_ONLY === '1';

export const emulatorConfig: FirebaseOptions = { apiKey: 'demo-key', authDomain: 'demo-ccb.firebaseapp.com', projectId: 'demo-ccb', appId: 'demo-app' };
