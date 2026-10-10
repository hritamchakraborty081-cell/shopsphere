/**
 * Pure, integer-only (paise) pricing. The server is the ONLY place totals are computed.
 */
export const TAX_RATE_BP = 1800; // 18% GST, in basis points
export const FREE_SHIPPING_THRESHOLD = 50_000; // Rs 500 after discount
export const SHIPPING_FEES = { STANDARD: 4_000, EXPRESS: 12_000 } as const;

export interface CouponRule {
  type: 'PERCENT' | 'FIXED';
  value: number; // percent (1-100) or paise
}

export interface Totals {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  shippingMinor: number;
  totalMinor: number;
}

export function computeTotals(
  lines: { unitPriceMinor: number; quantity: number }[],
  method: keyof typeof SHIPPING_FEES,
  coupon?: CouponRule | null,
): Totals {
  const subtotalMinor = lines.reduce((n, l) => n + l.unitPriceMinor * l.quantity, 0);
  let discountMinor = 0;
  if (coupon) {
    discountMinor =
      coupon.type === 'PERCENT' ? Math.floor((subtotalMinor * coupon.value) / 100) : coupon.value;
    discountMinor = Math.min(discountMinor, subtotalMinor); // never negative totals
  }
  const taxable = subtotalMinor - discountMinor;
  const taxMinor = Math.round((taxable * TAX_RATE_BP) / 10_000);
  const shippingMinor =
    method === 'STANDARD' && taxable >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEES[method];
  return {
    subtotalMinor,
    discountMinor,
    taxMinor,
    shippingMinor,
    totalMinor: taxable + taxMinor + shippingMinor,
  };
}
