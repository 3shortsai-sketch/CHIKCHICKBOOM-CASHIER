import { useState } from 'react';
import { peso } from '../../domain/pricing';
import type { BusinessDay, CashMove, Settings } from '../../domain/types';
import { addCashMove, cancelCashMove, modeCashMoves, useStore } from '../../data/store';
import { ManagerConfirm, Modal } from '../../ui/ui';

const CHOICES: { type: CashMove['type']; label: string; short: string }[] = [
  { type: 'drop', label: 'Take out to safe', short: 'To safe' },
  { type: 'add', label: 'Add change', short: 'Change added' },
  { type: 'expense', label: 'Pay for something', short: 'Paid out' },
];

const MAX_AMOUNT = 100_000;

/** "2:05 PM" */
function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Cash that goes in or out of the drawer without a sale: a drop to the safe,
 * extra change put in, or something bought with drawer cash. Every entry needs
 * the manager PIN. A mistake is cancelled (crossed out), never deleted.
 */
export function CashMoves({ s, day, cashier, onClose }: { s: Settings; day: BusinessDay; cashier: string; onClose: () => void }) {
  const all = useStore((st) => modeCashMoves(st));
  const today = all.filter((m) => m.dayId === day.id).sort((a, b) => b.at - a.at);
  const [type, setType] = useState<CashMove['type']>('drop');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [cancelling, setCancelling] = useState<CashMove | null>(null);

  const save = () => {
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 1 || n > MAX_AMOUNT) return setError(`Type an amount from ₱1 to ${peso(MAX_AMOUNT)}.`);
    if (type === 'expense' && !note.trim()) return setError('Type what the cash paid for, e.g. ice.');
    if (pin !== s.managerPin) return setError('Wrong manager PIN.');
    addCashMove({ dayId: day.id, type, amount: n, note, by: cashier });
    setSaved(`Saved: ${CHOICES.find((c) => c.type === type)?.short} ${peso(n)}.`);
    setAmount('');
    setNote('');
    setPin('');
    setError('');
  };

  // Totals leave out cancelled entries.
  const total = (t: CashMove['type']) => today.reduce((sum, m) => sum + (m.type === t && !m.cancelled ? m.amount : 0), 0);

  return (
    <Modal title="Cash in and out" onClose={onClose}>
      <div className="stack">
        <div className="extras-row" role="radiogroup" aria-label="What is the cash for?">
          {CHOICES.map((c) => (
            <button
              key={c.type}
              role="radio"
              aria-checked={type === c.type}
              className={`extra-chip extra-chip-main ${type === c.type ? 'on' : ''}`}
              onClick={() => {
                setType(c.type);
                setError('');
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Amount (₱)</span>
          <input
            className="input"
            inputMode="numeric"
            autoFocus
            value={amount}
            maxLength={6}
            onChange={(e) => {
              setAmount(e.target.value.replace(/\D/g, ''));
              setSaved('');
            }}
            aria-label="Amount in pesos"
          />
        </label>
        <label className="field">
          <span>{type === 'expense' ? 'What was it for?' : 'Note (optional)'}</span>
          <input className="input" value={note} maxLength={60} onChange={(e) => setNote(e.target.value)} placeholder={type === 'expense' ? 'e.g. ice' : type === 'drop' ? 'e.g. given to the treasurer' : 'e.g. coins from the bank'} />
        </label>
        <label className="field">
          <span>Manager PIN</span>
          <input className="input" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && save()} aria-label="Manager PIN" />
        </label>
        {error && <p className="error">{error}</p>}
        {saved && !error && <p className="ok-note">{saved}</p>}
        <button className="btn primary big" onClick={save}>
          Save
        </button>

        <p className="cash-totals">
          Taken out <b>{peso(total('drop'))}</b> · Added <b>{peso(total('add'))}</b> · Paid out <b>{peso(total('expense'))}</b>
        </p>
        {today.length === 0 ? (
          <p className="muted small">Nothing yet today.</p>
        ) : (
          <ul className="cash-moves">
            {today.map((m) => (
              <li key={m.id} className={m.cancelled ? 'cancelled' : ''}>
                <span className="cash-move-main">
                  <span className="muted small">{timeOf(m.at)}</span> <b>{CHOICES.find((c) => c.type === m.type)?.short ?? m.type}</b> <span>{peso(m.amount)}</span>
                  {m.note && <span className="muted"> · {m.note}</span>}
                  <span className="muted small"> · {m.by}</span>
                  {m.cancelled && (
                    <span className="cash-move-why small">
                      Cancelled by {m.cancelled.by}: {m.cancelled.reason}
                    </span>
                  )}
                </span>
                {!m.cancelled && (
                  <button className="btn ghost small danger-text" onClick={() => setCancelling(m)}>
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {cancelling && (
        <ManagerConfirm
          title="Cancel this cash entry"
          note={
            <p>
              <b>{CHOICES.find((c) => c.type === cancelling.type)?.short}</b> {peso(cancelling.amount)} at {timeOf(cancelling.at)}
              {cancelling.note && ` · ${cancelling.note}`}. It stays in the list, crossed out.
            </p>
          }
          managerPin={s.managerPin}
          confirmLabel="Cancel this entry"
          reasonHint="e.g. typed twice"
          onConfirm={(reason) => {
            cancelCashMove(cancelling.id, cashier, reason);
            setCancelling(null);
          }}
          onClose={() => setCancelling(null)}
        />
      )}
    </Modal>
  );
}
