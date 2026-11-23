import type { Choices, OrderLine } from './types';

/** The choices of one bowl, fries or drink in the cashier's words, e.g. ["Cucumbers", "+ 1 extra rice"]. */
export function choiceBits(c: Choices | undefined): string[] {
  if (!c) return [];
  const bits: string[] = [];
  if (c.side) bits.push(c.side);
  if (c.extraSides?.length) bits.push(`+ extra ${c.extraSides.join(', ')}`);
  if (c.extraSauce) bits.push(`+ ${c.extraSauce} extra sauce`);
  if (c.extraRice) bits.push(`+ ${c.extraRice} extra rice`);
  if (c.dip) bits.push(`dip: ${c.dip}`);
  if (c.topping === 'fries') bits.push('fries on top');
  return bits;
}

/** Everything chosen on a line (for a combo: on each of its parts). */
export function lineBits(line: OrderLine): string[] {
  return [...choiceBits(line.choices), ...(line.combo?.parts.flatMap((p) => choiceBits(p)) ?? [])];
}
