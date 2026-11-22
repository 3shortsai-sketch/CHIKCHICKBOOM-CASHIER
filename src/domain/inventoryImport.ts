// Load many stock counts at once from a pasted list or a file: one line per
// thing, "name, amount". Everything here is pure, so the screen only shows
// the rows and makes the store calls.

import type { BusinessDay, Ingredient, MenuItem, Settings, StockCount } from './types';

/** The example the screen shows. */
export const EXAMPLE = ['Chicken thigh fillet, 25 kg', 'Butter, 500 g', 'Rice, 20 kg', 'Cooking oil, 4 L', 'Eggs, 60 pcs', 'OG Chicken Rice Bowl, 60'].join('\n');

export type Row = {
  /** Line number in the pasted text, starting at 1. */
  line: number;
  raw: string;
  /** The name as typed (for a new ingredient: the name it gets). */
  name: string;
  amount: number;
  kind: 'menu' | 'ingredient' | 'new' | 'error';
  /** The menu item or ingredient this line is for. */
  id?: string;
  matchedName?: string;
  problem?: string;
  /** Unit typed with the amount ("kg"). A new ingredient always has one. */
  unit?: string;
  /** Warn-at level from the third column (ingredients only). */
  low?: number;
  /** The name was not exact: we picked the only thing that fits. */
  close?: boolean;
  /** What the sheet said when the amount was changed to the ingredient's unit: "500 g". */
  typed?: string;
};

type Candidate = { kind: 'menu' | 'ingredient'; id: string; name: string; unit?: string; words: string[] };

/** Units that measure weight or volume: "2 kg" is never a count of menu items. */
const MEASURES = ['kg', 'g', 'mg', 'L', 'ml'];
const UNIT_ALIAS: Record<string, string> = {
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g',
  mg: 'mg',
  l: 'L', liter: 'L', liters: 'L', litre: 'L', litres: 'L',
  ml: 'ml',
  pc: 'pcs', pcs: 'pcs', piece: 'pcs', pieces: 'pcs',
  pack: 'pack', packs: 'pack',
  bottle: 'bottle', bottles: 'bottle',
  box: 'box', boxes: 'box',
  can: 'can', cans: 'can',
  tray: 'tray', trays: 'tray',
  dozen: 'dozen', dozens: 'dozen', doz: 'dozen',
  sack: 'sack', sacks: 'sack', case: 'case', cases: 'case', bag: 'bag', bags: 'bag', carton: 'carton', cartons: 'carton', bundle: 'bundle', bundles: 'bundle',
};
/** Units that hold many pieces: never read as a number of pieces or kilos. */
const PACKS = ['pack', 'box', 'tray', 'dozen', 'sack', 'case', 'bag', 'carton', 'bundle'];
/** How many of the smallest unit of its family one unit is: g and kg convert, kg and L do not. */
const SCALE: Record<string, { family: string; size: number }> = {
  mg: { family: 'weight', size: 0.001 },
  g: { family: 'weight', size: 1 },
  kg: { family: 'weight', size: 1000 },
  ml: { family: 'volume', size: 1 },
  L: { family: 'volume', size: 1000 },
  pcs: { family: 'count', size: 1 },
  dozen: { family: 'count', size: 12 },
};

/** 500 g -> 0.5 kg. Null when the two units do not convert. */
function convert(amount: number, from: string, to: string): number | null {
  const a = SCALE[from];
  const b = SCALE[to];
  if (!a || !b || a.family !== b.family) return null;
  return Math.round(((amount * a.size) / b.size) * 1e6) / 1e6;
}

/** 0.5 -> "0.5", 12 -> "12". */
function plainNumber(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}
const HEADERS = ['name', 'item', 'ingredient'];
const TOO_BIG = 100000;

/** "12 KGS." -> "kg". An unknown unit is kept as typed. */
function cleanUnit(u: string): string {
  const t = u.trim().replace(/\.$/, '');
  return UNIT_ALIAS[t.toLowerCase()] ?? t.slice(0, 12);
}

/** Words of a name with case, punctuation and plural "s" taken out. */
function words(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/** One string to compare names by: spaces do not count. */
const key = (ws: string[]) => ws.join('');

function candidates(s: Settings): Candidate[] {
  const menu = s.menu.filter((m) => m.active).map((m): Candidate => ({ kind: 'menu', id: m.id, name: m.name, words: words(m.name) }));
  const ings = s.ingredients.map((i): Candidate => ({ kind: 'ingredient', id: i.id, name: i.name, unit: i.unit, words: words(i.name) }));
  return [...menu, ...ings];
}

/** Split one line into cells. Quotes keep a separator inside a cell ("Salt, iodized"). */
function cells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === '') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Tab wins, then semicolon, then comma. */
function separator(line: string): string {
  if (line.includes('\t')) return '\t';
  return line.includes(';') ? ';' : ',';
}

/** "1,250" -> 1250, "12,5" -> 12.5, "12" -> 12. NaN when it is not a number. */
function toNumber(text: string): number {
  const t = text.replace(/\s+/g, '');
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  if (/^[+-]?\d+,\d+$/.test(t)) return Number(t.replace(',', '.'));
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
}

/** "12 kg" / "12kg" / "1,250" -> the number and the unit after it. */
function parseAmount(cell: string): { amount: number; unit?: string } {
  // One number, then at most one unit word. Anything more ("1 tray (30 pcs)",
  // "30-40", "2 x 500ml") is not safe to guess, so it is not a number.
  const m = /^([+-]?[\d.,\s]*\d\.?)\s*([a-zA-Z]+\.?)?$/.exec(cell.trim());
  if (!m) return { amount: NaN };
  return { amount: toNumber(m[1]), unit: m[2] ? cleanUnit(m[2]) : undefined };
}

/** What Claude or a chat app adds around a line: bullets, numbering, bold and code marks. */
function stripMarks(line: string): string {
  return line
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/, '')
    .trim();
}

/** Find the thing a typed name means. */
function match(name: string, all: Candidate[], measured: boolean): { hit?: Candidate; close?: boolean; many?: Candidate[] } {
  const typed = name.trim().toLowerCase();
  const byId = all.find((c) => c.id.toLowerCase() === typed);
  if (byId) return { hit: byId };

  const ws = words(name);
  if (!ws.length) return {};
  const exact = all.filter((c) => key(c.words) === key(ws));
  if (exact.length === 1) return { hit: exact[0] };
  if (exact.length > 1) return { many: exact };

  // Close: every typed word starts a word of the name ("choco chip cookie").
  const fits = all.filter((c) => ws.every((w) => c.words.some((cw) => cw.startsWith(w))));
  const ings = fits.filter((c) => c.kind === 'ingredient');
  // An amount in kg or L is never a menu item, so those only look at ingredients.
  // One word alone ("Butter", "Garlic") is an ingredient name: it never picks a
  // menu item by itself, it is a new ingredient unless an ingredient fits too.
  const close = measured ? ings : ws.length === 1 && !ings.length ? [] : fits;
  if (close.length === 1) return { hit: close[0], close: true };
  return close.length > 1 ? { many: close } : {};
}

function whichOne(many: Candidate[]): string {
  const names = many.slice(0, 5).map((c) => c.name);
  return `Which one? ${names.join(', ')}${many.length > 5 ? ', …' : ''}`;
}

/** Turn one line into a row, or 'blank' when the amount was left empty on purpose. */
function parseLine(line: number, raw: string, all: Candidate[]): Row | 'blank' {
  const text = stripMarks(raw);
  const bad = (problem: string, extra: Partial<Row> = {}): Row => ({ line, raw, name: text, amount: NaN, kind: 'error', problem, ...extra });

  const sep = separator(text);
  let parts = cells(text, sep);
  // "Rice 20kg" with no separator at all.
  if (parts.length === 1) {
    const m = /^(.*\S)\s+([+-]?\d[\d.]*\s*[a-zA-Z]*\.?)$/.exec(parts[0]);
    if (m) parts = [m[1], m[2]];
  }
  const [name, amountCell = '', lowCell = ''] = parts;

  if (!name) return bad('No name.');
  if (parts.length === 1) return bad(`No amount. Write it like this: ${name}, 20`, { name });
  if (!amountCell) return 'blank';
  // "Cups, 1,250" would read as 1 with a warn-at level of 250.
  const thousands = sep === ',' && parts.length === 3 && /,\s+(\d{1,3}),(\d{3})\s*[a-zA-Z]*$/.exec(text);
  if (thousands) return bad(`Is this ${thousands[1]}${thousands[2]}? Write it without the comma.`, { name });

  const { amount, unit } = parseAmount(amountCell);
  const measured = !!unit && MEASURES.includes(unit);
  const found = match(name, all, measured);
  const hit = found.hit;
  const base = { line, raw, name, amount, unit, id: hit?.id, matchedName: hit?.name, close: found.close };
  const err = (problem: string): Row => ({ ...base, kind: 'error', problem });

  if (/^(sub|grand)?\s*totals?\b|^date$|^as of\b/i.test(name.trim())) return err('This looks like a total or a date, not something to count. Delete the line.');
  if (Number.isNaN(amount)) return err('Write one number, then one unit, like 25 kg. Notes and ranges are not read.');
  if (amount < 0) return err('The amount cannot be less than 0.');
  if (amount > TOO_BIG) return err('That number looks too big.');
  if (found.many) return err(whichOne(found.many));

  if (hit?.kind === 'menu') {
    if (!Number.isInteger(amount)) return err('Menu items are counted in whole pieces.');
    if (unit && (measured || PACKS.includes(unit))) return err(`Menu items are counted in pieces, not in ${unit}. Write how many pieces.`);
    if (lowCell) return err('Menu items take one number only. Is there a comma inside the number?');
    return { ...base, kind: 'menu' };
  }

  let low: number | undefined;
  if (lowCell) {
    const warn = parseAmount(lowCell);
    low = warn.amount;
    if (Number.isNaN(low) || low < 0) return err('The warn-at number is not a number.');
    // "Cabbage, 1,5 kg" splits into 1 and "5 kg": a decimal comma, not a warn-at level.
    if (warn.unit && !unit) return err(`Is this ${plainNumber(amount)}.${lowCell.trim()}? Write decimals with a point, like 1.5 kg.`);
    if (warn.unit && unit && warn.unit !== unit) {
      const same = convert(low, warn.unit, unit);
      if (same === null) return err('The warn-at number uses another unit than the amount.');
      low = same;
    }
  }
  if (hit) {
    // The sheet may use another unit than the list: change g to kg, never guess packs to kg.
    const own = cleanUnit(hit.unit ?? '');
    if (unit && own && unit !== own) {
      const changed = convert(amount, unit, own);
      const lowChanged = low === undefined ? undefined : (convert(low, unit, own) ?? low);
      if (changed !== null) return { ...base, kind: 'ingredient', low: lowChanged, amount: changed, unit: own, typed: `${plainNumber(amount)} ${unit}` };
      // Trays, packs, boxes, sacks: never guessed into pieces or kilos.
      // A unit the app does not know ("oz") is only fine when it is the thing's own name ("150 cups" of Slushie cups).
      const known = unit.toLowerCase() in UNIT_ALIAS || words(hit.name).includes(words(unit)[0] ?? '');
      if (measured || MEASURES.includes(own) || PACKS.includes(unit) || !known) return err(`This is counted in ${hit.unit} here, not in ${unit}. Write the amount in ${hit.unit}.`);
    }
    return { ...base, kind: 'ingredient', low };
  }
  return { ...base, kind: 'new', unit: unit || 'pcs', low };
}

/**
 * Read a pasted list or a file. Lines are "name, amount" (comma, tab or
 * semicolon). Skipped: empty lines, notes starting with #, code fence lines
 * and any words outside the code block, a header row, and lines whose amount is left empty (counted in `blank`).
 * When a thing is listed twice the later line wins.
 */
export function parseInventory(text: string, settings: Settings): { rows: Row[]; blank: number } {
  const all = candidates(settings);
  const rows: Row[] = [];
  let blank = 0;
  let first = true;
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  // An answer from Claude has the list inside a code block: the words around it are not counts.
  const fenced = lines.filter((l) => l.trim().startsWith('```')).length >= 2;
  let inside = false;

  lines.forEach((full, i) => {
    const raw = full.trim();
    if (raw.startsWith('```')) {
      inside = !inside;
      return;
    }
    if (!raw || (fenced && !inside)) return;
    // "Here are the counts:" is a sentence, not a line of the list.
    if (/:$/.test(raw) && !/\d/.test(raw)) return;
    const check = /^#\s*check\s*:?\s*(.*)$/i.exec(raw);
    if (check) {
      rows.push({ line: i + 1, raw, name: check[1] || raw, amount: NaN, kind: 'error', problem: 'Check this number in your sheet' });
      return;
    }
    if (raw.startsWith('#')) return;
    const isFirst = first;
    first = false;
    if (isFirst && HEADERS.includes(cells(stripMarks(raw), separator(raw))[0].toLowerCase())) return;
    const row = parseLine(i + 1, raw, all);
    if (row === 'blank') blank++;
    else rows.push(row);
  });

  // The same thing twice: keep the later line.
  const seen = new Set<string>();
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.kind === 'error') continue;
    const k = r.id ?? `new:${key(words(r.name))}`;
    if (seen.has(k)) rows[i] = { ...r, kind: 'error', problem: 'Listed twice. The later line is used.' };
    seen.add(k);
  }
  return { rows, blank };
}

/** How many rows of each kind, for the summary line. */
export function summary(rows: Row[]): { menu: number; ingredient: number; fresh: number; error: number } {
  const n = (k: Row['kind']) => rows.filter((r) => r.kind === k).length;
  return { menu: n('menu'), ingredient: n('ingredient'), fresh: n('new'), error: n('error') };
}

function csvName(name: string): string {
  return /[",;\t\n]/.test(name) || name !== name.trim() ? `"${name.replace(/"/g, '""')}"` : name;
}

/** A CSV with every active menu item and every ingredient, amounts empty: fill it in Excel or Sheets. */
export function blankList(settings: Settings): string {
  const names = [...settings.menu.filter((m) => m.active).map((m) => m.name), ...settings.ingredients.map((i) => i.name)];
  return ['Name,Amount', ...names.map((n) => `${csvName(n)},`)].join('\r\n') + '\r\n';
}

/**
 * A prompt to paste into Claude together with a screenshot of the stock
 * sheet. Claude's answer can be pasted straight into the import box.
 */
export function importPrompt(settings: Settings): string {
  const menu = settings.menu.filter((m) => m.active);
  const ings = settings.ingredients;
  const example: string[] = [];
  if (ings[0]) example.push(`${ings[0].name}, 25 ${ings[0].unit}`);
  if (ings[1]) example.push(`${ings[1].name}, 20 ${ings[1].unit}`);
  if (menu[0]) example.push(`${menu[0].name}, 60`);
  const spare = ['Rice, 20 kg', 'Eggs, 60 pcs', 'Cooking oil, 4 L'];
  while (example.length < 3) example.push(spare[example.length]);
  return [
    'Read the stock counts in the screenshot I attached and write them as plain text, one line per item, exactly `name, amount`.',
    'The screenshot is my ingredient inventory: how much of each ingredient and supply we have.',
    '',
    'Ingredients already in my list (the unit I count them in is in brackets):',
    ...(ings.length ? ings.map((i) => `- ${i.name} (${i.unit})`) : ['- none yet']),
    '',
    'Menu items, in case the sheet has finished items too:',
    ...(menu.length ? menu.map((m) => `- ${m.name}`) : ['- none']),
    '',
    'Rules:',
    '1. Write one line for every ingredient in the sheet, even when it is not in my list.',
    '2. Use the exact name from my list when the name in the sheet clearly means the same thing. Do not write the brackets.',
    "3. For anything not in my list, use the sheet's own name exactly as it is written.",
    '4. Put the unit after the amount and keep the unit exactly as shown in the sheet, for example `25 kg` or `500 g`. Do not convert it.',
    '5. Menu items are whole numbers with no unit.',
    '6. Skip rows that have no amount.',
    '7. Do not use a comma inside a number: write 1250, not 1,250.',
    '8. If you cannot read a number, write that line starting with `# CHECK:` so I can fix it.',
    '9. No header, no bullets, no bold, no extra words: reply with ONLY the lines inside one code block.',
    '',
    'Example of the answer:',
    '```',
    ...example,
    '```',
  ].join('\n');
}

/** What to put back when an import is undone. */
export type UndoInfo = {
  dayId?: string;
  /** Count each touched menu item had before (null = it had none). */
  counts: Record<string, StockCount | null>;
  startStock: Record<string, number>;
  /** Count and warn-at level each touched ingredient had before. */
  ingredients: Record<string, { count?: StockCount; low: number }>;
  addedIds: string[];
};

export type Plan = {
  /** The day's whole stockCounts map, for one patchDay. */
  stockCounts?: Record<string, StockCount>;
  /** The whole menu, for one saveSettings. */
  menu?: MenuItem[];
  /** The whole ingredient list, for one saveSettings. */
  ingredients?: Ingredient[];
  done: { menu: number; ingredient: number; added: number };
  undo: UndoInfo;
};

/**
 * Work out the store changes for the valid rows. Menu items go to today's
 * count; to the starting stock too when no day is open or `alsoStart` is on.
 * New ingredients are added unless their line number is in `skipNew`.
 */
export function planInventory(
  rows: Row[],
  opts: { settings: Settings; day: BusinessDay | undefined; who: string; now: number; alsoStart: boolean; skipNew: number[]; newId: () => string },
): Plan {
  const { settings, day, who, now } = opts;
  const stamp = (qty: number): StockCount => ({ qty, at: now, by: who });
  const undo: UndoInfo = { dayId: day?.id, counts: {}, startStock: {}, ingredients: {}, addedIds: [] };

  const menuRows = rows.filter((r) => r.kind === 'menu' && r.id);
  const ingRows = rows.filter((r) => r.kind === 'ingredient' && r.id);
  const newRows = rows.filter((r) => r.kind === 'new' && !opts.skipNew.includes(r.line));

  let stockCounts: Record<string, StockCount> | undefined;
  if (day && menuRows.length) {
    stockCounts = { ...(day.stockCounts ?? {}) };
    for (const r of menuRows) {
      undo.counts[r.id!] = day.stockCounts?.[r.id!] ?? null;
      stockCounts[r.id!] = stamp(r.amount);
    }
  }

  let menu: MenuItem[] | undefined;
  if (menuRows.length && (!day || opts.alsoStart)) {
    const byId = new Map(menuRows.map((r) => [r.id!, r.amount]));
    menu = settings.menu.map((m) => {
      if (!byId.has(m.id)) return m;
      undo.startStock[m.id] = m.startStock;
      return { ...m, startStock: byId.get(m.id)! };
    });
  }

  let ingredients: Ingredient[] | undefined;
  if (ingRows.length || newRows.length) {
    const byId = new Map(ingRows.map((r) => [r.id!, r]));
    ingredients = settings.ingredients.map((ing) => {
      const r = byId.get(ing.id);
      if (!r) return ing;
      undo.ingredients[ing.id] = { count: ing.count, low: ing.low };
      return { ...ing, count: stamp(r.amount), ...(r.low !== undefined ? { low: r.low } : {}) };
    });
    for (const r of newRows) {
      const id = opts.newId();
      undo.addedIds.push(id);
      ingredients.push({ id, name: r.name, unit: r.unit || 'pcs', low: r.low ?? 0, count: stamp(r.amount) });
    }
  }

  return { stockCounts, menu, ingredients, done: { menu: menuRows.length, ingredient: ingRows.length, added: newRows.length }, undo };
}

/**
 * The store changes that take an import back. Only the things the import
 * touched are put back, so counts made by someone else in between are kept.
 */
export function planUndo(undo: UndoInfo, settings: Settings, day: BusinessDay | undefined): Pick<Plan, 'stockCounts' | 'menu' | 'ingredients'> {
  let stockCounts: Record<string, StockCount> | undefined;
  const countIds = Object.keys(undo.counts);
  if (day && day.id === undo.dayId && countIds.length) {
    stockCounts = { ...(day.stockCounts ?? {}) };
    for (const id of countIds) {
      // An entry cannot be taken out of the synced map, so an item that had
      // no count goes back to its opening stock, counted from just before the
      // day opened. That gives the same number as having no count.
      const start = day.stockStart[id] ?? settings.menu.find((m) => m.id === id)?.startStock ?? 0;
      stockCounts[id] = undo.counts[id] ?? { qty: start, at: day.openedAt - 1, by: 'opening stock' };
    }
  }

  const menu = Object.keys(undo.startStock).length ? settings.menu.map((m) => (m.id in undo.startStock ? { ...m, startStock: undo.startStock[m.id] } : m)) : undefined;

  let ingredients: Ingredient[] | undefined;
  if (Object.keys(undo.ingredients).length || undo.addedIds.length) {
    ingredients = settings.ingredients
      .filter((ing) => !undo.addedIds.includes(ing.id))
      .map((ing) => {
        const was = undo.ingredients[ing.id];
        if (!was) return ing;
        const { count: _count, ...rest } = ing;
        return was.count ? { ...rest, count: was.count, low: was.low } : { ...rest, low: was.low };
      });
  }
  return { stockCounts, menu, ingredients };
}
