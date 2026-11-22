import { describe, expect, it } from 'vitest';
import { defaultSettings } from './defaults';
import { blankList, EXAMPLE, importPrompt, parseInventory, planInventory, planUndo, summary } from './inventoryImport';
import type { BusinessDay, Settings } from './types';

const s = defaultSettings();

const day: BusinessDay = {
  id: 'demo-2026-11-23',
  mode: 'demo',
  date: '2026-11-23',
  openedAt: 1000,
  openedBy: 'Ana',
  openingFloat: 2000,
  stockStart: Object.fromEntries(s.menu.map((m) => [m.id, m.startStock])),
  soldOut: {},
};

/** Parse one line and return its row. */
const one = (text: string, settings: Settings = s) => parseInventory(text, settings).rows[0];

describe('parseInventory: the example', () => {
  const { rows, blank } = parseInventory(EXAMPLE, s);

  it('matches every line of the example', () => {
    expect(blank).toBe(0);
    expect(rows.map((r) => [r.kind, r.id, r.amount, r.unit])).toEqual([
      ['ingredient', 'ing-chicken', 25, 'kg'],
      ['new', undefined, 500, 'g'],
      ['ingredient', 'ing-rice', 20, 'kg'],
      ['ingredient', 'ing-oil', 4, 'L'],
      ['ingredient', 'ing-eggs', 60, 'pcs'],
      ['menu', 'bowl-original', 60, undefined],
    ]);
  });

  it('keeps the line number, the raw text and the matched name', () => {
    expect(rows[0]).toMatchObject({ line: 1, raw: 'Chicken thigh fillet, 25 kg', name: 'Chicken thigh fillet', matchedName: 'Chicken thigh fillet', unit: 'kg' });
  });

  it('counts the kinds for the summary line', () => {
    expect(summary(rows)).toEqual({ menu: 1, ingredient: 4, fresh: 1, error: 0 });
  });
});

describe('parseInventory: messy input', () => {
  it('reads a file with a BOM, CRLF line ends, a header, tabs and extra spaces', () => {
    const text = '\uFEFFName\tAmount\r\n  og chicken rice bowl \t 1,250 \r\n\r\n# counted at 7am\r\nRICE\t12kg\r\n';
    const { rows } = parseInventory(text, s);
    expect(rows.map((r) => [r.line, r.kind, r.id, r.amount])).toEqual([
      [2, 'menu', 'bowl-original', 1250],
      [5, 'ingredient', 'ing-rice', 12],
    ]);
  });

  it('skips a header row whatever its case', () => {
    expect(parseInventory('ITEM, amount\nRice, 3', s).rows).toHaveLength(1);
    expect(parseInventory('Ingredient;Amount\nRice;3', s).rows).toHaveLength(1);
  });

  it('accepts semicolons, with a decimal comma', () => {
    expect(one('Rice; 12,5 kg')).toMatchObject({ kind: 'ingredient', id: 'ing-rice', amount: 12.5 });
  });

  it('reads quoted names with commas and quoted thousands', () => {
    const withComma: Settings = { ...s, ingredients: [...s.ingredients, { id: 'ing-x', name: 'Salt, iodized', unit: 'kg', low: 0 }] };
    expect(one('"Salt, iodized", 2', withComma)).toMatchObject({ kind: 'ingredient', id: 'ing-x', amount: 2 });
    expect(one('Slushie cups, "1,250"')).toMatchObject({ kind: 'ingredient', id: 'ing-cups', amount: 1250 });
  });

  it('reads a unit stuck on or after the amount', () => {
    expect(one('Cooking oil, 12L')).toMatchObject({ amount: 12, unit: 'L' });
    expect(one('Cooking oil, 12 liters')).toMatchObject({ amount: 12, unit: 'L' });
    expect(one('Eggs, 60 pcs')).toMatchObject({ kind: 'ingredient', amount: 60, unit: 'pcs' });
    expect(one('Bottled Water, 48 bottles')).toMatchObject({ kind: 'menu', amount: 48 });
  });

  it('reads "name amount" with no separator', () => {
    expect(one('Rice 20kg')).toMatchObject({ kind: 'ingredient', id: 'ing-rice', amount: 20 });
    expect(one('Bottled Water 48')).toMatchObject({ kind: 'menu', id: 'water', amount: 48 });
  });

  it('ignores case, spaces, punctuation and plurals', () => {
    expect(one('fries  with dip!, 5').id).toBe('fries-reg');
    expect(one('Egg, 5').id).toBe('ing-eggs');
    expect(one('slushie-cup, 5').id).toBe('ing-cups');
    expect(one('All purpose flour, 5').id).toBe('ing-flour');
    expect(one('BottledWater, 5').id).toBe('water');
  });

  it('accepts the item id', () => {
    expect(one('bowl-alaking, 7')).toMatchObject({ kind: 'menu', id: 'bowl-alaking', matchedName: 'Chicken Ala King Rice Bowl' });
    expect(one('ing-rice, 7')).toMatchObject({ kind: 'ingredient', id: 'ing-rice' });
  });

  it('matches a close name when only one thing fits', () => {
    expect(one('OG Bowl, 60')).toMatchObject({ kind: 'menu', id: 'bowl-original', close: true });
    expect(one('Choco chip cookie, 30')).toMatchObject({ kind: 'menu', id: 'cookie-choco' });
    expect(one('Ala King, 30').id).toBe('bowl-alaking');
    expect(one('Chicken thigh, 30').id).toBe('ing-chicken');
    expect(one('Rice, 30')).toMatchObject({ id: 'ing-rice' });
    expect(one('Rice, 30').close).toBeUndefined();
  });

  it('asks which one when a short name fits more than one thing', () => {
    const r = one('Fries, 80');
    expect(r.kind).toBe('error');
    expect(r.problem).toBe('Which one? Fries with Dip, Overloaded Fries, HyFun crinkle-cut fries');
    expect(one('Cookies, 10').kind).toBe('new');
  });

  it('does not guess a menu item for an amount in kg', () => {
    // "Butter, 2 kg" is butter, not 2 Garlic Butter bowls.
    expect(one('Butter, 2 kg')).toMatchObject({ kind: 'new', name: 'Butter', unit: 'kg' });
    expect(one('Mango, 5 kg')).toMatchObject({ kind: 'ingredient', id: 'ing-mango' });
  });

  it('offers an unknown name as a new ingredient', () => {
    expect(one('Ketchup sachets, 200')).toMatchObject({ kind: 'new', name: 'Ketchup sachets', amount: 200, unit: 'pcs' });
    expect(one('Sugar, 3kg')).toMatchObject({ kind: 'new', unit: 'kg' });
    expect(one('Sugar, 3kg').id).toBeUndefined();
  });

  it('reads the warn-at column for ingredients', () => {
    expect(one('Rice, 20 kg, 4')).toMatchObject({ amount: 20, low: 4 });
    expect(one('Rice, 20 kg').low).toBeUndefined();
    expect(one('Rice, 20 kg, soon')).toMatchObject({ kind: 'error', problem: 'The warn-at number is not a number.' });
  });

  it('gives a plain message for a bad amount', () => {
    expect(one('Rice, -3')).toMatchObject({ kind: 'error', problem: 'The amount cannot be less than 0.' });
    expect(one('Rice, lots')).toMatchObject({ kind: 'error', problem: 'Write one number, then one unit, like 25 kg. Notes and ranges are not read.' });
    expect(one('Rice')).toMatchObject({ kind: 'error', problem: 'No amount. Write it like this: Rice, 20' });
    expect(one(', 5')).toMatchObject({ kind: 'error', problem: 'No name.' });
    expect(one('Rice, 99999999').kind).toBe('error');
  });

  it('asks for a thousands comma to be taken out', () => {
    expect(one('Slushie cups, 1,250')).toMatchObject({ kind: 'error', problem: 'Is this 1250? Write it without the comma.' });
    // A normal three-column line is left alone.
    expect(one('Slushie cups,150,100')).toMatchObject({ kind: 'ingredient', amount: 150, low: 100 });
  });

  it('says so when a menu item has a decimal', () => {
    expect(one('OG Chicken Rice Bowl, 12.5')).toMatchObject({ kind: 'error', id: 'bowl-original', problem: 'Menu items are counted in whole pieces.' });
    expect(one('Rice, 12.5').kind).toBe('ingredient');
  });

  it('changes the amount to the unit the ingredient is counted in', () => {
    expect(one('Rice, 500 g')).toMatchObject({ kind: 'ingredient', id: 'ing-rice', amount: 0.5, unit: 'kg', typed: '500 g' });
    expect(one('Rice, 1.5kg')).toMatchObject({ amount: 1.5, unit: 'kg' });
    expect(one('Rice, 1.5kg').typed).toBeUndefined();
    expect(one('Rice, 2500 MG')).toMatchObject({ amount: 0.0025, typed: '2500 mg' });
    expect(one('Cooking oil, 750 ml')).toMatchObject({ amount: 0.75, unit: 'L', typed: '750 ml' });
    expect(one('Cooking oil, 2 L')).toMatchObject({ amount: 2, unit: 'L' });
    expect(one('Eggs, 5 dozen')).toMatchObject({ amount: 60, unit: 'pcs', typed: '5 dozen' });
    const grams: Settings = { ...s, ingredients: [{ id: 'ing-b', name: 'Butter', unit: 'g', low: 0 }] };
    expect(one('Butter, 1.2 kg', grams)).toMatchObject({ kind: 'ingredient', amount: 1200, unit: 'g', typed: '1.2 kg' });
  });

  it('says so when the unit cannot be changed to the ingredient\'s unit', () => {
    expect(one('Rice, 3 packs')).toMatchObject({ kind: 'error', id: 'ing-rice', problem: 'This is counted in kg here, not in pack. Write the amount in kg.' });
    expect(one('Rice, 2 L').kind).toBe('error');
    expect(one('Eggs, 2 kg')).toMatchObject({ kind: 'error', problem: 'This is counted in pcs here, not in kg. Write the amount in pcs.' });
    // Ways of counting pieces are left alone.
    expect(one('Agave syrup, 2 pcs')).toMatchObject({ kind: 'ingredient', amount: 2 });
    expect(one('Slushie cups, 150 cups')).toMatchObject({ kind: 'ingredient', amount: 150 });
    expect(one('Rice, 5 sacks').kind).toBe('error');
  });

  it('reads every unit a sheet may use', () => {
    const unit = (text: string) => one(`Zzz, ${text}`).unit;
    expect([unit('500 g'), unit('1.5KG'), unit('20 mg'), unit('250 ML'), unit('2 l')]).toEqual(['g', 'kg', 'mg', 'ml', 'L']);
    expect([unit('3 pc'), unit('3 pieces'), unit('2 packs'), unit('2 Bottles'), unit('4 boxes'), unit('6 cans'), unit('2 trays'), unit('1 dozen')]).toEqual(['pcs', 'pcs', 'pack', 'bottle', 'box', 'can', 'tray', 'dozen']);
  });

  it('takes one word alone as an ingredient, never as a menu item', () => {
    expect(one('Butter, 2')).toMatchObject({ kind: 'new', name: 'Butter' });
    expect(one('Garlic, 300 g')).toMatchObject({ kind: 'new', unit: 'g' });
    expect(one('Garlic, 3').kind).toBe('new');
    expect(one('Soy sauce, 2 bottles')).toMatchObject({ kind: 'new', name: 'Soy sauce', unit: 'bottle' });
    expect(one('Chicken, 25 kg').id).toBe('ing-chicken');
    expect(one('Chicken rice bowl, 5').problem).toMatch(/^Which one\? /);
  });

  it('uses the later line when a thing is listed twice', () => {
    const { rows } = parseInventory('Rice, 5\nBottled Water, 10\nrice, 8 kg\nSugar, 1\nsugar, 2', s);
    expect(rows.map((r) => [r.kind, r.amount, r.problem])).toEqual([
      ['error', 5, 'Listed twice. The later line is used.'],
      ['menu', 10, undefined],
      ['ingredient', 8, undefined],
      ['error', 1, 'Listed twice. The later line is used.'],
      ['new', 2, undefined],
    ]);
  });

  it('leaves out lines with no amount filled in, and counts them', () => {
    const { rows, blank } = parseInventory('Name,Amount\nRice,\nEggs,30\nBottled Water,', s);
    expect(blank).toBe(2);
    expect(rows).toHaveLength(1);
  });

  it('does not match a menu item that is switched off', () => {
    const off: Settings = { ...s, menu: s.menu.map((m) => (m.id === 'water' ? { ...m, active: false } : m)) };
    expect(one('Bottled Water, 5', off).kind).toBe('new');
  });

  it('returns nothing for empty text', () => {
    expect(parseInventory('', s)).toEqual({ rows: [], blank: 0 });
    expect(parseInventory('\n  \n# note\n', s).rows).toEqual([]);
  });
});

describe('blankList', () => {
  it('lists every active menu item and every ingredient, and round-trips', () => {
    const csv = blankList(s);
    const lines = csv.trim().split('\r\n');
    const things = s.menu.filter((m) => m.active).length + s.ingredients.length;
    expect(lines[0]).toBe('Name,Amount');
    expect(lines).toHaveLength(things + 1);

    // Untouched, every line is "left blank".
    expect(parseInventory(csv, s)).toEqual({ rows: [], blank: things });

    // Fill a number on every line, as Excel would save it.
    const filled = lines.map((l, i) => (i === 0 ? l : l + (i + 1))).join('\r\n');
    const { rows, blank } = parseInventory(filled, s);
    expect(blank).toBe(0);
    expect(rows).toHaveLength(things);
    expect(rows.every((r) => (r.kind === 'menu' || r.kind === 'ingredient') && !r.close)).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(things);
    expect(rows[0]).toMatchObject({ id: s.menu[0].id, amount: 2 });
  });

  it('quotes a name with a comma so it still matches', () => {
    const odd: Settings = { ...s, menu: [], ingredients: [{ id: 'ing-x', name: 'Salt, "iodized"', unit: 'kg', low: 0 }] };
    const filled = blankList(odd).trim() + '3';
    expect(parseInventory(filled, odd).rows[0]).toMatchObject({ kind: 'ingredient', id: 'ing-x', amount: 3 });
  });
});

describe('planInventory', () => {
  const text = 'OG Chicken Rice Bowl, 60\nBottled Water, 48\nRice, 20 kg, 4\nSugar, 3 kg\nFries, 9';
  const sugarLine = 4;
  const rows = parseInventory(text, s).rows;
  const ids = (() => {
    let n = 0;
    return () => `ing-new${++n}`;
  })();
  const base = { settings: s, who: 'Bea', now: 5000, alsoStart: false, skipNew: [] as number[], newId: ids };

  it('puts every menu count in one stockCounts map and keeps the old ones', () => {
    const open = { ...day, stockCounts: { 'cookie-choco': { qty: 7, at: 2000, by: 'Ana' } } };
    const plan = planInventory(rows, { ...base, day: open, skipNew: [sugarLine] });
    expect(plan.stockCounts).toEqual({
      'cookie-choco': { qty: 7, at: 2000, by: 'Ana' },
      'bowl-original': { qty: 60, at: 5000, by: 'Bea' },
      water: { qty: 48, at: 5000, by: 'Bea' },
    });
    expect(plan.menu).toBeUndefined();
    expect(plan.done).toEqual({ menu: 2, ingredient: 1, added: 0 });
  });

  it('sets the ingredient count and warn-at level, and keeps the rest', () => {
    const withUses: Settings = { ...s, ingredients: s.ingredients.map((i) => (i.id === 'ing-rice' ? { ...i, uses: { 'bowl-original': 0.2 }, removed: [{ qty: 1, reason: 'Removed', at: 1, by: 'x' }] } : i)) };
    const plan = planInventory(rows, { ...base, settings: withUses, day, skipNew: [sugarLine] });
    const rice = plan.ingredients!.find((i) => i.id === 'ing-rice')!;
    expect(rice).toEqual({ id: 'ing-rice', name: 'Rice', unit: 'kg', low: 4, uses: { 'bowl-original': 0.2 }, removed: [{ qty: 1, reason: 'Removed', at: 1, by: 'x' }], count: { qty: 20, at: 5000, by: 'Bea' } });
    expect(plan.ingredients).toHaveLength(s.ingredients.length);
    expect(plan.ingredients!.find((i) => i.id === 'ing-eggs')).toEqual(s.ingredients.find((i) => i.id === 'ing-eggs'));
  });

  it('adds new ingredients unless they are unticked', () => {
    const plan = planInventory(rows, { ...base, day });
    expect(plan.ingredients).toHaveLength(s.ingredients.length + 1);
    expect(plan.ingredients!.at(-1)).toEqual({ id: 'ing-new1', name: 'Sugar', unit: 'kg', low: 0, count: { qty: 3, at: 5000, by: 'Bea' } });
    expect(plan.done.added).toBe(1);

    const skipped = planInventory(rows, { ...base, day, skipNew: [sugarLine] });
    expect(skipped.ingredients).toHaveLength(s.ingredients.length);
    expect(skipped.done.added).toBe(0);
  });

  it('stores a converted amount in the ingredient\'s own unit', () => {
    const plan = planInventory(parseInventory('Rice, 500 g\nButter, 500 g', s).rows, { ...base, day });
    expect(plan.ingredients!.find((i) => i.id === 'ing-rice')!.count!.qty).toBe(0.5);
    expect(plan.ingredients!.at(-1)).toMatchObject({ name: 'Butter', unit: 'g', count: { qty: 500 } });
  });

  it('sets the starting stock when no day is open', () => {
    const plan = planInventory(rows, { ...base, day: undefined });
    expect(plan.stockCounts).toBeUndefined();
    expect(plan.menu!.find((m) => m.id === 'bowl-original')!.startStock).toBe(60);
    expect(plan.menu!.find((m) => m.id === 'water')!.startStock).toBe(48);
    expect(plan.menu!.find((m) => m.id === 'fries-reg')).toEqual(s.menu.find((m) => m.id === 'fries-reg'));
  });

  it('sets both when the box is ticked', () => {
    const plan = planInventory(rows, { ...base, day, alsoStart: true });
    expect(plan.stockCounts!.water.qty).toBe(48);
    expect(plan.menu!.find((m) => m.id === 'water')!.startStock).toBe(48);
  });

  it('never applies a problem row', () => {
    const plan = planInventory(parseInventory('Fries, 9\nRice, -1', s).rows, { ...base, day });
    expect(plan).toMatchObject({ stockCounts: undefined, menu: undefined, ingredients: undefined, done: { menu: 0, ingredient: 0, added: 0 } });
  });

  it('undo puts back the counts, the starting stock and the ingredients', () => {
    const open = { ...day, stockCounts: { water: { qty: 7, at: 2000, by: 'Ana' } } };
    const plan = planInventory(rows, { ...base, day: open, alsoStart: true });

    // Meanwhile someone else counted cookies and eggs: undo must keep those.
    const later: Settings = {
      ...s,
      menu: plan.menu!,
      ingredients: plan.ingredients!.map((i) => (i.id === 'ing-eggs' ? { ...i, count: { qty: 30, at: 6000, by: 'Cy' } } : i)),
    };
    const dayLater = { ...open, stockCounts: { ...plan.stockCounts!, 'cookie-choco': { qty: 9, at: 6000, by: 'Cy' } } };
    const back = planUndo(plan.undo, later, dayLater);

    expect(back.stockCounts!.water).toEqual({ qty: 7, at: 2000, by: 'Ana' });
    expect(back.stockCounts!['cookie-choco']).toEqual({ qty: 9, at: 6000, by: 'Cy' });
    // No count before: back to the opening stock, counted from when the day opened.
    expect(back.stockCounts!['bowl-original']).toEqual({ qty: 60, at: 999, by: 'opening stock' });
    expect(back.menu).toEqual(s.menu);
    expect(back.ingredients!.find((i) => i.id === 'ing-rice')).toEqual(s.ingredients.find((i) => i.id === 'ing-rice'));
    expect(back.ingredients!.find((i) => i.id === 'ing-eggs')!.count).toEqual({ qty: 30, at: 6000, by: 'Cy' });
    expect(back.ingredients!.some((i) => i.name === 'Sugar')).toBe(false);
  });

  it('undo leaves a closed or different day alone', () => {
    const plan = planInventory(rows, { ...base, day });
    expect(planUndo(plan.undo, s, undefined).stockCounts).toBeUndefined();
    expect(planUndo(plan.undo, s, { ...day, id: 'other' }).stockCounts).toBeUndefined();
  });
});

describe('importPrompt and what Claude sends back', () => {
  const prompt = importPrompt(s);

  it('asks for name, amount lines read from the screenshot', () => {
    expect(prompt).toContain('Read the stock counts in the screenshot I attached and write them as plain text, one line per item, exactly `name, amount`');
    expect(prompt).toContain('# CHECK:');
    expect(prompt).toContain('ONLY the lines inside one code block');
  });

  it('leads with the ingredients and their units, then the menu items', () => {
    expect(prompt).toContain('my ingredient inventory');
    for (const m of s.menu.filter((x) => x.active)) expect(prompt).toContain(`\n- ${m.name}\n`);
    for (const i of s.ingredients) expect(prompt).toContain(`\n- ${i.name} (${i.unit})\n`);
    expect(prompt.indexOf('- Rice (kg)')).toBeLessThan(prompt.indexOf('- Bottled Water'));
    const off: Settings = { ...s, menu: s.menu.map((m) => (m.id === 'water' ? { ...m, active: false } : m)) };
    expect(importPrompt(off)).not.toContain('Bottled Water');
  });

  it('tells Claude to keep the sheet\'s units and names', () => {
    expect(prompt).toContain('keep the unit exactly as shown in the sheet');
    expect(prompt).toContain('one line for every ingredient in the sheet, even when it is not in my list');
    expect(prompt).toContain("use the sheet's own name");
  });

  it('still gives a 3-line example with an empty list', () => {
    const empty = importPrompt({ ...s, menu: [], ingredients: [] });
    expect(parseInventory(empty.slice(empty.indexOf('```')), { ...s, menu: [], ingredients: [] }).rows).toHaveLength(3);
  });

  it('ends with a 3-line example that parses with no problems', () => {
    const block = prompt.slice(prompt.lastIndexOf('```', prompt.lastIndexOf('```') - 1));
    expect(prompt.trimEnd().endsWith('```')).toBe(true);
    const { rows, blank } = parseInventory(block, s);
    expect(blank).toBe(0);
    expect(rows).toHaveLength(3);
    expect(summary(rows).error).toBe(0);
    expect(rows.every((r) => (r.kind === 'menu' || r.kind === 'ingredient') && !r.typed)).toBe(true);
  });

  it('skips the code fence lines', () => {
    const { rows } = parseInventory('Here are the counts:\n```text\nRice, 20 kg\nEggs, 60 pcs\n```\nI could not read 2 rows, sorry.\n', s);
    expect(rows.map((r) => [r.line, r.id])).toEqual([
      [3, 'ing-rice'],
      [4, 'ing-eggs'],
    ]);
  });

  it('skips a sentence that introduces the list', () => {
    expect(parseInventory('Here is your list:\nRice, 20 kg', s).rows.map((r) => r.id)).toEqual(['ing-rice']);
    // Half a code block (the copy missed the end) still reads.
    expect(parseInventory('```\nRice, 20 kg', s).rows.map((r) => r.id)).toEqual(['ing-rice']);
  });

  it('reads lines with bullets', () => {
    expect(one('- Rice, 20 kg')).toMatchObject({ kind: 'ingredient', id: 'ing-rice', amount: 20 });
    expect(one('* Rice, 20 kg').id).toBe('ing-rice');
    expect(one('• Rice, 20 kg').id).toBe('ing-rice');
    expect(one('1. Rice, 20 kg')).toMatchObject({ id: 'ing-rice', amount: 20 });
    expect(one('12) Bottled Water, 48')).toMatchObject({ id: 'water', amount: 48 });
  });

  it('reads lines with bold or code marks', () => {
    expect(one('**Rice**, 20 kg')).toMatchObject({ id: 'ing-rice', name: 'Rice', amount: 20 });
    expect(one('- **OG Chicken Rice Bowl, 60**')).toMatchObject({ id: 'bowl-original', amount: 60 });
    expect(one('`Rice, 20 kg`').id).toBe('ing-rice');
  });

  it('shows a CHECK line as a problem and skips other notes', () => {
    const { rows } = parseInventory('# counted Monday\n# CHECK: Rice, 2? kg\n#check: Eggs\nBottled Water, 48', s);
    expect(rows.map((r) => [r.kind, r.name, r.problem])).toEqual([
      ['error', 'Rice, 2? kg', 'Check this number in your sheet'],
      ['error', 'Eggs', 'Check this number in your sheet'],
      ['menu', 'Bottled Water', undefined],
    ]);
  });
});

describe('never a silently wrong count (final check)', () => {
  const kind = (line: string) => parseInventory(line, s).rows[0]?.kind;
  it('flags packs, notes, ranges and multiplications instead of guessing', () => {
    for (const line of ['Eggs, 1 tray (30 pcs)', 'Eggs, 2 trays', 'Slushie cups, 2 packs', 'Rice bowl containers, 1 box', 'Eggs, 30-40', 'Agave syrup, 2 x 500ml', 'Slushie cups, 16 oz, 200', 'Bottled Water, 2 cases', 'Cookie Monster Velvet, 1 dozen', 'OG Chicken Rice Bowl, 60 kg']) {
      expect([line, kind(line)]).toEqual([line, 'error']);
    }
  });
  it('flags a decimal comma instead of reading a warn-at level', () => {
    for (const line of ['Cabbage, 1,5 kg', 'Rice, 0,5 kg']) expect([line, kind(line)]).toEqual([line, 'error']);
    expect(parseInventory('Rice, 20 kg, 500 g', s).rows[0]).toMatchObject({ kind: 'ingredient', amount: 20, low: 0.5 });
    expect(parseInventory('Rice, 20 kg, 5', s).rows[0]).toMatchObject({ kind: 'ingredient', amount: 20, low: 5 });
  });
  it('flags totals and dates', () => {
    for (const line of ['TOTAL, 45', 'Date, 2026-11-22', 'Grand total, 120 kg']) expect([line, kind(line)]).toEqual([line, 'error']);
  });
});
