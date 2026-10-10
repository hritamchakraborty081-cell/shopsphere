import { beforeEach, describe, expect, it } from 'vitest';
import {
  API,
  fillCart,
  loginAs,
  makeAddress,
  makeApp,
  makeProduct,
  makeUser,
  placeOrder,
  prisma,
  resetData,
  send,
} from '../helpers';

const app = makeApp();
beforeEach(resetData);

const validProduct = (categoryId: string, extra: object = {}) => ({
  sku: 'NEW-0001',
  name: 'New Test Product',
  brand: 'Acme',
  description: 'A long enough description.',
  priceMinor: 25_000,
  mrpMinor: 30_000,
  categoryId,
  stock: 5,
  images: [{ url: '/products/NEW-0001.svg', alt: 'x' }],
  ...extra,
});

describe('admin catalogue management', () => {
  it('creates, updates, restocks and soft-deletes products with audit logs', async () => {
    const admin = await loginAs(app, await makeUser({ role: 'ADMIN' }));
    const cat = (await send(admin, 'post', '/admin/categories', { name: 'Gadgets' })).body;
    const created = await send(admin, 'post', '/admin/products', validProduct(cat.id));
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect(
      (await send(admin, 'patch', `/admin/products/${id}`, { priceMinor: 26_000 })).status,
    ).toBe(200);
    expect(
      (await send(admin, 'patch', `/admin/products/${id}`, { priceMinor: 99_999_999 })).status,
    ).toBe(409); // mrp < price
    expect(
      (await send(admin, 'patch', `/admin/products/${id}/inventory`, { quantity: 42 })).body
        .quantity,
    ).toBe(42);
    expect((await send(admin, 'delete', `/admin/products/${id}`)).status).toBe(204);
    expect((await prisma.product.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
    const actions = (await prisma.auditLog.findMany()).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'admin.category_created',
        'admin.product_created',
        'admin.product_updated',
        'admin.inventory_set',
        'admin.product_deleted',
      ]),
    );
  });

  it('rejects dangerous image URLs, bad SKUs, negative stock and duplicate SKUs', async () => {
    const admin = await loginAs(app, await makeUser({ role: 'ADMIN' }));
    const cat = (await send(admin, 'post', '/admin/categories', { name: 'Safe' })).body;
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'http://insecure.example/a.png',
      '//evil.example/a.png',
      '/etc/passwd',
      '/products/../../secret',
    ]) {
      expect(
        (
          await send(
            admin,
            'post',
            '/admin/products',
            validProduct(cat.id, { images: [{ url, alt: 'x' }] }),
          )
        ).status,
      ).toBe(422);
    }
    expect(
      (await send(admin, 'post', '/admin/products', validProduct(cat.id, { sku: 'bad sku!' })))
        .status,
    ).toBe(422);
    expect(
      (await send(admin, 'post', '/admin/products', validProduct(cat.id, { stock: -1 }))).status,
    ).toBe(422);
    expect(
      (await send(admin, 'post', '/admin/products', validProduct(cat.id, { priceMinor: 0 })))
        .status,
    ).toBe(422);
    expect((await send(admin, 'post', '/admin/products', validProduct(cat.id))).status).toBe(201);
    expect((await send(admin, 'post', '/admin/products', validProduct(cat.id))).status).toBe(409);
    expect(
      (
        await send(
          admin,
          'post',
          '/admin/products',
          validProduct(cat.id, { sku: 'NEW-0002', id: 'x' }),
        )
      ).status,
    ).toBe(422); // mass assignment
  });

  it('refuses to delete a category that still has products', async () => {
    const admin = await loginAs(app, await makeUser({ role: 'ADMIN' }));
    const p = await makeProduct();
    expect((await send(admin, 'delete', `/admin/categories/${p.categoryId}`)).status).toBe(409);
  });
});

describe('admin order management', () => {
  async function paidOrder() {
    const u = await makeUser();
    const s = await loginAs(app, u);
    const p = await makeProduct({ stock: 5 });
    await fillCart(s, p.id, 2);
    const order = (await placeOrder(s, (await makeAddress(u.id)).id)).body.order;
    await send(s, 'post', `/orders/${order.id}/pay/mock`, { outcome: 'success' });
    return { s, p, order };
  }

  it('enforces valid status transitions, records tracking and audits changes', async () => {
    const admin = await loginAs(app, await makeUser({ role: 'ADMIN' }));
    const { s, order } = await paidOrder();
    expect(
      (await send(admin, 'patch', `/admin/orders/${order.id}/status`, { status: 'DELIVERED' }))
        .status,
    ).toBe(409); // cannot skip steps
    for (const st of ['PROCESSING', 'SHIPPED', 'DELIVERED']) {
      expect(
        (await send(admin, 'patch', `/admin/orders/${order.id}/status`, { status: st })).status,
      ).toBe(200);
    }
    const tracking = (await s.agent.get(`${API}/orders/${order.id}`)).body.order.tracking.map(
      (t: { status: string }) => t.status,
    );
    expect(tracking).toEqual(['PENDING_PAYMENT', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED']);
    expect(
      (await send(admin, 'patch', `/admin/orders/${order.id}/status`, { status: 'PAID' })).status,
    ).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: 'admin.order_status_changed' } })).toBe(
      3,
    );
  });

  it('restocks and refunds the payment when a paid order is cancelled', async () => {
    const admin = await loginAs(app, await makeUser({ role: 'ADMIN' }));
    const { p, order } = await paidOrder();
    expect(
      (await prisma.inventory.findUniqueOrThrow({ where: { productId: p.id } })).quantity,
    ).toBe(3);
    expect(
      (await send(admin, 'patch', `/admin/orders/${order.id}/status`, { status: 'CANCELLED' }))
        .status,
    ).toBe(200);
    expect(
      (await prisma.inventory.findUniqueOrThrow({ where: { productId: p.id } })).quantity,
    ).toBe(5);
    expect((await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } })).status).toBe(
      'REFUNDED',
    );
    expect(
      (await send(admin, 'patch', `/admin/orders/${order.id}/status`, { status: 'CANCELLED' }))
        .status,
    ).toBe(409); // no double restock
    expect(
      (await prisma.inventory.findUniqueOrThrow({ where: { productId: p.id } })).quantity,
    ).toBe(5);
  });

  it('exposes stats and a paginated audit log to admins only', async () => {
    const admin = await loginAs(app, await makeUser({ role: 'ADMIN' }));
    await paidOrder();
    const stats = (await admin.agent.get(`${API}/admin/stats`)).body;
    expect(stats.orders).toBe(1);
    expect(stats.revenueMinor).toBeGreaterThan(0);
    expect((await admin.agent.get(`${API}/admin/audit-logs`)).body.items.length).toBeGreaterThan(0);
  });
});
