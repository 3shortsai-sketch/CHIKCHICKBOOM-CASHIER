import { useState } from 'react';
import { cardDocId, cleanCardName } from '../../domain/cards';
import { saveCard, useStore } from '../../data/store';

/** The registered name for a card in the current data mode (or undefined). */
export function useCardName(number: string | undefined): string | undefined {
  return useStore((s) => (number ? s.cards[cardDocId(s.settings.mode, number)]?.name : undefined));
}

/**
 * Shows a card's name; when there is none yet, a small box to type it.
 * Saved on every device, so the next cashier sees it too.
 */
export function CardNameField({ number, by, onSaved }: { number: string; by: string; onSaved?: (name: string) => void }) {
  const name = useCardName(number);
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);

  const save = () => {
    const clean = cleanCardName(value);
    if (!clean) return;
    saveCard(number, clean, by);
    onSaved?.(clean);
    setValue('');
    setEditing(false);
  };

  if (name && !editing) {
    return (
      <span className="card-name">
        {name}{' '}
        <button className="link-btn" onClick={() => { setValue(name); setEditing(true); }} aria-label={`Change the name on Boom Card ${number}`}>
          edit
        </button>
      </span>
    );
  }
  return (
    <span className="mini-form card-name-form">
      <input
        className="input"
        value={value}
        maxLength={30}
        autoFocus={editing}
        placeholder="Name on this Boom Card"
        aria-label={`Name for card ${number}`}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), save())}
      />
      <button className="btn small" onClick={save} disabled={!cleanCardName(value)}>
        Save
      </button>
    </span>
  );
}
