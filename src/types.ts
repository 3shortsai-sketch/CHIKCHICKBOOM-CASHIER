export type DisplayRole = 'cashier' | 'customer' | 'kitchen';

export type CashierTab = 'register' | 'orders' | 'menu' | 'settings';

export type OrderStatus = 'queued' | 'preparing' | 'ready' | 'completed' | 'cancelled';

export type OrderType = 'dine-in' | 'takeout';

export type PaymentMethod = 'cash' | 'card' | 'digital';

export type MenuPresetId = 'grill' | 'cafe' | 'booth';

export interface MenuItem {
  id: string;
  name: string;
  category: string;
  priceCents: number;
  available: boolean;
  modifiers: string[];
  prepMinutes: number;
  colorTag: 'slate' | 'emerald' | 'amber' | 'sky' | 'rose';
}

export interface CartItem {
  lineId: string;
  menuItemId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  modifiers: string[];
  note: string;
}

export interface ActiveCart {
  items: CartItem[];
  customerName: string;
  orderType: OrderType;
  discountCents: number;
  updatedAt: number;
}

export interface Order {
  id: string;
  orderNumber: number;
  customerName: string;
  orderType: OrderType;
  items: CartItem[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod;
  tenderedCents?: number;
  changeCents?: number;
  status: OrderStatus;
  createdAt: number;
  preparingAt?: number;
  readyAt?: number;
  completedAt?: number;
}

export interface StoreSettings {
  storeName: string;
  taxRateBps: number; // 800 = 8.00%
  currencySymbol: string;
  nextOrderNumber: number;
}

export interface PresenceSummary {
  cashier: number;
  customer: number;
  kitchen: number;
}

export interface StationState {
  stationId: string;
  settings: StoreSettings;
  menu: MenuItem[];
  activeCart: ActiveCart;
  orders: Order[];
  lastPaidOrderId: string | null;
  presence: PresenceSummary;
}

export type ServerMessage =
  | { type: 'sync:state'; payload: StationState }
  | { type: 'cart:updated'; payload: { activeCart: ActiveCart } }
  | { type: 'order:created'; payload: { order: Order; nextOrderNumber: number; lastPaidOrderId: string } }
  | { type: 'order:status_updated'; payload: { order: Order } }
  | { type: 'menu:updated'; payload: { menu: MenuItem[] } }
  | { type: 'settings:updated'; payload: { settings: StoreSettings } }
  | { type: 'presence:updated'; payload: { presence: PresenceSummary } }
  | { type: 'error'; payload: { message: string } };

export type ClientMessage =
  | { type: 'cart:update'; payload: ActiveCart }
  | {
      type: 'order:submit';
      payload: {
        cart: ActiveCart;
        paymentMethod: PaymentMethod;
        tenderedCents?: number;
      };
    }
  | {
      type: 'order:update_status';
      payload: {
        orderId: string;
        status: OrderStatus;
      };
    }
  | { type: 'order:recall' }
  | { type: 'orders:clear_completed' }
  | { type: 'menu:save_item'; payload: MenuItem }
  | { type: 'menu:delete_item'; payload: { id: string } }
  | { type: 'menu:toggle_stock'; payload: { id: string } }
  | { type: 'menu:load_preset'; payload: { presetId: MenuPresetId } }
  | {
      type: 'settings:update';
      payload: Partial<StoreSettings>;
    };
