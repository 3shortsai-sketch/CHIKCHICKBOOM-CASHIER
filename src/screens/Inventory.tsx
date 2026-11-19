import { useMemo, useState } from 'react';
import { isLow, onHand, servingsLeft } from '../domain/inventory';
import { newId } from '../domain/pricing';
import { stockLeft } from '../domain/reports';
import type { BusinessDay, Ingredient, MenuItem, Settings, WasteEntry } from '../domain/types';
import { appendToDay, modeOrders, openDay, patchDay, saveSettings, useDevice, useStore } from '../data/store';
import { TopBar } from '../ui/TopBar';

const CATEGORY_LABEL: Record<MenuItem['category'], string> = { bowls: 'Rice bowls', fries: 'Fries', drinks: 'Drinks', cookies: 'Cookies', addons: 'Add-ons' };

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * A small number field with a button: "Set count" or "Remove".
 * `min` and `max` are the smallest and largest amount allowed; `hint` says why the button is off.
 */
function QtyAction({
  label,
  placeholder,
  onSubmit,
  decimals,
  danger,
  min = 0,
  max,
  hint,
}: {
  label: string;
  placeholder: string;
  onSubmit: (n: number) => void;
  decimals?: boolean;
  danger?: boolean;
  min?: number;
  max?: number;
  hint?: string;
}) {
  const [v, setV] = useState('');
  const n = Number(v);
  const valid = v !== '' && Number.isFinite(n);
  const ok = valid && n >= min && (max === undefined || n <= max);
  const go = () => {
    if (!ok) return;
    onSubmit(n);
    setV('');
  };
  return (
    <div className="qty-action">
      <input
        className="input"
        inputMode={decimals ? 'decimal' : 'numeric'}
        value={v}
        placeholder={placeholder}
        aria-label={`${label} amount`}
        onChange={(e) => setV(e.target.value.replace(decimals ? /[^\d.]/g : /\D/g, ''))}
        onKeyDown={(e) => e.key === 'Enter' && go()}
      />
      <button className={`btn small ${danger ? 'danger' : ''}`} disabled={!ok} onClick={go}>
        {label}
      </button>
      {valid && !ok && hint && (
        <small className="qty-hint" role="alert">
          {hint}
        </small>
      )}
    </div>
  );
}

function ItemRow({ m, left, day, who }: { m: MenuItem; left: number; day: BusinessDay; who: string }) {
  const count = day.stockCounts?.[m.id];
  const [reason, setReason] = useState('Broken');
  const low = left <= 5;
  const canRemove = Math.max(0, Math.floor(left));
  return (
    <tr className={left <= 0 ? 'out-row' : low ? 'warn-row' : ''}>
      <td>
        <b>{m.name}</b>
        <div className="muted small">{count ? `Counted ${count.qty} at ${new Date(count.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} by ${count.by}` : `Opening stock ${day.stockStart[m.id] ?? m.startStock}`}</div>
      </td>
      <td className="inv-left">
        <b className="display">{Math.max(0, left)}</b>
        <span className="muted small">left</span>
      </td>
      <td>
        <QtyAction label="Set count" placeholder="We have…" onSubmit={(n) => patchDay(day.id, { stockCounts: { ...(day.stockCounts ?? {}), [m.id]: { qty: n, at: Date.now(), by: who } } })} />
      </td>
      <td>
        <div className="qty-remove">
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
            {['Broken', 'Dropped', 'Spoiled', 'Wrong order made', 'Taste test'].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <QtyAction
            label="Remove"
            placeholder="How many"
            danger
            min={1}
            max={canRemove}
            hint={canRemove < 1 ? 'None left to remove.' : `Type 1 to ${canRemove}.`}
            onSubmit={(n) => {
              // One entry is added, so a waste entry made on another device at the same time is kept.
              const entry: WasteEntry = { id: newId('w'), itemId: m.id, qty: n, reason, at: Date.now(), by: who };
              appendToDay(day.id, 'waste', entry);
            }}
          />
        </div>
      </td>
    </tr>
  );
}

function IngredientRow({ ing, s, orders, who }: { ing: Ingredient; s: Settings; orders: ReturnType<typeof modeOrders>; who: string }) {
  const have = onHand(ing, orders);
  const low = isLow(ing, orders);
  const update = (patch: Partial<Ingredient>) => saveSettings({ ingredients: s.ingredients.map((x) => (x.id === ing.id ? { ...x, ...patch } : x)) });
  const covers = Object.keys(ing.uses ?? {})
    .map((id) => {
      const n = servingsLeft(ing, orders, id);
      const item = s.menu.find((m) => m.id === id);
      return n !== null && item ? `≈ ${n} ${item.name}` : null;
    })
    .filter(Boolean);
  return (
    <tr className={low ? 'warn-row' : ''}>
      <td>
        <b>{ing.name}</b>
        <div className="muted small">
          {ing.count ? `Counted ${fmt(ing.count.qty)} ${ing.unit} at ${new Date(ing.count.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} by ${ing.count.by}` : 'Not counted yet'}
          {covers.length > 0 && ` · enough for ${covers.join(', ')}`}
        </div>
      </td>
      <td className="inv-left">
        {have === null ? (
          <span className="muted">—</span>
        ) : (
          <>
            <b className="display">{fmt(have)}</b>
            <span className="muted small">{ing.unit}</span>
          </>
        )}
        {low && <span className="low-tag">LOW</span>}
      </td>
      <td>
        <QtyAction label="Set count" placeholder={`We have… ${ing.unit}`} decimals onSubmit={(n) => update({ count: { qty: n, at: Date.now(), by: who }, removed: [] })} />
      </td>
      <td>
        <QtyAction
          label="Remove"
          placeholder={`Spoiled/used ${ing.unit}`}
          decimals
          danger
          min={0.01}
          max={have === null ? undefined : Math.max(0, have)}
          hint={have === null ? 'Type more than 0.' : have <= 0 ? 'None left to remove.' : `Type up to ${fmt(have)}.`}
          onSubmit={(n) => {
            if (!ing.count) return update({ count: { qty: 0, at: Date.now(), by: who } });
            if (n > 0) update({ removed: [...(ing.removed ?? []), { qty: n, reason: 'Removed', at: Date.now(), by: who }] });
          }}
        />
      </td>
    </tr>
  );
}

export function Inventory() {
  const state = useStore((st) => st);
  const s = state.settings;
  const device = useDevice();
  const day = openDay(state);
  const orders = useMemo(() => modeOrders(state), [state]);
  const left = useMemo(() => stockLeft(day, orders, s), [day, orders, s]);
  const [who, setWho] = useState(device.cashier || 'Kitchen');
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('kg');
  const lowCount = s.ingredients.filter((i) => isLow(i, orders)).length;

  return (
    <div className="screen inventory">
      <TopBar title="Inventory">
        <a className="btn small" href="#kitchen">
          ← Kitchen
        </a>
      </TopBar>
      <div className="dash-body">
        <div className="row">
          <label className="field inline">
            <span>Updated by</span>
            <input className="input small-input wide-input" value={who} onChange={(e) => setWho(e.target.value)} />
          </label>
          {lowCount > 0 && <span className="banner warn">{lowCount} ingredient{lowCount > 1 ? 's are' : ' is'} running low</span>}
        </div>

        <section className="panel">
          <h2>Menu items today</h2>
          {!day ? (
            <p className="muted">The cashier hasn't opened the day yet. Item counts start once the day is open.</p>
          ) : (
            <div className="table-scroll">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Left</th>
                    <th>We counted</th>
                    <th>Broke or wasted</th>
                  </tr>
                </thead>
                {(['bowls', 'fries', 'drinks', 'cookies'] as const).map((cat) => (
                  <tbody key={cat}>
                    <tr className="inv-cat">
                      <td colSpan={4}>{CATEGORY_LABEL[cat]}</td>
                    </tr>
                    {s.menu
                      .filter((m) => m.active && m.category === cat)
                      .map((m) => (
                        <ItemRow key={m.id} m={m} left={left[m.id] ?? 0} day={day} who={who || 'Kitchen'} />
                      ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
          <p className="muted small">
            "Set count" replaces the number with what you actually have; sales after that keep counting down. "Remove" takes broken or wasted pieces out and adds their cost to waste.
          </p>
        </section>

        <section className="panel">
          <h2>Ingredients and supplies</h2>
          <div className="table-scroll">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>On hand</th>
                  <th>We counted</th>
                  <th>Spoiled or used up</th>
                </tr>
              </thead>
              <tbody>
                {s.ingredients.map((ing) => (
                  <IngredientRow key={ing.id} ing={ing} s={s} orders={orders} who={who || 'Kitchen'} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="row add-ingredient">
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Add an ingredient, e.g. Butter" />
            <select className="input small-input" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} aria-label="Unit">
              {['kg', 'g', 'L', 'pcs', 'pack', 'bottle', 'can'].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
            <button
              className="btn"
              disabled={!newName.trim()}
              onClick={() => {
                saveSettings({ ingredients: [...s.ingredients, { id: newId('ing-'), name: newName.trim(), unit: newUnit, low: 0 }] });
                setNewName('');
              }}
            >
              Add
            </button>
          </div>
          <p className="muted small">
            Count ingredients when you open and whenever you check. If "how much one item uses" is filled in Setup, the app also counts down as orders come in and shows how many servings are left.
          </p>
        </section>
      </div>
    </div>
  );
}
