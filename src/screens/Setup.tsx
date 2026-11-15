import { useState } from 'react';
import { newId } from '../domain/pricing';
import type { MenuItem, Settings } from '../domain/types';
import { clearDemoData, openDay, resetSettings, saveSettings, setDevice, useDevice, useStore } from '../data/store';
import { TopBar } from '../ui/TopBar';
import { PinGate } from '../ui/ui';

export function Setup() {
  const pin = useStore((s) => s.settings.adminPin);
  return (
    <PinGate pin={pin} label="Setup">
      <SetupInner />
    </PinGate>
  );
}

const num = (v: string) => Number(v.replace(/[^\d.]/g, '') || 0);

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
        onBlur={() => onChange(text.split('\n').map((x) => x.trim()).filter(Boolean))}
      />
    </label>
  );
}

function SetupInner() {
  const state = useStore((st) => st);
  const s = state.settings;
  const device = useDevice();
  const day = openDay(state);
  const [saved, setSaved] = useState('');
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

        <section className="panel">
          <h2>Data mode</h2>
          <div className="segmented">
            <button className={s.mode === 'demo' ? 'selected' : ''} onClick={() => save({ mode: 'demo' })}>
              Demo (practice)
            </button>
            <button
              className={s.mode === 'live' ? 'selected' : ''}
              onClick={() => {
                if (s.mode !== 'live' && confirm('Switch to REAL data? Demo orders stay separate and will not count in reports.')) save({ mode: 'live' });
              }}
            >
              Real data
            </button>
          </div>
          <p className="muted small">Demo and real orders are kept apart. {day ? `A ${day.mode} day is open (${day.date}).` : ''}</p>
          <button className="btn danger small" onClick={() => confirm('Delete ALL demo orders and demo days on this device?') && clearDemoData()}>
            Clear demo data
          </button>
        </section>

        <section className="panel wide">
          <h2>Menu</h2>
          <p className="muted small">Prices, unit cost (ingredients + packaging) and starting stock per day. Placeholder values until Step 2 sets the real ones.</p>
          <div className="table-scroll">
            <table className="edit-table">
              <thead>
                <tr>
                  <th>On menu</th>
                  <th>Name</th>
                  <th>Short name</th>
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
                      <input className="input" defaultValue={m.name} onBlur={(e) => setItem(m.id, { name: e.target.value })} />
                    </td>
                    <td>
                      <input className="input" defaultValue={m.short ?? ''} onBlur={(e) => setItem(m.id, { short: e.target.value || undefined })} />
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
                      <input className="input small-input" inputMode="numeric" defaultValue={m.price} onBlur={(e) => setItem(m.id, { price: num(e.target.value) })} />
                    </td>
                    <td>
                      <input className="input small-input" inputMode="decimal" defaultValue={m.unitCost} onBlur={(e) => setItem(m.id, { unitCost: num(e.target.value) })} />
                    </td>
                    <td>
                      <input className="input small-input" inputMode="numeric" defaultValue={m.startStock} onBlur={(e) => setItem(m.id, { startStock: num(e.target.value) })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn small" onClick={addItem}>+ Add item</button>
          <p className="muted small">Starting stock is copied into each new day when the cashier opens it.</p>
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
              <input className="input small-input" inputMode="numeric" defaultValue={c.price} onBlur={(e) => save({ combos: s.combos.map((x) => (x.id === c.id ? { ...x, price: num(e.target.value) } : x)) })} />
            </div>
          ))}
          <div className="grid-2">
            <label className="field">
              <span>Extra side ₱</span>
              <input className="input" inputMode="numeric" defaultValue={s.extraSidePrice} onBlur={(e) => save({ extraSidePrice: num(e.target.value) })} />
            </label>
            <label className="field">
              <span>Extra sauce ₱</span>
              <input className="input" inputMode="numeric" defaultValue={s.extraSaucePrice} onBlur={(e) => save({ extraSaucePrice: num(e.target.value) })} />
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
                    <input
                      className="input small-input"
                      inputMode="numeric"
                      defaultValue={w.slots}
                      onBlur={(e) => save({ wheel: { ...s.wheel, slots: s.wheel.slots.map((x, j) => (j === i ? { ...x, slots: num(e.target.value) } : x)) } })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Total slots: {s.wheel.slots.reduce((n, w) => n + w.slots, 0)}. Match these to the physical wheel; the digital backup uses the same odds.</p>
          <div className="grid-2">
            <label className="field">
              <span>Voucher amount ₱</span>
              <input className="input" inputMode="numeric" defaultValue={s.voucher.amount} onBlur={(e) => save({ voucher: { ...s.voucher, amount: num(e.target.value) } })} />
            </label>
            <label className="field">
              <span>Voucher minimum order ₱</span>
              <input className="input" inputMode="numeric" defaultValue={s.voucher.minOrder} onBlur={(e) => save({ voucher: { ...s.voucher, minOrder: num(e.target.value) } })} />
            </label>
            <label className="field">
              <span>Voucher valid for (days after it was won)</span>
              <input className="input" inputMode="numeric" defaultValue={s.voucher.validDays} onBlur={(e) => save({ voucher: { ...s.voucher, validDays: Math.max(1, num(e.target.value)) } })} />
            </label>
          </div>
        </section>

        <section className="panel">
          <h2>Loyalty card</h2>
          <div className="grid-2">
            <label className="field">
              <span>Card prefix</span>
              <input className="input" defaultValue={s.loyalty.prefix} onBlur={(e) => save({ loyalty: { ...s.loyalty, prefix: e.target.value } })} />
            </label>
            <label className="field">
              <span>Stamps to fill a card</span>
              <input className="input" inputMode="numeric" defaultValue={s.loyalty.cardSize} onBlur={(e) => save({ loyalty: { ...s.loyalty, cardSize: num(e.target.value) } })} />
            </label>
            <label className="field">
              <span>First card number</span>
              <input className="input" inputMode="numeric" defaultValue={s.loyalty.first} onBlur={(e) => save({ loyalty: { ...s.loyalty, first: num(e.target.value) } })} />
            </label>
            <label className="field">
              <span>Last card number</span>
              <input className="input" inputMode="numeric" defaultValue={s.loyalty.last} onBlur={(e) => save({ loyalty: { ...s.loyalty, last: num(e.target.value) } })} />
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
                    <input className="input" defaultValue={r.label} onBlur={(e) => save({ loyalty: { ...s.loyalty, rewards: s.loyalty.rewards.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) } })} />
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
          <div className="grid-2">
            <label className="field">
              <span>Manager PIN (voids & refunds)</span>
              <input className="input" inputMode="numeric" defaultValue={s.managerPin} onBlur={(e) => e.target.value.length >= 4 && save({ managerPin: e.target.value })} />
            </label>
            <label className="field">
              <span>Dashboard & Setup PIN</span>
              <input className="input" inputMode="numeric" defaultValue={s.adminPin} onBlur={(e) => e.target.value.length >= 4 && save({ adminPin: e.target.value })} />
            </label>
            <label className="field">
              <span>Daily sales goal ₱</span>
              <input className="input" inputMode="numeric" defaultValue={s.dailyGoal} onBlur={(e) => save({ dailyGoal: num(e.target.value) })} />
            </label>
            <label className="field">
              <span>Kitchen card turns red after (min)</span>
              <input className="input" inputMode="numeric" defaultValue={s.kitchenLateMinutes} onBlur={(e) => save({ kitchenLateMinutes: num(e.target.value) })} />
            </label>
            <label className="field">
              <span>"Now serving" number stays up for (min)</span>
              <input className="input" inputMode="numeric" defaultValue={s.servingClearMinutes} onBlur={(e) => save({ servingClearMinutes: num(e.target.value) })} />
            </label>
          </div>
          <p className="muted small">PINs need at least 4 digits. Change both from the defaults (1234 / 0000) before the event.</p>
        </section>

        <section className="panel">
          <h2>This device</h2>
          <label className="field">
            <span>Order letter for this device</span>
            <input className="input small-input" maxLength={1} defaultValue={device.orderLetter} onBlur={(e) => setDevice({ orderLetter: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') || 'A' })} />
          </label>
          <p className="muted small">Laptop = A. If the tablet ever takes orders as a backup cashier, set it to B so numbers never clash.</p>
          <button className="btn ghost small" onClick={() => {
              if (confirm('Reset ALL settings (menu, prices, PINs) to the starting values?')) {
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
