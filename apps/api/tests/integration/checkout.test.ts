import { beforeEach, describe, expect, it } from 'vitest';
import {
  API,
  fillCart,
  idemKey,
  loginAs,
  makeAddress,
  makeApp,
  makeProduct,
  makeUser,
  placeOrder,
  prisma,
  send,
  webhook,
  type Session,
} from '../helpers';

const app = makeApp();
beforeEach(resetAll);
import { resetData } from '../helpers';
async function resetAll() {
  await resetData();
}

async function customer(verified = true) {
  const u = await makeUser({ verified });
  const s = await loginAs(app, u);
  return { s, addr: await makeAddress(u.id) };
}
const stock = async (id: string) =>
  (await prisma.inventory.findUniqueOrThrow({ where: { productId: id } })).quantity;

describe('cart validation', () => {
  it('rejects invalid quantities and out-of-stock purchases', async () => {
    const { s } = await customer();
    const p = await makeProduct({ stock: 3 });
    for (const q of [0, -1, 1.5, 11, '2', null]) {
      expect(
        (await send(s, 'post', '/cart/items', { productId: p.id, quantity: q as number })).status,
      ).toBe(422);
    }
    expect((await fillCart(s, p.id, 4)).status).toBe(409); // more than stock
    expect((await fillCart(s, p.id, 3)).status).toBe(201);
    expect((await fillCart(s, p.id, 1)).status).toBe(409); // cumulative
    const none = await makeProduct({ stock: 0 });
    const res = await fillCart(s, none.id, 1);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('computes the subtotal on the server from current prices', async () => {
    const { s } = await customer();
    const p = await makeProduct({ price: 12_345 });
    await fillCart(s, p.id, 2);
    await prisma.product.update({
      where: { id: p.id },
      data: { priceMinor: 20_000, mrpMinor: 20_000 },
    });
    const cart = (await s.agent.get(`${API}/cart`)).body;
    expect(cart.subtotalMinor).toBe(40_000);
    expect(cart.items[0].unitPriceMinor).toBe(20_000);
  });
});

describe('order creation', () => {
  it('ignores client-supplied prices and totals (rejects unknown fields) and uses DB prices', async () => {
    const { s, addr } = await customer();
    const p = await makeProduct({ price: 100_000 });
    await fillCart(s, p.id, 1);
    const tampered = await placeOrder(s, addr.id, {
      totalMinor: 1,
      priceMinor: 1,
      items: [{ productId: p.id, unitPriceMinor: 1 }],
    });
    expect(tampered.status).toBe(422);
    expect(await prisma.order.count()).toBe(0);
    expect(await stock(p.id)).toBe(10);

    const ok = await placeOrder(s, addr.id);
    expect(ok.status).toBe(201);
    expect(ok.body.order.subtotalMinor).toBe(100_000);
    expect(ok.body.order.taxMinor).toBe(18_000);
    expect(ok.body.order.totalMinor).toBe(118_000); // free standard shipping above Rs 500
    expect(ok.body.order.payment.isMock).toBe(true);
    expect(await stock(p.id)).toBe(9);
    expect((await s.agent.get(`${API}/cart`)).body.items).toHaveLength(0);
  });

  it('snapshots name/sku/price so later catalogue edits do not change the order', async () => {
    const { s, addr } = await customer();
    const p = await makeProduct({ price: 10_000, name: 'Original Name' });
    await fillCart(s, p.id, 1);
    const order = (await placeOrder(s, addr.id)).body.order;
    await prisma.product.update({
      where: { id: p.id },
      data: { name: 'Renamed', priceMinor: 99_999, mrpMinor: 99_999 },
    });
    const fetched = (await s.agent.get(`${API}/orders/${order.id}`)).body.order;
    expect(fetched.items[0].name).toBe('Original Name');
    expect(fetched.items[0].unitPriceMinor).toBe(10_000);
  });

  it('requires a verified email, an idempotency key and a non-empty cart', async () => {
    const { s, addr } = await customer(false);
    const p = await makeProduct();
    await fillCart(s, p.id, 1);
    const unverified = await placeOrder(s, addr.id);
    expect(unverified.status).toBe(403);
    expect(unverified.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const v = await customer();
    expect(
      (await send(v.s, 'post', '/orders', { addressId: v.addr.id, shippingMethod: 'STANDARD' }))
        .status,
    ).toBe(400); // no key
    expect((await placeOrder(v.s, v.addr.id)).status).toBe(422); // empty cart
  });

  it('is idempotent: replaying the same key returns the same order and reserves stock once', async () => {
    const { s, addr } = await customer();
    const p = await makeProduct();
    await fillCart(s, p.id, 2);
    const key = idemKey();
    const first = await placeOrder(s, addr.id, {}, key);
    const second = await placeOrder(s, addr.id, {}, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.order.id).toBe(first.body.order.id);
    expect(await prisma.order.count()).toBe(1);
    expect(await stock(p.id)).toBe(8);
  });

  it('applies valid coupons and rejects invalid ones without side effects', async () => {
    const { s, addr } = await customer();
    const p = await makeProduct({ price: 100_000 });
    await prisma.coupon.create({
      data: { code: 'TEN', type: 'PERCENT', value: 10, minOrderMinor: 50_000, maxUses: 1 },
    });
    await fillCart(s, p.id, 1);
    const q = await send(s, 'post', '/checkout/quote', {
      shippingMethod: 'STANDARD',
      couponCode: 'ten',
    });
    expect(q.body.discountMinor).toBe(10_000);
    expect(
      (await send(s, 'post', '/checkout/quote', { shippingMethod: 'STANDARD', couponCode: 'NOPE' }))
        .status,
    ).toBe(422);
    expect((await placeOrder(s, addr.id, { couponCode: 'NOPE' })).status).toBe(422);
    expect(await stock(p.id)).toBe(10); // failed checkout rolled back entirely
    const ok = await placeOrder(s, addr.id, { couponCode: 'TEN' });
    expect(ok.body.order.discountMinor).toBe(10_000);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'TEN' } })).usedCount).toBe(1);
  });
});

describe('overselling prevention (concurrency)', () => {
  it('lets exactly one of many simultaneous checkouts buy the last unit', async () => {
    const p = await makeProduct({ stock: 1 });
    const buyers: { s: Session; addr: { id: string } }[] = [];
    for (let i = 0; i < 6; i++) {
      const u = await makeUser();
      const s = await loginAs(app, u);
      await prisma.inventory.update({ where: { productId: p.id }, data: { quantity: 6 } }); // allow everyone to add to cart
      await fillCart(s, p.id, 1);
      buyers.push({ s, addr: await makeAddress(u.id) });
    }
    await prisma.inventory.update({ where: { productId: p.id }, data: { quantity: 1 } });
    const results = await Promise.all(buyers.map((b) => placeOrder(b.s, b.addr.id)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((x) => x === 201)).toHaveLength(1);
    expect(statuses.filter((x) => x === 409)).toHaveLength(5);
    expect(await stock(p.id)).toBe(0);
    expect(await prisma.order.count()).toBe(1);
  });

  it('never lets total reserved quantity exceed stock across racing orders', async () => {
    const p = await makeProduct({ stock: 10 });
    const buyers: { s: Session; addr: { id: string } }[] = [];
    for (let i = 0; i < 5; i++) {
      const u = await makeUser();
      const s = await loginAs(app, u);
      await fillCart(s, p.id, 3); // 5 buyers x 3 = 15 wanted, only 10 available
      buyers.push({ s, addr: await makeAddress(u.id) });
    }
    const results = await Promise.all(buyers.map((b) => placeOrder(b.s, b.addr.id)));
    const won = results.filter((r) => r.status === 201).length;
    expect(won).toBe(3); // 3 x 3 = 9 <= 10; a 4th would need 12
    expect(await stock(p.id)).toBe(1);
    expect(await stock(p.id)).toBeGreaterThanOrEqual(0);
  });
});

describe('payments and webhooks', () => {
  async function pendingOrder(qty = 2) {
    const { s, addr } = await customer();
    const p = await makeProduct({ stock: 10 });
    await fillCart(s, p.id, qty);
    const order = (await placeOrder(s, addr.id)).body.order;
    return { s, p, order };
  }
  const evt = (
    order: { payment: { providerOrderId: string } },
    type = 'payment.succeeded',
    eventId = `evt_${Math.random().toString(36).slice(2, 12)}`,
    timestamp = Math.floor(Date.now() / 1000),
  ) => ({
    eventId,
    type,
    providerOrderId: order.payment.providerOrderId,
    timestamp,
  });

  it('marks an order paid only via a correctly signed webhook (never from a client redirect)', async () => {
    const { order } = await pendingOrder();
    expect((await webhook(app, evt(order), { signature: null })).status).toBe(401);
    expect((await webhook(app, evt(order), { signature: 'deadbeef'.repeat(8) })).status).toBe(401);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PENDING_PAYMENT',
    );
    const ok = await webhook(app, evt(order));
    expect(ok.status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID');
  });

  it('is idempotent: duplicate and re-sent webhooks do not duplicate fulfilment', async () => {
    const { order } = await pendingOrder();
    const e = evt(order);
    const results = await Promise.all([webhook(app, e), webhook(app, e), webhook(app, e)]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    const outcomes = results.map((r) => r.body.result).sort();
    expect(outcomes.filter((o) => o === 'paid')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'duplicate')).toHaveLength(2);
    // A *different* event id for the same payment must also be a no-op.
    expect((await webhook(app, evt(order))).body.result).toBe('noop');
    expect(
      await prisma.orderStatusHistory.count({ where: { orderId: order.id, status: 'PAID' } }),
    ).toBe(1);
    expect(await prisma.webhookEvent.count()).toBe(2);
  });

  it('rejects stale (replayed) and malformed webhooks', async () => {
    const { order } = await pendingOrder();
    expect(
      (
        await webhook(
          app,
          evt(order, 'payment.succeeded', 'evt_old_00000001', Math.floor(Date.now() / 1000) - 3600),
        )
      ).status,
    ).toBe(400);
    expect((await webhook(app, { nonsense: true })).status).toBe(400);
    expect((await webhook(app, { ...evt(order), type: 'payment.refunded' })).status).toBe(400);
  });

  it('releases reserved stock when payment fails, and a late success cannot resurrect the order', async () => {
    const { p, order } = await pendingOrder(3);
    expect(await stock(p.id)).toBe(7);
    const failed = await webhook(app, evt(order, 'payment.failed'));
    expect(failed.body.result).toBe('failed');
    expect(await stock(p.id)).toBe(10);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'CANCELLED',
    );
    expect((await webhook(app, evt(order, 'payment.succeeded'))).body.result).toBe('noop');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'CANCELLED',
    );
    expect(await stock(p.id)).toBe(10);
  });

  it('mock pay endpoint goes through the same signed-webhook path; double clicks are harmless', async () => {
    const { s, order } = await pendingOrder();
    const r1 = await send(s, 'post', `/orders/${order.id}/pay/mock`, { outcome: 'success' });
    expect(r1.status).toBe(200);
    expect(r1.body.order.status).toBe('PAID');
    expect(r1.body.order.payment.isMock).toBe(true);
    expect(
      (await send(s, 'post', `/orders/${order.id}/pay/mock`, { outcome: 'success' })).status,
    ).toBe(409);
    expect(
      await prisma.orderStatusHistory.count({ where: { orderId: order.id, status: 'PAID' } }),
    ).toBe(1);
  });

  it('lets a customer cancel an unpaid order (stock restored) but not a paid one', async () => {
    const { s, p, order } = await pendingOrder(2);
    expect((await send(s, 'post', `/orders/${order.id}/cancel`)).body.order.status).toBe(
      'CANCELLED',
    );
    expect(await stock(p.id)).toBe(10);
    expect((await send(s, 'post', `/orders/${order.id}/cancel`)).status).toBe(409); // double cancel does not restock twice
    expect(await stock(p.id)).toBe(10);

    const second = await pendingOrder();
    await send(second.s, 'post', `/orders/${second.order.id}/pay/mock`, { outcome: 'success' });
    expect((await send(second.s, 'post', `/orders/${second.order.id}/cancel`)).status).toBe(409);
  });
});
