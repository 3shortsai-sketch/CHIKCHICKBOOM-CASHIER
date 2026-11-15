import express from 'express';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  ActiveCart,
  ClientMessage,
  DisplayRole,
  MenuItem,
  MenuPresetId,
  Order,
  OrderStatus,
  PresenceSummary,
  ServerMessage,
  StationState,
} from './src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'stations.json');

const PORT = Number(process.env.PORT || 3000);

function getMenuPreset(presetId: MenuPresetId): MenuItem[] {
  if (presetId === 'cafe') {
    return [
      { id: 'c1', name: 'Iced Latte', category: 'Espresso', priceCents: 525, available: true, modifiers: ['Oat Milk', 'Almond Milk', 'Extra Shot', 'Less Ice'], prepMinutes: 3, colorTag: 'amber' },
      { id: 'c2', name: 'Cappuccino', category: 'Espresso', priceCents: 475, available: true, modifiers: ['Oat Milk', 'Decaf', 'Extra Hot'], prepMinutes: 3, colorTag: 'amber' },
      { id: 'c3', name: 'Matcha Tonic', category: 'Tea & Cold', priceCents: 575, available: true, modifiers: ['Less Sweet', 'No Ice', 'Oat Milk'], prepMinutes: 3, colorTag: 'emerald' },
      { id: 'c4', name: 'Cold Brew', category: 'Tea & Cold', priceCents: 450, available: true, modifiers: ['Splash Cream', 'Vanilla', 'No Ice'], prepMinutes: 1, colorTag: 'sky' },
      { id: 'c5', name: 'Butter Croissant', category: 'Bakery', priceCents: 425, available: true, modifiers: ['Warmed', 'With Jam'], prepMinutes: 2, colorTag: 'slate' },
      { id: 'c6', name: 'Almond Danish', category: 'Bakery', priceCents: 495, available: true, modifiers: ['Warmed'], prepMinutes: 2, colorTag: 'slate' },
      { id: 'c7', name: 'Avocado Toast', category: 'Kitchen', priceCents: 950, available: true, modifiers: ['Add Egg', 'Chili Flakes', 'GF Bread'], prepMinutes: 6, colorTag: 'emerald' },
      { id: 'c8', name: 'Egg & Cheddar Brioche', category: 'Kitchen', priceCents: 875, available: true, modifiers: ['Add Bacon', 'No Cheese', 'Spicy Mayo'], prepMinutes: 6, colorTag: 'rose' },
    ];
  }

  if (presetId === 'booth') {
    return [
      { id: 'b1', name: 'Classic Lemonade', category: 'Drinks', priceCents: 450, available: true, modifiers: ['Less Ice', 'Extra Lemon', 'Mint'], prepMinutes: 2, colorTag: 'amber' },
      { id: 'b2', name: 'Strawberry Fizz', category: 'Drinks', priceCents: 525, available: true, modifiers: ['Less Ice', 'No Boba'], prepMinutes: 2, colorTag: 'rose' },
      { id: 'b3', name: 'Iced Milk Tea', category: 'Drinks', priceCents: 575, available: true, modifiers: ['50% Sugar', 'Less Ice', 'Extra Boba'], prepMinutes: 3, colorTag: 'sky' },
      { id: 'b4', name: 'Crispy Chicken Bao', category: 'Hot Food', priceCents: 750, available: true, modifiers: ['Spicy Sauce', 'No Cilantro', 'Extra Pickles'], prepMinutes: 5, colorTag: 'rose' },
      { id: 'b5', name: 'Loaded Tater Tots', category: 'Hot Food', priceCents: 650, available: true, modifiers: ['Extra Cheese', 'Jalapeños', 'Sauce on Side'], prepMinutes: 5, colorTag: 'amber' },
      { id: 'b6', name: 'Garlic Noodle Box', category: 'Hot Food', priceCents: 900, available: true, modifiers: ['Add Egg', 'Extra Chili Oil', 'No Scallions'], prepMinutes: 6, colorTag: 'emerald' },
      { id: 'b7', name: 'Churro Bites', category: 'Sweets', priceCents: 500, available: true, modifiers: ['Chocolate Dip', 'Caramel Dip'], prepMinutes: 3, colorTag: 'slate' },
      { id: 'b8', name: 'Bottled Water', category: 'Drinks', priceCents: 250, available: true, modifiers: ['Cold', 'Room Temp'], prepMinutes: 1, colorTag: 'sky' },
    ];
  }

  // Default 'grill' preset
  return [
    { id: 'm1', name: 'Double Smash Burger', category: 'Burgers', priceCents: 1150, available: true, modifiers: ['No Onions', 'Extra Cheese', 'Add Bacon', 'Pickles on Side'], prepMinutes: 7, colorTag: 'rose' },
    { id: 'm2', name: 'Crispy Chicken Sandwich', category: 'Burgers', priceCents: 1050, available: true, modifiers: ['Spicy', 'No Mayo', 'Extra Pickles'], prepMinutes: 7, colorTag: 'amber' },
    { id: 'm3', name: 'Garden Veggie Burger', category: 'Burgers', priceCents: 975, available: true, modifiers: ['No Cheese', 'Avocado', 'Gluten-Free Bun'], prepMinutes: 6, colorTag: 'emerald' },
    { id: 'm4', name: 'Grilled Cheese Melt', category: 'Burgers', priceCents: 725, available: true, modifiers: ['Add Tomato', 'Add Bacon'], prepMinutes: 5, colorTag: 'amber' },
    { id: 'm5', name: 'Sea Salt Fries', category: 'Sides', priceCents: 450, available: true, modifiers: ['Extra Crispy', 'No Salt', 'Cheese Sauce'], prepMinutes: 4, colorTag: 'slate' },
    { id: 'm6', name: 'Crispy Onion Rings', category: 'Sides', priceCents: 525, available: true, modifiers: ['Ranch Dip', 'Spicy Mayo'], prepMinutes: 4, colorTag: 'slate' },
    { id: 'm7', name: 'House Lemonade', category: 'Drinks', priceCents: 375, available: true, modifiers: ['Less Ice', 'No Ice', 'Strawberry'], prepMinutes: 1, colorTag: 'sky' },
    { id: 'm8', name: 'Cold Brew Coffee', category: 'Drinks', priceCents: 425, available: true, modifiers: ['Oat Milk', 'Vanilla', 'Less Ice'], prepMinutes: 1, colorTag: 'sky' },
    { id: 'm9', name: 'Sparkling Soda', category: 'Drinks', priceCents: 300, available: true, modifiers: ['Lime', 'No Ice'], prepMinutes: 1, colorTag: 'sky' },
    { id: 'm10', name: 'Warm Chocolate Cookie', category: 'Desserts', priceCents: 350, available: true, modifiers: ['Warmed', 'Sea Salt'], prepMinutes: 2, colorTag: 'slate' },
  ];
}

function createDefaultStation(stationId: string): StationState {
  return {
    stationId,
    settings: {
      storeName: 'CounterSync Kitchen',
      taxRateBps: 800,
      currencySymbol: '$',
      nextOrderNumber: 101,
    },
    menu: getMenuPreset('grill'),
    activeCart: {
      items: [],
      customerName: '',
      orderType: 'takeout',
      discountCents: 0,
      updatedAt: Date.now(),
    },
    orders: [],
    lastPaidOrderId: null,
    presence: {
      cashier: 0,
      customer: 0,
      kitchen: 0,
    },
  };
}

const stations = new Map<string, StationState>();

function loadPersistedStations() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, StationState>;
      for (const [id, st] of Object.entries(parsed)) {
        st.presence = { cashier: 0, customer: 0, kitchen: 0 };
        stations.set(id, st);
      }
    }
  } catch (err) {
    console.error('Failed to load persisted station data:', err);
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const serializable: Record<string, StationState> = {};
      for (const [id, st] of stations.entries()) {
        serializable[id] = {
          ...st,
          presence: { cashier: 0, customer: 0, kitchen: 0 },
        };
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify(serializable, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to persist station data:', err);
    }
  }, 250);
}

function normalizeStationId(raw: string | null | undefined): string {
  const cleaned = (raw || 'MAIN').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  return cleaned.slice(0, 24) || 'MAIN';
}

function getOrCreateStation(rawId: string): StationState {
  const id = normalizeStationId(rawId);
  let station = stations.get(id);
  if (!station) {
    station = createDefaultStation(id);
    stations.set(id, station);
    schedulePersist();
  }
  return station;
}

loadPersistedStations();

interface ClientMeta {
  ws: WebSocket;
  stationId: string;
  role: DisplayRole;
}

const stationClients = new Map<string, Set<ClientMeta>>();

function computePresence(stationId: string): PresenceSummary {
  const clients = stationClients.get(stationId);
  const summary: PresenceSummary = { cashier: 0, customer: 0, kitchen: 0 };
  if (!clients) return summary;
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      summary[client.role] += 1;
    }
  }
  return summary;
}

function broadcast(stationId: string, message: ServerMessage) {
  const clients = stationClients.get(stationId);
  if (!clients) return;
  const serialized = JSON.stringify(message);
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(serialized);
    }
  }
}

function sendToClient(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function calculateOrderTotals(cart: ActiveCart, taxRateBps: number) {
  const subtotalCents = cart.items.reduce(
    (sum, item) => sum + Math.max(0, item.unitPriceCents) * Math.max(1, item.quantity),
    0
  );
  const discountCents = Math.min(Math.max(0, cart.discountCents || 0), subtotalCents);
  const taxableCents = Math.max(0, subtotalCents - discountCents);
  const taxCents = Math.round((taxableCents * taxRateBps) / 10000);
  const totalCents = taxableCents + taxCents;
  return { subtotalCents, discountCents, taxCents, totalCents };
}

function handleClientMessage(meta: ClientMeta, msg: ClientMessage) {
  const station = getOrCreateStation(meta.stationId);

  switch (msg.type) {
    case 'cart:update': {
      station.activeCart = {
        items: Array.isArray(msg.payload.items) ? msg.payload.items : [],
        customerName: (msg.payload.customerName || '').slice(0, 60),
        orderType: msg.payload.orderType === 'dine-in' ? 'dine-in' : 'takeout',
        discountCents: Math.max(0, Math.round(msg.payload.discountCents || 0)),
        updatedAt: Date.now(),
      };
      // Clear lastPaid banner as soon as cashier starts ringing up a new cart
      if (station.activeCart.items.length > 0) {
        station.lastPaidOrderId = null;
      }
      schedulePersist();
      broadcast(station.stationId, {
        type: 'cart:updated',
        payload: { activeCart: station.activeCart },
      });
      break;
    }

    case 'order:submit': {
      const { cart, paymentMethod, tenderedCents } = msg.payload;
      if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
        sendToClient(meta.ws, {
          type: 'error',
          payload: { message: 'Cannot submit an empty order.' },
        });
        return;
      }

      const totals = calculateOrderTotals(cart, station.settings.taxRateBps);
      const orderNumber = station.settings.nextOrderNumber;
      station.settings.nextOrderNumber += 1;

      const resolvedTendered =
        paymentMethod === 'cash'
          ? Math.max(totals.totalCents, Math.round(tenderedCents ?? totals.totalCents))
          : totals.totalCents;
      const changeCents =
        paymentMethod === 'cash' ? Math.max(0, resolvedTendered - totals.totalCents) : 0;

      const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const newOrder: Order = {
        id: orderId,
        orderNumber,
        customerName: (cart.customerName || '').trim().slice(0, 60),
        orderType: cart.orderType === 'dine-in' ? 'dine-in' : 'takeout',
        items: cart.items.map((item) => ({
          ...item,
          quantity: Math.max(1, Math.round(item.quantity)),
          unitPriceCents: Math.max(0, Math.round(item.unitPriceCents)),
        })),
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        paymentMethod,
        tenderedCents: resolvedTendered,
        changeCents,
        status: 'queued',
        createdAt: Date.now(),
      };

      station.orders.unshift(newOrder);
      // Keep most recent 250 orders per station
      if (station.orders.length > 250) {
        station.orders = station.orders.slice(0, 250);
      }
      station.lastPaidOrderId = orderId;
      station.activeCart = {
        items: [],
        customerName: '',
        orderType: 'takeout',
        discountCents: 0,
        updatedAt: Date.now(),
      };

      schedulePersist();

      broadcast(station.stationId, {
        type: 'order:created',
        payload: {
          order: newOrder,
          nextOrderNumber: station.settings.nextOrderNumber,
          lastPaidOrderId: orderId,
        },
      });
      broadcast(station.stationId, {
        type: 'cart:updated',
        payload: { activeCart: station.activeCart },
      });
      break;
    }

    case 'order:update_status': {
      const { orderId, status } = msg.payload;
      const order = station.orders.find((o) => o.id === orderId);
      if (!order) return;

      const allowedStatuses: OrderStatus[] = ['queued', 'preparing', 'ready', 'completed', 'cancelled'];
      if (!allowedStatuses.includes(status)) return;

      const now = Date.now();
      order.status = status;
      if (status === 'preparing' && !order.preparingAt) order.preparingAt = now;
      if (status === 'ready') {
        if (!order.preparingAt) order.preparingAt = now;
        order.readyAt = now;
      }
      if (status === 'completed') {
        order.completedAt = now;
      }

      schedulePersist();
      broadcast(station.stationId, {
        type: 'order:status_updated',
        payload: { order },
      });
      break;
    }

    case 'order:recall': {
      const recentCompleted = station.orders.find((o) => o.status === 'completed');
      if (!recentCompleted) return;
      recentCompleted.status = 'ready';
      recentCompleted.completedAt = undefined;
      schedulePersist();
      broadcast(station.stationId, {
        type: 'order:status_updated',
        payload: { order: recentCompleted },
      });
      break;
    }

    case 'orders:clear_completed': {
      station.orders = station.orders.filter(
        (o) => o.status === 'queued' || o.status === 'preparing' || o.status === 'ready'
      );
      schedulePersist();
      station.presence = computePresence(station.stationId);
      broadcast(station.stationId, {
        type: 'sync:state',
        payload: station,
      });
      break;
    }

    case 'menu:save_item': {
      const item = msg.payload;
      if (!item || !item.name?.trim()) return;
      const sanitized: MenuItem = {
        id: item.id || `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: item.name.trim().slice(0, 60),
        category: (item.category || 'General').trim().slice(0, 32),
        priceCents: Math.max(0, Math.round(item.priceCents || 0)),
        available: Boolean(item.available),
        modifiers: Array.isArray(item.modifiers)
          ? item.modifiers.map((m) => m.trim()).filter(Boolean).slice(0, 12)
          : [],
        prepMinutes: Math.max(1, Math.min(60, Math.round(item.prepMinutes || 5))),
        colorTag: item.colorTag || 'slate',
      };

      const existingIdx = station.menu.findIndex((m) => m.id === sanitized.id);
      if (existingIdx >= 0) {
        station.menu[existingIdx] = sanitized;
      } else {
        station.menu.push(sanitized);
      }

      schedulePersist();
      broadcast(station.stationId, {
        type: 'menu:updated',
        payload: { menu: station.menu },
      });
      break;
    }

    case 'menu:delete_item': {
      station.menu = station.menu.filter((m) => m.id !== msg.payload.id);
      schedulePersist();
      broadcast(station.stationId, {
        type: 'menu:updated',
        payload: { menu: station.menu },
      });
      break;
    }

    case 'menu:toggle_stock': {
      const item = station.menu.find((m) => m.id === msg.payload.id);
      if (!item) return;
      item.available = !item.available;
      schedulePersist();
      broadcast(station.stationId, {
        type: 'menu:updated',
        payload: { menu: station.menu },
      });
      break;
    }

    case 'menu:load_preset': {
      station.menu = getMenuPreset(msg.payload.presetId);
      schedulePersist();
      broadcast(station.stationId, {
        type: 'menu:updated',
        payload: { menu: station.menu },
      });
      break;
    }

    case 'settings:update': {
      const patch = msg.payload;
      if (typeof patch.storeName === 'string' && patch.storeName.trim()) {
        station.settings.storeName = patch.storeName.trim().slice(0, 50);
      }
      if (typeof patch.taxRateBps === 'number' && !Number.isNaN(patch.taxRateBps)) {
        station.settings.taxRateBps = Math.max(0, Math.min(3000, Math.round(patch.taxRateBps)));
      }
      if (typeof patch.currencySymbol === 'string' && patch.currencySymbol.trim()) {
        station.settings.currencySymbol = patch.currencySymbol.trim().slice(0, 4);
      }
      if (typeof patch.nextOrderNumber === 'number' && patch.nextOrderNumber >= 1) {
        station.settings.nextOrderNumber = Math.round(patch.nextOrderNumber);
      }
      schedulePersist();
      broadcast(station.stationId, {
        type: 'settings:updated',
        payload: { settings: station.settings },
      });
      break;
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, stations: stations.size });
  });

  app.get('/api/station/:id', (req, res) => {
    const station = getOrCreateStation(req.params.id);
    station.presence = computePresence(station.stationId);
    res.json(station);
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const reqUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (reqUrl.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, reqUrl);
    });
  });

  wss.on('connection', (ws: WebSocket, _req: unknown, reqUrl: URL) => {
    const stationId = normalizeStationId(reqUrl.searchParams.get('station'));
    const rawRole = reqUrl.searchParams.get('role');
    const role: DisplayRole =
      rawRole === 'customer' || rawRole === 'kitchen' ? rawRole : 'cashier';

    const station = getOrCreateStation(stationId);
    let clients = stationClients.get(stationId);
    if (!clients) {
      clients = new Set();
      stationClients.set(stationId, clients);
    }

    const meta: ClientMeta = { ws, stationId, role };
    clients.add(meta);

    station.presence = computePresence(stationId);
    sendToClient(ws, { type: 'sync:state', payload: station });
    broadcast(stationId, {
      type: 'presence:updated',
      payload: { presence: station.presence },
    });

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString()) as ClientMessage;
        handleClientMessage(meta, parsed);
      } catch (err) {
        console.error('Invalid WS message:', err);
      }
    });

    ws.on('close', () => {
      clients?.delete(meta);
      station.presence = computePresence(stationId);
      broadcast(stationId, {
        type: 'presence:updated',
        payload: { presence: station.presence },
      });
    });
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`CounterSync server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
