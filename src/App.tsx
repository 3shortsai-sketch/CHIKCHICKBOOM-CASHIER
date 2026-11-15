import { useCallback, useEffect, useMemo, useState } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import { CashierView } from './components/CashierView';
import { CustomerDisplayView } from './components/CustomerDisplayView';
import { KitchenDisplayView } from './components/KitchenDisplayView';
import { MenuManagerView } from './components/MenuManagerView';
import { OrdersHistoryView } from './components/OrdersHistoryView';
import { PairDisplaysModal } from './components/PairDisplaysModal';
import { useStationSocket } from './hooks/useStationSocket';
import { playCustomerReadyChime, playKitchenBell } from './lib/sound';
import type { CashierTab, DisplayRole } from './types';

function readInitialParams(): { role: DisplayRole; stationId: string } {
  if (typeof window === 'undefined') {
    return { role: 'cashier', stationId: 'MAIN' };
  }
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get('view');
  const role: DisplayRole =
    viewParam === 'customer' || viewParam === 'kitchen' ? viewParam : 'cashier';
  const stationId =
    (params.get('station') || 'MAIN')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '') || 'MAIN';
  return { role, stationId };
}

export default function App() {
  const initial = useMemo(() => readInitialParams(), []);
  const [role, setRole] = useState<DisplayRole>(initial.role);
  const [stationId, setStationId] = useState<string>(initial.stationId);
  const [cashierTab, setCashierTab] = useState<CashierTab>('register');
  const [pairModalOpen, setPairModalOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const syncUrlParams = useCallback((nextRole: DisplayRole, nextStation: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', nextRole);
    url.searchParams.set('station', nextStation);
    window.history.replaceState({}, '', url.toString());
  }, []);

  const handleSwitchRole = useCallback(
    (nextRole: DisplayRole) => {
      setRole(nextRole);
      syncUrlParams(nextRole, stationId);
    },
    [stationId, syncUrlParams]
  );

  const handleChangeStation = useCallback(
    (nextStation: string) => {
      setStationId(nextStation);
      syncUrlParams(role, nextStation);
    },
    [role, syncUrlParams]
  );

  const handleNewOrder = useCallback(() => {
    if (role === 'kitchen' && soundEnabled) {
      playKitchenBell();
    }
  }, [role, soundEnabled]);

  const handleOrderReady = useCallback(() => {
    if (role === 'customer' && soundEnabled) {
      playCustomerReadyChime();
    }
  }, [role, soundEnabled]);

  const {
    state,
    connectionStatus,
    lastError,
    clearError,
    updateCart,
    submitOrder,
    updateOrderStatus,
    recallOrder,
    clearCompletedOrders,
    saveMenuItem,
    deleteMenuItem,
    toggleMenuStock,
    loadMenuPreset,
    updateSettings,
  } = useStationSocket({
    stationId,
    role,
    onNewOrder: handleNewOrder,
    onOrderReady: handleOrderReady,
  });

  useEffect(() => {
    if (!lastError) return;
    const t = setTimeout(clearError, 4000);
    return () => clearTimeout(t);
  }, [lastError, clearError]);

  const activeOrderCount = useMemo(() => {
    if (!state) return 0;
    return state.orders.filter(
      (o) => o.status === 'queued' || o.status === 'preparing' || o.status === 'ready'
    ).length;
  }, [state]);

  if (!state) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin mx-auto" />
          <p className="text-sm font-medium text-slate-700">
            Connecting to station {stationId}...
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {role === 'customer' ? (
        <CustomerDisplayView
          station={state}
          soundEnabled={soundEnabled}
          onToggleSound={() => setSoundEnabled((v) => !v)}
          onOpenPairModal={() => setPairModalOpen(true)}
        />
      ) : role === 'kitchen' ? (
        <KitchenDisplayView
          station={state}
          soundEnabled={soundEnabled}
          onToggleSound={() => setSoundEnabled((v) => !v)}
          onUpdateOrderStatus={updateOrderStatus}
          onRecallOrder={recallOrder}
          onOpenPairModal={() => setPairModalOpen(true)}
        />
      ) : (
        <div className="h-screen flex flex-col bg-slate-50 text-slate-900 overflow-hidden">
          {/* 3-Zone Top Bar Contract */}
          <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8 shrink-0">
            {/* Zone 1: Brand Wordmark */}
            <a
              href={`?view=cashier&station=${encodeURIComponent(stationId)}`}
              onClick={(e) => {
                e.preventDefault();
                setCashierTab('register');
              }}
              className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
            >
              {state.settings.storeName}
            </a>

            {/* Zone 2: 4 Single-line Navigation Links */}
            <nav
              aria-label="Cashier navigation"
              className="flex items-center gap-6 overflow-x-auto"
            >
              {(
                [
                  { id: 'register', label: 'Register' },
                  {
                    id: 'orders',
                    label: activeOrderCount > 0 ? `Orders (${activeOrderCount})` : 'Orders',
                  },
                  { id: 'menu', label: 'Menu' },
                  { id: 'settings', label: 'Settings' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCashierTab(tab.id)}
                  className={`py-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    cashierTab === tab.id
                      ? 'text-slate-900 border-slate-900'
                      : 'text-slate-500 border-transparent hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            {/* Zone 3: 1 Primary Action */}
            <div className="flex items-center gap-3 shrink-0">
              {connectionStatus !== 'connected' && (
                <span className="text-xs font-medium text-amber-700 whitespace-nowrap">
                  Reconnecting...
                </span>
              )}
              <button
                type="button"
                onClick={() => setPairModalOpen(true)}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <MonitorSmartphone className="w-4 h-4" />
                <span>Pair Displays</span>
              </button>
            </div>
          </header>

          {lastError && (
            <div className="px-6 py-2 bg-rose-50 border-b border-rose-200 text-sm text-rose-800 flex items-center justify-between">
              <span>{lastError}</span>
              <button
                type="button"
                onClick={clearError}
                className="text-xs font-medium underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {cashierTab === 'register' && (
            <CashierView
              station={state}
              onUpdateCart={updateCart}
              onSubmitOrder={submitOrder}
              onUpdateOrderStatus={updateOrderStatus}
              onOpenPairModal={() => setPairModalOpen(true)}
            />
          )}

          {cashierTab === 'orders' && (
            <OrdersHistoryView
              station={state}
              onUpdateOrderStatus={updateOrderStatus}
              onClearCompleted={clearCompletedOrders}
            />
          )}

          {(cashierTab === 'menu' || cashierTab === 'settings') && (
            <MenuManagerView
              station={state}
              mode={cashierTab}
              onSaveItem={saveMenuItem}
              onDeleteItem={deleteMenuItem}
              onToggleStock={toggleMenuStock}
              onLoadPreset={loadMenuPreset}
              onUpdateSettings={updateSettings}
            />
          )}
        </div>
      )}

      <PairDisplaysModal
        open={pairModalOpen}
        onClose={() => setPairModalOpen(false)}
        stationId={stationId}
        currentRole={role}
        presence={state.presence}
        onSwitchRole={handleSwitchRole}
        onChangeStation={handleChangeStation}
      />
    </>
  );
}
