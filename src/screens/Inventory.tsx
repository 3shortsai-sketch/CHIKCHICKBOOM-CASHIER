import { useMemo, useRef, useState } from 'react';
import { isLow, onHand, servingsLeft } from '../domain/inventory';
import { blankList, EXAMPLE, importPrompt, parseInventory, planInventory, planUndo, summary, type Plan, type Row, type UndoInfo } from '../domain/inventoryImport';
import { newId } from '../domain/pricing';
import { stockLeft } from '../domain/reports';
import type { BusinessDay, Ingredient, MenuItem, Settings, WasteEntry } from '../domain/types';
import { appendToDay, modeOrders, openDay, patchDay, saveSettings, useDevice, useStore } from '../data/store';
import { TopBar } from '../ui/TopBar';
import { download } from '../ui/ui';

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

/** "3 ingredients", "1 ingredient". */
function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Put text on the clipboard; older browsers get the select-and-copy way. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement('textarea');
    box.value = text;
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    box.remove();
    return ok;
  }
}

/** Make the store calls of an import (or of its undo): one for the day, one for settings. */
function runPlan(plan: Pick<Plan, 'stockCounts' | 'menu' | 'ingredients'>, day: BusinessDay | undefined) {
  if (plan.stockCounts && day) patchDay(day.id, { stockCounts: plan.stockCounts });
  if (plan.menu || plan.ingredients) saveSettings({ ...(plan.menu ? { menu: plan.menu } : {}), ...(plan.ingredients ? { ingredients: plan.ingredients } : {}) });
}

/**
 * Load many counts at once: paste a list (or pick a file), check the preview, apply.
 * Problem lines never stop the good ones. The last import can be undone until the screen is left.
 */
function ImportPanel({ s, day, orders, left, who }: { s: Settings; day: BusinessDay | undefined; orders: ReturnType<typeof modeOrders>; left: Record<string, number>; who: string }) {
  const [text, setText] = useState('');
  /** Line numbers of new ingredients the user unticked. */
  const [skip, setSkip] = useState<number[]>([]);
  const [alsoStart, setAlsoStart] = useState(false);
  const [done, setDone] = useState<{ note: string; undo?: UndoInfo } | null>(null);
  const [fileNote, setFileNote] = useState('');
  const [copyNote, setCopyNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const { rows, blank } = useMemo(() => parseInventory(text, s), [text, s]);
  const sum = summary(rows);
  const newRows = rows.filter((r) => r.kind === 'new');
  const adding = newRows.filter((r) => !skip.includes(r.line)).length;
  const valid = sum.menu + sum.ingredient + adding;
  const prompt = useMemo(() => importPrompt(s), [s]);

  const change = (value: string) => {
    setText(value);
    setSkip([]);
    if (value.trim()) setDone(null);
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    if (/\.(xlsx?|numbers|ods|pdf|png|jpe?g)$/i.test(file.name)) {
      setFileNote('That file cannot be read here. In Excel or Sheets, save or download it as CSV first.');
      return;
    }
    change(await file.text());
    setFileNote(`Loaded ${file.name}.`);
  };

  const apply = () => {
    const plan = planInventory(rows, { settings: s, day, who, now: Date.now(), alsoStart, skipNew: skip, newId: () => newId('ing-') });
    runPlan(plan, day);
    const parts = [
      plan.done.menu ? count(plan.done.menu, 'menu item') : '',
      plan.done.ingredient ? count(plan.done.ingredient, 'ingredient') : '',
      plan.done.added ? `${count(plan.done.added, 'new ingredient')} added` : '',
    ].filter(Boolean);
    setDone({ note: `Counts updated: ${parts.join(', ')}.`, undo: plan.undo });
    setText('');
    setSkip([]);
    setFileNote('');
  };

  const undo = () => {
    if (!done?.undo) return;
    runPlan(planUndo(done.undo, s, day), day);
    setDone({ note: 'Undone. The counts are back to what they were.' });
  };

  /** The number we have now, to show next to the new one. */
  const before = (r: Row): string => {
    if (r.kind === 'menu' && r.id) return String(Math.max(0, day ? (left[r.id] ?? 0) : (s.menu.find((m) => m.id === r.id)?.startStock ?? 0)));
    const ing = r.kind === 'ingredient' ? s.ingredients.find((i) => i.id === r.id) : undefined;
    const have = ing ? onHand(ing, orders) : null;
    return have === null ? '–' : fmt(have);
  };

  return (
    <section className="panel imp">
      <h2>Import counts</h2>
      <p className="muted small imp-lead">
        Load all your counts in one go. Write one line for each thing: the name, a comma, then the amount. Like this:
      </p>
      <pre className="imp-example">{EXAMPLE}</pre>

      <textarea
        className="input imp-text"
        rows={6}
        value={text}
        placeholder="Paste your list here"
        aria-label="Your list of counts"
        spellCheck={false}
        onChange={(e) => {
          change(e.target.value);
          setFileNote('');
        }}
      />
      <div className="row imp-tools">
        <button className="btn small" onClick={() => fileRef.current?.click()}>
          Choose a file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          hidden
          aria-label="File with your counts"
          onChange={(e) => {
            void pickFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button className="btn small" onClick={() => download('stock-count-list.csv', blankList(s), 'text/csv')}>
          Download a blank list
        </button>
        <button
          className="btn small"
          onClick={async () => {
            const ok = await copyText(prompt);
            setCopyNote(ok ? 'Copied. Paste it into Claude with a screenshot of your sheet, then paste the answer here.' : 'Could not copy. Tap "Show the prompt" and copy it by hand.');
          }}
        >
          Copy the prompt for Claude
        </button>
        {text && (
          <button className="link-btn" onClick={() => change('')}>
            Clear
          </button>
        )}
      </div>
      {fileNote && (
        <p className="muted small" role="status">
          {fileNote}
        </p>
      )}
      {copyNote && (
        <p className="imp-ok small" role="status">
          {copyNote}
        </p>
      )}
      <p className="muted small">
        The blank list has every name filled in: open it in Excel or Sheets, type the amounts, then choose the file here. Have a sheet already? Copy the prompt, send it to Claude with a screenshot of your sheet, and paste the answer in the box.
      </p>
      <details className="imp-prompt">
        <summary>Show the prompt</summary>
        <textarea className="input" rows={10} readOnly value={prompt} aria-label="Prompt for Claude" onFocus={(e) => e.target.select()} />
      </details>

      {rows.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="imp-table">
              <thead>
                <tr>
                  <th>You wrote</th>
                  <th>Goes to</th>
                  <th>Now → new</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line} className={r.kind === 'error' ? 'imp-bad' : ''}>
                    <td className="imp-raw">{r.name}</td>
                    <td>
                      {r.kind === 'menu' && <span className="imp-ok">✔ menu item{r.close ? `: ${r.matchedName}` : ''}</span>}
                      {r.kind === 'ingredient' && <span className="imp-ok">✔ ingredient{r.close ? `: ${r.matchedName}` : ''}</span>}
                      {r.kind === 'new' && (
                        <label className="imp-new">
                          <input type="checkbox" checked={!skip.includes(r.line)} onChange={(e) => setSkip(e.target.checked ? skip.filter((n) => n !== r.line) : [...skip, r.line])} />
                          <span>＋ new ingredient ({r.unit})</span>
                        </label>
                      )}
                      {r.kind === 'error' && <span className="imp-err">✖ {r.problem}</span>}
                    </td>
                    <td className="imp-num">
                      {r.kind === 'error' ? (
                        ''
                      ) : (
                        <>
                          {r.typed && <span className="muted small imp-typed">{r.typed} → </span>}
                          <span className="muted">{before(r)} → </span>
                          <b>{fmt(r.amount)}</b>
                          {r.kind !== 'menu' && r.unit ? ` ${r.kind === 'ingredient' ? (s.ingredients.find((i) => i.id === r.id)?.unit ?? r.unit) : r.unit}` : ''}
                          {r.low !== undefined && <span className="muted small"> · warn at {fmt(r.low)}</span>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="imp-summary" role="status">
            {count(sum.menu, 'menu item')}, {count(sum.ingredient, 'ingredient')}, {adding} new will be added, {count(sum.error, 'problem')}
            {blank > 0 && `, ${blank} left blank`}
            {newRows.length > 0 && (
              <>
                {' '}
                <button className="link-btn" onClick={() => setSkip(adding > 0 ? newRows.map((r) => r.line) : [])}>
                  {adding > 0 ? 'Untick all new' : 'Tick all new'}
                </button>
              </>
            )}
          </p>
          {sum.menu > 0 &&
            (day ? (
              <label className="imp-check">
                <input type="checkbox" checked={alsoStart} onChange={(e) => setAlsoStart(e.target.checked)} />
                <span>Also use these as the starting stock for new days</span>
              </label>
            ) : (
              <p className="muted small">The day is not open yet, so the menu item counts become the starting stock for the next day.</p>
            ))}
        </>
      )}
      {text.trim() !== '' && rows.length === 0 && <p className="muted small">No counts found yet{blank > 0 ? `: ${blank} lines have no amount` : ''}.</p>}

      <div className="row">
        <button className="btn primary" disabled={valid === 0} onClick={apply}>
          Apply {count(valid, 'count')}
        </button>
      </div>
      {done && (
        <p className="imp-done" role="status">
          <span>{done.note}</span>
          {done.undo && (
            <button className="btn small" onClick={undo}>
              Undo
            </button>
          )}
        </p>
      )}
    </section>
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

        <ImportPanel s={s} day={day} orders={orders} left={left} who={who || 'Kitchen'} />

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
