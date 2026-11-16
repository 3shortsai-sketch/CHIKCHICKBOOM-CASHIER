import { cardState } from './loyalty';
import type { Card, DataMode, Order, Settings } from './types';

/** Practice and real cards are kept apart, like orders. */
export function cardDocId(mode: DataMode, number: string): string {
  return `${mode}_${number}`;
}

/** A name as typed at the counter: single spaces, at most 30 characters. */
export function cleanCardName(name: string | undefined): string {
  return (name ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
}

export type CardRow = {
  number: string;
  name: string;
  /** False when the card has been used on orders but nobody typed a name yet. */
  registered: boolean;
  stamps: number;
  size: number;
  visits: number;
  cardsCompleted: number;
  rewardsReady: string[];
  lastVisit?: number;
  lastOrder?: string;
};

/**
 * Every card that has a name or has been used on an order, newest activity
 * first. Stamps and rewards come from the orders.
 */
export function cardRows(cards: Card[], orders: Order[], s: Settings): CardRow[] {
  const byNumber = new Map(cards.map((c) => [c.number, c]));
  const numbers = new Set<string>([...byNumber.keys(), ...orders.filter((o) => o.cardId && !o.voided).map((o) => o.cardId!)]);
  const rows: CardRow[] = [];
  for (const number of numbers) {
    const st = cardState(number, orders, s);
    const mine = orders.filter((o) => o.cardId === number && !o.voided).sort((a, b) => b.createdAt - a.createdAt);
    const card = byNumber.get(number);
    rows.push({
      number,
      name: card?.name ?? '',
      registered: !!card,
      stamps: st.stamps,
      size: s.loyalty.cardSize,
      visits: st.orders,
      cardsCompleted: st.cardsCompleted,
      rewardsReady: s.loyalty.rewards.filter((r) => st.stamps >= r.at && !st.used.includes(r.at)).map((r) => r.label),
      lastVisit: mine[0]?.createdAt,
      lastOrder: mine[0]?.number,
    });
  }
  return rows.sort((a, b) => (b.lastVisit ?? 0) - (a.lastVisit ?? 0) || a.number.localeCompare(b.number));
}

/** Search by card number ("37", "ccb-037") or any part of the name. */
export function searchCards(rows: CardRow[], query: string): CardRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  const digits = q.replace(/\D/g, '');
  return rows.filter((r) => r.name.toLowerCase().includes(q) || r.number.toLowerCase().includes(q) || (digits !== '' && Number(r.number.replace(/\D/g, '')) === Number(digits)));
}
