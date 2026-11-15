import { useCallback, useEffect, useMemo, useState } from 'react';
import { amountDue, createOrder } from '../../domain/checkout';
import { availableRewards, canRedeem, cardState, checkVoucher, localDate, parseCard } from '../../domain/loyalty';
import { applyCombo, itemById, newId, lineTotal, lineUnitTotal, peso, spinsEarned, stockUsage, subtotal, suggestCombo } from '../../domain/pricing';
import { isAvailable, stockLeft } from '../../domain/reports';
import type { Category, Combo, MenuItem, Order, OrderLine, Reward } from '../../domain/types';
import { modeOrders, openDay, patchDay, patchOrder, putOrder, useDevice, useStore } from '../../data/store';
import { TopBar } from '../../ui/TopBar';
import { OpenDayForm } from './OpenDay';
import { AfterPay, PayModal, StampDots } from './payflow';
import { ComboPicker, ItemPicker } from './pickers';

const TABS: { id: Category; label: string }[] = [
  { id: 'bowls', label: 'Bowls' },
  { id: 'fries', label: 'Fries' },
  { id: 'drinks', label: 'Drinks' },
  { id: 'cookies', label: 'Cookies' },
  { id: 'combos', label: 'Combos' },
  { id: 'addons', label: 'Add-ons' },
];

type Picking =
  | { type: 'item'; item: MenuItem; free?: OrderLine['free'] }
  | { type: 'combo'; combo: Combo }
  | { type: 'reward'; reward: Reward }
  | null;

export function Cashier() {
  const state = useStore((s) => s);
  const s = state.settings;
  const device = useDevice();
  const day = openDay(state);
  const orders = useMemo(() => modeOrders(state), [state]);
  const left = useMemo(() => stockLeft(day, orders, s), [day, orders, s]);

  const [tab, setTab] = useState<Category>('bowls');
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [picking, setPicking] = useState<Picking>(null);
  const [paying, setPaying] = useState(false);
  const [afterPay, setAfterPay] = useState<string | null>(null);
  const [soldOutMode, setSoldOutMode] = useState(false);
  const [cardInput, setCardInput] = useState('');
  const [cardId, setCardId] = useState<string | undefined>();
  const [voucherInput, setVoucherInput] = useState('');
  const [voucher, setVoucher] = useState<{ code: string; amount: number } | undefined>();
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [comboDismissed, setComboDismissed] = useState<string>('');
  const [escArmed, setEscArmed] = useState(false);

  const cartUse = useMemo(() => stockUsage(lines), [lines]);
  const remaining = useCallback((id: string) => (left[id] ?? 0) - (cartUse[id] ?? 0), [left, cartUse]);
  const canUse = useCallback(
    (id: string) => {
      const it = itemById(s, id);
      return !!it && isAvailable(it, day, left) && remaining(id) > 0;
    },
    [s, day, left, remaining],
  );

  const card = useMemo(() => (cardId ? cardState(cardId, orders, s) : null), [cardId, orders, s]);
  const rewardsInCart = lines.flatMap((l) => (l.free?.reason === 'reward' ? [l.free.stampsAt] : []));
  const sub = subtotal(lines, s);
  const due = amountDue(lines, s, voucher?.amount ?? 0);
  const spins = spinsEarned(lines, s, !!voucher);
  const combo = suggestCombo(lines, s);
  const comboKey = combo ? combo.combo.id + combo.lineIds.join() : '';

  const flash = (text: string, bad = false) => {
    setNotice({ text, bad });
    setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 4000);
  };

  // ----- Adding items -----
  const addLine = (line: OrderLine) => {
    const use = stockUsage([line]);
    for (const [id, n] of Object.entries(use)) {
      if (remaining(id) < n) {
        flash(`Not enough ${itemById(s, id)?.name ?? id} left (${Math.max(0, remaining(id))}).`, true);
        return;
      }
    }
    // Same item with the same choices: bump quantity.
    const same = lines.find((l) => !l.combo && !l.free && !line.free && !line.combo && l.itemId === line.itemId && JSON.stringify(l.choices ?? {}) === JSON.stringify(line.choices ?? {}) && (l.notes ?? '') === (line.notes ?? ''));
    if (same) setLines(lines.map((l) => (l === same ? { ...l, qty: l.qty + 1 } : l)));
    else setLines([...lines, line]);
    setPicking(null);
  };

  const tapItem = (item: MenuItem) => {
    if (soldOutMode) {
      if (!day) return;
      patchDay(day.id, { soldOut: { ...day.soldOut, [item.id]: !day.soldOut[item.id] } });
      return;
    }
    if (!canUse(item.id)) return flash(`${item.name} is sold out.`, true);
    if (item.kind === 'bowl' || item.kind === 'fries' || item.kind === 'extraSide') setPicking({ type: 'item', item });
    else addLine({ id: newId('l'), itemId: item.id, name: item.name, qty: 1, unitPrice: item.price });
  };

  const comboAvailable = (c: Combo) =>
    c.parts.every((k) => s.menu.some((m) => (k === 'fries' ? m.kind === 'fries' && m.regular : m.kind === k) && canUse(m.id)));

  const changeQty = (id: string, d: number) => {
    const line = lines.find((l) => l.id === id)!;
    if (d > 0) {
      if (line.free) return flash('Free items are one each.', true);
      for (const [itemId, n] of Object.entries(stockUsage([{ ...line, qty: 1 }]))) {
        if (remaining(itemId) < n) return flash(`No more ${itemById(s, itemId)?.name ?? itemId} left.`, true);
      }
    }
    setLines(lines.flatMap((l) => (l.id !== id ? [l] : l.qty + d <= 0 ? [] : [{ ...l, qty: l.qty + d }])));
  };

  // ----- Card & voucher -----
  const applyCard = () => {
    if (!cardInput.trim()) return;
    const id = parseCard(cardInput, s);
    if (!id) return flash(`Unknown card number. Cards run ${s.loyalty.prefix}${String(s.loyalty.first).padStart(3, '0')}–${s.loyalty.prefix}${s.loyalty.last}.`, true);
    setCardId(id);
    setCardInput('');
  };

  const useReward = (r: Reward) => {
    if (!card) return;
    if (rewardsInCart.includes(r.at)) return flash('That reward is already in this order.', true);
    const ok = canRedeem(card, r.at, s);
    if (!ok.ok) return flash(ok.message, true);
    if (r.itemId) {
      const item = itemById(s, r.itemId);
      if (!item || !canUse(item.id)) return flash(`${item?.name ?? 'Item'} is sold out.`, true);
      setPicking({ type: 'item', item, free: { reason: 'reward', stampsAt: r.at } });
    } else setPicking({ type: 'reward', reward: r });
  };

  const applyVoucher = () => {
    const r = checkVoucher(voucherInput, orders, s, day?.date ?? localDate(), sub);
    if (!r.ok) return flash(r.message, true);
    setVoucher({ code: r.code, amount: r.amount });
    setVoucherInput('');
    flash('Voucher applied. Orders with a voucher do not get spins.');
  };

  // Drop the voucher if the order falls below the minimum.
  useEffect(() => {
    if (voucher && sub < s.voucher.minOrder) {
      setVoucher(undefined);
      flash(`Voucher removed: order is under ₱${s.voucher.minOrder}.`, true);
    }
  }, [sub, voucher, s.voucher.minOrder]);

  const clearOrder = () => {
    setLines([]);
    setCardId(undefined);
    setCardInput('');
    setVoucher(undefined);
    setVoucherInput('');
    setEscArmed(false);
  };

  // ----- Pay -----
  const pay = (method: Order['payment']['method'], tendered: number, reference: string) => {
    if (!day) return;
    try {
      const o = createOrder({
        lines,
        day,
        orders,
        prefix: device.orderLetter || 'A',
        cashier: device.cashier || day.openedBy,
        cardId,
        rewardsRedeemed: rewardsInCart,
        voucher,
        method,
        tendered,
        reference,
        settings: s,
        now: Date.now(),
      });
      putOrder(o);
      setPaying(false);
      setAfterPay(o.id);
      clearOrder();
    } catch (e) {
      flash((e as Error).message, true);
    }
  };

  const pickFree = (kind: MenuItem['kind']) =>
    s.menu.filter((m) => m.kind === kind && isAvailable(m, day, left)).sort((a, b) => a.price - b.price)[0];

  // ----- Keyboard -----
  const visible = useMemo(() => {
    if (tab === 'combos') return [];
    return s.menu.filter((m) => m.category === tab && m.active && (soldOutMode || !day?.soldOut[m.id]));
  }, [s.menu, tab, soldOutMode, day]);
  const combos = s.combos.filter((c) => c.active);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (picking || paying || afterPay) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        e.preventDefault();
        if (tab === 'combos') {
          const c = combos[n - 1];
          if (c) comboAvailable(c) ? setPicking({ type: 'combo', combo: c }) : flash(`${c.name} is sold out.`, true);
        } else if (visible[n - 1]) tapItem(visible[n - 1]);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const i = TABS.findIndex((t) => t.id === tab);
        setTab(TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id);
      } else if (e.key === 'Enter' && lines.length) {
        e.preventDefault();
        setPaying(true);
      } else if (e.key === 'Escape' && lines.length) {
        if (escArmed) clearOrder();
        else {
          setEscArmed(true);
          setTimeout(() => setEscArmed(false), 2500);
        }
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  if (!day) return <OpenDayForm />;

  const after = afterPay ? state.orders[afterPay] : undefined;
  const readyToClaim = orders.filter((o) => o.dayId === day.id && o.status === 'ready' && !o.voided).sort((a, b) => (a.readyAt ?? 0) - (b.readyAt ?? 0));
  const soldOutCount = s.menu.filter((m) => m.active && day.soldOut[m.id]).length;

  return (
    <div className="screen cashier">
      <TopBar title="Cashier" />
      {after ? (
        <AfterPay order={after} orders={orders} s={s} pickFree={pickFree} onUpdate={putOrder} onDone={() => setAfterPay(null)} />
      ) : (
        <div className="cashier-body">
          <section className="menu-side">
            <nav className="tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'selected' : ''} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
              <span className="tabs-spacer" />
              <button className={`btn small ${soldOutMode ? 'danger' : 'ghost'}`} onClick={() => setSoldOutMode(!soldOutMode)}>
                {soldOutMode ? 'Done marking' : `Mark sold out${soldOutCount ? ` (${soldOutCount} out)` : ''}`}
              </button>
            </nav>
            {soldOutMode && <p className="banner warn">Tap an item to mark it sold out, or tap again to bring it back.</p>}

            <div className="tiles">
              {tab === 'combos'
                ? combos.map((c, i) => {
                    const ok = comboAvailable(c);
                    return (
                      <button key={c.id} className={`tile tile-combo ${ok ? '' : 'out'}`} onClick={() => (ok ? setPicking({ type: 'combo', combo: c }) : flash(`${c.name} is sold out.`, true))}>
                        <kbd>{i + 1}</kbd>
                        <span className="tile-name">{c.name}</span>
                        <span className="tile-sub">{c.parts.map((p) => (p === 'fries' ? 'regular fries' : p)).join(' + ')}</span>
                        <span className="tile-price">{peso(c.price)}</span>
                      </button>
                    );
                  })
                : visible.map((m, i) => {
                    const n = remaining(m.id);
                    const out = !!day.soldOut[m.id] || n <= 0;
                    return (
                      <button key={m.id} className={`tile tile-${m.category} ${out ? 'out' : ''}`} onClick={() => tapItem(m)}>
                        {i < 9 && <kbd>{i + 1}</kbd>}
                        <span className="tile-name">{m.short && m.category === 'bowls' ? m.short : m.name}</span>
                        <span className="tile-price">{peso(m.price)}</span>
                        <span className={`tile-stock ${n <= 5 ? 'low' : ''}`}>{day.soldOut[m.id] ? 'SOLD OUT' : n <= 0 ? 'SOLD OUT (0 left)' : `${n} left`}</span>
                      </button>
                    );
                  })}
            </div>

            {readyToClaim.length > 0 && (
              <div className="claim-strip">
                <span>Ready, tap when picked up:</span>
                {readyToClaim.map((o) => (
                  <button key={o.id} className="btn small success" onClick={() => patchOrder(o.id, { status: 'claimed', claimedAt: Date.now() })}>
                    {o.number} ✓
                  </button>
                ))}
              </div>
            )}
            <p className="key-help">
              Keys: <kbd>1</kbd>–<kbd>9</kbd> add item · <kbd>←</kbd>
              <kbd>→</kbd> switch tab · <kbd>Enter</kbd> pay · <kbd>Esc</kbd> twice to cancel order
            </p>
          </section>

          <section className="order-side">
            <h2 className="order-title">
              Order <span className="muted">· {day.date}</span>
            </h2>
            {lines.length === 0 ? (
              <p className="empty">Tap an item to start an order.</p>
            ) : (
              <ul className="lines">
                {lines.map((l) => (
                  <li key={l.id} className={`line ${l.free ? 'free' : ''}`}>
                    <div className="line-main">
                      <div className="line-name">
                        <b>{l.name}</b>
                        <LineDetails line={l} />
                        {l.notes && <span className="note">📝 {l.notes}</span>}
                      </div>
                      <div className="line-price">{peso(lineTotal(l, s))}</div>
                    </div>
                    <div className="line-actions">
                      <div className="stepper">
                        <button className="btn small" onClick={() => changeQty(l.id, -1)} aria-label="Less">−</button>
                        <b>{l.qty}</b>
                        <button className="btn small" onClick={() => changeQty(l.id, 1)} aria-label="More">+</button>
                      </div>
                      {l.qty > 1 && <span className="muted small">{peso(lineUnitTotal(l, s))} each</span>}
                      <span className="spacer" />
                      <button className="btn ghost small" onClick={() => setEditingNote(editingNote === l.id ? null : l.id)}>Note</button>
                      <button className="btn ghost small danger-text" onClick={() => setLines(lines.filter((x) => x.id !== l.id))}>Remove</button>
                    </div>
                    {editingNote === l.id && (
                      <input
                        className="input"
                        autoFocus
                        defaultValue={l.notes}
                        placeholder="e.g. no cucumber"
                        onBlur={(e) => {
                          setLines(lines.map((x) => (x.id === l.id ? { ...x, notes: e.target.value.trim() || undefined } : x)));
                          setEditingNote(null);
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}

            {combo && comboDismissed !== comboKey && (
              <div className="banner combo-offer">
                <span>
                  This order has everything in <b>{combo.combo.name}</b>. Switch and save <b>{peso(combo.saving)}</b>?
                </span>
                <div className="row">
                  <button className="btn primary small" onClick={() => setLines(applyCombo(lines, combo, s))}>Make it {combo.combo.name}</button>
                  <button className="btn ghost small" onClick={() => setComboDismissed(comboKey)}>No</button>
                </div>
              </div>
            )}

            <div className="loyalty">
              {card ? (
                <div className="card-row">
                  <div>
                    <b>{card.cardId}</b> <span className="muted">{card.stamps}/{s.loyalty.cardSize} stamps</span>
                    <StampDots n={card.stamps} size={s.loyalty.cardSize} />
                  </div>
                  <button className="btn ghost small" onClick={() => { setCardId(undefined); setLines(lines.filter((l) => l.free?.reason !== 'reward')); }}>✕</button>
                </div>
              ) : (
                <div className="row">
                  <input className="input" value={cardInput} onChange={(e) => setCardInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), applyCard())} placeholder="Loyalty card no. (e.g. 37)" />
                  <button className="btn" onClick={applyCard}>Add card</button>
                </div>
              )}
              {card &&
                availableRewards(card, s).map((r) => (
                  <button key={r.at} className="btn reward" disabled={rewardsInCart.includes(r.at)} onClick={() => useReward(r)}>
                    🎁 Use reward: {r.label} ({r.at} stamps)
                  </button>
                ))}
            </div>

            <div className="voucher">
              {voucher ? (
                <div className="card-row">
                  <span>
                    Voucher <b>{voucher.code}</b> −{peso(voucher.amount)}
                  </span>
                  <button className="btn ghost small" onClick={() => setVoucher(undefined)}>✕</button>
                </div>
              ) : (
                <div className="row">
                  <input className="input" value={voucherInput} onChange={(e) => setVoucherInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), applyVoucher())} placeholder="Voucher code (V-XXXX)" />
                  <button className="btn" onClick={applyVoucher} disabled={!voucherInput.trim()}>Apply</button>
                </div>
              )}
            </div>

            {notice && <p className={notice.bad ? 'error' : 'ok-note'}>{notice.text}</p>}
            {escArmed && <p className="error">Press Esc again to cancel this order.</p>}

            <div className="totals">
              {voucher && (
                <div>
                  <span>Subtotal</span>
                  <span>{peso(sub)}</span>
                </div>
              )}
              {voucher && (
                <div>
                  <span>Voucher</span>
                  <span>−{peso(voucher.amount)}</span>
                </div>
              )}
              <div className="grand">
                <span>Total</span>
                <b>{peso(due)}</b>
              </div>
              {lines.length > 0 && <div className="muted small">{spins > 0 ? `🎡 ${spins} spin${spins > 1 ? 's' : ''} after paying` : s.wheel.paused ? 'Wheel paused' : 'No spins'}</div>}
            </div>
            <div className="row">
              <button className="btn ghost" disabled={!lines.length} onClick={clearOrder}>Cancel</button>
              <button className="btn primary big grow" disabled={!lines.length} onClick={() => setPaying(true)}>
                Pay {lines.length ? peso(due) : ''} ↵
              </button>
            </div>
          </section>
        </div>
      )}

      {picking?.type === 'item' && <ItemPicker item={picking.item} s={s} free={picking.free} onAdd={addLine} onClose={() => setPicking(null)} />}
      {picking?.type === 'combo' && <ComboPicker combo={picking.combo} s={s} canUse={canUse} onAdd={addLine} onClose={() => setPicking(null)} />}
      {picking?.type === 'reward' && (
        <RewardBowlPicker
          items={s.menu.filter((m) => m.category === picking.reward.category && m.active)}
          canUse={canUse}
          onPick={(item) => setPicking({ type: 'item', item, free: { reason: 'reward', stampsAt: picking.reward.at } })}
          onClose={() => setPicking(null)}
        />
      )}
      {paying && <PayModal due={due} onPay={pay} onClose={() => setPaying(false)} />}
    </div>
  );
}

export function LineDetails({ line }: { line: OrderLine }) {
  const bits: string[] = [];
  const add = (c?: OrderLine['choices']) => {
    if (!c) return;
    if (c.side) bits.push(c.side);
    if (c.extraSides?.length) bits.push(`+ extra ${c.extraSides.join(', ')}`);
    if (c.extraSauce) bits.push(`+ ${c.extraSauce} extra sauce`);
    if (c.dip) bits.push(`dip: ${c.dip}`);
  };
  add(line.choices);
  line.combo?.parts.forEach((p) => add(p));
  return bits.length ? <span className="details">{bits.join(' · ')}</span> : null;
}

function RewardBowlPicker({ items, canUse, onPick, onClose }: { items: MenuItem[]; canUse: (id: string) => boolean; onPick: (m: MenuItem) => void; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Pick the free item">
        <div className="modal-head">
          <h2>Reward: pick the flavor</h2>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        <div className="option-grid">
          {items.map((m) => (
            <button key={m.id} className="option" disabled={!canUse(m.id)} onClick={() => onPick(m)}>
              {m.short ?? m.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
