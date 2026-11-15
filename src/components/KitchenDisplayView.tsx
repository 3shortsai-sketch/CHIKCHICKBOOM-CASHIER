import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BellOff,
  Check,
  ChefHat,
  Clock,
  RotateCcw,
  Tablet,
} from 'lucide-react';
import { formatClockTime, formatElapsed } from '../lib/format';
import { unlockAudio } from '../lib/sound';
import type { OrderStatus, StationState } from '../types';

interface KitchenDisplayViewProps {
  station: StationState;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onUpdateOrderStatus: (orderId: string, status: OrderStatus) => void;
  onRecallOrder: () => void;
  onOpenPairModal: () => void;
}

type KitchenFilter = 'active' | 'ready' | 'completed';

export function KitchenDisplayView({
  station,
  soundEnabled,
  onToggleSound,
  onUpdateOrderStatus,
  onRecallOrder,
  onOpenPairModal,
}: KitchenDisplayViewProps) {
  const { orders, settings } = station;
  const [filter, setFilter] = useState<KitchenFilter>('active');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const queuedCount = useMemo(
    () => orders.filter((o) => o.status === 'queued').length,
    [orders]
  );
  const preparingCount = useMemo(
    () => orders.filter((o) => o.status === 'preparing').length,
    [orders]
  );
  const readyCount = useMemo(
    () => orders.filter((o) => o.status === 'ready').length,
    [orders]
  );
  const hasCompleted = useMemo(
    () => orders.some((o) => o.status === 'completed'),
    [orders]
  );

  const visibleOrders = useMemo(() => {
    if (filter === 'active') {
      return orders
        .filter((o) => o.status === 'queued' || o.status === 'preparing')
        .sort((a, b) => a.createdAt - b.createdAt); // Oldest first in kitchen queue
    }
    if (filter === 'ready') {
      return orders
        .filter((o) => o.status === 'ready')
        .sort((a, b) => (b.readyAt || b.createdAt) - (a.readyAt || a.createdAt));
    }
    return orders
      .filter((o) => o.status === 'completed')
      .slice(0, 30);
  }, [orders, filter]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Kitchen Tablet Top Control Bar */}
      <header className="px-4 sm:px-6 py-4 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-2.5">
            <ChefHat className="w-6 h-6 text-amber-400 shrink-0" />
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white whitespace-nowrap">
              {settings.storeName} Kitchen
            </h1>
          </div>
          <div className="hidden md:flex items-center gap-2 text-sm text-slate-400">
            <span className="font-mono tabular-nums text-slate-200">{queuedCount}</span>
            <span>Queued</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-amber-400">{preparingCount}</span>
            <span>Preparing</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-emerald-400">{readyCount}</span>
            <span>Ready</span>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => setFilter('active')}
            className={`px-3.5 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filter === 'active'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Active ({queuedCount + preparingCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('ready')}
            className={`px-3.5 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filter === 'ready'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Ready ({readyCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('completed')}
            className={`px-3.5 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filter === 'completed'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Completed
          </button>
        </div>

        {/* Tablet Actions */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              unlockAudio();
              onRecallOrder();
            }}
            disabled={!hasCompleted}
            className="px-3.5 py-2 text-sm font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Recall</span>
          </button>

          <button
            type="button"
            onClick={() => {
              unlockAudio();
              onToggleSound();
            }}
            className={`px-3.5 py-2 text-sm font-medium rounded-lg border transition-colors flex items-center gap-2 whitespace-nowrap ${
              soundEnabled
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            {soundEnabled ? (
              <>
                <Bell className="w-4 h-4" />
                <span>Chime On</span>
              </>
            ) : (
              <>
                <BellOff className="w-4 h-4" />
                <span>Muted</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenPairModal}
            className="px-3.5 py-2 text-sm font-medium text-slate-300 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <Tablet className="w-4 h-4" />
            <span className="hidden sm:inline">Switch View</span>
          </button>
        </div>
      </header>

      {/* Kitchen Tickets Grid */}
      <main className="flex-1 p-4 sm:p-6 overflow-y-auto">
        {visibleOrders.length === 0 ? (
          <div className="h-full min-h-[360px] flex flex-col items-center justify-center text-center px-6">
            <ChefHat className="w-12 h-12 text-slate-700 mb-3" />
            <h2 className="text-lg font-semibold text-slate-200">
              {filter === 'active'
                ? 'All caught up — no active tickets'
                : filter === 'ready'
                ? 'No orders waiting for pickup'
                : 'No completed orders yet'}
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-md">
              {filter === 'active'
                ? 'New orders submitted from the Cashier laptop will appear here instantly.'
                : 'Orders move here as you update their status.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 items-start">
            {visibleOrders.map((order) => {
              const elapsedMs = now - order.createdAt;
              const isOverdue = elapsedMs >= 10 * 60 * 1000;
              const isWarning = !isOverdue && elapsedMs >= 5 * 60 * 1000;

              const headerStyle =
                order.status === 'ready'
                  ? 'bg-emerald-950/70 border-b border-emerald-800/70'
                  : order.status === 'preparing'
                  ? 'bg-amber-950/60 border-b border-amber-800/60'
                  : 'bg-slate-800/70 border-b border-slate-700/80';

              const statusLabel =
                order.status === 'queued'
                  ? 'New Ticket'
                  : order.status === 'preparing'
                  ? 'Preparing'
                  : order.status === 'ready'
                  ? 'Ready for Pickup'
                  : 'Completed';

              const statusTextColor =
                order.status === 'ready'
                  ? 'text-emerald-300'
                  : order.status === 'preparing'
                  ? 'text-amber-300'
                  : 'text-slate-300';

              return (
                <article
                  key={order.id}
                  className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col"
                >
                  {/* Ticket Header */}
                  <div className={`px-5 py-4 flex items-start justify-between gap-3 ${headerStyle}`}>
                    <div>
                      <div className="flex items-baseline gap-2.5">
                        <span className="text-2xl font-mono font-bold tabular-nums text-white">
                          #{order.orderNumber}
                        </span>
                        <span className={`text-sm font-semibold ${statusTextColor}`}>
                          {statusLabel}
                        </span>
                      </div>
                      <p className="text-sm text-slate-300 mt-0.5">
                        {order.orderType === 'dine-in' ? 'Dine-In' : 'Takeout'}
                        {order.customerName ? ` · ${order.customerName}` : ''}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      {order.status !== 'completed' ? (
                        <div
                          className={`inline-flex items-center gap-1.5 font-mono text-base font-bold tabular-nums ${
                            isOverdue
                              ? 'text-rose-400'
                              : isWarning
                              ? 'text-amber-400'
                              : 'text-slate-200'
                          }`}
                        >
                          <Clock className="w-4 h-4" />
                          <span>{formatElapsed(order.createdAt, now)}</span>
                        </div>
                      ) : (
                        <span className="font-mono text-sm tabular-nums text-slate-400">
                          {formatClockTime(order.createdAt)}
                        </span>
                      )}
                      <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                        {formatClockTime(order.createdAt)}
                      </p>
                    </div>
                  </div>

                  {/* Ticket Line Items */}
                  <ul className="px-5 py-4 divide-y divide-slate-800/80 space-y-0">
                    {order.items.map((line) => (
                      <li key={line.lineId} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-baseline gap-3">
                          <span className="text-lg font-mono font-bold tabular-nums text-amber-400 shrink-0">
                            {line.quantity}×
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-base sm:text-lg font-semibold text-white leading-snug">
                              {line.name}
                            </p>
                            {line.modifiers.length > 0 && (
                              <p className="text-sm font-medium text-amber-300 mt-1">
                                {line.modifiers.join(' · ')}
                              </p>
                            )}
                            {line.note && (
                              <p className="text-sm font-medium text-sky-300 mt-1">
                                Note: {line.note}
                              </p>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>

                  {/* Large Touch-Friendly Footer Actions */}
                  <div className="p-4 pt-2 flex items-center gap-2.5">
                    {order.status === 'queued' && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            unlockAudio();
                            onUpdateOrderStatus(order.id, 'preparing');
                          }}
                          className="flex-1 min-h-[52px] px-4 py-3 text-sm font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl transition-colors whitespace-nowrap"
                        >
                          Start Prep
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            unlockAudio();
                            onUpdateOrderStatus(order.id, 'ready');
                          }}
                          className="min-h-[52px] px-4 py-3 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                        >
                          <Check className="w-4 h-4" />
                          <span>Ready</span>
                        </button>
                      </>
                    )}

                    {order.status === 'preparing' && (
                      <button
                        type="button"
                        onClick={() => {
                          unlockAudio();
                          onUpdateOrderStatus(order.id, 'ready');
                        }}
                        className="w-full min-h-[54px] px-4 py-3 text-base font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                      >
                        <Check className="w-5 h-5" />
                        <span>Mark Order Ready</span>
                      </button>
                    )}

                    {order.status === 'ready' && (
                      <>
                        <button
                          type="button"
                          onClick={() => onUpdateOrderStatus(order.id, 'preparing')}
                          className="min-h-[52px] px-4 py-3 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors whitespace-nowrap"
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateOrderStatus(order.id, 'completed')}
                          className="flex-1 min-h-[52px] px-4 py-3 text-base font-semibold text-slate-950 bg-white hover:bg-slate-200 rounded-xl transition-colors whitespace-nowrap"
                        >
                          Picked Up
                        </button>
                      </>
                    )}

                    {order.status === 'completed' && (
                      <button
                        type="button"
                        onClick={() => onUpdateOrderStatus(order.id, 'ready')}
                        className="w-full min-h-[48px] px-4 py-2.5 text-sm font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors whitespace-nowrap"
                      >
                        Move Back to Ready
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
