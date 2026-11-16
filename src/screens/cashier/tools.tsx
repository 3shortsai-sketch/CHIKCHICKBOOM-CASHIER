import { useMemo, useState } from 'react';
import { cardRows, searchCards } from '../../domain/cards';
import { availableRewards, cardState, parseCard } from '../../domain/loyalty';
import { newId, peso } from '../../domain/pricing';
import type { BusinessDay, Order, Settings } from '../../domain/types';
import { modeCards, patchDay, useStore } from '../../data/store';
import { Modal } from '../../ui/ui';
import { CardNameField } from './CardName';
import { StampDots } from './payflow';

/**
 * Look up a loyalty card by number or by name: stamps, rewards, visits.
 * Also where a card's name is typed in the first time.
 */
export function CardLookup({ s, orders, cashier, onClose }: { s: Settings; orders: Order[]; cashier: string; onClose: () => void }) {
  const cards = useStore((st) => modeCards(st));
  const rows = useMemo(() => cardRows(cards, orders, s), [cards, orders, s]);
  const [input, setInput] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  const typedNumber = parseCard(input, s);
  const matches = useMemo(() => (input.trim() ? searchCards(rows, input).slice(0, 6) : []), [rows, input]);
  // A valid number that nobody has registered or used yet is still a real card.
  const number = picked ?? (typedNumber && /\d/.test(input) ? typedNumber : (matches.length === 1 ? matches[0].number : null));
  const row = number ? (rows.find((r) => r.number === number) ?? cardRows([], [], s)[0]) : undefined;
  const st = number ? cardState(number, orders, s) : null;
  const rewards = st ? availableRewards(st, s) : [];
  const next = st ? s.loyalty.rewards.find((r) => r.at > st.stamps && !st.used.includes(r.at)) : undefined;
  const visits = number ? orders.filter((o) => o.cardId === number && !o.voided).sort((a, b) => b.createdAt - a.createdAt) : [];
  const nameLookupFailed = input.trim() && !typedNumber && matches.length === 0;

  return (
    <Modal title="Loyalty cards" onClose={onClose}>
      <div className="mini-form">
        <input
          className="input"
          autoFocus
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setPicked(null);
          }}
          placeholder="Card number (37) or name (Ana)"
          aria-label="Card number or name"
        />
      </div>
      {nameLookupFailed && <p className="muted">No card with that number or name yet. Type the card number to register it.</p>}
      {matches.length > 1 && !picked && (
        <ul className="card-matches">
          {matches.map((m) => (
            <li key={m.number}>
              <button className="btn small" onClick={() => setPicked(m.number)}>
                <b>{m.number}</b> {m.name || <span className="muted">(no name)</span>} <span className="muted">{m.stamps}/{m.size}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {number && st && (
        <div className="lookup">
          <div className="lookup-head">
            <span className="lookup-id">{number}</span>
            <b className="display">
              {st.stamps}/{s.loyalty.cardSize}
            </b>
          </div>
          <div className="lookup-name">
            <span className="muted small">Name:</span> <CardNameField number={number} by={cashier} />
          </div>
          <StampDots n={st.stamps} size={s.loyalty.cardSize} />
          {rewards.length > 0 ? (
            <p className="ok-note">Reward ready: {rewards.map((r) => r.label).join(', ')}. Add the card to an order to use it.</p>
          ) : next ? (
            <p className="muted">
              {next.at - st.stamps} more stamp{next.at - st.stamps === 1 ? '' : 's'} to {next.label}.
            </p>
          ) : null}
          <p className="muted small">
            {visits.length} visit{visits.length === 1 ? '' : 's'}
            {st.cardsCompleted > 0 && ` · ${st.cardsCompleted} full card${st.cardsCompleted === 1 ? '' : 's'} completed`}
            {visits[0] && ` · last visit ${new Date(visits[0].createdAt).toLocaleDateString()} (${visits[0].number})`}
            {row && !row.registered && visits.length === 0 && ' · not used yet'}
          </p>
        </div>
      )}
      <p className="muted small">
        <a href="#cards">See all cards →</a> (team passcode)
      </p>
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
          Log {qty} × {item?.name ?? ''}
        </button>
        {today.length > 0 && (
          <p className="muted small">
            Logged today:{' '}
            {today
              .slice(-5)
              .map((w) => `${w.qty}× ${items.find((m) => m.id === w.itemId)?.name ?? w.itemId} (${w.reason})`)
              .join(', ')}
          </p>
        )}
      </div>
    </Modal>
  );
}
