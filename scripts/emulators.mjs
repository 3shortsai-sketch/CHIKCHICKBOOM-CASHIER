// Starts the Firebase emulators (login + database) on this computer with the
// booth's real rules, so sync and the rules can be tested without touching
// the real project. The rules file in the repo has a placeholder email: the
// copy used here has the test login below instead.
//
//   npm run emulators       (leave it running)
//   npm run check:rules     (in a second terminal)
//   VITE_FIREBASE_EMULATOR=1 npm run build && npx vite preview
//
// Nothing here is deployed. Needs Java (the emulators run on it).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const TEST_BOOTH_EMAIL = 'booth@test.com';

const dir = new URL('../.emulator/', import.meta.url);
mkdirSync(dir, { recursive: true });
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
if (!rules.includes('BOOTH_EMAIL_GOES_HERE')) throw new Error('firestore.rules should keep the BOOTH_EMAIL_GOES_HERE placeholder');
writeFileSync(new URL('firestore.rules', dir), rules.replace('BOOTH_EMAIL_GOES_HERE', TEST_BOOTH_EMAIL));
writeFileSync(
  new URL('firebase.json', dir),
  JSON.stringify({ firestore: { rules: 'firestore.rules' }, emulators: { auth: { port: 9099 }, firestore: { port: 8080 }, ui: { enabled: false }, singleProjectMode: true } }, null, 2),
);
const child = spawn('npx', ['-y', 'firebase-tools@13', 'emulators:start', '--only', 'auth,firestore', '--project', 'demo-ccb', '--config', 'firebase.json'], { cwd: dir, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
