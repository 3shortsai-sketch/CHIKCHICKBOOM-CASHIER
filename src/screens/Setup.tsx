import { useEffect, useRef, useState } from 'react';
import { defaultSettings } from '../domain/defaults';
import { newId } from '../domain/pricing';
import { ALLERGENS, type AllergenTags, type DataMode, type MenuItem, type PrizeId, type Settings } from '../domain/types';
import { PRIZE_LABEL } from '../domain/wheel';
import { exportBackup, openDay, resetSettings, saveSettings, setDevice, startFresh, useDevice, useStore, type State } from '../data/store';
import { signOutBooth, useAuthState, useSyncStatus } from '../data/sync';
import { askToSignIn } from '../ui/BoothLogin';
import { TopBar } from '../ui/TopBar';
import { download, keepUnlocked, Modal, PinGate } from '../ui/ui';

export function Setup() {
  const pin = useStore((s) => s.settings.adminPin);
  return (
    <PinGate pin={pin} label="Setup">
      <SetupInner />
    </PinGate>
  );
}

/** The passcodes the app ships with. Anyone can read them in the public code. */
/** The built-in passcodes (public in the code), read from the defaults so the warning can never go stale. */
const DEFAULT_PINS = (({ adminPin, managerPin, teamPin }) => ({ adminPin, managerPin, teamPin }))(defaultSettings());

const showNum = (n: number) => (Number.isFinite(n) ? String(n) : '0');

/**
 * A number box that can only save a sensible number. A wrong entry (letters,
 * a minus, too small) puts the old value back and says why in one line.
 * Nothing is saved when the number did not change.
 */
function NumField({
  value,
  onSave,
  min = 0,
  max,
  decimals,
  blankZero,
  className = 'input',
  label,
}: {
  value: number;
  onSave: (n: number) => void;
  min?: number;
  max?: number;
  /** Allow 0.15; without it only whole numbers. */
  decimals?: boolean;
  /** Show 0 as an empty box, and read an empty box as 0. */
  blankZero?: boolean;
  className?: string;
  label?: string;
}) {
  const shown = blankZero && !value ? '' : showNum(value);
  const [text, setText] = useState(shown);
  const [error, setError] = useState('');
  const focused = useRef(false);
  // A change made on another device (or a reset) shows up, unless someone is typing here.
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  const commit = () => {
    focused.current = false;
    const raw = text.trim();
    if (raw === shown) return;
    const n = raw === '' && blankZero ? 0 : Number(raw);
    const wellFormed = raw === '' ? !!blankZero : decimals ? /^\d+(\.\d+)?$/.test(raw) : /^\d+$/.test(raw);
    if (!wellFormed || !Number.isFinite(n) || n < min || (max !== undefined && n > max)) {
      const kind = decimals ? 'a number' : 'a whole number';
      const range = max !== undefined ? `from ${min} to ${max}` : `${min} or more`;
      setError(`Not saved. Type ${kind}, ${range}.`);
      setText(shown);
      return;
    }
    setError('');
    if (n !== value) onSave(n);
    else setText(shown);
  };
  return (
    <>
      <input
        className={className}
        inputMode={decimals ? 'decimal' : 'numeric'}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        value={text}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          setText(e.target.value);
          setError('');
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
    </>
  );
}

function ListEditor({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(values.join('\n'));
  return (
    <label className="field">
      <span>{label} (one per line)</span>
      <textarea
        className="input"
        rows={Math.max(3, values.length + 1)}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const next = text.split('\n').map((x) => x.trim()).filter(Boolean);
          if (next.join('\n') !== values.join('\n')) onChange(next);
        }}
      />
    </label>
  );
}

function realDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
}

/** The days the booth sells, and what the voucher slot gives on the last one. */
function BazaarDays({ s, save }: { s: Settings; save: (patch: Partial<Settings>) => void }) {
  const days = [...(s.sellingDays ?? [])].sort();
  const shown = days.join(', ');
  const [text, setText] = useState(shown);
  const [error, setError] = useState('');
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  const commit = () => {
    focused.current = false;
    const parts = text.split(/[\s,;]+/).filter(Boolean);
    const bad = parts.filter((d) => !realDate(d));
    if (bad.length) {
      setError(`Not saved. "${bad[0]}" is not a date. Type dates like 2026-11-23, with commas between them.`);
      setText(shown);
      return;
    }
    const next = [...new Set(parts)].sort();
    setError('');
    setText(next.join(', '));
    if (next.join(',') !== days.join(',')) save({ sellingDays: next });
  };
  const standIn: PrizeId = s.voucher.lastDayPrize ?? 'tenOff';
  return (
    <section className="panel">
      <h2>Bazaar days</h2>
      <label className="field">
        <span>Days the booth sells (YYYY-MM-DD, commas between)</span>
        <input
          className="input"
          value={text}
          aria-invalid={error ? true : undefined}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          placeholder="2026-11-23, 2026-11-24"
        />
        {error && (
          <small className="field-error" role="alert">
            {error}
          </small>
        )}
      </label>
      <label className="field">
        <span>On the last day the voucher slot gives</span>
        <select className="input" value={standIn} onChange={(e) => save({ voucher: { ...s.voucher, lastDayPrize: e.target.value as PrizeId } })}>
          {(Object.keys(PRIZE_LABEL) as PrizeId[])
            .filter((p) => p !== 'voucher' && p !== 'comboVoucher')
            .map((p) => (
              <option key={p} value={p}>
                {PRIZE_LABEL[p]}
              </option>
            ))}
        </select>
      </label>
      <p className="muted small">
        Vouchers are valid on the next selling day. {days.length ? `The last day is ${days[days.length - 1]}: there is no next day, so the voucher slot gives the prize above instead.` : 'No days are set, so a voucher is simply valid the next day.'}
      </p>
    </section>
  );
}

/** Three passcodes, saved together with one button. */
function Passcodes({ s, save }: { s: Settings; save: (patch: Partial<Settings>) => void }) {
  const [manager, setManager] = useState(s.managerPin);
  const [admin, setAdmin] = useState(s.adminPin);
  const [team, setTeam] = useState(s.teamPin);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const digits = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value.replace(/\D/g, '').slice(0, 8));
    setMsg(null);
  };
  const changed = manager !== s.managerPin || admin !== s.adminPin || team !== s.teamPin;
  const submit = () => {
    const fail = (text: string) => setMsg({ ok: false, text });
    for (const [name, v] of [['Manager', manager], ['Dashboard and Setup', admin], ['Team', team]] as const) {
      if (!/^\d{4,8}$/.test(v)) return fail(`Not saved. The ${name} passcode needs 4 to 8 digits.`);
    }
    if (admin === manager || admin === team) return fail('Not saved. The Dashboard and Setup passcode must be different from the other two.');
    if (!changed) return setMsg({ ok: true, text: 'Nothing changed.' });
    // This tab stays open; other tabs and devices must type the new passcode.
    if (admin !== s.adminPin) {
      keepUnlocked('Setup', admin);
      keepUnlocked('Dashboard', admin);
    }
    // Only the passcodes typed here are saved, so one changed on another device meanwhile is not put back.
    const patch: Partial<Settings> = {};
    if (manager !== s.managerPin) patch.managerPin = manager;
    if (admin !== s.adminPin) patch.adminPin = admin;
    if (team !== s.teamPin) patch.teamPin = team;
    save(patch);
    const stillDefault = manager === DEFAULT_PINS.managerPin || admin === DEFAULT_PINS.adminPin || team === DEFAULT_PINS.teamPin;
    setMsg({ ok: true, text: stillDefault ? 'Passcodes saved. One is still a default: change it too.' : 'Passcodes saved. Tell the team the new ones.' });
  };
  return (
    <div className="passcodes">
      <div className="grid-2">
        <label className="field">
          <span>Manager passcode (voids and refunds)</span>
          <input className="input" inputMode="numeric" autoComplete="off" value={manager} onChange={digits(setManager)} />
        </label>
        <label className="field">
          <span>Dashboard and Setup passcode</span>
          <input className="input" inputMode="numeric" autoComplete="off" value={admin} onChange={digits(setAdmin)} />
        </label>
        <label className="field">
          <span>Team passcode (cashier "Team" page)</span>
          <input className="input" inputMode="numeric" autoComplete="off" value={team} onChange={digits(setTeam)} />
        </label>
      </div>
      <div className="row">
        <button className="btn primary" onClick={submit} disabled={!changed}>
          Save passcodes
        </button>
        <span className="muted small">4 to 8 digits each. The Dashboard and Setup one must be different from the other two.</span>
      </div>
      {msg && (
        <p className={msg.ok ? 'ok-note' : 'error'} role="status">
          {msg.text}
        </p>
      )}
    </div>
  );
}

function SyncInfo() {
  const auth = useAuthState();
  const sync = useSyncStatus();
  if (!auth.enabled) return <p className="muted small">Sync is not set up yet: this device works on its own.</p>;
  return (
    <div className="sync-info">
      <p className="small">
        <b>Sync:</b> {sync.label}
        {auth.email ? ` · signed in as ${auth.email}` : ''}
      </p>
      {auth.email ? (
        <button className="btn small ghost" onClick={() => confirm('Sign this device out? It will stop syncing until someone signs in again.') && void signOutBooth()}>
          Sign out this device
        </button>
      ) : (
        <button className="btn small" onClick={askToSignIn}>
          Sign in to sync
        </button>
      )}
    </div>
  );
}

/** Each allergen chip cycles: off → Contains → May contain → off. */
function AllergenPicker({ value, onChange }: { value: AllergenTags | undefined; onChange: (v: AllergenTags) => void }) {
  const contains = value?.contains ?? [];
  const may = value?.may ?? [];
  const cycle = (a: string) => {
    if (contains.includes(a)) onChange({ contains: contains.filter((x) => x !== a), may: [...may, a] });
    else if (may.includes(a)) onChange({ contains, may: may.filter((x) => x !== a) });
    else onChange({ contains: [...contains, a], may });
  };
  return (
    <div className="allergen-chips">
      {ALLERGENS.map((a) => {
        const state = contains.includes(a) ? 'on' : may.includes(a) ? 'may' : '';
        return (
          <button key={a} type="button" className={`allergen-chip ${state}`} onClick={() => cycle(a)} aria-label={`${a}: ${state === 'on' ? 'contains' : state === 'may' ? 'may contain' : 'not present'}`}>
            {state === 'may' ? `may: ${a}` : a}
          </button>
        );
      })}
    </div>
  );
}

function SetupInner() {
  const state = useStore((st) => st);
  const s = state.settings;
  const device = useDevice();
  const day = openDay(state);
  const [saved, setSaved] = useState('');
  const [modeMsg, setModeMsg] = useState('');
  const realDayOpen = Object.values(state.days).find((d) => d.mode === 'live' && !d.closedAt);
  const defaultPins = s.adminPin === DEFAULT_PINS.adminPin || s.managerPin === DEFAULT_PINS.managerPin || s.teamPin === DEFAULT_PINS.teamPin;
  const wheelTotal = s.wheel.slots.reduce((n, w) => n + w.slots, 0);
  // Bumped after a reset so the form shows the new values.
  const [formKey, setFormKey] = useState(0);

  const save = (patch: Partial<Settings>) => {
    saveSettings(patch);
    setSaved('Saved');
    setTimeout(() => setSaved(''), 1500);
  };
  const setItem = (id: string, patch: Partial<MenuItem>) => save({ menu: s.menu.map((m) => (m.id === id ? { ...m, ...patch } : m)) });

  const addItem = () =>
    save({
      menu: [...s.menu, { id: newId('item-'), name: 'New item', category: 'bowls', kind: 'bowl', price: 0, unitCost: 0, startStock: 0, active: false }],
    });

  const KIND_FOR: Record<MenuItem['category'], MenuItem['kind'][]> = {
    bowls: ['bowl'],
    fries: ['fries'],
    drinks: ['slushie', 'water'],
    cookies: ['cookie'],
    addons: ['extraSide', 'extraSauce'],
  };

  return (
    <div className="screen setup">
      <TopBar title="Setup" />
      <div className="dash-body" key={formKey}>
        {saved && <div className="toast">{saved}</div>}
        {defaultPins && (
          <p className="error default-pins" role="alert">
            Passcodes are still the defaults anyone can find online. Change all three before the bazaar.
          </p>
        )}

        <section className="panel">
          <h2>Data mode</h2>
          <div className="segmented">
            <button
              className={s.mode === 'demo' ? 'selected' : ''}
              onClick={() => {
                if (s.mode === 'demo') return;
                if (realDayOpen) return setModeMsg(`Close the day first. A real day is open (${realDayOpen.date}): close it on the Dashboard, then switch to demo.`);
                if (confirm('Switch to DEMO (practice)? Every device changes to practice mode. Orders taken in demo are not real sales and do not count.')) {
                  setModeMsg('');
                  save({ mode: 'demo' });
                }
              }}
            >
              Demo (practice)
            </button>
            <button
              className={s.mode === 'live' ? 'selected' : ''}
              onClick={() => {
                if (s.mode !== 'live' && confirm('Switch to REAL data? Demo orders stay separate and will not count in reports.')) {
                  setModeMsg('');
                  save({ mode: 'live' });
                }
              }}
            >
              Real data
            </button>
          </div>
          {modeMsg && (
            <p className="error" role="alert">
              {modeMsg}
            </p>
          )}
          <p className="muted small">Demo and real orders are kept apart. {day ? `A ${day.mode === 'live' ? 'real' : 'demo'} day is open (${day.date}).` : ''}</p>
        </section>

        <StartFreshPanel state={state} />

        <section className="panel wide">
          <h2>Menu</h2>
          <p className="muted small">Prices, unit cost (ingredients + packaging) and starting stock per day. Placeholder values until Step 2 sets the real ones.</p>
          <div className="table-scroll">
            <table className="edit-table">
              <thead>
                <tr>
                  <th>On menu</th>
                  <th>Name (shown everywhere)</th>
                  <th>Tab</th>
                  <th>Type</th>
                  <th>Price ₱</th>
                  <th>Unit cost ₱</th>
                  <th>Start stock</th>
                </tr>
              </thead>
              <tbody>
                {s.menu.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <input type="checkbox" checked={m.active} onChange={(e) => setItem(m.id, { active: e.target.checked })} />
                    </td>
                    <td>
                      <input className="input" defaultValue={m.name} onBlur={(e) => e.target.value !== m.name && setItem(m.id, { name: e.target.value })} />
                    </td>
                    <td>
                      <select className="input" value={m.category} onChange={(e) => { const category = e.target.value as MenuItem['category']; setItem(m.id, { category, kind: KIND_FOR[category][0] }); }}>
                        {Object.keys(KIND_FOR).map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select className="input" value={m.kind} onChange={(e) => setItem(m.id, { kind: e.target.value as MenuItem['kind'] })}>
                        {KIND_FOR[m.category].map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                      {m.kind === 'fries' && (
                        <label className="small">
                          <input type="checkbox" checked={!!m.regular} onChange={(e) => setItem(m.id, { regular: e.target.checked })} /> regular (combos)
                        </label>
                      )}
                    </td>
                    <td>
                      <NumField className="input small-input" label={`${m.name} price`} value={m.price} onSave={(price) => setItem(m.id, { price })} />
                    </td>
                    <td>
                      <NumField className="input small-input" label={`${m.name} unit cost`} decimals value={m.unitCost} onSave={(unitCost) => setItem(m.id, { unitCost })} />
                    </td>
                    <td>
                      <NumField className="input small-input" label={`${m.name} start stock`} value={m.startStock} onSave={(startStock) => setItem(m.id, { startStock })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn small" onClick={addItem}>+ Add item</button>
          <p className="muted small">Starting stock is copied into each new day when the cashier opens it.</p>
        </section>

        <section className="panel wide">
          <h2>What customers see</h2>
          <p className="muted small">
            One-line description and allergens, shown on the customer monitor, cashier tiles and pickers. Tap an allergen to cycle: <b>off → Contains → May contain</b>. Use "May contain" for brand products whose label you still need to check (Knorr, bread crumbs, oil, Oreo, Biscoff…).
          </p>
          <div className="table-scroll">
            <table className="edit-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Description</th>
                  <th>Allergens</th>
                </tr>
              </thead>
              <tbody>
                {s.menu
                  .filter((m) => m.category !== 'addons')
                  .map((m) => (
                    <tr key={m.id}>
                      <td>
                        <b>{m.name}</b>
                      </td>
                      <td>
                        <input className="input" defaultValue={m.description ?? ''} maxLength={70} onBlur={(e) => (e.target.value.trim() || undefined) !== m.description && setItem(m.id, { description: e.target.value.trim() || undefined })} placeholder="e.g. Crispy chicken in garlic butter" />
                      </td>
                      <td>
                        <AllergenPicker value={{ contains: m.allergens, may: m.mayContain }} onChange={(v) => setItem(m.id, { allergens: v.contains, mayContain: v.may })} />
                      </td>
                    </tr>
                  ))}
                {s.sides.map((side) => (
                  <tr key={`side-${side}`}>
                    <td>
                      <b>{side}</b>
                      <div className="muted small">free side</div>
                    </td>
                    <td></td>
                    <td>
                      <AllergenPicker value={s.sideAllergens[side]} onChange={(v) => save({ sideAllergens: { ...s.sideAllergens, [side]: v } })} />
                    </td>
                  </tr>
                ))}
                {s.dips.map((dip) => (
                  <tr key={`dip-${dip}`}>
                    <td>
                      <b>{dip}</b>
                      <div className="muted small">free dip</div>
                    </td>
                    <td></td>
                    <td>
                      <AllergenPicker value={s.dipAllergens[dip]} onChange={(v) => save({ dipAllergens: { ...s.dipAllergens, [dip]: v } })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Photos: send them over and they'll be added to the menu.</p>
        </section>

        <section className="panel">
          <h2>Combos</h2>
          {s.combos.map((c) => (
            <div key={c.id} className="row">
              <label className="small">
                <input type="checkbox" checked={c.active} onChange={(e) => save({ combos: s.combos.map((x) => (x.id === c.id ? { ...x, active: e.target.checked } : x)) })} /> {c.name}
              </label>
              <span className="muted small">{c.parts.join(' + ')}</span>
              <span className="spacer" />
              <span>₱</span>
              <NumField className="input small-input" label={`${c.name} price`} value={c.price} onSave={(price) => save({ combos: s.combos.map((x) => (x.id === c.id ? { ...x, price } : x)) })} />
            </div>
          ))}
          <div className="grid-2">
            <label className="field">
              <span>Extra side ₱</span>
              <NumField value={s.extraSidePrice} onSave={(extraSidePrice) => save({ extraSidePrice })} />
            </label>
            <label className="field">
              <span>Extra sauce ₱</span>
              <NumField value={s.extraSaucePrice} onSave={(extraSaucePrice) => save({ extraSaucePrice })} />
            </label>
          </div>
          <ListEditor label="Bowl sides" values={s.sides} onChange={(sides) => save({ sides })} />
          <ListEditor label="Fries dips" values={s.dips} onChange={(dips) => save({ dips })} />
        </section>

        <section className="panel">
          <h2>Spin-to-Win wheel</h2>
          <label className="row">
            <input type="checkbox" checked={s.wheel.paused} onChange={(e) => save({ wheel: { ...s.wheel, paused: e.target.checked } })} />
            <b>Pause the wheel</b> <span className="muted small">(sell-out days)</span>
          </label>
          <table>
            <thead>
              <tr>
                <th>Prize</th>
                <th>Slots on the wheel</th>
              </tr>
            </thead>
            <tbody>
              {s.wheel.slots.map((w, i) => (
                <tr key={w.prize}>
                  <td>{w.label}</td>
                  <td>
                    <NumField
                      className="input small-input"
                      label={`${w.label} slots`}
                      value={w.slots}
                      onSave={(slots) => save({ wheel: { ...s.wheel, slots: s.wheel.slots.map((x, j) => (j === i ? { ...x, slots } : x)) } })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {wheelTotal !== 20 && (
            <p className="banner warn wheel-warn" role="alert">
              The slots add up to {wheelTotal}, not 20. The real wheel has 20 slots: fix the numbers so the backup wheel has the same chances.
            </p>
          )}
          <p className="muted small">Total slots: {wheelTotal}. Match these to the physical wheel; the digital backup uses the same odds.</p>
          <div className="grid-2">
            <label className="field">
              <span>Voucher amount ₱</span>
              <NumField value={s.voucher.amount} onSave={(amount) => save({ voucher: { ...s.voucher, amount } })} />
            </label>
            <label className="field">
              <span>Voucher minimum order ₱</span>
              <NumField value={s.voucher.minOrder} onSave={(minOrder) => save({ voucher: { ...s.voucher, minOrder } })} />
            </label>
            <label className="field">
              <span>Voucher valid for (selling days, from the next one)</span>
              <NumField min={1} value={s.voucher.validDays} onSave={(validDays) => save({ voucher: { ...s.voucher, validDays } })} />
            </label>
          </div>
        </section>

        <section className="panel">
          <h2>Payments</h2>
          <label className="row">
            <input type="checkbox" checked={s.payments.gcash} onChange={(e) => save({ payments: { ...s.payments, gcash: e.target.checked } })} />
            <b>Accept GCash</b>
          </label>
          <label className="field">
            <span>GCash number to show on the customer screen (optional)</span>
            <input className="input" inputMode="tel" defaultValue={s.payments.gcashNumber} onBlur={(e) => e.target.value.trim() !== s.payments.gcashNumber && save({ payments: { ...s.payments, gcashNumber: e.target.value.trim() } })} placeholder="09XX XXX XXXX" />
          </label>
          <p className="muted small">When the cashier picks GCash, the customer screen shows the GCash QR and the amount.</p>
        </section>

        <section className="panel">
          <h2>Prize limit</h2>
          <label className="row">
            <input type="checkbox" checked={!s.promoLimits.off} onChange={(e) => save({ promoLimits: { ...s.promoLimits, off: !e.target.checked } })} />
            <b>Warn the cashier when prizes run high</b>
          </label>
          {!s.promoLimits.off && (
            <div className="grid-2">
              <label className="field">
                <span>Warn the cashier at (% of sales)</span>
                <NumField decimals max={100} value={s.promoLimits.warnPct} onSave={(warnPct) => save({ promoLimits: { ...s.promoLimits, warnPct } })} />
              </label>
              <label className="field">
                <span>Ask to pause the wheel at (% of sales)</span>
                <NumField decimals max={100} value={s.promoLimits.pausePct} onSave={(pausePct) => save({ promoLimits: { ...s.promoLimits, pausePct } })} />
              </label>
              <label className="field">
                <span>Start checking after sales of (₱)</span>
                <NumField value={s.promoLimits.minSales} onSave={(minSales) => save({ promoLimits: { ...s.promoLimits, minSales } })} />
              </label>
            </div>
          )}
          <p className="muted small">Counts wheel prizes at what they cost the booth (ingredients of free meals and free items, plus ₱10-off cash) and vouchers used. The wheel now gives a spin for every item bought, so a normal day is about 8 to 10%.</p>
        </section>

        <section className="panel">
          <h2>Boom Card</h2>
          <div className="grid-2">
            <label className="field">
              <span>Boom Card number prefix</span>
              <input className="input" defaultValue={s.loyalty.prefix} onBlur={(e) => e.target.value !== s.loyalty.prefix && save({ loyalty: { ...s.loyalty, prefix: e.target.value } })} />
            </label>
            <label className="field">
              <span>Stamps to fill a Boom Card</span>
              <NumField min={2} value={s.loyalty.cardSize} onSave={(cardSize) => save({ loyalty: { ...s.loyalty, cardSize } })} />
            </label>
            <label className="field">
              <span>First Boom Card number</span>
              <NumField min={1} max={s.loyalty.last} value={s.loyalty.first} onSave={(first) => save({ loyalty: { ...s.loyalty, first } })} />
            </label>
            <label className="field">
              <span>Last Boom Card number</span>
              <NumField min={Math.max(1, s.loyalty.first)} value={s.loyalty.last} onSave={(last) => save({ loyalty: { ...s.loyalty, last } })} />
            </label>
          </div>
          <table>
            <thead>
              <tr>
                <th>At stamp</th>
                <th>Reward (placeholder until Step 2)</th>
              </tr>
            </thead>
            <tbody>
              {s.loyalty.rewards.map((r, i) => (
                <tr key={i}>
                  <td>{r.at}</td>
                  <td>
                    <input className="input" defaultValue={r.label} onBlur={(e) => e.target.value !== r.label && save({ loyalty: { ...s.loyalty, rewards: s.loyalty.rewards.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) } })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="row small">
            <input type="checkbox" checked={s.loyalty.rewardOrderEarnsStamp} onChange={(e) => save({ loyalty: { ...s.loyalty, rewardOrderEarnsStamp: e.target.checked } })} />
            An order that uses a reward still earns its stamp
          </label>
          <p className="muted small">After the {s.loyalty.cardSize}-stamp reward is used, the card starts again at 0.</p>
        </section>

        <section className="panel">
          <h2>Team, PINs and screens</h2>
          <ListEditor label="Cashier names" values={s.cashiers} onChange={(cashiers) => save({ cashiers })} />
          <Passcodes s={s} save={save} />
          <div className="grid-2">
            <label className="field">
              <span>Daily sales goal ₱</span>
              <NumField value={s.dailyGoal} onSave={(dailyGoal) => save({ dailyGoal })} />
            </label>
            <label className="field">
              <span>Kitchen card turns red after (min)</span>
              <NumField min={1} value={s.kitchenLateMinutes} onSave={(kitchenLateMinutes) => save({ kitchenLateMinutes })} />
            </label>
            <label className="field">
              <span>"Now serving" number stays up for (min)</span>
              <NumField min={1} value={s.servingClearMinutes} onSave={(servingClearMinutes) => save({ servingClearMinutes })} />
            </label>
            <label className="field">
              <span>Monitor shows "Only N left!" at</span>
              <NumField value={s.lowStockAlert} onSave={(lowStockAlert) => save({ lowStockAlert })} />
            </label>
            <label className="field">
              <span>Wait estimate before any order is done (min)</span>
              <NumField min={1} value={s.defaultWaitMinutes} onSave={(defaultWaitMinutes) => save({ defaultWaitMinutes })} />
            </label>
          </div>
        </section>

        <BazaarDays s={s} save={save} />

        <section className="panel wide">
          <h2>Ingredients: how much one item uses (optional)</h2>
          <p className="muted small">
            Fill these in once you know your recipe amounts (e.g. one bowl uses 0.15 kg chicken). The Inventory page then counts down by itself and shows how many servings are left. Leave blank to count by hand only.
          </p>
          <div className="table-scroll">
            <table className="edit-table">
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>Low at</th>
                  {s.menu
                    .filter((m) => m.active && m.category !== 'addons')
                    .map((m) => (
                      <th key={m.id} title={m.name}>
                        {m.name.replace(' Chicken Rice Bowl', ' bowl').replace(' Cookie', '')}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {s.ingredients.map((ing) => (
                  <tr key={ing.id}>
                    <td>
                      <b>{ing.name}</b> <span className="muted small">({ing.unit})</span>
                    </td>
                    <td>
                      <NumField
                        className="input tiny-input"
                        decimals
                        blankZero
                        label={`${ing.name} low at`}
                        value={ing.low}
                        onSave={(low) => save({ ingredients: s.ingredients.map((x) => (x.id === ing.id ? { ...x, low } : x)) })}
                      />
                    </td>
                    {s.menu
                      .filter((m) => m.active && m.category !== 'addons')
                      .map((m) => (
                        <td key={m.id}>
                          <NumField
                            className="input tiny-input"
                            decimals
                            blankZero
                            label={`${ing.name} per ${m.name}`}
                            value={ing.uses?.[m.id] ?? 0}
                            onSave={(v) => {
                              const uses = { ...(ing.uses ?? {}) };
                              if (v > 0) uses[m.id] = v;
                              else delete uses[m.id];
                              save({ ingredients: s.ingredients.map((x) => (x.id === ing.id ? { ...x, uses } : x)) });
                            }}
                          />
                        </td>
                      ))}
                    <td>
                      <button className="btn ghost small danger-text" onClick={() => confirm(`Remove ${ing.name} from inventory?`) && save({ ingredients: s.ingredients.filter((x) => x.id !== ing.id) })}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <h2>This device</h2>
          <SyncInfo />
          <label className="field">
            <span>Order letter for this device</span>
            <input className="input small-input" maxLength={1} defaultValue={device.orderLetter} onBlur={(e) => {
              const letter = e.target.value.toUpperCase().replace(/[^A-Z]/g, '') || 'A';
              e.target.value = letter;
              if (letter !== device.orderLetter) setDevice({ orderLetter: letter });
            }} />
          </label>
          <p className="muted small">Laptop = A. If the tablet ever takes orders as a backup cashier, set it to B so numbers never clash.</p>
          <button className="btn ghost small" onClick={() => {
              if (confirm('Reset the menu, prices, passcodes, wheel and ingredients to the starting values? The data mode (demo or real) stays as it is. Orders are not touched.')) {
                // The passcodes go back to the built-in ones; keep this tab open.
                keepUnlocked('Setup', DEFAULT_PINS.adminPin);
                resetSettings();
                setFormKey((k) => k + 1);
              }
            }}>
            Reset settings to defaults
          </button>
        </section>
      </div>
    </div>
  );
}

/** How much a "Start fresh" would remove for one data mode. */
function countsFor(state: State, mode: DataMode) {
  return {
    orders: Object.values(state.orders).filter((o) => o.mode === mode).length,
    days: Object.values(state.days).filter((d) => d.mode === mode).length,
    cards: Object.values(state.cards).filter((c) => c.mode === mode).length,
    cash: Object.values(state.cashMoves).filter((m) => m.mode === mode).length,
    open: Object.values(state.days).find((d) => d.mode === mode && !d.closedAt),
  };
}

/**
 * Clear practice data, or clear the real data to start the bazaar fresh.
 * Needs the Setup passcode; clearing real data also needs CLEAR typed.
 * A backup file is downloaded first, every time.
 */
function StartFreshPanel({ state }: { state: State }) {
  const [mode, setMode] = useState<DataMode | null>(null);
  const [done, setDone] = useState('');
  const demo = countsFor(state, 'demo');
  const live = countsFor(state, 'live');
  const line = (c: ReturnType<typeof countsFor>) => `${c.orders} order${c.orders === 1 ? '' : 's'}, ${c.days} day${c.days === 1 ? '' : 's'}, ${c.cards} Boom Card record${c.cards === 1 ? '' : 's'}, ${c.cash} cash entr${c.cash === 1 ? 'y' : 'ies'}`;
  return (
    <section className="panel start-fresh">
      <h2>Start fresh</h2>
      <p className="muted small">
        Clears orders, business days, cash in/out and Boom Card records on <b>every device</b>, so practice sales never mix with the bazaar numbers. Menu, prices and passcodes stay. A backup file downloads first.
      </p>
      <div className="row">
        <button className="btn danger" onClick={() => { setDone(''); setMode('demo'); }}>
          Clear practice (demo) data
        </button>
        <span className="muted small">{line(demo)}</span>
      </div>
      <div className="row">
        <button className="btn danger" onClick={() => { setDone(''); setMode('live'); }}>
          Clear real data (start the bazaar fresh)
        </button>
        <span className="muted small">{line(live)}</span>
      </div>
      {done && <p className="ok-note">{done}</p>}
      {mode && <StartFreshConfirm mode={mode} counts={mode === 'demo' ? demo : live} pin={state.settings.adminPin} onDone={(msg) => { setDone(msg); setMode(null); }} onClose={() => setMode(null)} />}
    </section>
  );
}

function StartFreshConfirm({ mode, counts, pin, onDone, onClose }: { mode: DataMode; counts: ReturnType<typeof countsFor>; pin: string; onDone: (msg: string) => void; onClose: () => void }) {
  const real = mode === 'live';
  const [code, setCode] = useState('');
  const [word, setWord] = useState('');
  const [error, setError] = useState('');
  const submit = () => {
    if (counts.open) return setError(`A ${real ? 'real' : 'practice'} day is open (${counts.open.date}). Close it on the Dashboard first.`);
    if (code !== pin) return setError('Wrong passcode. Use the Dashboard and Setup passcode.');
    if (real && word.trim().toUpperCase() !== 'CLEAR') return setError('Type CLEAR in the box to confirm.');
    download(`chick-chick-boom-backup-before-clearing-${real ? 'real' : 'demo'}-${new Date().toISOString().slice(0, 10)}.json`, exportBackup(), 'application/json');
    const r = startFresh(mode);
    onDone(`${real ? 'Real' : 'Practice'} data cleared on every device: ${r.orders} order${r.orders === 1 ? '' : 's'} and ${r.days} day${r.days === 1 ? '' : 's'} removed. The backup file is in your downloads.`);
  };
  return (
    <Modal title={real ? 'Clear real data?' : 'Clear practice data?'} onClose={onClose}>
      <div className="stack">
        <p>
          This removes <b>{counts.orders}</b> {real ? 'real' : 'practice'} orders, <b>{counts.days}</b> business days, {counts.cash} cash entries and {counts.cards} Boom Card records from <b>every device</b>. It cannot be undone here (only by restoring the backup file).
        </p>
        {real && <p className="error">Only do this before the bazaar starts, to remove test sales made in Real mode. Never during the bazaar.</p>}
        <label className="field">
          <span>Dashboard and Setup passcode</span>
          <input className="input" type="password" inputMode="numeric" autoFocus value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 8)); setError(''); }} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>
        {real && (
          <label className="field">
            <span>Type CLEAR to confirm</span>
            <input className="input" value={word} onChange={(e) => { setWord(e.target.value); setError(''); }} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </label>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button className="btn danger" onClick={submit}>
            {real ? 'Clear real data' : 'Clear practice data'}
          </button>
          <button className="btn ghost" onClick={onClose}>
            Keep everything
          </button>
        </div>
      </div>
    </Modal>
  );
}
