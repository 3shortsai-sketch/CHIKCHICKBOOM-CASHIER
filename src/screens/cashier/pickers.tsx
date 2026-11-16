import { useEffect, useState } from 'react';
import { makeComboLine, newId, peso } from '../../domain/pricing';
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

function Options({ options, value, onPick, keys = true, big }: { options: string[]; value?: string; onPick: (v: string) => void; keys?: boolean; big?: boolean }) {
  useNumberKeys(keys ? options.length : 0, (i) => onPick(options[i]));
  return (
    <div className={`option-grid ${big ? 'big' : ''}`}>
      {options.map((o, i) => (
        <button key={o} className={`option ${value === o ? 'selected' : ''}`} onClick={() => onPick(o)}>
          {keys && i < 9 && <kbd>{i + 1}</kbd>}
          {o}
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
        <Options options={s.sides} value={value.side} onPick={(side) => onChange({ ...value, side })} />
      </div>
      <div>
        <h3 className="pick-sub">Extras (optional)</h3>
        <ExtrasRow s={s} value={value} onChange={onChange} />
      </div>
    </div>
  );
}

function clean(c: Choices): Choices {
  const out: Choices = {};
  if (c.side) out.side = c.side;
  if (c.extraSides?.length) out.extraSides = c.extraSides;
  if (c.extraSauce) out.extraSauce = c.extraSauce;
  if (c.dip) out.dip = c.dip;
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
    onAdd(build(choices));
  };

  useEffect(() => {
    if (!editing) return;
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
      {item.allergens && item.allergens.length > 0 && <p className="allergen-note">Contains: {item.allergens.join(', ')}</p>}
      {isBowl && (
        <div className="bowl-mods">
          <h3 className="pick-sub">Extras (optional, set before the side)</h3>
          <ExtrasRow s={s} value={choices} onChange={setChoices} />
          <input className="input note-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note for the kitchen, e.g. no cucumber" aria-label="Note for the kitchen" />
        </div>
      )}
      <h3 className="pick-title">
        {isBowl ? (editing ? 'Free side' : 'Tap the free side to add') : isFries ? (editing ? 'Dip' : 'Tap the free dip to add') : 'Which side?'}
      </h3>
      <Options
        big
        options={options}
        value={isFries ? choices.dip : choices.side}
        onPick={(v) => pick(isFries ? { ...choices, dip: v } : { ...choices, side: v })}
      />
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
const PART_TITLE: Record<PartKind, string> = { bowl: 'Pick the bowl', fries: 'Fries dip', slushie: 'Pick the slushie', cookie: 'Pick the cookie' };

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
  type Step = { kind: PartKind; sub?: 'choices' };
  const steps: Step[] = combo.parts.flatMap((k): Step[] => (k === 'bowl' ? [{ kind: k }, { kind: k, sub: 'choices' }] : [{ kind: k }]));
  const [stepIdx, setStepIdx] = useState(0);
  const [parts, setParts] = useState<Partial<Record<PartKind, ComboPart>>>({});
  const step = steps[stepIdx];

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

  const options: { label: string; onPick: () => void; disabled?: boolean }[] = [];
  if (!step.sub) {
    if (step.kind === 'fries') {
      const fries = itemsFor('fries')[0];
      for (const dip of s.dips) options.push({ label: dip, onPick: () => setPart('fries', { itemId: fries.id, dip }), disabled: !fries || !canUse(fries.id) });
    } else {
      for (const it of itemsFor(step.kind)) options.push({ label: it.name, onPick: () => setPart(step.kind, { itemId: it.id }), disabled: !canUse(it.id) });
    }
  }
  useNumberKeys(step.sub ? 0 : options.length, (i) => !options[i].disabled && options[i].onPick());

  const bowl = parts.bowl;
  return (
    <Modal title={`${combo.name} · ${peso(combo.price)} — step ${stepIdx + 1} of ${steps.length}`} onClose={onClose} wide>
      <ol className="steps">
        {steps.map((st, i) => (
          <li key={i} className={i === stepIdx ? 'current' : i < stepIdx ? 'done' : ''}>
            {st.sub ? 'Side & extras' : PART_TITLE[st.kind]}
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
                {o.label}
                {o.disabled && <span className="tag">sold out</span>}
              </button>
            ))}
          </div>
        </>
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
