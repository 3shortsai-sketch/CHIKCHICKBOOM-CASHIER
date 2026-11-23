import type { Combo, ComboPart, MenuItem, OrderLine, Settings } from './types';

export function newId(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

export function itemById(settings: Settings, id: string): MenuItem | undefined {
  return settings.menu.find((m) => m.id === id);
}

type ExtraPrices = { side: number; sauce: number; rice: number };

function extrasFor(c: { extraSides?: string[]; extraSauce?: number; extraRice?: number } | undefined, p: ExtraPrices): number {
  if (!c) return 0;
  return (c.extraSides?.length ?? 0) * p.side + (c.extraSauce ?? 0) * p.sauce + (c.extraRice ?? 0) * p.rice;
}

/** Price of one extra rice (settings saved before it existed have none: ₱20). */
export function extraRicePrice(s: Settings): number {
  return s.extraRicePrice ?? 20;
}

/**
 * Price of one unit of the line, including paid extras. A paid order's line
 * keeps the extras prices it was sold at; a cart line uses today's prices.
 */
export function lineUnitTotal(line: OrderLine, s: Settings): number {
  const p: ExtraPrices = { side: line.extraSidePrice ?? s.extraSidePrice, sauce: line.extraSaucePrice ?? s.extraSaucePrice, rice: line.extraRicePrice ?? extraRicePrice(s) };
  let extras = extrasFor(line.choices, p);
  if (line.combo) extras += line.combo.parts.reduce((sum, part) => sum + extrasFor(part, p), 0);
  return line.unitPrice + extras;
}

export function lineTotal(line: OrderLine, s: Settings): number {
  return lineUnitTotal(line, s) * line.qty;
}

export function subtotal(lines: OrderLine[], s: Settings): number {
  return lines.reduce((sum, l) => sum + lineTotal(l, s), 0);
}

/** How many of each menu item an order uses up (combos, extras and free items included). */
export function stockUsage(lines: OrderLine[]): Record<string, number> {
  const used: Record<string, number> = {};
  const add = (id: string, n: number) => {
    if (n > 0) used[id] = (used[id] ?? 0) + n;
  };
  const addChoices = (c: { extraSides?: string[]; extraSauce?: number; extraRice?: number; topping?: string } | undefined, qty: number) => {
    add('extra-side', (c?.extraSides?.length ?? 0) * qty);
    add('extra-sauce', (c?.extraSauce ?? 0) * qty);
    add('extra-rice', (c?.extraRice ?? 0) * qty);
    // Fries on top of a drink (80 g) comes out of the fries ingredient, not a Fries with Dip portion.
    if (c?.topping === 'fries') add('topping-fries', qty);
  };
  for (const line of lines) {
    if (line.combo) {
      for (const p of line.combo.parts) {
        add(p.itemId, line.qty);
        addChoices(p, line.qty);
      }
    } else {
      add(line.itemId, line.qty);
      addChoices(line.choices, line.qty);
    }
  }
  return used;
}

/** Ingredient cost of one unit of the line, from today's unit costs (combo parts and extras included). */
export function lineCostEach(line: OrderLine, s: Settings): number {
  let cost = 0;
  for (const [id, n] of Object.entries(stockUsage([{ ...line, qty: 1 }]))) cost += (itemById(s, id)?.unitCost ?? 0) * n;
  return Math.round(cost * 100) / 100;
}

/** A copy of the line that remembers today's extras prices and unit cost (see OrderLine). */
export function snapshotLine(line: OrderLine, s: Settings): OrderLine {
  return { ...line, extraSidePrice: s.extraSidePrice, extraSaucePrice: s.extraSaucePrice, extraRicePrice: extraRicePrice(s), costEach: lineCostEach(line, s) };
}

/** Spins one combo earns. */
export const COMBO_SPINS = 3;

/** Does this line earn spins? Everything bought except bottled water, add-ons and free items. */
function spins(l: OrderLine, s: Settings): number {
  if (l.free) return 0;
  if (l.combo) return COMBO_SPINS;
  const item = itemById(s, l.itemId);
  if (!item || item.kind === 'water' || item.category === 'addons') return 0;
  return 1;
}

/**
 * Spins an order earns: one for every item bought (not bottled water, add-ons
 * or free items), three for a combo. An order paid with a voucher spins too.
 */
export function spinsEarned(lines: OrderLine[], s: Settings, _hasVoucher?: boolean): number {
  if (s.wheel.paused) return 0;
  return lines.reduce((n, l) => n + spins(l, s) * l.qty, 0);
}

export type SpinUnit = { lineId: string; unit: number; name: string; price: number; combo: boolean };

/** Everything on the order that can spin, one entry per spin: {lineId, unit}. A combo gives 3 units per combo. */
export function spinnableUnits(lines: OrderLine[], s: Settings): SpinUnit[] {
  const out: SpinUnit[] = [];
  for (const l of lines) {
    const n = spins(l, s) * l.qty;
    for (let u = 0; u < n; u++) out.push({ lineId: l.id, unit: u, name: l.name, price: lineUnitTotal(l, s), combo: !!l.combo });
  }
  return out;
}

/** Older name, kept so existing screens keep working. */
export const spinnableBowls = spinnableUnits;

type PartKind = Combo['parts'][number];

function lineMatchesPart(line: OrderLine, kind: PartKind, s: Settings): boolean {
  if (line.combo || line.free) return false;
  const item = itemById(s, line.itemId);
  if (!item) return false;
  if (kind === 'fries') return item.kind === 'fries' && !!item.regular;
  return item.kind === kind;
}

export type ComboSuggestion = { combo: Combo; lineIds: string[]; saving: number };

/** If the order already holds every item of a combo, return the best combo to switch to. */
export function suggestCombo(lines: OrderLine[], s: Settings): ComboSuggestion | null {
  let best: ComboSuggestion | null = null;
  for (const combo of s.combos.filter((c) => c.active)) {
    const taken = new Map<string, number>();
    const picked: string[] = [];
    for (const kind of combo.parts) {
      const line = lines.find((l) => lineMatchesPart(l, kind, s) && (taken.get(l.id) ?? 0) < l.qty);
      if (!line) {
        picked.length = 0;
        break;
      }
      taken.set(line.id, (taken.get(line.id) ?? 0) + 1);
      picked.push(line.id);
    }
    if (picked.length !== combo.parts.length) continue;
    const separate = picked.reduce((sum, id) => sum + lines.find((l) => l.id === id)!.unitPrice, 0);
    const saving = separate - combo.price;
    if (saving > 0 && (!best || saving > best.saving)) best = { combo, lineIds: picked, saving };
  }
  return best;
}

export function makeComboLine(combo: Combo, parts: ComboPart[], s: Settings, notes?: string): OrderLine {
  const names = parts.map((p) => itemById(s, p.itemId)?.name ?? p.itemId);
  return {
    id: newId('l'),
    itemId: combo.id,
    name: `${combo.name}: ${names.join(' + ')}`,
    qty: 1,
    unitPrice: combo.price,
    combo: { comboId: combo.id, parts },
    notes,
  };
}

/** Replace one unit of each matched line with a single combo line. */
export function applyCombo(lines: OrderLine[], sug: ComboSuggestion, s: Settings): OrderLine[] {
  const parts: ComboPart[] = [];
  const notes: string[] = [];
  let next = lines.map((l) => ({ ...l }));
  for (const id of sug.lineIds) {
    const line = next.find((l) => l.id === id)!;
    parts.push({ itemId: line.itemId, ...line.choices });
    if (line.notes && !notes.includes(line.notes)) notes.push(line.notes);
    line.qty -= 1;
  }
  next = next.filter((l) => l.qty > 0);
  next.push(makeComboLine(sug.combo, parts, s, notes.join('; ') || undefined));
  return next;
}

/** ₱1,234 for whole pesos, ₱96.04 when there are centavos (unit costs). */
export function peso(n: number): string {
  const v = Math.round(Math.abs(n) * 100) / 100;
  const sign = n < 0 && v > 0 ? '−' : '';
  const cents = Number.isInteger(v) ? 0 : 2;
  return `${sign}₱${v.toLocaleString('en-PH', { minimumFractionDigits: cents, maximumFractionDigits: 2 })}`;
}

/** Round to centavos for exports (avoids 215.86000000000001). */
export function money2(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Items the cashier picks options for: bowls (side), regular fries (dip), extra side. */
export function needsPicker(item: MenuItem): boolean {
  return item.kind === 'bowl' || (item.kind === 'fries' && !!item.regular) || item.kind === 'extraSide';
}
