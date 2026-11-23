import { useEffect } from 'react';
import { lineBits } from '../../domain/lineText';
import { peso } from '../../domain/pricing';
import type { Order, Settings } from '../../domain/types';
import { Modal, useLatest } from '../../ui/ui';

const METHOD = { cash: 'cash', gcash: 'GCash', maya: 'Maya' } as const;

/**
 * A ready order, opened before handing it over: everything in it, so the
 * cashier can check the tray against the list, then "Picked up".
 */
export function PickupModal({ order, s, onPickedUp, onClose }: { order: Order; s: Settings; onPickedUp: (thenSpins: boolean) => void; onClose: () => void }) {
  const spinsLeft = order.voided ? 0 : Math.max(0, order.spinsEarned - order.spins.length);
  const pieces = order.lines.reduce((n, l) => n + l.qty * (l.combo ? l.combo.parts.length : 1), 0);
  const done = useLatest(onPickedUp);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      done.current(false);
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [done]);
  const itemName = (id: string) => s.menu.find((m) => m.id === id)?.name ?? id;
  return (
    <Modal title={`Pickup · ${order.number}`} onClose={onClose}>
      <div className="pickup">
        <div className="pickup-who">
          <b className="pickup-name">{order.customerName ?? order.number}</b>
          <span className="muted">
            {order.number} · {pieces} item{pieces === 1 ? '' : 's'} · paid {peso(order.payment.due)} {METHOD[order.payment.method]}
          </span>
        </div>
        {order.note && <p className="pickup-note">Note: {order.note}</p>}
        <ul className="pickup-lines">
          {order.lines.map((l) => (
            <li key={l.id} className={l.free ? 'free' : ''}>
              <b className="pickup-qty">{l.qty}×</b>
              <span>
                <b>{l.combo ? (s.combos.find((c) => c.id === l.combo!.comboId)?.name ?? l.name) : l.name}</b>
                {l.combo && <span className="details">{l.combo.parts.map((p) => itemName(p.itemId)).join(' + ')}</span>}
                {lineBits(l).length > 0 && <span className="details">{lineBits(l).join(' · ')}</span>}
                {l.notes && <span className="note">Note: {l.notes}</span>}
              </span>
            </li>
          ))}
        </ul>
        {spinsLeft > 0 && (
          <p className="pickup-spins">
            🎡 {spinsLeft} spin{spinsLeft === 1 ? '' : 's'} not logged yet.
          </p>
        )}
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            Not yet
          </button>
          {spinsLeft > 0 && (
            <button className="btn big" onClick={() => onPickedUp(true)}>
              Picked up + log spin{spinsLeft === 1 ? '' : 's'}
            </button>
          )}
          <button className="btn success big" onClick={() => onPickedUp(false)}>
            Picked up ↵
          </button>
        </div>
      </div>
    </Modal>
  );
}
