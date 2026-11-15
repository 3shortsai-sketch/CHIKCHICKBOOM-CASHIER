import type { CartItem, Order } from '../types';

export function formatMoney(cents: number, currencySymbol = '$'): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toFixed(2);
  return `${negative ? '-' : ''}${currencySymbol}${dollars}`;
}

export function computeCartTotals(
  items: CartItem[],
  discountCents: number,
  taxRateBps: number
) {
  const subtotalCents = items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0
  );
  const clampedDiscount = Math.min(Math.max(0, discountCents), subtotalCents);
  const taxableCents = Math.max(0, subtotalCents - clampedDiscount);
  const taxCents = Math.round((taxableCents * taxRateBps) / 10000);
  const totalCents = taxableCents + taxCents;
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    subtotalCents,
    discountCents: clampedDiscount,
    taxCents,
    totalCents,
    itemCount,
  };
}

export function formatElapsed(fromTimestamp: number, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((nowMs - fromTimestamp) / 1000));
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function exportOrdersCsv(orders: Order[], currencySymbol = '$') {
  const headers = [
    'OrderNumber',
    'CreatedAt',
    'Customer',
    'Type',
    'Status',
    'Payment',
    'Items',
    'Subtotal',
    'Discount',
    'Tax',
    'Total',
  ];

  const rows = orders.map((o) => {
    const itemSummary = o.items
      .map((i) => `${i.quantity}x ${i.name}${i.modifiers.length ? ` (${i.modifiers.join(', ')})` : ''}`)
      .join('; ');
    return [
      `#${o.orderNumber}`,
      new Date(o.createdAt).toISOString(),
      o.customerName || 'Walk-in',
      o.orderType,
      o.status,
      o.paymentMethod,
      `"${itemSummary.replace(/"/g, '""')}"`,
      formatMoney(o.subtotalCents, currencySymbol),
      formatMoney(o.discountCents, currencySymbol),
      formatMoney(o.taxCents, currencySymbol),
      formatMoney(o.totalCents, currencySymbol),
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `countersync-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
