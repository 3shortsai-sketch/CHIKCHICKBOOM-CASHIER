// Checks the booth's Firebase rules against the emulators started by
// `npm run emulators`, using the same Firebase library the app uses.
// Prints one line per check and exits with 1 if any fails.
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { collection, connectFirestoreEmulator, deleteField, doc, getDoc, getDocs, getFirestore, setDoc, terminate } from 'firebase/firestore';

const PROJECT = 'demo-ccb';
const BOOTH = 'booth@test.com';
const PASSWORD = 'test1234';
let failed = 0;
const apps = [];

async function client(email) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, appId: 'demo-app' }, `c${apps.length}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  if (email) {
    try {
      await createUserWithEmailAndPassword(auth, email, PASSWORD);
    } catch {
      await signInWithEmailAndPassword(auth, email, PASSWORD);
    }
  }
  return db;
}

async function expectOk(name, run) {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL  ${name}: ${e.code ?? e.message}`);
  }
}

async function expectDenied(name, run) {
  try {
    await run();
    failed += 1;
    console.log(`FAIL  ${name}: it was allowed`);
  } catch (e) {
    if (e.code === 'permission-denied') console.log(`PASS  ${name}`);
    else {
      failed += 1;
      console.log(`FAIL  ${name}: ${e.code ?? e.message}`);
    }
  }
}

async function check(name, test) {
  if (test) console.log(`PASS  ${name}`);
  else {
    failed += 1;
    console.log(`FAIL  ${name}`);
  }
}

try {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
} catch {
  console.error('The emulators are not running. Start them with: npm run emulators');
  process.exit(1);
}

const booth = await client(BOOTH);
const stranger = await client('someone.else@test.com');
const customer = await client(null);

// The booth account
await expectOk('booth saves settings', () => setDoc(doc(booth, 'settings', 'main'), { mode: 'demo', pickupTimes: { recess: '09:30', lunch: '11:30' }, wheel: { paused: false } }));
await expectDenied('booth cannot write another settings document', () => setDoc(doc(booth, 'settings', 'other'), { x: 1 }));
for (const col of ['days', 'orders', 'cards', 'cashMoves']) {
  await expectOk(`booth writes ${col}`, () => setDoc(doc(booth, col, 'x1'), { id: 'x1', mode: 'demo' }));
  await expectOk(`booth reads all ${col}`, () => getDocs(collection(booth, col)));
}
await expectOk('booth writes an order copy for the customer page', () => setDoc(doc(booth, 'tracker', 'demo_2026-11-24_A-001'), { number: 'A-001', status: 'new' }));
await expectOk('booth writes the booth summary', () => setDoc(doc(booth, 'public', 'booth-demo'), { open: true }));
await expectDenied('booth cannot write another public document', () => setDoc(doc(booth, 'public', 'other'), { x: 1 }));

// A map is merged entry by entry (as the app does), and an entry taken out is removed by name
await setDoc(doc(booth, 'settings', 'main'), { pickupTimes: { lunch: '11:30', recess: deleteField() } }, { merge: true });
const settings = (await getDoc(doc(booth, 'settings', 'main'))).data();
await check('a cleared break time is gone from the server', settings.pickupTimes.recess === undefined && settings.pickupTimes.lunch === '11:30');
await check('fields not in the change are kept', settings.mode === 'demo' && settings.wheel?.paused === false);
await setDoc(doc(booth, 'days', 'x1'), { soldOut: { water: true } }, { merge: true });
await setDoc(doc(booth, 'days', 'x1'), { soldOut: { fries: true } }, { merge: true });
const soldOut = (await getDoc(doc(booth, 'days', 'x1'))).data().soldOut;
await check('two devices marking different items sold out both keep theirs', soldOut.water === true && soldOut.fries === true);
await setDoc(doc(booth, 'days', 'x1'), { closedAt: 5 }, { merge: true });
await setDoc(doc(booth, 'days', 'x1'), { closedAt: deleteField() }, { merge: true });
await check('reopening a day removes closedAt on the server', !('closedAt' in (await getDoc(doc(booth, 'days', 'x1'))).data()));

// Another account (anyone can make one with the app's public config)
for (const col of ['days', 'orders', 'cards', 'cashMoves']) {
  await expectDenied(`another account cannot read ${col}`, () => getDocs(collection(stranger, col)));
  await expectDenied(`another account cannot write ${col}`, () => setDoc(doc(stranger, col, 'y'), { id: 'y' }));
}
await expectDenied('another account cannot read settings', () => getDoc(doc(stranger, 'settings', 'main')));
await expectDenied('another account cannot write the customer copies', () => setDoc(doc(stranger, 'tracker', 'demo_2026-11-24_A-001'), { status: 'ready' }));

// A customer (not signed in)
await expectOk('a customer opens one order copy by its id', () => getDoc(doc(customer, 'tracker', 'demo_2026-11-24_A-001')));
await expectOk('a customer opens the booth summary', () => getDoc(doc(customer, 'public', 'booth-demo')));
await expectDenied('a customer cannot list the order copies', () => getDocs(collection(customer, 'tracker')));
await expectDenied('a customer cannot change an order copy', () => setDoc(doc(customer, 'tracker', 'demo_2026-11-24_A-001'), { status: 'ready' }));
await expectDenied('a customer cannot read orders', () => getDocs(collection(customer, 'orders')));

for (const app of apps) {
  await terminate(getFirestore(app)).catch(() => {});
  await deleteApp(app).catch(() => {});
}
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll rules checks passed.');
process.exit(failed ? 1 : 0);
