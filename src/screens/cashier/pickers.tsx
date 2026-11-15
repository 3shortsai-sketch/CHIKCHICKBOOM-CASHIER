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

function Options({ options, value, onPick, keys = true }: { options: string[]; value?: string; onPick: (v: string) => void; keys?: boolean }) {
  useNumberKeys(keys ? options.length : 0, (i) => onPick(options[i]));
  return (
    <div className="option-grid">
      {options.map((o, i) => (
        <button key={o} className={`option ${value === o ? 'selected' : ''}`} onClick={() => onPick(o)}>
          {keys && i < 9 && <kbd>{i + 1}</kbd>}
          {o}
        </button>
      ))}
    </div>
  );
}

/** Free side + paid extras for one bowl. */
function BowlChoices({ s, value, onChange }: { s: Settings; value: Choices; onChange: (c: Choices) => void }) {
  const extras = value.extraSides ?? [];
  return (
    <div className="stack">
      <div>
        <h3>1 free side</h3>
        <Options options={s.sides} value={value.side} onPick={(side) => onChange({ ...value, side })} />
      </div>
      <div>
        <h3>
          Extra sides <span className="muted">+{peso(s.extraSidePrice)} each</span>
        </h3>
        <div className="option-grid extras-grid">
          {s.sides.map((side) => {
            const n = extras.filter((x) => x === side).length;
            return (
              <div key={side} className="stepper-option">
                <span>{side}</span>
                <div className="stepper">
                  <button className="btn small" disabled={!n} onClick={() => { const i = extras.indexOf(side); onChange({ ...value, extraSides: extras.filter((_, j) => j !== i) }); }}>−</button>
                  <b>{n}</b>
                  <button className="btn small" onClick={() => onChange({ ...value, extraSides: [...extras, side] })}>+</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="stepper-option wide">
        <span>
          Extra sauce <span className="muted">+{peso(s.extraSaucePrice)} each</span>
        </span>
        <div className="stepper">
          <button className="btn small" disabled={!value.extraSauce} onClick={() => onChange({ ...value, extraSauce: (value.extraSauce ?? 0) - 1 })}>−</button>
          <b>{value.extraSauce ?? 0}</b>
          <button className="btn small" onClick={() => onChange({ ...value, extraSauce: (value.extraSauce ?? 0) + 1 })}>+</button>
        </div>
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

export function ItemPicker({
  item,
  s,
  free,
  onAdd,
  onClose,
}: {
  item: MenuItem;
  s: Settings;
  free?: OrderLine['free'];
  onAdd: (line: OrderLine) => void;
  onClose: () => void;
}) {
  const [choices, setChoices] = useState<Choices>({});
  const [notes, setNotes] = useState('');
  const isBowl = item.kind === 'bowl';
  const isFries = item.kind === 'fries';
  const isExtraSide = item.kind === 'extraSide';
  const ready = isBowl ? !!choices.side : isFries ? !!choices.dip : isExtraSide ? !!choices.side : true;

  const add = () => {
    if (!ready) return;
    onAdd({
      id: newId('l'),
      itemId: item.id,
      name: free ? `${item.name} (REWARD)` : item.name,
      qty: 1,
      unitPrice: free ? 0 : item.price,
      choices: clean(choices),
      notes: notes.trim() || undefined,
      free,
    });
  };

  // Fries and extra sides: picking the option adds the item straight away.
  const pickAndAdd = (c: Choices) => {
    onAdd({
      id: newId('l'),
      itemId: item.id,
      name: free ? `${item.name} (REWARD)` : item.name,
      qty: 1,
      unitPrice: free ? 0 : item.price,
      choices: clean(c),
      free,
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Enter always means "add", even right after tapping an option button.
      if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        e.stopPropagation();
        add();
      }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  });

  return (
    <Modal title={`${item.name}${free ? ' — reward' : ` · ${peso(item.price)}`}`} onClose={onClose} wide={isBowl}>
      {isBowl && <BowlChoices s={s} value={choices} onChange={setChoices} />}
      {isFries && (
        <div>
          <h3>1 free dip</h3>
          <Options options={s.dips} onPick={(dip) => pickAndAdd({ dip })} />
        </div>
      )}
      {isExtraSide && (
        <div>
          <h3>Which side?</h3>
          <Options options={s.sides} onPick={(side) => pickAndAdd({ side })} />
        </div>
      )}
      {isBowl && (
        <>
          <label className="field">
            <span>Note for the kitchen</span>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. no cucumber" />
          </label>
          <div className="modal-foot">
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary big" disabled={!ready} onClick={add}>
              {ready ? 'Add to order ↵' : 'Pick a free side'}
            </button>
          </div>
        </>
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
      for (const it of itemsFor(step.kind)) options.push({ label: it.short ?? it.name, onPick: () => setPart(step.kind, { itemId: it.id }), disabled: !canUse(it.id) });
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
