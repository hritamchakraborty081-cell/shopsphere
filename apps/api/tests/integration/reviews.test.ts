import { beforeEach, describe, expect, it } from 'vitest';
import {
  API,
  loginAs,
  makeApp,
  makeProduct,
  makeUser,
  prisma,
  request,
  resetData,
  send,
} from '../helpers';

const app = makeApp();
beforeEach(resetData);

async function deliveredOrderFor(userId: string, productId: string) {
  const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  await prisma.order.create({
    data: {
      userId,
      idempotencyKey: `seed-${Math.random().toString(36).slice(2)}-0000`,
      status: 'DELIVERED',
      shippingMethod: 'STANDARD',
      subtotalMinor: p.priceMinor,
      taxMinor: 0,
      shippingMinor: 0,
      totalMinor: p.priceMinor,
      shipName: 'T',
      shipPhone: '9876543210',
      shipLine1: 'x',
      shipCity: 'c',
      shipState: 's',
      shipPostalCode: '400001',
      shipCountry: 'IN',
      items: {
        create: [
          {
            productId,
            sku: p.sku,
            name: p.name,
            unitPriceMinor: p.priceMinor,
            quantity: 1,
            lineTotalMinor: p.priceMinor,
          },
        ],
      },
    },
  });
}
const body = { rating: 5, title: 'Great product', body: 'Works exactly as described.' };

describe('reviews', () => {
  it('requires authentication', async () => {
    const p = await makeProduct();
    const res = await request(app)
      .post(`${API}/products/${p.id}/reviews`)
      .set('Origin', 'http://localhost:5173')
      .send(body);
    expect(res.status).toBe(401);
  });

  it('blocks customers who have not received the product, allows those who have, and only once', async () => {
    const p = await makeProduct();
    const buyer = await makeUser();
    const stranger = await loginAs(app, await makeUser());
    const b = await loginAs(app, buyer);
    await deliveredOrderFor(buyer.id, p.id);

    const denied = await send(stranger, 'post', `/products/${p.id}/reviews`, body);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('REVIEW_NOT_ELIGIBLE');
    expect(
      (await stranger.agent.get(`${API}/products/${p.id}/review-eligibility`)).body.eligible,
    ).toBe(false);

    expect((await b.agent.get(`${API}/products/${p.id}/review-eligibility`)).body.eligible).toBe(
      true,
    );
    expect((await send(b, 'post', `/products/${p.id}/reviews`, body)).status).toBe(201);
    expect((await send(b, 'post', `/products/${p.id}/reviews`, body)).status).toBe(409);

    const detail = (await request(app).get(`${API}/products/${p.slug}`)).body.product;
    expect(detail.ratingCount).toBe(1);
    expect(detail.ratingAvg).toBe(5);
    const list = (await request(app).get(`${API}/products/${p.id}/reviews`)).body;
    expect(list.items[0].author).toBe('Test U.'); // surname abbreviated (data minimisation)
  });

  it('does not accept a review from a customer whose order is only paid or pending', async () => {
    const p = await makeProduct();
    const u = await makeUser();
    await prisma.order.create({
      data: {
        userId: u.id,
        idempotencyKey: 'pending-order-key-0001',
        status: 'PAID',
        shippingMethod: 'STANDARD',
        subtotalMinor: 1,
        taxMinor: 0,
        shippingMinor: 0,
        totalMinor: 1,
        shipName: 'T',
        shipPhone: '9876543210',
        shipLine1: 'x',
        shipCity: 'c',
        shipState: 's',
        shipPostalCode: '400001',
        shipCountry: 'IN',
        items: {
          create: [
            {
              productId: p.id,
              sku: p.sku,
              name: p.name,
              unitPriceMinor: 1,
              quantity: 1,
              lineTotalMinor: 1,
            },
          ],
        },
      },
    });
    const s = await loginAs(app, u);
    expect((await send(s, 'post', `/products/${p.id}/reviews`, body)).status).toBe(403);
  });

  it('validates rating range and length, and rejects unknown fields', async () => {
    const p = await makeProduct();
    const u = await makeUser();
    await deliveredOrderFor(u.id, p.id);
    const s = await loginAs(app, u);
    for (const bad of [
      { ...body, rating: 0 },
      { ...body, rating: 6 },
      { ...body, rating: 4.5 },
      { ...body, title: '' },
      { ...body, userId: 'x' },
    ]) {
      expect((await send(s, 'post', `/products/${p.id}/reviews`, bad)).status).toBe(422);
    }
  });

  it('returns stored markup as inert JSON text (React escapes it on render)', async () => {
    const p = await makeProduct();
    const u = await makeUser();
    await deliveredOrderFor(u.id, p.id);
    const s = await loginAs(app, u);
    await send(s, 'post', `/products/${p.id}/reviews`, {
      rating: 4,
      title: 'xss <script>alert(1)</script>',
      body: '<img src=x onerror=alert(1)>',
    });
    const res = await request(app).get(`${API}/products/${p.id}/reviews`);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
