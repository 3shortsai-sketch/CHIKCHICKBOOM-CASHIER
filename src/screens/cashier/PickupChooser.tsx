import { PICKUP_SLOTS, PLACE_MAX, slotTime, niceTime, SLOT_LABEL, type PickupDraft } from '../../domain/pickup';
import type { Settings } from '../../domain/types';

/**
 * When the customer gets the order (required): Recess, Lunch or Dismissal,
 * and Pickup or Delivery. A delivery also needs the place.
 */
export function PickupChooser({ s, value, onChange, missing }: { s: Settings; value: PickupDraft; onChange: (d: PickupDraft) => void; missing?: boolean }) {
  const needSlot = missing && !value.slot;
  const needPlace = missing && value.delivery && !value.place.trim();
  return (
    <div className={`pickup-chooser ${needSlot || needPlace ? 'missing' : ''}`}>
      <div className="pickup-row" role="radiogroup" aria-label="Pickup time (required)" aria-invalid={needSlot}>
        {PICKUP_SLOTS.map((slot) => {
          const t = slotTime(slot, s);
          return (
            <button key={slot} type="button" role="radio" aria-checked={value.slot === slot} className={`pickup-opt ${value.slot === slot ? 'on' : ''}`} onClick={() => onChange({ ...value, slot })}>
              <b>{SLOT_LABEL[slot]}</b>
              {t && <small>{niceTime(t)}</small>}
            </button>
          );
        })}
      </div>
      <div className="pickup-row" role="radiogroup" aria-label="Pickup or delivery">
        <button type="button" role="radio" aria-checked={!value.delivery} className={`pickup-opt small ${!value.delivery ? 'on' : ''}`} onClick={() => onChange({ ...value, delivery: false })}>
          Pickup
        </button>
        <button type="button" role="radio" aria-checked={value.delivery} className={`pickup-opt small ${value.delivery ? 'on' : ''}`} onClick={() => onChange({ ...value, delivery: true })}>
          🚚 Delivery
        </button>
      </div>
      {value.delivery && (
        <input
          className={`input ${needPlace ? 'missing' : ''}`}
          value={value.place}
          maxLength={PLACE_MAX}
          autoFocus
          onChange={(e) => onChange({ ...value, place: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), (e.target as HTMLInputElement).blur())}
          placeholder="Deliver to (required), e.g. Grade 5 - Rizal"
          aria-label="Deliver to (required)"
          aria-required="true"
          aria-invalid={needPlace}
        />
      )}
    </div>
  );
}
