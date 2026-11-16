import { useCallback, useEffect, useMemo, useState } from 'react';
import { amountDue, createOrder, nextSeq, orderNumber } from '../../domain/checkout';
import { availableRewards, canRedeem, cardState, checkVoucher, localDate, parseCard } from '../../domain/loyalty';
import { applyCombo, itemById, needsPicker, newId, lineTotal, lineUnitTotal, peso, spinsEarned, stockUsage, subtotal, suggestCombo } from '../../domain/pricing';
import { allergenText, itemTags } from '../../domain/allergens';
import { promoStatus } from '../../domain/promo';
import { isAvailable, pendingSpins, stockLeft, summarize } from '../../domain/reports';
import type { Category, Combo, MenuItem, Order, OrderLine, PaymentMethod, Reward } from '../../domain/types';
import { publishCart } from '../../data/live';
import { modeOrders, openDay, patchDay, patchOrder, putOrder, saveSettings, useDevice, useStore } from '../../data/store';
import { TopBar } from '../../ui/TopBar';
import { OpenDayForm } from './OpenDay';
import { AfterPay, PayModal, StampDots, type AfterPayMode } from './payflow';
import { ComboPicker, ItemPicker } from './pickers';
import { CardLookup, WasteLog } from './tools';

const TABS: { id: Category; label: string }[] = [
  { id: 'bowls', label: 'Bowls' },
  { id: 'fries', label: 'Fries' },
  { id: 'drinks', label: 'Drinks' },
  { id: 'cookies', label: 'Cookies' },
  { id: 'combos', label: 'Combos' },
  { id: 'addons', label: 'Add-ons' },
];

type Picking =
  | { type: 'item'; item: MenuItem; free?: OrderLine['free']; initial?: OrderLine }
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
  const [afterPay, setAfterPay] = useState<{ id: string; mode: AfterPayMode } | null>(null);
  const [soldOutMode, setSoldOutMode] = useState(false);
  const [cardInput, setCardInput] = useState('');
  const [cardId, setCardId] = useState<string | undefined>();
  const [voucherInput, setVoucherInput] = useState('');
  const [voucher, setVoucher] = useState<{ code: string; amount: number } | undefined>();
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [comboDismissed, setComboDismissed] = useState<string>('');
  const [escArmed, setEscArmed] = useState(false);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [tool, setTool] = useState<'card' | 'waste' | null>(null);
  const [promoDismissed, setPromoDismissed] = useState<string>('');

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
    const existing = lines.find((l) => l.id === line.id);
    const freed = existing ? stockUsage([existing]) : {};
    const use = stockUsage([line]);
    for (const [id, n] of Object.entries(use)) {
      const avail = remaining(id) + (freed[id] ?? 0);
      if (avail < n) {
        flash(`Not enough ${itemById(s, id)?.name ?? id} left (${Math.max(0, avail)}).`, true);
        return;
      }
    }
    if (existing) {
      setLines(lines.map((l) => (l.id === line.id ? line : l)));
      setPicking(null);
      return;
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
    if (needsPicker(item)) setPicking({ type: 'item', item });
    else addLine({ id: newId('l'), itemId: item.id, name: item.name, qty: 1, unitPrice: item.price });
  };

  /** Smallest saving a combo gives versus buying its cheapest parts separately. */
  const comboSaving = (c: Combo) =>
    c.parts.reduce((sum, k) => {
      const prices = s.menu.filter((m) => m.active && (k === 'fries' ? m.kind === 'fries' && m.regular : m.kind === k)).map((m) => m.price);
      return sum + (prices.length ? Math.min(...prices) : 0);
    }, 0) - c.price;

  const editLine = (l: OrderLine) => {
    if (l.combo) return flash('To change a combo, remove it and add it again.');
    const item = itemById(s, l.itemId);
    if (!item || !needsPicker(item)) return;
    setPicking({ type: 'item', item, initial: l });
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
      setPayMethod('cash');
      setAfterPay({ id: o.id, mode: 'fresh' });
      clearOrder();
    } catch (e) {
      flash((e as Error).message, true);
    }
  };

  const pickFree = (kind: MenuItem['kind']) =>
    s.menu.filter((m) => m.kind === kind && isAvailable(m, day, left)).sort((a, b) => a.price - b.price)[0];

  // ----- Customer monitor: show the order as it is rung up -----
  const afterOrder = afterPay ? state.orders[afterPay.id] : undefined;
  useEffect(() => {
    if (afterOrder && afterPay?.mode === 'fresh') {
      publishCart({
        stage: 'paid',
        number: afterOrder.number,
        spins: afterOrder.spinsEarned - afterOrder.spins.length,
        change: afterOrder.payment.method === 'cash' ? afterOrder.payment.change : 0,
        paid: afterOrder.payment.due,
        method: afterOrder.payment.method,
      });
      return;
    }
    if (!lines.length) {
      publishCart({ stage: 'idle' });
      return;
    }
    publishCart({
      stage: paying ? 'paying' : 'ordering',
      lines: lines.map((l) => {
        const bits: string[] = [];
        const add = (c?: OrderLine['choices']) => {
          if (c?.side) bits.push(c.side);
          if (c?.extraSides?.length) bits.push(`+${c.extraSides.join(', ')}`);
          if (c?.extraSauce) bits.push(`+${c.extraSauce} sauce`);
          if (c?.dip) bits.push(c.dip);
        };
        add(l.choices);
        l.combo?.parts.forEach((p) => add(p));
        return { qty: l.qty, name: l.name, details: bits.join(' · '), total: lineTotal(l, s), free: !!l.free };
      }),
      subtotal: sub,
      voucher: voucher?.amount,
      due,
      spins,
      method: paying ? payMethod : undefined,
    });
  }, [lines, paying, payMethod, voucher, afterOrder, afterPay?.mode, s, sub, due, spins]);

  // ----- Keyboard -----
  const visible = useMemo(() => {
    if (tab === 'combos') return [];
    return s.menu.filter((m) => m.category === tab && m.active && (soldOutMode || !day?.soldOut[m.id]));
  }, [s.menu, tab, soldOutMode, day]);
  const combos = s.combos.filter((c) => c.active);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (picking || paying || afterPay || tool) return;
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

  const after = afterPay ? state.orders[afterPay.id] : undefined;
  const todays = orders.filter((o) => o.dayId === day.id && !o.voided);
  const readyToClaim = todays.filter((o) => o.status === 'ready').sort((a, b) => (a.readyAt ?? 0) - (b.readyAt ?? 0));
  const inKitchen = todays.filter((o) => o.status === 'new' || o.status === 'cooking').length;
  const recent = [...todays].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const waitingSpins = pendingSpins(day, orders, Date.now());
  const nextNumber = orderNumber(device.orderLetter || 'A', nextSeq(day, orders, device.orderLetter || 'A'));
  const soldOutCount = s.menu.filter((m) => m.active && day.soldOut[m.id]).length;
  const promo = promoStatus(summarize(day, orders, s), s);
  const promoKey = `${day.id}:${promo.level}`;
  const methods: PaymentMethod[] = ['cash', ...(s.payments.gcash ? (['gcash'] as const) : []), ...(s.payments.maya ? (['maya'] as const) : [])];
  const tabCount = (id: Category) =>
    lines.reduce((n, l) => n + (id === 'combos' ? (l.combo ? l.qty : 0) : !l.combo && itemById(s, l.itemId)?.category === id ? l.qty : 0), 0);

  return (
    <div className="screen cashier">
      <TopBar title="Cashier">
        <div className="status-strip" aria-label="Booth status">
          <span>
            Next <b>{nextNumber}</b>
          </span>
          <span>
            Kitchen <b>{inKitchen}</b>
          </span>
          <span className={readyToClaim.length ? 'hot' : ''}>
            Ready <b>{readyToClaim.length}</b>
          </span>
          <span>
            Today <b>{todays.length}</b>
          </span>
        </div>
      </TopBar>
      {after ? (
        <AfterPay mode={afterPay?.mode ?? 'fresh'} order={after} orders={orders} s={s} pickFree={pickFree} onUpdate={putOrder} onDone={() => setAfterPay(null)} />
      ) : (
        <div className="cashier-body">
          <section className="menu-side">
            <nav className="tabs" role="tablist" aria-label="Menu">
              {TABS.map((t) => {
                const n = tabCount(t.id);
                return (
                  <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab tab-${t.id} ${tab === t.id ? 'selected' : ''}`} onClick={() => setTab(t.id)}>
                    {t.label}
                    {n > 0 && <span className="tab-count">{n}</span>}
                  </button>
                );
              })}
              <span className="tabs-spacer" />
              <button className="btn small ghost tool-btn" title="Check a loyalty card's stamps" onClick={() => setTool('card')}>
                Card
              </button>
              <button className="btn small ghost tool-btn" title="Log dropped or spoiled items" onClick={() => setTool('waste')}>
                Waste
              </button>
              <button className={`btn small tool-btn ${soldOutMode ? 'danger' : 'ghost'}`} title="Mark items sold out" onClick={() => setSoldOutMode(!soldOutMode)}>
                {soldOutMode ? 'Done' : `Sold out${soldOutCount ? ` · ${soldOutCount}` : ''}`}
              </button>
            </nav>
            {!s.wheel.paused && (promo.level === 'warn' || promo.level === 'pause') && promoDismissed !== promoKey && (
              <div className={`promo-alert ${promo.level}`} role="alert">
                <span>
                  {promo.level === 'pause' ? <b>Pause the wheel?</b> : <b>Prizes are running high.</b>} Prizes cost {promo.pct.toFixed(1)}% of today's sales (
                  {promo.level === 'pause' ? `limit ${s.promoLimits.pausePct}%` : `warning at ${s.promoLimits.warnPct}%`}).
                </span>
                <div className="row">
                  {promo.level === 'pause' && (
                    <button className="btn small danger" onClick={() => saveSettings({ wheel: { ...s.wheel, paused: true } })}>
                      Pause wheel
                    </button>
                  )}
                  <button className="btn small ghost" onClick={() => setPromoDismissed(promoKey)}>
                    Keep spinning
                  </button>
                </div>
              </div>
            )}
            {soldOutMode && <p className="banner warn">Tap an item to mark it sold out. Tap it again to bring it back.</p>}

            <div className={`tiles ${soldOutMode ? 'marking' : ''}`}>
              {tab === 'combos'
                ? combos.map((c, i) => {
                    const ok = comboAvailable(c);
                    const save = comboSaving(c);
                    return (
                      <button key={c.id} className={`tile tile-combos ${ok ? '' : 'out'}`} onClick={() => (ok ? setPicking({ type: 'combo', combo: c }) : flash(`${c.name} is sold out.`, true))}>
                        <kbd>{i + 1}</kbd>
                        <span className="tile-name">{c.name}</span>
                        <span className="tile-sub">{c.parts.map((p) => (p === 'fries' ? 'regular fries' : p)).join(' + ')}</span>
                        <span className="tile-foot">
                          <span className="tile-price">{peso(c.price)}</span>
                          {ok ? save > 0 && <span className="tile-save">save {peso(save)}+</span> : <span className="tile-out">sold out</span>}
                        </span>
                      </button>
                    );
                  })
                : visible.map((m, i) => {
                    const n = remaining(m.id);
                    const start = day.stockStart[m.id] ?? m.startStock;
                    const marked = !!day.soldOut[m.id];
                    const out = marked || n <= 0;
                    const pct = start > 0 ? Math.max(0, Math.min(100, (n / start) * 100)) : 0;
                    return (
                      <button key={m.id} className={`tile tile-${m.category} ${out ? 'out' : ''} ${!out && n <= 5 ? 'low' : ''}`} onClick={() => tapItem(m)} aria-label={`${m.name}, ${peso(m.price)}, ${out ? 'sold out' : `${n} left`}`}>
                        {i < 9 && <kbd>{i + 1}</kbd>}
                        <span className="tile-name">{m.name}</span>
                        {allergenText(itemTags(m), true) && <span className="tile-allergens">{allergenText(itemTags(m), true)}</span>}
                        <span className="tile-foot">
                          <span className="tile-price">{peso(m.price)}</span>
                          <span className="tile-left">{marked ? 'sold out' : n <= 0 ? '0 left' : `${n} left`}</span>
                        </span>
                        <span className="stock-meter" aria-hidden="true">
                          <span style={{ width: `${out ? 0 : pct}%` }} />
                        </span>
                      </button>
                    );
                  })}
            </div>

            <div className="orders-bar">
              {readyToClaim.length > 0 && (
                <div className="orders-group">
                  <span className="orders-label">Ready · tap when picked up</span>
                  {readyToClaim.map((o) => (
                    <button key={o.id} className="btn small success" onClick={() => patchOrder(o.id, { status: 'claimed', claimedAt: Date.now() })}>
                      {o.number} ✓
                    </button>
                  ))}
                </div>
              )}
              {waitingSpins.length > 0 && (
                <div className="orders-group">
                  <span className="orders-label">🎡 Spins waiting · tap to log the prize</span>
                  {waitingSpins.map((o) => {
                    const left = o.spinsEarned - o.spins.length;
                    return (
                      <button key={o.id} className="btn small recent spin-waiting" onClick={() => setAfterPay({ id: o.id, mode: 'spin' })}>
                        {o.number}
                        {left > 1 && <span className="recent-spin">×{left}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              {recent.length > 0 && (
                <div className="orders-group">
                  <span className="orders-label">Recent · tap to see voucher, stamps</span>
                  {recent.map((o) => (
                    <button key={o.id} className="btn small recent" onClick={() => setAfterPay({ id: o.id, mode: 'past' })}>
                      {o.number}
                    </button>
                  ))}
                </div>
              )}
              <p className="key-help">
                <kbd>1</kbd>–<kbd>9</kbd> add · <kbd>←</kbd>
                <kbd>→</kbd> tab · <kbd>Enter</kbd> pay · <kbd>Esc</kbd>×2 cancel
              </p>
            </div>
          </section>

          <section className="order-side" aria-label="Current order">
            <div className="order-head">
              <h2>Order</h2>
              <span className="order-next">{nextNumber}</span>
            </div>
            <div className="order-scroll">
              {lines.length === 0 ? (
                <div className="empty-order">
                  <img src="./logo.png" alt="" width={120} height={120} />
                  <p>Tap an item to start an order.</p>
                </div>
              ) : (
                <ul className="lines">
                  {lines.map((l) => {
                    const lineItem = itemById(s, l.itemId);
                    const editable = !l.combo && !!lineItem && needsPicker(lineItem);
                    return (
                      <li key={l.id} className={`line ${l.free ? 'free' : ''}`}>
                        <div className="line-main">
                          <button className="line-name" onClick={() => editLine(l)} disabled={!editable} title={editable ? 'Tap to change side, dip or extras' : undefined}>
                            <b>{l.name}</b>
                            <LineDetails line={l} />
                            {l.notes && <span className="note">Note: {l.notes}</span>}
                            {editable && <span className="edit-hint">Edit</span>}
                          </button>
                          <div className="line-price">{peso(lineTotal(l, s))}</div>
                        </div>
                        <div className="line-actions">
                          <div className="stepper">
                            <button className="btn small" onClick={() => changeQty(l.id, -1)} aria-label={`One less ${l.name}`}>
                              −
                            </button>
                            <b>{l.qty}</b>
                            <button className="btn small" onClick={() => changeQty(l.id, 1)} aria-label={`One more ${l.name}`}>
                              +
                            </button>
                          </div>
                          {l.qty > 1 && <span className="muted small">{peso(lineUnitTotal(l, s))} each</span>}
                          <span className="spacer" />
                          <button className="btn ghost small" onClick={() => setEditingNote(editingNote === l.id ? null : l.id)}>
                            Note
                          </button>
                          <button className="btn ghost small danger-text" onClick={() => setLines(lines.filter((x) => x.id !== l.id))}>
                            Remove
                          </button>
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
                    );
                  })}
                </ul>
              )}

              {combo && comboDismissed !== comboKey && (
                <div className="combo-offer">
                  <span>
                    This order has everything in <b>{combo.combo.name}</b>. Switch and save <b>{peso(combo.saving)}</b>?
                  </span>
                  <div className="row">
                    <button className="btn primary small" onClick={() => setLines(applyCombo(lines, combo, s))}>
                      Make it {combo.combo.name}
                    </button>
                    <button className="btn ghost small" onClick={() => setComboDismissed(comboKey)}>
                      No thanks
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="order-extras">
              {card ? (
                <div className="card-row">
                  <div>
                    <b>{card.cardId}</b> <span className="muted">{card.stamps}/{s.loyalty.cardSize} stamps</span>
                    <StampDots n={card.stamps} size={s.loyalty.cardSize} />
                  </div>
                  <button className="btn ghost small" aria-label="Remove card" onClick={() => { setCardId(undefined); setLines(lines.filter((l) => l.free?.reason !== 'reward')); }}>
                    ✕
                  </button>
                </div>
              ) : (
                <div className="mini-form">
                  <input className="input" value={cardInput} onChange={(e) => setCardInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), applyCard())} placeholder="Loyalty card no." aria-label="Loyalty card number" />
                  <button className="btn small" onClick={applyCard} disabled={!cardInput.trim()}>
                    Add
                  </button>
                </div>
              )}
              {card &&
                availableRewards(card, s).map((r) => (
                  <button key={r.at} className="btn reward" disabled={rewardsInCart.includes(r.at)} onClick={() => useReward(r)}>
                    🎁 Use reward: {r.label}
                  </button>
                ))}
              {voucher ? (
                <div className="card-row">
                  <span>
                    Voucher <b>{voucher.code}</b> −{peso(voucher.amount)}
                  </span>
                  <button className="btn ghost small" aria-label="Remove voucher" onClick={() => setVoucher(undefined)}>
                    ✕
                  </button>
                </div>
              ) : (
                <div className="mini-form">
                  <input className="input" value={voucherInput} onChange={(e) => setVoucherInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), applyVoucher())} placeholder="Voucher code" aria-label="Voucher code" />
                  <button className="btn small" onClick={applyVoucher} disabled={!voucherInput.trim()}>
                    Apply
                  </button>
                </div>
              )}
            </div>

            <div className="totals">
              {voucher && (
                <div className="totals-row">
                  <span>Subtotal</span>
                  <span>{peso(sub)}</span>
                </div>
              )}
              {voucher && (
                <div className="totals-row">
                  <span>Voucher</span>
                  <span>−{peso(voucher.amount)}</span>
                </div>
              )}
              <div className="grand">
                <span>Total</span>
                <b className="display">{peso(due)}</b>
              </div>
              {lines.length > 0 && <div className="spin-hint">{spins > 0 ? `🎡 ${spins} spin${spins > 1 ? 's' : ''} after paying` : s.wheel.paused ? 'Wheel paused today' : 'No spins on this order'}</div>}
              <div className="pay-row">
                <button className="btn ghost" disabled={!lines.length} onClick={clearOrder}>
                  Cancel
                </button>
                <button className="btn primary pay-btn" disabled={!lines.length} onClick={() => setPaying(true)}>
                  {lines.length ? `Pay ${peso(due)}` : 'Pay'} <kbd>↵</kbd>
                </button>
              </div>
            </div>

            <div className="toast-zone" aria-live="polite">
              {escArmed && <p className="toast-msg bad">Press Esc again to cancel this order.</p>}
              {notice && <p className={`toast-msg ${notice.bad ? 'bad' : ''}`}>{notice.text}</p>}
            </div>
          </section>
        </div>
      )}

      {picking?.type === 'item' && <ItemPicker item={picking.item} s={s} free={picking.free} initial={picking.initial} onAdd={addLine} onClose={() => setPicking(null)} />}
      {picking?.type === 'combo' && <ComboPicker combo={picking.combo} s={s} canUse={canUse} onAdd={addLine} onClose={() => setPicking(null)} />}
      {picking?.type === 'reward' && (
        <RewardBowlPicker
          items={s.menu.filter((m) => m.category === picking.reward.category && m.active)}
          canUse={canUse}
          onPick={(item) => setPicking({ type: 'item', item, free: { reason: 'reward', stampsAt: picking.reward.at } })}
          onClose={() => setPicking(null)}
        />
      )}
      {paying && (
        <PayModal
          due={due}
          methods={methods}
          onMethod={setPayMethod}
          onPay={pay}
          onClose={() => {
            setPaying(false);
            setPayMethod('cash');
          }}
        />
      )}
      {tool === 'card' && <CardLookup s={s} orders={orders} onClose={() => setTool(null)} />}
      {tool === 'waste' && <WasteLog s={s} day={day} cashier={device.cashier || day.openedBy} onClose={() => setTool(null)} />}
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
              {m.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
