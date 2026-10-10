import { beforeEach, describe, expect, it } from 'vitest';
import {
  API,
  ORIGIN,
  PASSWORD,
  fillCart,
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

const address = {
  fullName: 'A B',
  phone: '9876543210',
  line1: '1 Main Road',
  city: 'Pune',
  state: 'Maharashtra',
  postalCode: '411001',
};

describe('profile and password management', () => {
  it('updates the profile name and ignores attempts to change role or email (mass assignment)', async () => {
    const s = await loginAs(app, await makeUser());
    expect((await send(s, 'patch', '/users/me', { name: 'New Name' })).body.user.name).toBe(
      'New Name',
    );
    expect((await send(s, 'patch', '/users/me', { name: 'X', role: 'ADMIN' })).status).toBe(422);
    expect(
      (await send(s, 'patch', '/users/me', { name: 'X', email: 'evil@example.test' })).status,
    ).toBe(422);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.userId } })).role).toBe(
      'CUSTOMER',
    );
  });

  it('changing the password requires the current one, enforces policy and signs out OTHER sessions only', async () => {
    const user = await makeUser();
    const a = await loginAs(app, user);
    const b = await loginAs(app, user);
    expect(
      (
        await send(a, 'post', '/users/me/password', {
          currentPassword: 'wrong-Password-1',
          newPassword: 'Another-Passw0rd-9',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send(a, 'post', '/users/me/password', {
          currentPassword: PASSWORD,
          newPassword: 'weak',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await send(a, 'post', '/users/me/password', {
          currentPassword: PASSWORD,
          newPassword: 'Another-Passw0rd-9',
        })
      ).status,
    ).toBe(200);
    expect((await a.agent.get(`${API}/cart`)).status).toBe(200); // current session survives
    expect((await b.agent.get(`${API}/cart`)).status).toBe(401); // other device is signed out
    expect(
      (
        await request(app)
          .post(`${API}/auth/login`)
          .set('Origin', ORIGIN)
          .send({ email: user.email, password: 'Another-Passw0rd-9' })
      ).status,
    ).toBe(200);
  });

  it('deactivating the account revokes sessions and blocks future logins', async () => {
    const user = await makeUser();
    const s = await loginAs(app, user);
    expect((await send(s, 'delete', '/users/me')).status).toBe(204);
    expect((await s.agent.get(`${API}/cart`)).status).toBe(401);
    expect(
      (
        await request(app)
          .post(`${API}/auth/login`)
          .set('Origin', ORIGIN)
          .send({ email: user.email, password: PASSWORD })
      ).status,
    ).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'user.deactivated' } })).toBe(1);
  });
});

describe('address book', () => {
  it('validates input, keeps a single default, soft-deletes and caps the number of addresses', async () => {
    const s = await loginAs(app, await makeUser());
    expect(
      (await send(s, 'post', '/users/me/addresses', { ...address, postalCode: '12' })).status,
    ).toBe(422);
    expect((await send(s, 'post', '/users/me/addresses', { ...address, userId: 'x' })).status).toBe(
      422,
    );
    const first = (await send(s, 'post', '/users/me/addresses', address)).body.address;
    expect(first.isDefault).toBe(true); // first address becomes default
    const second = (await send(s, 'post', '/users/me/addresses', { ...address, isDefault: true }))
      .body.address;
    const list = (await s.agent.get(`${API}/users/me/addresses`)).body.items;
    expect(list.filter((a: { isDefault: boolean }) => a.isDefault)).toHaveLength(1);
    expect(list[0].id).toBe(second.id);
    expect((await send(s, 'delete', `/users/me/addresses/${second.id}`)).status).toBe(204);
    expect(
      (await prisma.address.findUniqueOrThrow({ where: { id: second.id } })).deletedAt,
    ).not.toBeNull(); // soft delete
    for (let i = 0; i < 9; i++) await send(s, 'post', '/users/me/addresses', address);
    expect((await send(s, 'post', '/users/me/addresses', address)).status).toBe(409);
  });
});

describe('cart operations', () => {
  it('updates and removes items and flags stock problems', async () => {
    const s = await loginAs(app, await makeUser());
    const p = await makeProduct({ stock: 5 });
    await fillCart(s, p.id, 2);
    expect((await send(s, 'patch', `/cart/items/${p.id}`, { quantity: 4 })).body.itemCount).toBe(4);
    expect((await send(s, 'patch', `/cart/items/${p.id}`, { quantity: 6 })).status).toBe(409); // exceeds stock
    expect((await send(s, 'patch', `/cart/items/${p.id}`, { quantity: 0 })).status).toBe(422);
    await prisma.inventory.update({ where: { productId: p.id }, data: { quantity: 1 } }); // stock drops later
    const cart = (await s.agent.get(`${API}/cart`)).body;
    expect(cart.hasIssues).toBe(true);
    expect(cart.items[0].issue).toBe('INSUFFICIENT_STOCK');
    expect((await send(s, 'delete', `/cart/items/${p.id}`)).body.items).toHaveLength(0);
    expect((await send(s, 'patch', `/cart/items/${p.id}`, { quantity: 1 })).status).toBe(404);
  });

  it("keeps each customer's cart private", async () => {
    const a = await loginAs(app, await makeUser());
    const b = await loginAs(app, await makeUser());
    const p = await makeProduct();
    await fillCart(a, p.id, 1);
    expect((await b.agent.get(`${API}/cart`)).body.items).toHaveLength(0);
  });
});
