// Money is whole pesos everywhere (the menu has no centavos).

export type Category = 'bowls' | 'fries' | 'drinks' | 'cookies' | 'combos' | 'addons';

export type MenuItem = {
  id: string;
  /** The one name shown everywhere: cashier, kitchen, customer monitor, reports. */
  name: string;
  category: Exclude<Category, 'combos'>;
  price: number;
  /** Ingredient + packaging cost per piece. */
  unitCost: number;
  /** Stock loaded at the start of each business day. */
  startStock: number;
  /** Bowls pick a free side; fries pick a free dip; slushies are combo drinks. */
  kind?: 'bowl' | 'fries' | 'slushie' | 'water' | 'cookie' | 'extraSide' | 'extraSauce';
  /** Regular fries come with a free dip; the combos use them. */
  regular?: boolean;
  active: boolean;
  /** One line for customers on the monitor menu. */
  description?: string;
  /** Allergens the item contains (see ALLERGENS). Empty = none recorded. */
  allergens?: string[];
  /** Allergens that may be present (brand ingredients vary: "check the label"). */
  mayContain?: string[];
  /** Photo file in public/menu/, e.g. "menu/ala-king.jpg". */
  photo?: string;
};

/** Common food allergens the booth can tag an item with. */
export const ALLERGENS = ['Egg', 'Milk', 'Wheat', 'Soy', 'Sesame', 'Shellfish', 'Fish', 'Peanut', 'Tree nut', 'Pork'] as const;

export type AllergenTags = { contains?: string[]; may?: string[] };

export type Combo = {
  id: 'comboA' | 'comboB';
  name: string;
  price: number;
  /** Item kinds, in the order the picker asks for them. */
  parts: ('bowl' | 'fries' | 'slushie' | 'cookie')[];
  active: boolean;
};

/** Choices made for one bowl or one fries. */
export type Choices = {
  side?: string;
  extraSides?: string[];
  extraSauce?: number;
  dip?: string;
};

export type ComboPart = Choices & { itemId: string };

export type LineFree =
  | { reason: 'prize'; prize: PrizeId }
  | { reason: 'reward'; stampsAt: number };

export type OrderLine = {
  id: string;
  /** For combos this is the combo id. */
  itemId: string;
  name: string;
  qty: number;
  /** Price of one, before extras. 0 for free items. */
  unitPrice: number;
  choices?: Choices;
  combo?: { comboId: Combo['id']; parts: ComboPart[] };
  notes?: string;
  free?: LineFree;
  /** Added after payment (wheel prizes). Kitchen highlights these. */
  addedAfterPay?: boolean;
};

export type PrizeId =
  | 'freeMeal'
  | 'freeCookie'
  | 'freeWater'
  | 'freeSauce'
  | 'doubleStamp'
  | 'tenOff'
  | 'voucher'
  | 'tryAgain';

export type WheelSlot = { prize: PrizeId; label: string; slots: number };

export type SpinResult = {
  /** Which bowl (line id + unit index) this spin belongs to. */
  lineId: string;
  unit: number;
  prize: PrizeId;
  /** Cash handed back to the customer for this prize. */
  refund: number;
  voucherCode?: string;
  /** Line added to the order for free items. */
  addedLineId?: string;
  via: 'physical' | 'digital';
  at: number;
};

export type PaymentMethod = 'cash' | 'gcash' | 'maya';

export type Payment = {
  method: PaymentMethod;
  /** Amount due after vouchers and rewards. */
  due: number;
  tendered: number;
  change: number;
  reference?: string;
};

export type KitchenStatus = 'new' | 'cooking' | 'ready' | 'claimed';

export type Refund = { amount: number; reason: string; at: number; by: string };

export type Order = {
  id: string;
  dayId: string;
  mode: DataMode;
  /** "A-001" */
  number: string;
  seq: number;
  createdAt: number;
  cashier: string;
  lines: OrderLine[];
  subtotal: number;
  voucher?: { code: string; amount: number };
  cardId?: string;
  /** Stamps this order adds to the card (1 + double-stamp prizes). */
  stampsEarned: number;
  /** Reward thresholds redeemed in this order, e.g. [5]. */
  rewardsRedeemed: number[];
  payment: Payment;
  spins: SpinResult[];
  /** Number of spins this order earned. */
  spinsEarned: number;
  // Kitchen-owned fields (written only by the kitchen / serving flow).
  status: KitchenStatus;
  cookingAt?: number;
  readyAt?: number;
  claimedAt?: number;
  // Manager actions.
  voided?: { reason: string; at: number; by: string };
  refunds?: Refund[];
};

export type DataMode = 'demo' | 'live';

export type WasteEntry = { id: string; itemId: string; qty: number; reason: string; at: number; by: string };

export type BusinessDay = {
  id: string;
  mode: DataMode;
  date: string; // YYYY-MM-DD the day was opened
  openedAt: number;
  openedBy: string;
  openingFloat: number;
  stockStart: Record<string, number>;
  soldOut: Record<string, boolean>;
  /** Dropped, spoiled or mistake items: out of stock and counted as cost. */
  waste?: WasteEntry[];
  closedAt?: number;
  countedCash?: number;
  closedBy?: string;
};

export type Reward = { at: number; label: string; category: 'fries' | 'bowls'; itemId?: string };

export type Settings = {
  menu: MenuItem[];
  combos: Combo[];
  sides: string[];
  dips: string[];
  /** Allergens of each free side and dip, since customers pick them. */
  sideAllergens: Record<string, AllergenTags>;
  dipAllergens: Record<string, AllergenTags>;
  /** Bumped when the built-in menu changes, so devices with an old saved menu get the new one. */
  menuVersion: number;
  extraSidePrice: number;
  extraSaucePrice: number;
  wheel: { paused: boolean; slots: WheelSlot[] };
  loyalty: { prefix: string; first: number; last: number; cardSize: number; rewards: Reward[]; rewardOrderEarnsStamp: boolean };
  voucher: { amount: number; minOrder: number; validDays: number };
  dailyGoal: number;
  /** Which e-wallets the booth accepts. The GCash number is typed in Setup, not stored in code. */
  payments: { gcash: boolean; maya: boolean; gcashNumber: string };
  /** Prize cost as % of the day's sales: warn, then tell the cashier to pause the wheel. */
  promoLimits: { warnPct: number; pausePct: number; minSales: number };
  cashiers: string[];
  managerPin: string;
  adminPin: string;
  mode: DataMode;
  /** Minutes a "ready" number stays on the monitor before it drops off on its own. */
  servingClearMinutes: number;
  /** Minutes after which a kitchen card turns red. */
  kitchenLateMinutes: number;
  updatedAt: number;
};
