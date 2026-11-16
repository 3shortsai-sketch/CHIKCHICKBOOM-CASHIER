import { useState } from 'react';
import { adjustmentsOf } from '../../domain/cards';
import type { Card } from '../../domain/types';
import { adjustStamps } from '../../data/store';
import { Modal } from '../../ui/ui';
import { StampDots } from './payflow';

const REASONS = ['Stamps from the paper card', 'Missed a stamp', 'Wrong stamp given', 'Other'] as const;

/**
 * Change a card's stamps by hand. Every change is saved with the reason, who
 * did it and when. At the cashier it also asks for the manager PIN, because
 * stamps lead to free food.
 */
export function StampEditor({
  number,
  name,
  stamps,
  size,
  cards,
  by,
  pin,
  onClose,
}: {
  number: string;
  name?: string;
  stamps: number;
  size: number;
  cards: Card[];
  by: string;
  /** Manager PIN to ask for (cashier). Leave out where the team passcode already guards the page. */
  pin?: string;
  onClose: () => void;
}) {
  const [target, setTarget] = useState(stamps);
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [other, setOther] = useState('');
  const [pinValue, setPinValue] = useState('');
  const [error, setError] = useState('');
  const delta = target - stamps;
  const history = [...adjustmentsOf(cards, number)].reverse();

  const save = () => {
    if (!delta) return setError('Change the number of stamps first.');
    const why = reason === 'Other' ? other.trim() : reason;
    if (!why) return setError('Type a reason.');
    if (pin !== undefined && pinValue !== pin) return setError('Wrong manager PIN.');
    adjustStamps(number, delta, why, by);
    onClose();
  };

  return (
    <Modal title={`Edit stamps · ${number}${name ? ` · ${name}` : ''}`} onClose={onClose}>
      <div className="stack">
        <div className="stamp-edit">
          <button className="btn big" onClick={() => setTarget(Math.max(0, target - 1))} disabled={target <= 0} aria-label="One stamp less">
            −
          </button>
          <div className="stamp-edit-count">
            <b className="display">
              {target}/{size}
            </b>
            <StampDots n={target} size={size} />
            <span className={`stamp-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`}>{delta === 0 ? `now ${stamps}` : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} from ${stamps}`}</span>
          </div>
          <button className="btn big" onClick={() => setTarget(Math.min(size, target + 1))} disabled={target >= size} aria-label="One stamp more">
            +
          </button>
        </div>
        <div className="extras-row" role="radiogroup" aria-label="Reason">
          {REASONS.map((r) => (
            <button key={r} role="radio" aria-checked={reason === r} className={`extra-chip extra-chip-main ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        {reason === 'Other' && <input className="input" value={other} onChange={(e) => setOther(e.target.value)} placeholder="What happened?" aria-label="Reason" />}
        {pin !== undefined && (
          <label className="field">
            <span>Manager PIN</span>
            <input className="input" type="password" inputMode="numeric" value={pinValue} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && save()} />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn primary big" onClick={save}>
          Save stamps
        </button>
        {history.length > 0 && (
          <div>
            <p className="pick-sub">Earlier changes</p>
            <ul className="adjust-history">
              {history.map((h, i) => (
                <li key={i}>
                  <b className={h.delta > 0 ? 'up' : 'down'}>{h.delta > 0 ? `+${h.delta}` : `−${Math.abs(h.delta)}`}</b> {h.reason}
                  <span className="muted small">
                    {' '}
                    · {h.by} · {new Date(h.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
