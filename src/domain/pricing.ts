import type { Combo, ComboPart, MenuItem, OrderLine, Settings } from './types';

export function newId(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

export function itemById(settings: Settings, id: string): MenuItem | undefined {
  return settings.menu.find((m) => m.id === id);
}

function extrasFor(c: { extraSides?: string[]; extraSauce?: number } | undefined, s: Settings): number {
  if (!c) return 0;
  return (c.extraSides?.length ?? 0) * s.extraSidePrice + (c.extraSauce ?? 0) * s.extraSaucePrice;
}

/** Price of one unit of the line, including paid extras. */
export function lineUnitTotal(line: OrderLine, s: Settings): number {
  let extras = extrasFor(line.choices, s);
  if (line.combo) extras += line.combo.parts.reduce((sum, p) => sum + extrasFor(p, s), 0);
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
  const addChoices = (c: { extraSides?: string[]; extraSauce?: number } | undefined, qty: number) => {
    add('extra-side', (c?.extraSides?.length ?? 0) * qty);
    add('extra-sauce', (c?.extraSauce ?? 0) * qty);
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

/**
 * Spins an order earns: one per bowl that is not in a combo and not free.
 * An order paid with a voucher earns none.
 */
export function spinsEarned(lines: OrderLine[], s: Settings, hasVoucher: boolean): number {
  if (hasVoucher || s.wheel.paused) return 0;
  return lines
    .filter((l) => !l.combo && !l.free && itemById(s, l.itemId)?.kind === 'bowl')
    .reduce((n, l) => n + l.qty, 0);
}

/** The bowl units that can spin, as {lineId, unit}. */
export function spinnableBowls(lines: OrderLine[], s: Settings): { lineId: string; unit: number; name: string; price: number }[] {
  const out: { lineId: string; unit: number; name: string; price: number }[] = [];
  for (const l of lines) {
    if (l.combo || l.free || itemById(s, l.itemId)?.kind !== 'bowl') continue;
    for (let u = 0; u < l.qty; u++) out.push({ lineId: l.id, unit: u, name: l.name, price: lineUnitTotal(l, s) });
  }
  return out;
}

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
  const names = parts.map((p) => itemById(s, p.itemId)?.short ?? itemById(s, p.itemId)?.name ?? p.itemId);
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

export function peso(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}₱${Math.abs(n).toLocaleString('en-PH')}`;
}
