import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Monitor, Volume2, VolumeX } from 'lucide-react';
import { computeCartTotals, formatMoney } from '../lib/format';
import { unlockAudio } from '../lib/sound';
import type { StationState } from '../types';

interface CustomerDisplayViewProps {
  station: StationState;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onOpenPairModal: () => void;
}

export function CustomerDisplayView({
  station,
  soundEnabled,
  onToggleSound,
  onOpenPairModal,
}: CustomerDisplayViewProps) {
  const { settings, activeCart, orders, lastPaidOrderId, menu } = station;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(id);
  }, []);

  const readyOrders = useMemo(
    () => orders.filter((o) => o.status === 'ready').slice(0, 12),
    [orders]
  );

  const preparingOrders = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'queued' || o.status === 'preparing')
        .slice(0, 16),
    [orders]
  );

  const lastPaidOrder = useMemo(() => {
    if (!lastPaidOrderId) return null;
    const found = orders.find((o) => o.id === lastPaidOrderId);
    if (!found) return null;
    // Show recent confirmation for up to 25 seconds when cart is empty
    if (now - found.createdAt > 25000) return null;
    return found;
  }, [orders, lastPaidOrderId, now]);

  const cartTotals = useMemo(
    () => computeCartTotals(activeCart.items, activeCart.discountCents, settings.taxRateBps),
    [activeCart.items, activeCart.discountCents, settings.taxRateBps]
  );

  const hasLiveCart = activeCart.items.length > 0;
  const showRightTicket = hasLiveCart || lastPaidOrder !== null;

  const availableMenu = useMemo(
    () => menu.filter((m) => m.available).slice(0, 8),
    [menu]
  );

  const timeString = new Date(now).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Clean Monitor Header */}
      <header className="px-8 py-5 bg-white border-b border-slate-200 flex items-center justify-between gap-6">
        <div className="flex items-baseline gap-4 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 truncate">
            {settings.storeName}
          </h1>
          <span className="text-sm text-slate-500 hidden sm:inline whitespace-nowrap">
            Order Pickup & Register Display
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-base font-mono tabular-nums text-slate-600 pr-2">
            {timeString}
          </span>
          <button
            type="button"
            onClick={() => {
              unlockAudio();
              onToggleSound();
            }}
            className={`px-3.5 py-2 text-sm font-medium rounded-lg border transition-colors flex items-center gap-2 whitespace-nowrap ${
              soundEnabled
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            {soundEnabled ? (
              <>
                <Volume2 className="w-4 h-4" />
                <span>Chime On</span>
              </>
            ) : (
              <>
                <VolumeX className="w-4 h-4" />
                <span>Muted</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenPairModal}
            className="px-3.5 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:text-slate-900 hover:bg-slate-100 transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <Monitor className="w-4 h-4" />
            <span>Switch View</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main
        className={`flex-1 grid min-h-0 ${
          showRightTicket ? 'grid-cols-1 lg:grid-cols-[1.2fr_0.8fr]' : 'grid-cols-1'
        }`}
      >
        {/* Order Status Board */}
        <section className="p-8 flex flex-col gap-8 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
            {/* READY FOR PICKUP */}
            <div className="bg-white border border-emerald-200 rounded-2xl p-6 flex flex-col">
              <div className="pb-4 border-b border-emerald-100 flex items-baseline justify-between gap-3">
                <h2 className="text-xl font-bold text-emerald-800">
                  Ready for Pickup
                </h2>
                <span className="text-sm font-mono tabular-nums text-emerald-700">
                  {readyOrders.length} ready
                </span>
              </div>

              {readyOrders.length === 0 ? (
                <div className="flex-1 flex items-center justify-center py-14 text-center">
                  <p className="text-base text-slate-400">
                    Orders ready for collection will appear here.
                  </p>
                </div>
              ) : (
                <div className="pt-5 grid grid-cols-2 gap-3.5 content-start">
                  {readyOrders.map((order) => (
                    <div
                      key={order.id}
                      className="p-4 rounded-xl bg-emerald-600 text-white flex flex-col justify-between min-h-[104px]"
                    >
                      <span className="text-4xl sm:text-5xl font-mono font-bold tabular-nums tracking-tight">
                        #{order.orderNumber}
                      </span>
                      <span className="text-sm font-medium text-emerald-50 truncate mt-2">
                        {order.customerName || (order.orderType === 'dine-in' ? 'Dine-In' : 'Takeout')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* NOW PREPARING */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col">
              <div className="pb-4 border-b border-slate-100 flex items-baseline justify-between gap-3">
                <h2 className="text-xl font-bold text-slate-900">
                  Now Preparing
                </h2>
                <span className="text-sm font-mono tabular-nums text-slate-500">
                  {preparingOrders.length} in kitchen
                </span>
              </div>

              {preparingOrders.length === 0 ? (
                <div className="flex-1 flex items-center justify-center py-14 text-center">
                  <p className="text-base text-slate-400">
                    No active orders in the kitchen right now.
                  </p>
                </div>
              ) : (
                <div className="pt-5 grid grid-cols-2 gap-3 content-start">
                  {preparingOrders.map((order) => (
                    <div
                      key={order.id}
                      className="p-4 rounded-xl bg-slate-100 border border-slate-200 flex flex-col justify-between min-h-[96px]"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-3xl font-mono font-bold tabular-nums text-slate-900">
                          #{order.orderNumber}
                        </span>
                        <span
                          className={`text-xs font-semibold ${
                            order.status === 'preparing'
                              ? 'text-amber-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {order.status === 'preparing' ? 'Cooking' : 'Queued'}
                        </span>
                      </div>
                      <span className="text-sm text-slate-600 truncate mt-1.5">
                        {order.customerName || (order.orderType === 'dine-in' ? 'Dine-In' : 'Takeout')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Menu Highlights Strip when idle */}
          {!showRightTicket && availableMenu.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6">
              <div className="flex items-baseline justify-between pb-4 border-b border-slate-100">
                <h3 className="text-base font-semibold text-slate-900">
                  Available Today
                </h3>
                <span className="text-xs text-slate-500">
                  Order at the counter
                </span>
              </div>
              <div className="pt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                {availableMenu.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-baseline justify-between gap-2 text-sm py-1.5"
                  >
                    <span className="font-medium text-slate-800 truncate">
                      {item.name}
                    </span>
                    <span className="font-mono font-semibold tabular-nums text-slate-900 shrink-0">
                      {formatMoney(item.priceCents, settings.currencySymbol)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Live Cashier Register Mirror / Confirmation Panel */}
        {showRightTicket && (
          <aside className="bg-white border-t lg:border-t-0 lg:border-l border-slate-200 p-8 flex flex-col justify-between">
            {hasLiveCart ? (
              <>
                <div className="space-y-5 flex-1 min-h-0 flex flex-col">
                  <div className="pb-4 border-b border-slate-200">
                    <p className="text-xs font-medium text-slate-500">
                      Current Register Order
                    </p>
                    <div className="flex items-baseline justify-between gap-3 mt-1">
                      <h2 className="text-2xl font-bold text-slate-900">
                        Order #{settings.nextOrderNumber}
                      </h2>
                      <span className="text-sm text-slate-600">
                        {activeCart.orderType === 'dine-in' ? 'Dine-In' : 'Takeout'}
                        {activeCart.customerName ? ` · ${activeCart.customerName}` : ''}
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto divide-y divide-slate-100 pr-1">
                    {activeCart.items.map((line) => (
                      <div key={line.lineId} className="py-3.5 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-2.5">
                            <span className="font-mono font-bold text-lg tabular-nums text-slate-900">
                              {line.quantity}×
                            </span>
                            <span className="text-lg font-medium text-slate-900">
                              {line.name}
                            </span>
                          </div>
                          {(line.modifiers.length > 0 || line.note) && (
                            <p className="text-sm text-slate-500 mt-0.5 pl-7">
                              {line.modifiers.join(' · ')}
                              {line.modifiers.length > 0 && line.note ? ' · ' : ''}
                              {line.note}
                            </p>
                          )}
                        </div>
                        <span className="font-mono font-semibold text-lg tabular-nums text-slate-900 shrink-0">
                          {formatMoney(
                            line.unitPriceCents * line.quantity,
                            settings.currencySymbol
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-5 border-t border-slate-200 space-y-2">
                  <div className="flex justify-between text-base text-slate-600">
                    <span>Subtotal</span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(cartTotals.subtotalCents, settings.currencySymbol)}
                    </span>
                  </div>
                  {cartTotals.discountCents > 0 && (
                    <div className="flex justify-between text-base text-emerald-700">
                      <span>Discount</span>
                      <span className="font-mono tabular-nums">
                        -{formatMoney(cartTotals.discountCents, settings.currencySymbol)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-base text-slate-600">
                    <span>Tax</span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(cartTotals.taxCents, settings.currencySymbol)}
                    </span>
                  </div>
                  <div className="pt-3 border-t border-slate-200 flex items-baseline justify-between">
                    <span className="text-xl font-bold text-slate-900">Total</span>
                    <span className="text-4xl font-mono font-bold tabular-nums text-slate-900">
                      {formatMoney(cartTotals.totalCents, settings.currencySymbol)}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              lastPaidOrder && (
                <div className="flex-1 flex flex-col justify-between">
                  <div className="space-y-5">
                    <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-2">
                      <div className="flex items-center gap-2.5 text-emerald-800">
                        <CheckCircle2 className="w-6 h-6 shrink-0" />
                        <span className="text-base font-semibold">Payment Confirmed</span>
                      </div>
                      <p className="text-4xl font-mono font-bold tabular-nums text-slate-900">
                        Order #{lastPaidOrder.orderNumber}
                      </p>
                      <p className="text-sm text-emerald-900">
                        Your order has been sent to the kitchen. Watch the pickup board for your number.
                      </p>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {lastPaidOrder.items.map((line) => (
                        <div
                          key={line.lineId}
                          className="py-2.5 flex items-baseline justify-between text-base"
                        >
                          <span className="text-slate-800">
                            <span className="font-mono font-semibold mr-2">
                              {line.quantity}×
                            </span>
                            {line.name}
                          </span>
                          <span className="font-mono tabular-nums text-slate-900">
                            {formatMoney(
                              line.unitPriceCents * line.quantity,
                              settings.currencySymbol
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-200 space-y-1.5">
                    <div className="flex justify-between text-lg font-bold text-slate-900">
                      <span>Total Paid</span>
                      <span className="font-mono tabular-nums">
                        {formatMoney(lastPaidOrder.totalCents, settings.currencySymbol)}
                      </span>
                    </div>
                    {lastPaidOrder.paymentMethod === 'cash' &&
                      typeof lastPaidOrder.changeCents === 'number' &&
                      lastPaidOrder.changeCents > 0 && (
                        <div className="flex justify-between text-base font-semibold text-emerald-700">
                          <span>Change Due</span>
                          <span className="font-mono tabular-nums">
                            {formatMoney(lastPaidOrder.changeCents, settings.currencySymbol)}
                          </span>
                        </div>
                      )}
                  </div>
                </div>
              )
            )}
          </aside>
        )}
      </main>
    </div>
  );
}
