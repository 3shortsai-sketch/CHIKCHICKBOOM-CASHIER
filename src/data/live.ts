import { useEffect, useState } from 'react';
import type { PaymentMethod } from '../domain/types';

/**
 * The order being taken right now, sent from the cashier window to the
 * customer monitor on the same laptop. Not saved anywhere and not synced:
 * it only exists while the cashier is ringing it up.
 */
export type LiveCart =
  | { stage: 'idle' }
  | {
      stage: 'ordering' | 'paying';
      lines: { qty: number; name: string; details: string; total: number; free: boolean }[];
      subtotal: number;
      voucher?: number;
      due: number;
      spins: number;
      method?: PaymentMethod;
      name?: string;
    }
  | { stage: 'paid'; number: string; spins: number; change: number; paid: number; method: PaymentMethod; name?: string };

type Msg = { type: 'cart'; cart: LiveCart } | { type: 'hello' };

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ccb-live') : null;
let current: LiveCart = { stage: 'idle' };

/** Cashier side: publish the cart whenever it changes. */
export function publishCart(cart: LiveCart) {
  current = cart;
  channel?.postMessage({ type: 'cart', cart } satisfies Msg);
}

// A monitor that opens late asks for the current cart.
channel?.addEventListener('message', (e: MessageEvent<Msg>) => {
  if (e.data.type === 'hello' && current.stage !== 'idle') channel.postMessage({ type: 'cart', cart: current } satisfies Msg);
});

/** Monitor side: the cart the cashier is ringing up now. */
export function useLiveCart(): LiveCart {
  const [cart, setCart] = useState<LiveCart>({ stage: 'idle' });
  useEffect(() => {
    if (!channel) return;
    const on = (e: MessageEvent<Msg>) => {
      if (e.data.type === 'cart') setCart(e.data.cart);
    };
    channel.addEventListener('message', on);
    channel.postMessage({ type: 'hello' } satisfies Msg);
    return () => channel.removeEventListener('message', on);
  }, []);
  return cart;
}
