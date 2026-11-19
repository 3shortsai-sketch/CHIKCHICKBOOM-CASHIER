import { useEffect, useMemo, useState } from 'react';
import { cashSuggestions } from '../../domain/checkout';
import { cardStateFor } from '../../domain/cards';
import { availableRewards, localDate, parseCard, voucherWindow } from '../../domain/loyalty';
import { peso, spinnableBowls } from '../../domain/pricing';
import type { MenuItem, Order, PaymentMethod, PrizeId, Settings } from '../../domain/types';
import { applyPrize, digitalSpin, PRIZE_LABEL, prizeRefundTotal, undoLastSpin } from '../../domain/wheel';
import { modeCards, useStore } from '../../data/store';
import { Modal } from '../../ui/ui';
import { CardNameField } from './CardName';

/** Shortest GCash/Maya reference the cashier may type (the last 4 digits). */
const MIN_REFERENCE = 4;
/** Longest cash amount that can be typed: 7 digits. */
const MAX_CASH_DIGITS = 7;
/** Keys are ignored this long after the after-payment screen opens (a held Enter must not close it). */
const AFTERPAY_KEY_DELAY_MS = 400;

/** "2026-11-24" as "Tue, Nov 24". */
function niceDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function PayModal({
  due,
  methods,
  duplicateOf,
  onMethod,
  onPay,
  onClose,
}: {
  due: number;
  /** Payment methods the booth accepts (cash is always on). */
  methods: PaymentMethod[];
  /** The number of another order today paid with this GCash/Maya reference, if any. */
  duplicateOf: (reference: string) => string | undefined;
  /** Tells the customer monitor which method is chosen, so it can show the QR. */
  onMethod: (m: PaymentMethod) => void;
  /** Saves the order. Returns the problem as a sentence when it could not be saved. */
  onPay: (method: PaymentMethod, tendered: number, reference: string) => string | undefined;
  onClose: () => void;
}) {
  const [method, setMethodState] = useState<PaymentMethod>('cash');
  const setMethod = (m: PaymentMethod) => {
    setMethodState(m);
    onMethod(m);
  };
  const [tendered, setTendered] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [reference, setReference] = useState('');
  const cash = typed ? Number(typed) : (tendered ?? 0);
  const change = cash - due;
  const ref = reference.trim();
  const canPay = method === 'cash' ? cash >= due : ref.length >= MIN_REFERENCE;
  const [problem, setProblem] = useState('');
  // Same reference as an earlier order: Confirm must be pressed twice.
  const sameAs = method !== 'cash' && ref ? duplicateOf(ref) : undefined;
  const [warnedRef, setWarnedRef] = useState('');

  const pay = () => {
    if (!canPay) return;
    if (sameAs && warnedRef !== ref) return setWarnedRef(ref);
    setProblem(onPay(method, method === 'cash' ? cash : due, method === 'cash' ? '' : ref) ?? '');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        // A held-down Enter must not confirm the payment.
        if (!e.repeat) pay();
      }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  });

  return (
    <Modal title="Payment" onClose={onClose}>
      <div className="due">
        <span>Amount due</span>
        <b className="display">{peso(due)}</b>
      </div>
      <div className="segmented">
        {methods.map((m) => (
          <button key={m} className={method === m ? 'selected' : ''} onClick={() => setMethod(m)}>
            {m === 'cash' ? 'Cash' : m === 'gcash' ? 'GCash' : 'Maya'}
          </button>
        ))}
      </div>
      {method === 'cash' ? (
        <>
          <div className="quick-cash">
            <button className={`btn ${tendered === due && !typed ? 'primary' : ''}`} onClick={() => { setTendered(due); setTyped(''); }}>Exact</button>
            {cashSuggestions(due).map((n) => (
              <button key={n} className={`btn ${tendered === n && !typed ? 'primary' : ''}`} onClick={() => { setTendered(n); setTyped(''); }}>
                {peso(n)}
              </button>
            ))}
          </div>
          <label className="field">
            <span>Or type the cash received</span>
            <input className="input" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, '').slice(0, MAX_CASH_DIGITS))} placeholder="₱" autoFocus />
          </label>
          <div className={`change ${cash > 0 && change < 0 ? 'short' : ''}`}>
            <span>{cash > 0 && change < 0 ? 'Still short' : 'Change'}</span>
            <b className="display">{cash ? peso(Math.abs(change)) : '—'}</b>
          </div>
        </>
      ) : (
        <>
          {method === 'gcash' && <p className="ok-note">The GCash QR and amount are showing on the customer screen.</p>}
          <p className="muted">Check the payment arrived on the business phone before confirming.</p>
          <label className="field">
            <span>Reference number (last 4 digits or more)</span>
            <input className="input" inputMode="numeric" value={reference} maxLength={40} onChange={(e) => setReference(e.target.value)} placeholder="from the payment message" autoFocus />
          </label>
          {sameAs && (
            <p className="error" role="alert">
              Same reference as order {sameAs}. Check the phone again.{warnedRef === ref ? ' Press Confirm again to go on.' : ''}
            </p>
          )}
        </>
      )}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      <button className="btn primary big full" disabled={!canPay} onClick={pay}>
        Confirm payment ↵
      </button>
    </Modal>
  );
}

const PRIZE_ORDER: PrizeId[] = ['freeMeal', 'freeCookie', 'freeWater', 'freeSauce', 'doubleStamp', 'tenOff', 'voucher', 'tryAgain'];

/**
 * fresh: just paid (show change). spin: reopened to log a spin called out
 * at the wheel. past: looking back at an old order (read-only for money).
 */
export type AfterPayMode = 'fresh' | 'spin' | 'past';

/** Shown after payment: log each bowl's spin, then show the order number. */
export function AfterPay({
  mode,
  order,
  orders,
  s,
  pickFree,
  onPatch,
  onDone,
}: {
  mode: AfterPayMode;
  order: Order;
  orders: Order[];
  s: Settings;
  pickFree: (kind: MenuItem['kind']) => MenuItem | undefined;
  /** Saves only the fields that changed, so a change made on another device is not erased. */
  onPatch: (patch: Partial<Order>) => void;
  onDone: () => void;
}) {
  const bowls = useMemo(() => spinnableBowls(order.lines, s), [order.lines, s]);
  const past = mode === 'past';
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const [cardInput, setCardInput] = useState('');
  const spinsLeft = order.spinsEarned - order.spins.length;
  const nextBowl = bowls.find((b) => !order.spins.some((x) => x.lineId === b.lineId && x.unit === b.unit));
  // Only prizes logged since this screen opened are still to be paid out.
  const [spinsAtOpen] = useState(() => (mode === 'fresh' ? 0 : order.spins.length));
  const refund = past ? prizeRefundTotal(order) : order.spins.slice(spinsAtOpen).reduce((n, x) => n + x.refund, 0);
  const cardList = useStore((st) => modeCards(st));
  const card = order.cardId ? cardStateFor(order.cardId, orders.filter((o) => o.id !== order.id).concat(order), s, cardList) : null;
  const vouchers = order.spins.filter((x) => x.voucherCode);
  /** The real days a voucher won at `at` can be used, e.g. "on Tue, Nov 24". */
  const voucherDays = (at: number) => {
    const w = voucherWindow(localDate(at), s);
    return w.validTo > w.validFrom ? `${niceDate(w.validFrom)} to ${niceDate(w.validTo)}` : `on ${niceDate(w.validFrom)}`;
  };

  const spinPatch = (o: Order): Partial<Order> => ({ spins: o.spins, lines: o.lines, stampsEarned: o.stampsEarned });

  /** `landed` is what the wheel showed; the prize really given (r.spin.prize) can differ on the last day. */
  const log = (landed: PrizeId, via: 'physical' | 'digital') => {
    // A past order is only for looking: nothing is logged from here.
    if (past || !nextBowl) return;
    const r = applyPrize(order, nextBowl, landed, { settings: s, pickFree, via, now: Date.now() });
    if (!r.ok) return setMessage({ text: r.message, bad: true });
    onPatch(spinPatch(r.order));
    setMessage({ text: via === 'digital' ? `Digital wheel landed on ${PRIZE_LABEL[landed]}. ${r.message}` : r.message });
  };

  const undo = () => {
    if (past) return;
    onPatch(spinPatch(undoLastSpin(order)));
    setMessage({ text: 'Last spin undone.' });
  };

  const attachCard = () => {
    const id = parseCard(cardInput, s);
    if (!id) return setMessage({ text: `Unknown card number. Cards run ${s.loyalty.prefix}${String(s.loyalty.first).padStart(3, '0')} to ${s.loyalty.prefix}${s.loyalty.last}.`, bad: true });
    onPatch({ cardId: id, stampsEarned: order.stampsEarned + 1 });
    setCardInput('');
    setMessage({ text: `Card ${id} added. +1 stamp.` });
  };

  const [openedAt] = useState(() => Date.now());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      // The Enter that confirmed the payment may still be held down: it must
      // not close this screen before the cashier has read the change.
      if (e.repeat || Date.now() - openedAt < AFTERPAY_KEY_DELAY_MS) {
        if (e.key === 'Enter') e.preventDefault();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        onDone();
        return;
      }
      const n = Number(e.key);
      if (!past && spinsLeft > 0 && n >= 1 && n <= PRIZE_ORDER.length) log(PRIZE_ORDER[n - 1], 'physical');
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  return (
    <div className="afterpay">
      <div className="afterpay-main">
        <div className="order-hero">
          <div className="burst" aria-hidden="true" />
          <div className="order-hero-text">
            <span>Order number</span>
            <b className="display">{order.number}</b>
          </div>
        </div>
        {past && (
          <p className="banner warn">
            Past order, paid at {new Date(order.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Change and cash give-backs were already handled then.
          </p>
        )}
        {mode === 'fresh' && order.payment.method === 'cash' && order.payment.change > 0 && (
          <div className="change big-change">
            <span>Change</span>
            <b className="display">{peso(order.payment.change)}</b>
          </div>
        )}

        {past && spinsLeft > 0 ? (
          <p className="muted">
            {spinsLeft} spin{spinsLeft > 1 ? 's were' : ' was'} not logged on this order.
          </p>
        ) : spinsLeft > 0 && nextBowl ? (
          <section className="spin-panel">
            <h2>
              🎡 Spin {order.spins.length + 1} of {order.spinsEarned} <span className="muted">for {nextBowl.name}</span>
            </h2>
            <p className="muted">
              The customer spins at the pickup wheel. Tap the prize when it's called out, here or later from <b>Spins waiting</b> (keys 1–8).
            </p>
            <div className="prize-grid">
              {PRIZE_ORDER.map((p, i) => (
                <button key={p} className={`prize prize-${p}`} onClick={() => log(p, 'physical')}>
                  <kbd>{i + 1}</kbd>
                  {PRIZE_LABEL[p]}
                </button>
              ))}
            </div>
            <button className="btn" onClick={() => log(digitalSpin(s.wheel.slots), 'digital')}>
              Wheel broken? Use the digital backup wheel
            </button>
          </section>
        ) : order.spinsEarned > 0 ? (
          <p className="ok-note">All spins logged.</p>
        ) : (
          <p className="muted">No spins on this order{order.voucher ? ' (voucher used)' : s.wheel.paused ? ' (wheel paused)' : ''}.</p>
        )}

        {message && <p className={message.bad ? 'error' : 'ok-note'}>{message.text}</p>}
        {!past && order.spins.length > spinsAtOpen && (
          <button className="btn ghost small" onClick={undo}>
            Undo last spin
          </button>
        )}
      </div>

      <aside className="afterpay-side">
        {refund > 0 && (
          <div className={`giveback ${past ? 'past' : ''}`}>
            <span>{past ? 'Cash given back (all spins)' : 'Give back cash'}</span>
            <b className="display">{peso(refund)}</b>
          </div>
        )}
        {vouchers.length > 0 && (
          <div className="voucher-box">
            <span>Write on a voucher slip</span>
            {vouchers.map((v) => (
              <b key={v.voucherCode}>{v.voucherCode}</b>
            ))}
            {[...new Set(vouchers.map((v) => voucherDays(v.at)))].map((days) => (
              <small key={days}>
                ₱{s.voucher.amount} off, valid {days}, min ₱{s.voucher.minOrder}
              </small>
            ))}
          </div>
        )}
        {order.spins.length > 0 && (
          <ul className="spin-list">
            {order.spins.map((x, i) => (
              <li key={i}>
                {PRIZE_LABEL[x.prize]}
                {x.refund > 0 && ` (−${peso(x.refund)})`}
              </li>
            ))}
          </ul>
        )}
        {card ? (
          <div className="stamps">
            <span>
              {card.cardId} <CardNameField number={card.cardId} by={order.cashier} />
            </span>
            <b>
              {card.stamps}/{s.loyalty.cardSize}
            </b>
            <StampDots n={card.stamps} size={s.loyalty.cardSize} />
            {availableRewards(card, s).length > 0 && <small>Reward ready next visit: {availableRewards(card, s).map((r) => r.label).join(', ')}</small>}
          </div>
        ) : (
          <div className="stack">
            <label className="field">
              <span>Forgot the loyalty card?</span>
              <input className="input" value={cardInput} onChange={(e) => setCardInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && attachCard()} placeholder="Card number, e.g. 37" />
            </label>
            <button className="btn small" onClick={attachCard}>Add card</button>
          </div>
        )}
        <button className="btn primary big full" onClick={onDone}>
          {past ? 'Back to orders ↵' : 'Next order ↵'}
        </button>
        {spinsLeft > 0 && !past && (
          <p className="muted small center">
            {spinsLeft} spin{spinsLeft > 1 ? 's' : ''} waiting. They stay in <b>Spins waiting</b> for 45 minutes.
          </p>
        )}
      </aside>
    </div>
  );
}

export function StampDots({ n, size }: { n: number; size: number }) {
  return (
    <div className="stamp-dots" aria-label={`${n} of ${size} stamps`}>
      {Array.from({ length: size }, (_, i) => (
        <span key={i} className={i < n ? 'on' : ''} />
      ))}
    </div>
  );
}
