import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  Minus,
  Plus,
  Search,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { computeCartTotals, formatMoney } from '../lib/format';
import { playRegisterConfirm, unlockAudio } from '../lib/sound';
import type {
  ActiveCart,
  CartItem,
  MenuItem,
  OrderStatus,
  PaymentMethod,
  StationState,
} from '../types';

interface CashierViewProps {
  station: StationState;
  onUpdateCart: (cart: ActiveCart) => void;
  onSubmitOrder: (
    cart: ActiveCart,
    paymentMethod: PaymentMethod,
    tenderedCents?: number
  ) => void;
  onUpdateOrderStatus: (orderId: string, status: OrderStatus) => void;
  onOpenPairModal: () => void;
}

const COLOR_DOT: Record<MenuItem['colorTag'], string> = {
  slate: 'bg-slate-400',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  sky: 'bg-sky-500',
  rose: 'bg-rose-500',
};

export function CashierView({
  station,
  onUpdateCart,
  onSubmitOrder,
  onUpdateOrderStatus,
  onOpenPairModal,
}: CashierViewProps) {
  const { menu, activeCart, settings, orders, presence } = station;

  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingLine, setEditingLine] = useState<CartItem | null>(null);
  const [customNoteInput, setCustomNoteInput] = useState('');
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>([]);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [cashTenderedStr, setCashTenderedStr] = useState('');
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [customDiscountStr, setCustomDiscountStr] = useState('');
  const [justPaidOrderNum, setJustPaidOrderNum] = useState<number | null>(null);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(menu.map((m) => m.category)));
    return ['All', ...cats];
  }, [menu]);

  const filteredMenu = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return menu.filter((item) => {
      const catMatch = selectedCategory === 'All' || item.category === selectedCategory;
      const qMatch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q);
      return catMatch && qMatch;
    });
  }, [menu, selectedCategory, searchQuery]);

  const totals = useMemo(
    () => computeCartTotals(activeCart.items, activeCart.discountCents, settings.taxRateBps),
    [activeCart.items, activeCart.discountCents, settings.taxRateBps]
  );

  const readyOrders = useMemo(
    () => orders.filter((o) => o.status === 'ready'),
    [orders]
  );

  const activeKitchenCount = useMemo(
    () => orders.filter((o) => o.status === 'queued' || o.status === 'preparing').length,
    [orders]
  );

  const addMenuItem = (item: MenuItem) => {
    if (!item.available) return;
    unlockAudio();
    setJustPaidOrderNum(null);

    // If identical item without modifiers/note exists, increment its quantity
    const existingIdx = activeCart.items.findIndex(
      (line) =>
        line.menuItemId === item.id &&
        line.modifiers.length === 0 &&
        !line.note
    );

    let nextItems: CartItem[];
    if (existingIdx >= 0) {
      nextItems = activeCart.items.map((line, idx) =>
        idx === existingIdx ? { ...line, quantity: line.quantity + 1 } : line
      );
    } else {
      nextItems = [
        ...activeCart.items,
        {
          lineId: `line_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          menuItemId: item.id,
          name: item.name,
          unitPriceCents: item.priceCents,
          quantity: 1,
          modifiers: [],
          note: '',
        },
      ];
    }

    onUpdateCart({
      ...activeCart,
      items: nextItems,
      updatedAt: Date.now(),
    });
  };

  const adjustQuantity = (lineId: string, delta: number) => {
    const nextItems = activeCart.items
      .map((line) =>
        line.lineId === lineId ? { ...line, quantity: line.quantity + delta } : line
      )
      .filter((line) => line.quantity > 0);

    onUpdateCart({
      ...activeCart,
      items: nextItems,
      updatedAt: Date.now(),
    });
  };

  const removeLine = (lineId: string) => {
    onUpdateCart({
      ...activeCart,
      items: activeCart.items.filter((line) => line.lineId !== lineId),
      updatedAt: Date.now(),
    });
  };

  const clearCart = () => {
    onUpdateCart({
      items: [],
      customerName: '',
      orderType: activeCart.orderType,
      discountCents: 0,
      updatedAt: Date.now(),
    });
  };

  const openLineEditor = (line: CartItem) => {
    setEditingLine(line);
    setSelectedModifiers([...line.modifiers]);
    setCustomNoteInput(line.note || '');
  };

  const saveLineEditor = () => {
    if (!editingLine) return;
    const nextItems = activeCart.items.map((line) =>
      line.lineId === editingLine.lineId
        ? {
            ...line,
            modifiers: selectedModifiers,
            note: customNoteInput.trim().slice(0, 80),
          }
        : line
    );
    onUpdateCart({
      ...activeCart,
      items: nextItems,
      updatedAt: Date.now(),
    });
    setEditingLine(null);
  };

  const editingMenuItem = editingLine
    ? menu.find((m) => m.id === editingLine.menuItemId)
    : undefined;

  const openCheckout = () => {
    if (activeCart.items.length === 0) return;
    unlockAudio();
    setPaymentMethod('card');
    setCashTenderedStr((totals.totalCents / 100).toFixed(2));
    setCheckoutOpen(true);
  };

  const tenderedCents = Math.round((parseFloat(cashTenderedStr || '0') || 0) * 100);
  const cashChangeCents = Math.max(0, tenderedCents - totals.totalCents);
  const canCompleteCash =
    paymentMethod !== 'cash' || tenderedCents >= totals.totalCents;

  const handleCompletePayment = () => {
    if (!canCompleteCash || activeCart.items.length === 0) return;
    const assignedNumber = settings.nextOrderNumber;
    onSubmitOrder(
      activeCart,
      paymentMethod,
      paymentMethod === 'cash' ? tenderedCents : undefined
    );
    playRegisterConfirm();
    setCheckoutOpen(false);
    setJustPaidOrderNum(assignedNumber);
  };

  const quickCashOptions = useMemo(() => {
    const exact = totals.totalCents;
    const bills = [500, 1000, 2000, 5000, 10000].filter((b) => b > exact);
    return [exact, ...bills.slice(0, 3)];
  }, [totals.totalCents]);

  return (
    <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_400px] xl:grid-cols-[1fr_430px] min-h-0 overflow-hidden">
      {/* LEFT: Menu Grid + Ready Pickup Banner */}
      <section className="flex flex-col min-h-0 bg-slate-50 border-r border-slate-200">
        {/* Category + Search Toolbar */}
        <div className="px-6 py-4 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3.5 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  selectedCategory === cat
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search items..."
              className="w-full pl-9 pr-8 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Ready for Pickup Quick Bar (from Kitchen Tablet) */}
        {(readyOrders.length > 0 || activeKitchenCount > 0) && (
          <div className="px-6 py-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-4 overflow-x-auto">
              <span className="text-slate-500 font-medium whitespace-nowrap shrink-0">
                Kitchen: <span className="font-mono tabular-nums text-slate-900">{activeKitchenCount}</span> preparing
              </span>
              {readyOrders.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-emerald-700 font-semibold whitespace-nowrap shrink-0">
                    Ready for Pickup:
                  </span>
                  {readyOrders.map((order) => (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => onUpdateOrderStatus(order.id, 'completed')}
                      title="Click to mark picked up"
                      className="px-2.5 py-1 text-xs font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-md hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0"
                    >
                      #{order.orderNumber}
                      {order.customerName ? ` · ${order.customerName}` : ''} ✓
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Menu Tiles Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {filteredMenu.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12">
              <p className="text-base font-medium text-slate-900">No menu items match your filter</p>
              <p className="text-sm text-slate-500 mt-1">
                Try clearing the search query or switching categories.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3.5">
              {filteredMenu.map((item) => {
                const inCartCount = activeCart.items
                  .filter((l) => l.menuItemId === item.id)
                  .reduce((sum, l) => sum + l.quantity, 0);

                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!item.available}
                    onClick={() => addMenuItem(item)}
                    className={`group text-left p-4 rounded-xl border transition-all duration-150 flex flex-col justify-between min-h-[124px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
                      item.available
                        ? 'bg-white border-slate-200 hover:border-slate-400 hover:shadow-xs active:scale-[0.98]'
                        : 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <div className="space-y-1.5 w-full">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-xs text-slate-500 truncate">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${COLOR_DOT[item.colorTag]}`}
                            aria-hidden="true"
                          />
                          <span className="truncate">{item.category}</span>
                        </span>
                        {inCartCount > 0 && (
                          <span className="text-xs font-mono font-bold text-slate-900 tabular-nums shrink-0">
                            {inCartCount} in cart
                          </span>
                        )}
                      </div>
                      <h3 className="font-semibold text-slate-900 leading-snug line-clamp-2 text-[15px]">
                        {item.name}
                      </h3>
                    </div>

                    <div className="pt-3 flex items-baseline justify-between gap-2 w-full">
                      <span className="font-mono font-bold text-base tabular-nums text-slate-900">
                        {formatMoney(item.priceCents, settings.currencySymbol)}
                      </span>
                      {!item.available ? (
                        <span className="text-xs font-medium text-rose-700">Sold out</span>
                      ) : (
                        <span className="text-xs text-slate-400 tabular-nums">
                          {item.prepMinutes}m prep
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* RIGHT: Active Ticket & Live Customer Sync */}
      <aside className="flex flex-col min-h-0 bg-white">
        {/* Ticket Header */}
        <div className="px-5 py-4 border-b border-slate-200 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-baseline gap-2">
                <h2 className="text-lg font-bold text-slate-900">
                  Order #{settings.nextOrderNumber}
                </h2>
                <span className="text-xs text-slate-500">
                  · {totals.itemCount} {totals.itemCount === 1 ? 'item' : 'items'}
                </span>
              </div>
              <button
                type="button"
                onClick={onOpenPairModal}
                className="text-xs text-slate-500 hover:text-slate-900 transition-colors text-left mt-0.5"
              >
                Monitor: <span className="font-mono tabular-nums">{presence.customer}</span> · Kitchen:{' '}
                <span className="font-mono tabular-nums">{presence.kitchen}</span>
                {presence.customer === 0 || presence.kitchen === 0 ? ' (Pair)' : ''}
              </button>
            </div>

            {/* Dine-in / Takeout Toggle */}
            <div className="flex items-center p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() =>
                  onUpdateCart({
                    ...activeCart,
                    orderType: 'takeout',
                    updatedAt: Date.now(),
                  })
                }
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  activeCart.orderType === 'takeout'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Takeout
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateCart({
                    ...activeCart,
                    orderType: 'dine-in',
                    updatedAt: Date.now(),
                  })
                }
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  activeCart.orderType === 'dine-in'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Dine-In
              </button>
            </div>
          </div>

          {/* Customer Name / Table */}
          <div className="relative">
            <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={activeCart.customerName}
              onChange={(e) =>
                onUpdateCart({
                  ...activeCart,
                  customerName: e.target.value,
                  updatedAt: Date.now(),
                })
              }
              placeholder="Customer name or table (optional)"
              maxLength={40}
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900"
            />
          </div>
        </div>

        {/* Cart Items List */}
        <div className="flex-1 overflow-y-auto px-5 py-3 divide-y divide-slate-100">
          {justPaidOrderNum !== null && activeCart.items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-10 px-4">
              <CheckCircle2 className="w-11 h-11 text-emerald-600 mb-3" />
              <p className="text-base font-semibold text-slate-900">
                Order #{justPaidOrderNum} Sent to Kitchen
              </p>
              <p className="text-sm text-slate-500 mt-1">
                Tap any menu item on the left to start the next order.
              </p>
            </div>
          ) : activeCart.items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-10 px-4">
              <p className="text-sm font-medium text-slate-700">Ticket is empty</p>
              <p className="text-xs text-slate-500 mt-1 max-w-[240px]">
                Tap items on the menu grid to ring up an order. Your customer monitor updates live.
              </p>
            </div>
          ) : (
            activeCart.items.map((line) => (
              <div key={line.lineId} className="py-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900 text-sm leading-snug">
                      {line.name}
                    </p>
                    {(line.modifiers.length > 0 || line.note) && (
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                        {line.modifiers.join(' · ')}
                        {line.modifiers.length > 0 && line.note ? ' · ' : ''}
                        {line.note ? `Note: ${line.note}` : ''}
                      </p>
                    )}
                  </div>
                  <span className="font-mono font-semibold text-sm tabular-nums text-slate-900 shrink-0">
                    {formatMoney(
                      line.unitPriceCents * line.quantity,
                      settings.currencySymbol
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => adjustQuantity(line.lineId, -1)}
                      className="w-8 h-8 flex items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors"
                      aria-label={`Decrease ${line.name} quantity`}
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-8 text-center font-mono text-sm font-semibold tabular-nums text-slate-900">
                      {line.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => adjustQuantity(line.lineId, 1)}
                      className="w-8 h-8 flex items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors"
                      aria-label={`Increase ${line.name} quantity`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openLineEditor(line)}
                      className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors flex items-center gap-1 whitespace-nowrap"
                    >
                      <SlidersHorizontal className="w-3 h-3" />
                      Options
                    </button>
                    <button
                      type="button"
                      onClick={() => removeLine(line.lineId)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md transition-colors"
                      aria-label={`Remove ${line.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Totals & Checkout Footer */}
        <div className="p-5 border-t border-slate-200 bg-slate-50/80 space-y-4">
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between text-slate-600">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums">
                {formatMoney(totals.subtotalCents, settings.currencySymbol)}
              </span>
            </div>

            <div className="flex items-center justify-between text-slate-600">
              <button
                type="button"
                onClick={() => {
                  setCustomDiscountStr(
                    activeCart.discountCents > 0
                      ? (activeCart.discountCents / 100).toFixed(2)
                      : ''
                  );
                  setDiscountModalOpen(true);
                }}
                disabled={activeCart.items.length === 0}
                className="text-slate-600 hover:text-slate-900 underline decoration-slate-300 underline-offset-2 disabled:opacity-50 disabled:no-underline"
              >
                {totals.discountCents > 0 ? 'Edit discount' : 'Add discount'}
              </button>
              <span className="font-mono tabular-nums text-emerald-700">
                {totals.discountCents > 0
                  ? `-${formatMoney(totals.discountCents, settings.currencySymbol)}`
                  : formatMoney(0, settings.currencySymbol)}
              </span>
            </div>

            <div className="flex items-center justify-between text-slate-600">
              <span>Tax ({(settings.taxRateBps / 100).toFixed(2).replace(/\.00$/, '')}%)</span>
              <span className="font-mono tabular-nums">
                {formatMoney(totals.taxCents, settings.currencySymbol)}
              </span>
            </div>

            <div className="pt-2 border-t border-slate-200 flex items-baseline justify-between">
              <span className="text-base font-semibold text-slate-900">Total</span>
              <span className="text-2xl font-mono font-bold tabular-nums text-slate-900">
                {formatMoney(totals.totalCents, settings.currencySymbol)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={clearCart}
              disabled={activeCart.items.length === 0}
              className="px-4 py-3 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={openCheckout}
              disabled={activeCart.items.length === 0}
              className="flex-1 py-3 px-5 text-sm font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              Charge {formatMoney(totals.totalCents, settings.currencySymbol)}
            </button>
          </div>
        </div>
      </aside>

      {/* Line Item Options / Modifier Modal */}
      {editingLine && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h3 className="font-semibold text-slate-900">
                Customize: {editingLine.name}
              </h3>
              <button
                type="button"
                onClick={() => setEditingLine(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {editingMenuItem && editingMenuItem.modifiers.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-500">Quick Modifiers</p>
                  <div className="flex flex-wrap gap-2">
                    {editingMenuItem.modifiers.map((mod) => {
                      const active = selectedModifiers.includes(mod);
                      return (
                        <button
                          key={mod}
                          type="button"
                          onClick={() =>
                            setSelectedModifiers((prev) =>
                              prev.includes(mod)
                                ? prev.filter((m) => m !== mod)
                                : [...prev, mod]
                            )
                          }
                          className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                            active
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                          }`}
                        >
                          {mod}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-500">
                  Kitchen Note
                </label>
                <input
                  type="text"
                  value={customNoteInput}
                  onChange={(e) => setCustomNoteInput(e.target.value)}
                  placeholder="e.g., Allergy, sauce on side, extra hot..."
                  maxLength={80}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingLine(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200/60 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveLineEditor}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Discount Modal */}
      {discountModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h3 className="font-semibold text-slate-900">Apply Order Discount</h3>
              <button
                type="button"
                onClick={() => setDiscountModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onUpdateCart({ ...activeCart, discountCents: 0, updatedAt: Date.now() });
                    setDiscountModalOpen(false);
                  }}
                  className="px-3 py-2 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  No Discount
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateCart({
                      ...activeCart,
                      discountCents: Math.round(totals.subtotalCents * 0.1),
                      updatedAt: Date.now(),
                    });
                    setDiscountModalOpen(false);
                  }}
                  className="px-3 py-2 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  10% Off
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateCart({ ...activeCart, discountCents: 200, updatedAt: Date.now() });
                    setDiscountModalOpen(false);
                  }}
                  className="px-3 py-2 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  {formatMoney(200, settings.currencySymbol)} Off
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateCart({ ...activeCart, discountCents: 500, updatedAt: Date.now() });
                    setDiscountModalOpen(false);
                  }}
                  className="px-3 py-2 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  {formatMoney(500, settings.currencySymbol)} Off
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-500">
                  Custom Amount ({settings.currencySymbol})
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={customDiscountStr}
                    onChange={(e) => setCustomDiscountStr(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const cents = Math.max(
                        0,
                        Math.round((parseFloat(customDiscountStr || '0') || 0) * 100)
                      );
                      onUpdateCart({
                        ...activeCart,
                        discountCents: cents,
                        updatedAt: Date.now(),
                      });
                      setDiscountModalOpen(false);
                    }}
                    className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payment & Checkout Modal */}
      {checkoutOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkout-modal-title"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h3 id="checkout-modal-title" className="text-lg font-bold text-slate-900">
                  Collect Payment · Order #{settings.nextOrderNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  {activeCart.orderType === 'dine-in' ? 'Dine-In' : 'Takeout'}
                  {activeCart.customerName ? ` · ${activeCart.customerName}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Total Amount Due */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-baseline justify-between">
                <span className="text-sm font-medium text-slate-600">Total Due</span>
                <span className="text-3xl font-mono font-bold tabular-nums text-slate-900">
                  {formatMoney(totals.totalCents, settings.currencySymbol)}
                </span>
              </div>

              {/* Payment Method */}
              <div className="grid grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('card')}
                  className={`py-3 px-3 rounded-xl border text-sm font-medium flex flex-col items-center gap-1.5 transition-colors ${
                    paymentMethod === 'card'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <CreditCard className="w-5 h-5" />
                  <span>Card</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaymentMethod('cash');
                    setCashTenderedStr((totals.totalCents / 100).toFixed(2));
                  }}
                  className={`py-3 px-3 rounded-xl border text-sm font-medium flex flex-col items-center gap-1.5 transition-colors ${
                    paymentMethod === 'cash'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <Wallet className="w-5 h-5" />
                  <span>Cash</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('digital')}
                  className={`py-3 px-3 rounded-xl border text-sm font-medium flex flex-col items-center gap-1.5 transition-colors ${
                    paymentMethod === 'digital'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <Smartphone className="w-5 h-5" />
                  <span>Digital / QR</span>
                </button>
              </div>

              {/* Cash Tendered Calculator */}
              {paymentMethod === 'cash' && (
                <div className="space-y-3 pt-1">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>Cash Tendered</span>
                    <span>Quick Amounts</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {quickCashOptions.map((cents) => (
                      <button
                        key={cents}
                        type="button"
                        onClick={() => setCashTenderedStr((cents / 100).toFixed(2))}
                        className="px-3 py-1.5 text-sm font-mono font-medium bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg transition-colors"
                      >
                        {cents === totals.totalCents
                          ? 'Exact'
                          : formatMoney(cents, settings.currencySymbol)}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">
                        Received ({settings.currencySymbol})
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={cashTenderedStr}
                        onChange={(e) => setCashTenderedStr(e.target.value)}
                        className="w-full px-3 py-2.5 text-lg font-mono font-semibold bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>
                    <div>
                      <span className="block text-xs text-slate-500 mb-1">Change Due</span>
                      <div
                        className={`w-full px-3 py-2.5 text-lg font-mono font-bold tabular-nums rounded-lg border ${
                          canCompleteCash
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : 'bg-rose-50 border-rose-200 text-rose-700'
                        }`}
                      >
                        {canCompleteCash
                          ? formatMoney(cashChangeCents, settings.currencySymbol)
                          : 'Short'}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setCheckoutOpen(false)}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-200/70 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canCompleteCash}
                onClick={handleCompletePayment}
                className="px-6 py-2.5 text-sm font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                Complete & Send to Kitchen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
