import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActiveCart,
  ClientMessage,
  DisplayRole,
  MenuItem,
  MenuPresetId,
  Order,
  OrderStatus,
  PaymentMethod,
  ServerMessage,
  StationState,
  StoreSettings,
} from '../types';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

interface UseStationSocketOptions {
  stationId: string;
  role: DisplayRole;
  onNewOrder?: (order: Order) => void;
  onOrderReady?: (order: Order) => void;
}

export function useStationSocket({
  stationId,
  role,
  onNewOrder,
  onOrderReady,
}: UseStationSocketOptions) {
  const [state, setState] = useState<StationState | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [lastError, setLastError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const pendingQueueRef = useRef<ClientMessage[]>([]);
  const onNewOrderRef = useRef(onNewOrder);
  const onOrderReadyRef = useRef(onOrderReady);

  onNewOrderRef.current = onNewOrder;
  onOrderReadyRef.current = onOrderReady;

  const sendMessage = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      pendingQueueRef.current.push(msg);
    }
  }, []);

  useEffect(() => {
    let disposed = false;

    // Fetch initial snapshot over HTTP immediately for fast first paint
    fetch(`/api/station/${encodeURIComponent(stationId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((snapshot: StationState | null) => {
        if (!disposed && snapshot) {
          setState((prev) => prev ?? snapshot);
        }
      })
      .catch(() => {});

    function connect() {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws?station=${encodeURIComponent(
        stationId
      )}&role=${encodeURIComponent(role)}`;

      setConnectionStatus(retryCountRef.current > 0 ? 'reconnecting' : 'connecting');
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }
        retryCountRef.current = 0;
        setConnectionStatus('connected');
        setLastError(null);

        if (pendingQueueRef.current.length > 0) {
          const queued = [...pendingQueueRef.current];
          pendingQueueRef.current = [];
          for (const msg of queued) {
            ws.send(JSON.stringify(msg));
          }
        }
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const msg = JSON.parse(event.data) as ServerMessage;
          switch (msg.type) {
            case 'sync:state':
              setState(msg.payload);
              break;

            case 'cart:updated':
              setState((prev) =>
                prev ? { ...prev, activeCart: msg.payload.activeCart } : prev
              );
              break;

            case 'order:created': {
              const { order, nextOrderNumber, lastPaidOrderId } = msg.payload;
              let addedNew = false;
              setState((prev) => {
                if (!prev) return prev;
                // Idempotent guard against duplicate deliveries
                if (prev.orders.some((o) => o.id === order.id)) {
                  return prev;
                }
                addedNew = true;
                return {
                  ...prev,
                  settings: { ...prev.settings, nextOrderNumber },
                  lastPaidOrderId,
                  orders: [order, ...prev.orders].slice(0, 250),
                };
              });
              // Trigger notification sound on kitchen/customer if new
              if (addedNew || true) {
                onNewOrderRef.current?.(order);
              }
              break;
            }

            case 'order:status_updated': {
              const updatedOrder = msg.payload.order;
              let becameReady = false;
              setState((prev) => {
                if (!prev) return prev;
                const existing = prev.orders.find((o) => o.id === updatedOrder.id);
                if (existing && existing.status !== 'ready' && updatedOrder.status === 'ready') {
                  becameReady = true;
                }
                const nextOrders = existing
                  ? prev.orders.map((o) => (o.id === updatedOrder.id ? updatedOrder : o))
                  : [updatedOrder, ...prev.orders];
                return { ...prev, orders: nextOrders };
              });
              if (becameReady) {
                onOrderReadyRef.current?.(updatedOrder);
              }
              break;
            }

            case 'menu:updated':
              setState((prev) =>
                prev ? { ...prev, menu: msg.payload.menu } : prev
              );
              break;

            case 'settings:updated':
              setState((prev) =>
                prev ? { ...prev, settings: msg.payload.settings } : prev
              );
              break;

            case 'presence:updated':
              setState((prev) =>
                prev ? { ...prev, presence: msg.payload.presence } : prev
              );
              break;

            case 'error':
              setLastError(msg.payload.message);
              break;
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setConnectionStatus('reconnecting');
        const delay = Math.min(5000, 600 * Math.pow(1.5, retryCountRef.current));
        retryCountRef.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [stationId, role]);

  const updateCart = useCallback(
    (nextCart: ActiveCart) => {
      setState((prev) =>
        prev
          ? {
              ...prev,
              activeCart: nextCart,
              lastPaidOrderId: nextCart.items.length > 0 ? null : prev.lastPaidOrderId,
            }
          : prev
      );
      sendMessage({ type: 'cart:update', payload: nextCart });
    },
    [sendMessage]
  );

  const submitOrder = useCallback(
    (cart: ActiveCart, paymentMethod: PaymentMethod, tenderedCents?: number) => {
      sendMessage({
        type: 'order:submit',
        payload: { cart, paymentMethod, tenderedCents },
      });
    },
    [sendMessage]
  );

  const updateOrderStatus = useCallback(
    (orderId: string, status: OrderStatus) => {
      // Optimistic status update
      setState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          orders: prev.orders.map((o) =>
            o.id === orderId ? { ...o, status } : o
          ),
        };
      });
      sendMessage({ type: 'order:update_status', payload: { orderId, status } });
    },
    [sendMessage]
  );

  const recallOrder = useCallback(() => {
    sendMessage({ type: 'order:recall' });
  }, [sendMessage]);

  const clearCompletedOrders = useCallback(() => {
    sendMessage({ type: 'orders:clear_completed' });
  }, [sendMessage]);

  const saveMenuItem = useCallback(
    (item: MenuItem) => {
      sendMessage({ type: 'menu:save_item', payload: item });
    },
    [sendMessage]
  );

  const deleteMenuItem = useCallback(
    (id: string) => {
      sendMessage({ type: 'menu:delete_item', payload: { id } });
    },
    [sendMessage]
  );

  const toggleMenuStock = useCallback(
    (id: string) => {
      sendMessage({ type: 'menu:toggle_stock', payload: { id } });
    },
    [sendMessage]
  );

  const loadMenuPreset = useCallback(
    (presetId: MenuPresetId) => {
      sendMessage({ type: 'menu:load_preset', payload: { presetId } });
    },
    [sendMessage]
  );

  const updateSettings = useCallback(
    (patch: Partial<StoreSettings>) => {
      sendMessage({ type: 'settings:update', payload: patch });
    },
    [sendMessage]
  );

  return {
    state,
    connectionStatus,
    lastError,
    clearError: () => setLastError(null),
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
  };
}
