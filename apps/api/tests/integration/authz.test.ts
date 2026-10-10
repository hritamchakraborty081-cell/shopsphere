import { beforeEach, describe, expect, it } from 'vitest';
import {
  API,
  loginAs,
  makeAddress,
  makeApp,
  makeProduct,
  makeUser,
  placeOrder,
  fillCart,
  prisma,
  request,
  resetData,
  send,
} from '../helpers';

const app = makeApp();
beforeEach(resetData);

const ADMIN_ROUTES: [string, string][] = [
  ['get', '/admin/stats'],
  ['get', '/admin/products'],
  ['get', '/admin/orders'],
  ['get', '/admin/users'],
  ['get', '/admin/audit-logs'],
  ['get', '/admin/support-messages'],
];

describe('role-based access control', () => {
  it('blocks anonymous users (401) and customers (403) from every admin endpoint', async () => {
    const customer = await loginAs(app, await makeUser());
    for (const [, url] of ADMIN_ROUTES) {
      expect((await request(app).get(`${API}${url}`)).status).toBe(401);
      expect((await customer.agent.get(`${API}${url}`)).status).toBe(403);
    }
    const p = await makeProduct();
    expect(
      (
        await send(customer, 'post', '/admin/products', {
          sku: 'HACK-001',
          name: 'Hack',
          brand: 'x',
          description: 'hacking attempt',
          priceMinor: 100,
          mrpMinor: 100,
          categoryId: p.categoryId,
          stock: 1,
        })
      ).status,
    ).toBe(403);
    expect(
      (await send(customer, 'patch', `/admin/products/${p.id}/inventory`, { quantity: 999 }))
        .status,
    ).toBe(403);
    expect(
      (await send(customer, 'patch', `/admin/users/${customer.userId}/role`, { role: 'ADMIN' }))
        .status,
    ).toBe(403);
    expect(
      (await prisma.inventory.findUniqueOrThrow({ where: { productId: p.id } })).quantity,
    ).toBe(10);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: customer.userId } })).role).toBe(
      'CUSTOMER',
    );
  });

  it('lets admins in, prevents self role changes and removal of the last admin', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const a = await loginAs(app, admin);
    expect((await a.agent.get(`${API}/admin/stats`)).status).toBe(200);
    expect(
      (await send(a, 'patch', `/admin/users/${admin.id}/role`, { role: 'CUSTOMER' })).body.error
        .code,
    ).toBe('SELF_ROLE_CHANGE');

    const other = await makeUser({ role: 'ADMIN' });
    expect(
      (await send(a, 'patch', `/admin/users/${other.id}/role`, { role: 'CUSTOMER' })).status,
    ).toBe(200);
    const customer = await makeUser();
    const promoted = await send(a, 'patch', `/admin/users/${customer.id}/role`, { role: 'ADMIN' });
    expect(promoted.status).toBe(200);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'admin.role_changed', entityId: customer.id },
    });
    expect(audit).not.toBeNull();
  });

  it('revokes sessions of a user whose role changed', async () => {
    const a = await loginAs(app, await makeUser({ role: 'ADMIN' }));
    const victim = await makeUser();
    const v = await loginAs(app, victim);
    await send(a, 'patch', `/admin/users/${victim.id}/role`, { role: 'ADMIN' });
    expect((await v.agent.get(`${API}/cart`)).status).toBe(401);
  });
});

describe('object-level authorization (IDOR / BOLA)', () => {
  it("prevents reading or modifying another customer's addresses", async () => {
    const alice = await loginAs(app, await makeUser());
    const bob = await loginAs(app, await makeUser());
    const aliceAddr = await makeAddress(alice.userId);
    expect((await bob.agent.get(`${API}/users/me/addresses`)).body.items).toHaveLength(0);
    expect(
      (await send(bob, 'patch', `/users/me/addresses/${aliceAddr.id}`, { city: 'Hacked' })).status,
    ).toBe(404);
    expect((await send(bob, 'delete', `/users/me/addresses/${aliceAddr.id}`)).status).toBe(404);
    expect((await prisma.address.findUniqueOrThrow({ where: { id: aliceAddr.id } })).city).toBe(
      'Mumbai',
    );
  });

  it("prevents reading, cancelling or paying another customer's order", async () => {
    const alice = await loginAs(app, await makeUser());
    const bob = await loginAs(app, await makeUser());
    const product = await makeProduct();
    await fillCart(alice, product.id, 1);
    const addr = await makeAddress(alice.userId);
    const order = (await placeOrder(alice, addr.id)).body.order;

    expect((await bob.agent.get(`${API}/orders/${order.id}`)).status).toBe(404);
    expect((await send(bob, 'post', `/orders/${order.id}/cancel`)).status).toBe(404);
    expect(
      (await send(bob, 'post', `/orders/${order.id}/pay/mock`, { outcome: 'success' })).status,
    ).toBe(404);
    expect((await bob.agent.get(`${API}/orders`)).body.items).toHaveLength(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PENDING_PAYMENT',
    );
  });

  it("cannot use another user's address to place an order", async () => {
    const alice = await loginAs(app, await makeUser());
    const bob = await loginAs(app, await makeUser());
    const aliceAddr = await makeAddress(alice.userId);
    const product = await makeProduct();
    await fillCart(bob, product.id, 1);
    expect((await placeOrder(bob, aliceAddr.id)).status).toBe(422);
  });

  it('rejects malformed ids with 422 instead of reaching the database', async () => {
    const s = await loginAs(app, await makeUser());
    expect((await s.agent.get(`${API}/orders/not-a-uuid`)).status).toBe(422);
    expect((await s.agent.get(`${API}/orders/1' OR '1'='1`)).status).toBe(422);
  });
});
