import { itemById } from './pricing';
import type { MenuItem, Order, OrderLine, Settings } from './types';

/** The bowl choice for a customer who wants no free side. Stored as the side's name. */
export const NO_SIDE = 'No side';

/** Longest note the cashier can send to the kitchen (one item or the whole order). */
export const NOTE_MAX = 80;

/**
 * One thing the kitchen ticks off: a line of the order, or one part of a
 * combo (the bowl, the fries, the drink are made at different stations).
 */
export type KitchenUnit = {
  /** What is stored in order.done when it is ticked. */
  key: string;
  lineId: string;
  /** Index of the combo part; undefined for a plain line. */
  part?: number;
  /** Pieces this tick stands for (a line of 2 bowls is one tick, two pieces). */
  qty: number;
};

export function kitchenUnits(lines: OrderLine[]): KitchenUnit[] {
  const out: KitchenUnit[] = [];
  for (const l of lines) {
    if (l.combo) l.combo.parts.forEach((_p, i) => out.push({ key: `${l.id}#${i}`, lineId: l.id, part: i, qty: l.qty }));
    else out.push({ key: l.id, lineId: l.id, qty: l.qty });
  }
  return out;
}

type Progress = Pick<Order, 'lines' | 'done' | 'status'>;

/** "4 of 6 ready": pieces ticked and pieces in the order. A ready or picked-up order is all done. */
export function itemProgress(o: Progress): { done: number; total: number } {
  const units = kitchenUnits(o.lines);
  const total = units.reduce((n, u) => n + u.qty, 0);
  if (o.status === 'ready' || o.status === 'claimed') return { done: total, total };
  const ticked = new Set(o.done ?? []);
  return { done: units.reduce((n, u) => n + (ticked.has(u.key) ? u.qty : 0), 0), total };
}

/** Every item of the order is ticked (an order with no items is never "all ticked"). */
export function allTicked(o: Pick<Order, 'lines' | 'done'>): boolean {
  const units = kitchenUnits(o.lines);
  const ticked = new Set(o.done ?? []);
  return units.length > 0 && units.every((u) => ticked.has(u.key));
}

/** The ticks that still belong to an item of the order (a removed wheel prize takes its tick with it). */
export function liveTicks(o: Pick<Order, 'lines' | 'done'>): string[] {
  const keys = new Set(kitchenUnits(o.lines).map((u) => u.key));
  return (o.done ?? []).filter((k) => keys.has(k));
}

// ---------- Notes ----------

/** A note as typed at the counter: single spaces, at most NOTE_MAX characters. Empty = no note. */
export function cleanNote(text: string | undefined): string | undefined {
  const n = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX).trim();
  return n || undefined;
}

const KIND_NOTES: Partial<Record<NonNullable<MenuItem['kind']>, string[]>> = {
  bowl: ['No sauce', 'Sauce on the side', 'Less rice'],
  fries: ['Less fries', 'Less salt'],
  slushie: ['Less ice', 'Less sweet'],
  cookie: ['Warm it up'],
  water: ['Cold', 'Not cold'],
};

/** One-tap notes that make sense for this line (for a combo: for each of its parts). */
export function quickNotes(line: OrderLine, s: Settings): string[] {
  const ids = line.combo ? line.combo.parts.map((p) => p.itemId) : [line.itemId];
  const out: string[] = [];
  const add = (n: string) => {
    if (!out.includes(n)) out.push(n);
  };
  for (const id of ids) {
    const item = itemById(s, id);
    if (!item?.kind) continue;
    // Only the loaded fries have bacon and cheese sauce.
    if (item.kind === 'fries' && !item.regular) ['No bacon', 'No cheese sauce'].forEach(add);
    (KIND_NOTES[item.kind] ?? []).forEach(add);
  }
  return out;
}

function noteParts(notes: string | undefined): string[] {
  return (notes ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Is this one-tap note already in the line's note? */
export function hasNote(notes: string | undefined, phrase: string): boolean {
  const want = phrase.toLowerCase();
  return noteParts(notes).some((p) => p.toLowerCase() === want);
}

/** Tap a one-tap note: adds it to the note, or takes it out if it is already there. Typed text is kept. */
export function toggleNote(notes: string | undefined, phrase: string): string | undefined {
  const parts = noteParts(notes);
  const want = phrase.toLowerCase();
  const next = parts.some((p) => p.toLowerCase() === want) ? parts.filter((p) => p.toLowerCase() !== want) : [...parts, phrase];
  return cleanNote(next.join(', '));
}
