/**
 * Development seed. Idempotent (safe to run repeatedly). Refuses to run in production.
 * Demo passwords come from SEED_DEMO_PASSWORD - never hard-coded.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash, Algorithm } from '@node-rs/argon2';
import { PrismaClient } from '../src/generated/prisma/client';
import { categories, products } from './seed-data';

async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Refusing to seed demo data in production');
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password || password.length < 12)
    throw new Error('Set SEED_DEMO_PASSWORD (min 12 chars) in your .env');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const passwordHash = await hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const verifiedAt = new Date();

  const mkUser = (email: string, name: string, role: 'ADMIN' | 'CUSTOMER') =>
    prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name, role, passwordHash, emailVerifiedAt: verifiedAt },
    });
  const admin = await mkUser('admin@shopsphere.test', 'Asha Admin', 'ADMIN');
  const customer = await mkUser('customer@shopsphere.test', 'Rahul Sharma', 'CUSTOMER');
  const other = await mkUser('priya@shopsphere.test', 'Priya Nair', 'CUSTOMER');

  const catIds = new Map<string, string>();
  for (const c of categories) {
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: { name: c.name, slug: c.slug },
    });
    catIds.set(c.slug, row.id);
  }

  const productIds = new Map<string, string>();
  for (const p of products) {
    const slug = `${p.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')}-${p.sku.toLowerCase()}`.slice(0, 120);
    const row = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: {
        sku: p.sku,
        slug,
        name: p.name,
        brand: p.brand,
        description: p.description,
        priceMinor: p.price * 100,
        mrpMinor: p.mrp * 100,
        categoryId: catIds.get(p.category)!,
        inventory: { create: { quantity: p.stock } },
        images: { create: [{ url: `/products/${p.sku}.svg`, alt: p.name, position: 0 }] },
      },
    });
    productIds.set(p.sku, row.id);
  }

  await prisma.coupon.upsert({
    where: { code: 'WELCOME10' },
    update: {},
    create: { code: 'WELCOME10', type: 'PERCENT', value: 10, minOrderMinor: 50_000 },
  });
  await prisma.coupon.upsert({
    where: { code: 'FLAT200' },
    update: {},
    create: { code: 'FLAT200', type: 'FIXED', value: 20_000, minOrderMinor: 150_000, maxUses: 100 },
  });

  // A delivered order for the demo customer so the "write a review" flow can be tried.
  const demoKey = 'seed-delivered-order-0001';
  const exists = await prisma.order.findUnique({
    where: { userId_idempotencyKey: { userId: customer.id, idempotencyKey: demoKey } },
  });
  if (!exists) {
    const pid = productIds.get('BOOK-2001')!;
    const unit = 54_900;
    const tax = Math.round((unit * 1800) / 10_000);
    await prisma.order.create({
      data: {
        userId: customer.id,
        idempotencyKey: demoKey,
        status: 'DELIVERED',
        shippingMethod: 'STANDARD',
        subtotalMinor: unit,
        taxMinor: tax,
        shippingMinor: 4000,
        totalMinor: unit + tax + 4000,
        shipName: 'Rahul Sharma',
        shipPhone: '9876543210',
        shipLine1: '12 MG Road',
        shipCity: 'Bengaluru',
        shipState: 'Karnataka',
        shipPostalCode: '560001',
        shipCountry: 'IN',
        items: {
          create: [
            {
              productId: pid,
              sku: 'BOOK-2001',
              name: 'Digital Design Workbook',
              unitPriceMinor: unit,
              quantity: 1,
              lineTotalMinor: unit,
            },
          ],
        },
        payment: {
          create: {
            provider: 'mock',
            providerOrderId: 'mock_order_seed_0001',
            providerPaymentId: 'mock_pay_seed_0001',
            status: 'SUCCEEDED',
            amountMinor: unit + tax + 4000,
          },
        },
        history: {
          create: [
            { status: 'PENDING_PAYMENT', note: 'Order placed' },
            { status: 'PAID', note: 'Payment received (mock provider)' },
            { status: 'SHIPPED', note: 'Shipped' },
            { status: 'DELIVERED', note: 'Delivered' },
          ],
        },
      },
    });
  }

  // A few sample reviews from the second demo customer (kept consistent with product aggregates).
  const sampleReviews: [string, number, string, string][] = [
    [
      'ELEC-1001',
      5,
      'Superb sound and battery',
      'Noise cancellation is excellent for the price, and the case lasts days.',
    ],
    [
      'ELEC-1002',
      4,
      'Reliable power bank',
      'Charges my phone four times. A little heavy but worth it.',
    ],
    ['HOME-3001', 4, 'Boils fast', 'Quiet, fast and the auto shut-off works as expected.'],
    ['SPRT-5001', 5, 'Great grip', 'Does not slip even during hot yoga. Highly recommended.'],
    ['GROC-8001', 5, 'Fragrant rice', 'Long grains, lovely aroma, cooks perfectly every time.'],
  ];
  for (const [sku, rating, title, body] of sampleReviews) {
    const productId = productIds.get(sku)!;
    await prisma.review.upsert({
      where: { productId_userId: { productId, userId: other.id } },
      update: {},
      create: { productId, userId: other.id, rating, title, body },
    });
    const agg = await prisma.review.aggregate({
      where: { productId },
      _avg: { rating: true },
      _count: { _all: true },
    });
    await prisma.product.update({
      where: { id: productId },
      data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count._all },
    });
  }

  console.log(
    `Seeded ${products.length} products, ${categories.length} categories, 3 demo users (admin: ${admin.email}).`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
