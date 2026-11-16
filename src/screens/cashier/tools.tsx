import { useState } from 'react';
import { availableRewards, cardState, parseCard } from '../../domain/loyalty';
import { newId, peso } from '../../domain/pricing';
import type { BusinessDay, Order, Settings } from '../../domain/types';
import { patchDay } from '../../data/store';
import { Modal } from '../../ui/ui';
import { StampDots } from './payflow';

/** "How many stamps do I have?": look up a card without starting an order. */
export function CardLookup({ s, orders, onClose }: { s: Settings; orders: Order[]; onClose: () => void }) {
  const [input, setInput] = useState('');
  const [cardId, setCardId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const look = () => {
    const id = parseCard(input, s);
    if (!id) {
      setCardId(null);
      setError(`Unknown card number. Cards run ${s.loyalty.prefix}${String(s.loyalty.first).padStart(3, '0')} to ${s.loyalty.prefix}${s.loyalty.last}.`);
      return;
    }
    setError('');
    setCardId(id);
  };

  const state = cardId ? cardState(cardId, orders, s) : null;
  const visits = cardId
    ? orders
        .filter((o) => o.cardId === cardId && !o.voided)
        .sort((a, b) => b.createdAt - a.createdAt)
    : [];
  const rewards = state ? availableRewards(state, s) : [];
  const next = state ? s.loyalty.rewards.find((r) => r.at > state.stamps && !state.used.includes(r.at)) : undefined;

  return (
    <Modal title="Check a loyalty card" onClose={onClose}>
      <div className="mini-form">
        <input className="input" autoFocus value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), look())} placeholder="Card number, e.g. 37" aria-label="Card number" />
        <button className="btn primary" onClick={look} disabled={!input.trim()}>
          Check
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {state && (
        <div className="lookup">
          <div className="lookup-head">
            <span className="lookup-id">{state.cardId}</span>
            <b className="display">
              {state.stamps}/{s.loyalty.cardSize}
            </b>
          </div>
          <StampDots n={state.stamps} size={s.loyalty.cardSize} />
          {rewards.length > 0 ? (
            <p className="ok-note">Reward ready: {rewards.map((r) => r.label).join(', ')}. Add the card to an order to use it.</p>
          ) : next ? (
            <p className="muted">
              {next.at - state.stamps} more stamp{next.at - state.stamps === 1 ? '' : 's'} to {next.label}.
            </p>
          ) : null}
          <p className="muted small">
            {visits.length} visit{visits.length === 1 ? '' : 's'}
            {state.cardsCompleted > 0 && ` · ${state.cardsCompleted} full card${state.cardsCompleted === 1 ? '' : 's'} completed`}
            {visits[0] && ` · last visit ${new Date(visits[0].createdAt).toLocaleDateString()} (${visits[0].number})`}
          </p>
        </div>
      )}
    </Modal>
  );
}

/** Dropped, spoiled or made by mistake: comes out of stock and counts as cost. */
export function WasteLog({ s, day, cashier, onClose }: { s: Settings; day: BusinessDay; cashier: string; onClose: () => void }) {
  const items = s.menu.filter((m) => m.active);
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState('Dropped');
  const [other, setOther] = useState('');
  const reasons = ['Dropped', 'Spoiled', 'Wrong order made', 'Taste test', 'Other'];
  const item = items.find((m) => m.id === itemId);

  const save = () => {
    if (!item || qty < 1) return;
    const why = reason === 'Other' ? other.trim() || 'Other' : reason;
    patchDay(day.id, { waste: [...(day.waste ?? []), { id: newId('w'), itemId, qty, reason: why, at: Date.now(), by: cashier }] });
    onClose();
  };

  const today = day.waste ?? [];
  return (
    <Modal title="Log waste" onClose={onClose}>
      <div className="stack">
        <label className="field">
          <span>Item</span>
          <select className="input" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            {items.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <span className="field-label">How many</span>
          <div className="stepper">
            <button className="btn small" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="One less">
              −
            </button>
            <b>{qty}</b>
            <button className="btn small" onClick={() => setQty(qty + 1)} aria-label="One more">
              +
            </button>
          </div>
          {item && <span className="muted small">cost {peso(item.unitCost * qty)}</span>}
        </div>
        <div className="extras-row" role="radiogroup" aria-label="Reason">
          {reasons.map((r) => (
            <button key={r} role="radio" aria-checked={reason === r} className={`extra-chip extra-chip-main ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        {reason === 'Other' && <input className="input" value={other} onChange={(e) => setOther(e.target.value)} placeholder="What happened?" autoFocus />}
        <button className="btn primary big" onClick={save} disabled={!item}>
          Log {qty} × {item?.short ?? item?.name ?? ''}
        </button>
        {today.length > 0 && (
          <p className="muted small">
            Logged today:{' '}
            {today
              .slice(-5)
              .map((w) => `${w.qty}× ${items.find((m) => m.id === w.itemId)?.short ?? w.itemId} (${w.reason})`)
              .join(', ')}
          </p>
        )}
      </div>
    </Modal>
  );
}
