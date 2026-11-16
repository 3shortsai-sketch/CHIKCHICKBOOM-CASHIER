import type { AllergenTags, MenuItem } from './types';

export function itemTags(m: MenuItem): AllergenTags {
  return { contains: m.allergens ?? [], may: m.mayContain ?? [] };
}

/** "Contains: Egg, Wheat · May contain: Milk, Soy", or null when nothing is recorded. */
export function allergenText(t: AllergenTags | undefined, short = false): string | null {
  const parts: string[] = [];
  if (t?.contains?.length) parts.push(`${short ? '' : 'Contains: '}${t.contains.join(', ')}`);
  if (t?.may?.length) parts.push(`${short ? 'may: ' : 'May contain: '}${t.may.join(', ')}`);
  return parts.length ? parts.join(short ? ' · ' : ' · ') : null;
}

/** Lower-case list for side/dip hints, e.g. "soy, wheat, sesame". */
export function allergenHint(t: AllergenTags | undefined): string | undefined {
  const all = [...(t?.contains ?? []), ...(t?.may ?? []).map((a) => `may: ${a}`)];
  return all.length ? all.map((a) => a.toLowerCase()).join(', ') : undefined;
}
