import { describe, expect, it } from 'vitest';
import { computeTotals } from '../../src/modules/orders/pricing';

describe('computeTotals (integer paise)', () => {
  it('adds 18% tax and charges standard shipping under the free threshold', () => {
    const t = computeTotals([{ unitPriceMinor: 10_000, quantity: 2 }], 'STANDARD');
    expect(t).toEqual({
      subtotalMinor: 20_000,
      discountMinor: 0,
      taxMinor: 3_600,
      shippingMinor: 4_000,
      totalMinor: 27_600,
    });
  });
  it('gives free standard shipping at or above Rs 500 (after discount)', () => {
    expect(computeTotals([{ unitPriceMinor: 50_000, quantity: 1 }], 'STANDARD').shippingMinor).toBe(
      0,
    );
    expect(computeTotals([{ unitPriceMinor: 49_999, quantity: 1 }], 'STANDARD').shippingMinor).toBe(
      4_000,
    );
  });
  it('express shipping is always charged', () => {
    expect(computeTotals([{ unitPriceMinor: 90_000, quantity: 1 }], 'EXPRESS').shippingMinor).toBe(
      12_000,
    );
  });
  it('applies percent and fixed coupons and never goes negative', () => {
    expect(
      computeTotals([{ unitPriceMinor: 100_000, quantity: 1 }], 'STANDARD', {
        type: 'PERCENT',
        value: 10,
      }).discountMinor,
    ).toBe(10_000);
    const t = computeTotals([{ unitPriceMinor: 5_000, quantity: 1 }], 'STANDARD', {
      type: 'FIXED',
      value: 99_999,
    });
    expect(t.discountMinor).toBe(5_000);
    expect(t.totalMinor).toBeGreaterThanOrEqual(0);
  });
  it('never produces fractional paise', () => {
    const t = computeTotals([{ unitPriceMinor: 3_333, quantity: 3 }], 'STANDARD', {
      type: 'PERCENT',
      value: 7,
    });
    for (const v of Object.values(t)) expect(Number.isInteger(v)).toBe(true);
  });
});
