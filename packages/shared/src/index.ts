/**
 * Constants and pure helpers shared by the API and the web app.
 * IMPORTANT: the web app uses these for DISPLAY only. The API is the single source of truth
 * for prices, totals, stock and permissions.
 */

export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const SHIPPING_METHODS = ['STANDARD', 'EXPRESS'] as const;
export type ShippingMethod = (typeof SHIPPING_METHODS)[number];

export const PRODUCT_SORTS = ['relevance', 'price_asc', 'price_desc', 'rating', 'newest'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Format integer paise as an INR string, e.g. 129900 -> "₹1,299.00". */
export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(rupees);
}

/** Allowed order status transitions (enforced on the server; reused by the admin UI). */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['PROCESSING', 'CANCELLED', 'REFUNDED'],
  PROCESSING: ['SHIPPED', 'CANCELLED', 'REFUNDED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};
