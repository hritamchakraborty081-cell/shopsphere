import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';
import { hashPassword } from '../src/modules/auth/auth.service';
import { clearOutbox, getOutbox } from '../src/services/mailer';
import { signPayload } from '../src/modules/orders/orders.service';

export const ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'Str0ng-Test-Passw0rd';
export const API = '/api/v1';
const BIG = {
  global: 100000,
  auth: 100000,
  login: 100000,
  register: 100000,
  passwordReset: 100000,
  checkout: 100000,
};

export const makeApp = (limits: Partial<typeof BIG> = BIG): Express =>
  createApp({ limits: { ...BIG, ...limits } });

const TABLES = [
  'AuditLog',
  'SupportMessage',
  'WebhookEvent',
  'Review',
  'OrderStatusHistory',
  'Payment',
  'OrderItem',
  'Order',
  'Coupon',
  'WishlistItem',
  'CartItem',
  'Cart',
  'Inventory',
  'ProductImage',
  'Product',
  'Category',
  'Address',
  'PasswordResetToken',
  'EmailVerificationToken',
  'Session',
  'User',
];
export async function resetData() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(',')} RESTART IDENTITY CASCADE`,
  );
  clearOutbox();
}

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${counter++}`;
let cachedHash: string | undefined;

export async function makeUser(
  opts: { role?: 'ADMIN' | 'CUSTOMER'; verified?: boolean; email?: string } = {},
) {
  cachedHash ??= await hashPassword(PASSWORD);
  return prisma.user.create({
    data: {
      email: opts.email ?? `user-${uniq()}@example.test`,
      name: 'Test User',
      passwordHash: cachedHash,
      role: opts.role ?? 'CUSTOMER',
      emailVerifiedAt: opts.verified === false ? null : new Date(),
    },
  });
}

export interface Session {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  userId: string;
  email: string;
}

export async function loginAs(app: Express, user: { id: string; email: string }): Promise<Session> {
  const agent = request.agent(app);
  const res = await agent
    .post(`${API}/auth/login`)
    .set('Origin', ORIGIN)
    .send({ email: user.email, password: PASSWORD });
  if (res.status !== 200)
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, csrf: res.body.csrfToken, userId: user.id, email: user.email };
}

/** Mutating helper: always sends Origin + CSRF token like the real web client does. */
export const send = (
  s: Session,
  method: 'post' | 'patch' | 'put' | 'delete',
  url: string,
  body?: object,
  headers: Record<string, string> = {},
) => {
  let r = s.agent[method](`${API}${url}`).set('Origin', ORIGIN).set('X-CSRF-Token', s.csrf);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return body ? r.send(body) : r;
};

export async function makeProduct(
  opts: { price?: number; stock?: number; name?: string; categoryId?: string } = {},
) {
  const category = opts.categoryId
    ? { id: opts.categoryId }
    : await prisma.category.create({ data: { name: `Cat ${uniq()}`, slug: `cat-${uniq()}` } });
  const id = uniq();
  return prisma.product.create({
    data: {
      sku: `SKU-${id}`.toUpperCase(),
      slug: `product-${id}`,
      name: opts.name ?? `Product ${id}`,
      brand: 'TestBrand',
      description: 'A product used in automated tests.',
      priceMinor: opts.price ?? 10_000,
      mrpMinor: (opts.price ?? 10_000) + 1000,
      categoryId: category.id,
      inventory: { create: { quantity: opts.stock ?? 10 } },
      images: { create: [{ url: '/products/test.svg', alt: 'test', position: 0 }] },
    },
  });
}

export async function makeAddress(userId: string) {
  return prisma.address.create({
    data: {
      userId,
      fullName: 'Test User',
      phone: '9876543210',
      line1: '1 Test Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      postalCode: '400001',
      isDefault: true,
    },
  });
}

export const idemKey = () => `idem-${uniq()}-${'x'.repeat(12)}`;

export async function fillCart(s: Session, productId: string, quantity: number) {
  return send(s, 'post', '/cart/items', { productId, quantity });
}

export async function placeOrder(
  s: Session,
  addressId: string,
  extra: object = {},
  key = idemKey(),
) {
  return send(
    s,
    'post',
    '/orders',
    { addressId, shippingMethod: 'STANDARD', ...extra },
    { 'Idempotency-Key': key },
  );
}

/** Sends a (by default correctly signed) webhook with the raw body. */
export function webhook(app: Express, payload: object, opts: { signature?: string | null } = {}) {
  const raw = JSON.stringify(payload);
  let r = request(app).post(`${API}/payments/webhook/mock`).set('Content-Type', 'application/json');
  const sig = opts.signature === undefined ? signPayload(Buffer.from(raw)) : opts.signature;
  if (sig) r = r.set('x-signature', sig);
  return r.send(raw);
}

export const lastLinkToken = (to: string): string => {
  const mail = [...getOutbox()].reverse().find((m) => m.to === to);
  const m = mail?.text.match(/token=([\w-]+)/);
  if (!m) throw new Error('no token email found for ' + to);
  return m[1]!;
};

export { prisma, request };
