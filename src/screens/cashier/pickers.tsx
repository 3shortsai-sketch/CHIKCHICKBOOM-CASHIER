import { useEffect, useState } from 'react';
import { allergenHint, allergenText, itemTags } from '../../domain/allergens';
import { makeComboLine, needsPicker, newId, peso } from '../../domain/pricing';
import type { Choices, Combo, ComboPart, MenuItem, OrderLine, Settings } from '../../domain/types';
import { Modal } from '../../ui/ui';

/** Number keys 1–9 pick the n-th option. */
function useNumberKeys(count: number, onPick: (i: number) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const n = Number(e.key);
      if (n >= 1 && n <= Math.min(9, count)) {
        e.preventDefault();
        e.stopPropagation();
        onPick(n - 1);
      }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [count, onPick]);
}

function Options({
  options,
  value,
  onPick,
  keys = true,
  big,
  hint,
}: {
  options: string[];
  value?: string;
  onPick: (v: string) => void;
  keys?: boolean;
  big?: boolean;
  /** Small text under an option, e.g. its allergens. */
  hint?: (o: string) => string | undefined;
}) {
  useNumberKeys(keys ? options.length : 0, (i) => onPick(options[i]));
  return (
    <div className={`option-grid ${big ? 'big' : ''}`}>
      {options.map((o, i) => (
        <button key={o} className={`option ${value === o ? 'selected' : ''}`} onClick={() => onPick(o)}>
          {keys && i < 9 && <kbd>{i + 1}</kbd>}
          <span className="option-label">
            {o}
            {hint?.(o) && <small className="option-hint">{hint(o)}</small>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Paid extras as compact counters: extra sides (+₱20) and extra sauce (+₱10). */
function ExtrasRow({ s, value, onChange }: { s: Settings; value: Choices; onChange: (c: Choices) => void }) {
  const extras = value.extraSides ?? [];
  const sauce = value.extraSauce ?? 0;
  const chip = (label: string, price: number, n: number, inc: () => void, dec: () => void) => (
    <div key={label} className={`extra-chip ${n ? 'on' : ''}`}>
      <button className="extra-chip-main" onClick={inc} aria-label={`Add extra ${label}`}>
        <span>+ {label}</span>
        <small>{peso(price)}</small>
      </button>
      {n > 0 && (
        <>
          <b className="extra-count">×{n}</b>
          <button className="extra-chip-minus" onClick={dec} aria-label={`Remove one extra ${label}`}>
            −
          </button>
        </>
      )}
    </div>
  );
  return (
    <div className="extras-row">
      {s.sides.map((side) => {
        const n = extras.filter((x) => x === side).length;
        return chip(
          side,
          s.extraSidePrice,
          n,
          () => onChange({ ...value, extraSides: [...extras, side] }),
          () => {
            const i = extras.indexOf(side);
            onChange({ ...value, extraSides: extras.filter((_, j) => j !== i) });
          },
        );
      })}
      {chip(
        'Sauce',
        s.extraSaucePrice,
        sauce,
        () => onChange({ ...value, extraSauce: sauce + 1 }),
        () => onChange({ ...value, extraSauce: sauce - 1 }),
      )}
    </div>
  );
}

/** Free side + paid extras for one bowl (used inside the combo picker). */
function BowlChoices({ s, value, onChange }: { s: Settings; value: Choices; onChange: (c: Choices) => void }) {
  return (
    <div className="stack">
      <div>
        <h3 className="pick-title">1 free side</h3>
        <Options options={s.sides} value={value.side} onPick={(side) => onChange({ ...value, side })} hint={(o) => allergenHint(s.sideAllergens[o])} />
      </div>
      <div>
        <h3 className="pick-sub">Extras (optional)</h3>
        <ExtrasRow s={s} value={value} onChange={onChange} />
      </div>
    </div>
  );
}

/** Items that open a picker when tapped: the domain's list, plus slushies (fruit or fries on top). */
export function opensPicker(item: MenuItem): boolean {
  return needsPicker(item) || item.kind === 'slushie';
}

type Topping = NonNullable<Choices['topping']>;
const TOPPINGS: { id: Topping; label: string }[] = [
  { id: 'fruit', label: 'Fruit on top' },
  { id: 'fries', label: 'Fries on top' },
];

/** Two big buttons: more fresh fruit on top (the default) or fries on top. Keys 1 and 2. */
function ToppingChoice({ value, onPick, enterPicks }: { value: Topping; onPick: (t: Topping) => void; enterPicks?: boolean }) {
  useNumberKeys(TOPPINGS.length, (i) => onPick(TOPPINGS[i].id));
  // In the combo picker, Enter takes the topping shown as picked (fruit at first).
  useEffect(() => {
    if (!enterPicks) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      onPick(value);
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  });
  return (
    <div className="option-grid big topping-grid">
      {TOPPINGS.map((o, i) => (
        <button key={o.id} className={`option ${value === o.id ? 'selected' : ''}`} onClick={() => onPick(o.id)}>
          <kbd>{i + 1}</kbd>
          <span className="option-label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function clean(c: Choices): Choices {
  const out: Choices = {};
  if (c.side) out.side = c.side;
  if (c.extraSides?.length) out.extraSides = c.extraSides;
  if (c.extraSauce) out.extraSauce = c.extraSauce;
  if (c.dip) out.dip = c.dip;
  if (c.topping) out.topping = c.topping;
  return out;
}

/**
 * Bowl, fries or extra side. New item: extras and note are set first, then
 * tapping the free side (or dip) adds it in one tap. Editing a line: the
 * choices are pre-filled and Save replaces the line.
 */
export function ItemPicker({
  item,
  s,
  free,
  initial,
  onAdd,
  onClose,
}: {
  item: MenuItem;
  s: Settings;
  free?: OrderLine['free'];
  initial?: OrderLine;
  onAdd: (line: OrderLine) => void;
  onClose: () => void;
}) {
  const editing = !!initial;
  const [choices, setChoices] = useState<Choices>(initial?.choices ?? {});
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const isBowl = item.kind === 'bowl';
  const isFries = item.kind === 'fries';
  const isDrink = item.kind === 'slushie';
  const lineFree = initial?.free ?? free;

  const build = (c: Choices): OrderLine => ({
    id: initial?.id ?? newId('l'),
    itemId: item.id,
    name: lineFree ? `${item.name} (REWARD)` : item.name,
    qty: initial?.qty ?? 1,
    unitPrice: lineFree ? 0 : item.price,
    choices: clean(c),
    notes: notes.trim() || undefined,
    free: lineFree,
  });

  const pick = (c: Choices) => {
    if (editing && isBowl) setChoices(c);
    else onAdd(build(c));
  };

  const save = () => {
    if (isBowl && !choices.side) return;
    onAdd(build(isDrink ? { ...choices, topping: choices.topping ?? 'fruit' } : choices));
  };

  useEffect(() => {
    // Enter saves an edit, and adds a drink with the topping shown as picked (fruit at first).
    if (!editing && !isDrink) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        e.stopPropagation();
        save();
      }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  });

  const title = `${editing ? 'Edit · ' : ''}${item.name}${lineFree ? ' · reward' : ` · ${peso(item.price)}`}`;
  const options = isFries ? s.dips : s.sides;

  return (
    <Modal title={title} onClose={onClose} wide={isBowl}>
      {allergenText(itemTags(item)) && <p className="allergen-note">{allergenText(itemTags(item))}</p>}
      {isBowl && (
        <div className="bowl-mods">
          <h3 className="pick-sub">Extras (optional, set before the side)</h3>
          <ExtrasRow s={s} value={choices} onChange={setChoices} />
          <input className="input note-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note for the kitchen, e.g. no cucumber" aria-label="Note for the kitchen" />
        </div>
      )}
      {isDrink ? (
        <>
          <h3 className="pick-title">What goes on top? Tap to add</h3>
          <ToppingChoice value={choices.topping ?? 'fruit'} onPick={(topping) => pick({ ...choices, topping })} />
        </>
      ) : (
        <>
          <h3 className="pick-title">
            {isBowl ? (editing ? 'Free side' : 'Tap the free side to add') : isFries ? (editing ? 'Dip' : 'Tap the free dip to add') : 'Which side?'}
          </h3>
          <Options
            big
            options={options}
            value={isFries ? choices.dip : choices.side}
            onPick={(v) => pick(isFries ? { ...choices, dip: v } : { ...choices, side: v })}
            hint={(o) => allergenHint(isFries ? s.dipAllergens[o] : s.sideAllergens[o])}
          />
        </>
      )}
      {editing && isBowl && (
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary big" disabled={!choices.side} onClick={save}>
            Save changes ↵
          </button>
        </div>
      )}
    </Modal>
  );
}

type PartKind = Combo['parts'][number];
const PART_TITLE: Record<PartKind, string> = { bowl: 'Pick the bowl', fries: 'Fries dip', slushie: 'Pick the shake or juice', cookie: 'Pick the cookie' };

/** Step-by-step combo picker: bowl → side & extras → dip / cookie → slushie. */
export function ComboPicker({
  combo,
  s,
  canUse,
  onAdd,
  onClose,
}: {
  combo: Combo;
  s: Settings;
  canUse: (itemId: string) => boolean;
  onAdd: (line: OrderLine) => void;
  onClose: () => void;
}) {
  type Step = { kind: PartKind; sub?: 'choices' | 'topping' };
  const steps: Step[] = combo.parts.flatMap((k): Step[] =>
    k === 'bowl' ? [{ kind: k }, { kind: k, sub: 'choices' }] : k === 'slushie' ? [{ kind: k }, { kind: k, sub: 'topping' }] : [{ kind: k }],
  );
  const [stepIdx, setStepIdx] = useState(0);
  const [parts, setParts] = useState<Partial<Record<PartKind, ComboPart>>>({});
  const step = steps[stepIdx];

  const itemName = (id: string) => s.menu.find((m) => m.id === id)?.name ?? 'drink';
  const itemsFor = (kind: PartKind) =>
    s.menu.filter((m) => m.active && (kind === 'fries' ? m.kind === 'fries' && m.regular : m.kind === kind));

  const setPart = (kind: PartKind, part: ComboPart, advance = true) => {
    const next = { ...parts, [kind]: part };
    setParts(next);
    if (!advance) return;
    if (stepIdx + 1 < steps.length) setStepIdx(stepIdx + 1);
    else finish(next);
  };

  const finish = (p: Partial<Record<PartKind, ComboPart>>) => {
    const ordered = combo.parts.map((k) => p[k]!);
    onAdd(makeComboLine(combo, ordered.map((x) => ({ ...x, ...clean(x) })), s));
  };

  const options: { label: string; hint?: string; onPick: () => void; disabled?: boolean }[] = [];
  if (!step.sub) {
    if (step.kind === 'fries') {
      const fries = itemsFor('fries')[0];
      for (const dip of s.dips) options.push({ label: dip, hint: allergenHint(s.dipAllergens[dip]), onPick: () => setPart('fries', { itemId: fries.id, dip }), disabled: !fries || !canUse(fries.id) });
    } else {
      for (const it of itemsFor(step.kind)) options.push({ label: it.name, hint: allergenText(itemTags(it), true) ?? undefined, onPick: () => setPart(step.kind, { itemId: it.id }), disabled: !canUse(it.id) });
    }
  }
  useNumberKeys(step.sub ? 0 : options.length, (i) => !options[i].disabled && options[i].onPick());

  const bowl = parts.bowl;
  const drink = parts.slushie;
  // Enter moves on from the side-and-extras step, like the "Next" button.
  const sideStep = !!step.sub && step.kind === 'bowl';
  useEffect(() => {
    if (!sideStep) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || !bowl?.side) return;
      e.preventDefault();
      e.stopPropagation();
      if (stepIdx + 1 < steps.length) setStepIdx(stepIdx + 1);
      else finish(parts);
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  });
  return (
    <Modal title={`${combo.name} · ${peso(combo.price)} — step ${stepIdx + 1} of ${steps.length}`} onClose={onClose} wide>
      <ol className="steps">
        {steps.map((st, i) => (
          <li key={i} className={i === stepIdx ? 'current' : i < stepIdx ? 'done' : ''}>
            {st.sub === 'choices' ? 'Side & extras' : st.sub === 'topping' ? 'Fruit or fries on top' : PART_TITLE[st.kind]}
          </li>
        ))}
      </ol>
      {!step.sub ? (
        <>
          <h3>{PART_TITLE[step.kind]}</h3>
          <div className="option-grid">
            {options.map((o, i) => (
              <button key={o.label} className="option" disabled={o.disabled} onClick={o.onPick}>
                {i < 9 && <kbd>{i + 1}</kbd>}
                <span className="option-label">
                  {o.label}
                  {o.hint && <small className="option-hint">{o.hint}</small>}
                </span>
                {o.disabled && <span className="tag">sold out</span>}
              </button>
            ))}
          </div>
        </>
      ) : step.sub === 'topping' ? (
        drink && (
          <>
            <h3>What goes on top of the {itemName(drink.itemId)}?</h3>
            <ToppingChoice enterPicks value={drink.topping ?? 'fruit'} onPick={(topping) => setPart('slushie', { ...drink, topping })} />
          </>
        )
      ) : (
        bowl && (
          <>
            <BowlChoices s={s} value={bowl} onChange={(c) => setPart('bowl', { ...bowl, ...c }, false)} />
            <div className="modal-foot">
              <button className="btn primary big" disabled={!bowl.side} onClick={() => (stepIdx + 1 < steps.length ? setStepIdx(stepIdx + 1) : finish(parts))}>
                {bowl.side ? 'Next →' : 'Pick a free side'}
              </button>
            </div>
          </>
        )
      )}
      {stepIdx > 0 && (
        <button className="btn ghost" onClick={() => setStepIdx(stepIdx - 1)}>
          ← Back
        </button>
      )}
    </Modal>
  );
}
