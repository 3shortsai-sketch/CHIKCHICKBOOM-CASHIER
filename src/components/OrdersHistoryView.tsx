import { useMemo, useState } from 'react';
import { Download, Receipt, Search, Trash2, X } from 'lucide-react';
import { exportOrdersCsv, formatClockTime, formatMoney } from '../lib/format';
import type { Order, OrderStatus, StationState } from '../types';

interface OrdersHistoryViewProps {
  station: StationState;
  onUpdateOrderStatus: (orderId: string, status: OrderStatus) => void;
  onClearCompleted: () => void;
}

type StatusFilter = 'all' | 'active' | 'ready' | 'completed';

const STATUS_LABEL: Record<OrderStatus, string> = {
  queued: 'Queued',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_COLOR: Record<OrderStatus, string> = {
  queued: 'text-slate-700',
  preparing: 'text-amber-700',
  ready: 'text-emerald-700',
  completed: 'text-slate-500',
  cancelled: 'text-rose-700',
};

export function OrdersHistoryView({
  station,
  onUpdateOrderStatus,
  onClearCompleted,
}: OrdersHistoryViewProps) {
  const { orders, settings } = station;
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const metrics = useMemo(() => {
    const valid = orders.filter((o) => o.status !== 'cancelled');
    const revenueCents = valid.reduce((sum, o) => sum + o.totalCents, 0);
    const activeCount = orders.filter(
      (o) => o.status === 'queued' || o.status === 'preparing' || o.status === 'ready'
    ).length;
    const avgCents = valid.length > 0 ? Math.round(revenueCents / valid.length) : 0;
    return {
      revenueCents,
      orderCount: valid.length,
      activeCount,
      avgCents,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      const statusMatch =
        filter === 'all'
          ? true
          : filter === 'active'
          ? o.status === 'queued' || o.status === 'preparing'
          : filter === 'ready'
          ? o.status === 'ready'
          : o.status === 'completed' || o.status === 'cancelled';

      const qMatch =
        !q ||
        String(o.orderNumber).includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.items.some((i) => i.name.toLowerCase().includes(q));

      return statusMatch && qMatch;
    });
  }, [orders, filter, search]);

  const completedCount = useMemo(
    () => orders.filter((o) => o.status === 'completed' || o.status === 'cancelled').length,
    [orders]
  );

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Shift KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Gross Sales</p>
            <p className="text-2xl font-mono font-bold tabular-nums text-slate-900 mt-1">
              {formatMoney(metrics.revenueCents, settings.currencySymbol)}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Completed & Active Orders</p>
            <p className="text-2xl font-mono font-bold tabular-nums text-slate-900 mt-1">
              {metrics.orderCount}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">In Queue / Ready</p>
            <p className="text-2xl font-mono font-bold tabular-nums text-slate-900 mt-1">
              {metrics.activeCount}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Average Order</p>
            <p className="text-2xl font-mono font-bold tabular-nums text-slate-900 mt-1">
              {formatMoney(metrics.avgCents, settings.currencySymbol)}
            </p>
          </div>
        </div>

        {/* Filter + Actions Toolbar */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'all', label: 'All Orders' },
                  { id: 'active', label: 'Preparing' },
                  { id: 'ready', label: 'Ready' },
                  { id: 'completed', label: 'Completed' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    filter === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative w-56">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Order #, customer, item..."
                  className="w-full pl-9 pr-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <button
                type="button"
                onClick={() => exportOrdersCsv(orders, settings.currencySymbol)}
                disabled={orders.length === 0}
                className="px-3.5 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                <span>Export CSV</span>
              </button>

              {completedCount > 0 && (
                <button
                  type="button"
                  onClick={onClearCompleted}
                  className="px-3.5 py-1.5 text-sm font-medium text-rose-700 bg-white border border-rose-200 rounded-lg hover:bg-rose-50 transition-colors flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Clear Completed</span>
                </button>
              )}
            </div>
          </div>

          {/* Orders Data Table */}
          {filteredOrders.length === 0 ? (
            <div className="py-16 text-center px-4">
              <p className="text-base font-medium text-slate-900">No orders to display</p>
              <p className="text-sm text-slate-500 mt-1">
                Orders rung up from the Register will appear here in real time.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 px-5">Order</th>
                    <th className="py-3 px-4">Time</th>
                    <th className="py-3 px-4">Customer / Type</th>
                    <th className="py-3 px-4">Items</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Total</th>
                    <th className="py-3 px-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredOrders.map((order) => (
                    <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-5 font-mono font-bold tabular-nums text-slate-900 whitespace-nowrap">
                        #{order.orderNumber}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs tabular-nums text-slate-500 whitespace-nowrap">
                        {formatClockTime(order.createdAt)}
                      </td>
                      <td className="py-3.5 px-4 text-slate-700 whitespace-nowrap">
                        <span>{order.customerName || 'Walk-in'}</span>
                        <span className="text-slate-400 mx-1.5">·</span>
                        <span className="text-xs text-slate-500">
                          {order.orderType === 'dine-in' ? 'Dine-In' : 'Takeout'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-700 max-w-xs truncate">
                        {order.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                      </td>
                      <td className={`py-3.5 px-4 font-semibold whitespace-nowrap ${STATUS_COLOR[order.status]}`}>
                        {STATUS_LABEL[order.status]}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                        {formatMoney(order.totalCents, settings.currencySymbol)}
                      </td>
                      <td className="py-3.5 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {order.status === 'queued' && (
                            <button
                              type="button"
                              onClick={() => onUpdateOrderStatus(order.id, 'preparing')}
                              className="px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100"
                            >
                              Start Prep
                            </button>
                          )}
                          {(order.status === 'queued' || order.status === 'preparing') && (
                            <button
                              type="button"
                              onClick={() => onUpdateOrderStatus(order.id, 'ready')}
                              className="px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100"
                            >
                              Mark Ready
                            </button>
                          )}
                          {order.status === 'ready' && (
                            <button
                              type="button"
                              onClick={() => onUpdateOrderStatus(order.id, 'completed')}
                              className="px-2.5 py-1 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800"
                            >
                              Picked Up
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedOrder(order)}
                            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md"
                            title="View Receipt"
                            aria-label={`View receipt for order ${order.orderNumber}`}
                          >
                            <Receipt className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Receipt Detail Modal */}
      {selectedOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h3 className="font-bold text-slate-900">
                  Receipt · Order #{selectedOrder.orderNumber}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  {new Date(selectedOrder.createdAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-xs text-slate-600 flex items-center justify-between">
                <span>
                  {selectedOrder.customerName || 'Walk-in'} ·{' '}
                  {selectedOrder.orderType === 'dine-in' ? 'Dine-In' : 'Takeout'}
                </span>
                <span className={`font-semibold ${STATUS_COLOR[selectedOrder.status]}`}>
                  {STATUS_LABEL[selectedOrder.status]}
                </span>
              </div>

              <div className="border-t border-b border-dashed border-slate-200 py-3 space-y-2.5">
                {selectedOrder.items.map((line) => (
                  <div key={line.lineId} className="flex justify-between gap-3 text-sm">
                    <div>
                      <p className="text-slate-900 font-medium">
                        <span className="font-mono mr-1.5">{line.quantity}×</span>
                        {line.name}
                      </p>
                      {(line.modifiers.length > 0 || line.note) && (
                        <p className="text-xs text-slate-500 pl-5">
                          {line.modifiers.join(', ')}
                          {line.modifiers.length > 0 && line.note ? ' · ' : ''}
                          {line.note}
                        </p>
                      )}
                    </div>
                    <span className="font-mono tabular-nums text-slate-900">
                      {formatMoney(
                        line.unitPriceCents * line.quantity,
                        settings.currencySymbol
                      )}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span className="font-mono tabular-nums">
                    {formatMoney(selectedOrder.subtotalCents, settings.currencySymbol)}
                  </span>
                </div>
                {selectedOrder.discountCents > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Discount</span>
                    <span className="font-mono tabular-nums">
                      -{formatMoney(selectedOrder.discountCents, settings.currencySymbol)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-slate-600">
                  <span>Tax</span>
                  <span className="font-mono tabular-nums">
                    {formatMoney(selectedOrder.taxCents, settings.currencySymbol)}
                  </span>
                </div>
                <div className="flex justify-between font-bold text-base text-slate-900 pt-1">
                  <span>Total ({selectedOrder.paymentMethod.toUpperCase()})</span>
                  <span className="font-mono tabular-nums">
                    {formatMoney(selectedOrder.totalCents, settings.currencySymbol)}
                  </span>
                </div>
                {selectedOrder.paymentMethod === 'cash' &&
                  typeof selectedOrder.tenderedCents === 'number' && (
                    <div className="flex justify-between text-xs text-slate-500 pt-1">
                      <span>
                        Cash Tendered:{' '}
                        {formatMoney(selectedOrder.tenderedCents, settings.currencySymbol)}
                      </span>
                      <span>
                        Change:{' '}
                        {formatMoney(selectedOrder.changeCents || 0, settings.currencySymbol)}
                      </span>
                    </div>
                  )}
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
              {selectedOrder.status !== 'cancelled' && selectedOrder.status !== 'completed' ? (
                <button
                  type="button"
                  onClick={() => {
                    onUpdateOrderStatus(selectedOrder.id, 'cancelled');
                    setSelectedOrder(null);
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 rounded-lg"
                >
                  Cancel Order
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
