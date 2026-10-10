import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../db/prisma';
import { conflict, forbidden, notFound } from '../../utils/errors';
import type { z } from 'zod';
import type { listQuerySchema } from './catalog.schemas';

const LOW_STOCK = 5;
export const MAX_PER_ITEM = 10;

const cardInclude = {
  images: { orderBy: { position: 'asc' as const }, take: 1 },
  inventory: { select: { quantity: true } },
} satisfies Prisma.ProductInclude;

type CardProduct = Prisma.ProductGetPayload<{ include: typeof cardInclude }>;

/** Public DTO. Internal fields (cost, deletedAt, ...) are never exposed. */
export function toCard(p: CardProduct) {
  const qty = p.inventory?.quantity ?? 0;
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    priceMinor: p.priceMinor,
    mrpMinor: p.mrpMinor,
    ratingAvg: Math.round(p.ratingAvg * 10) / 10,
    ratingCount: p.ratingCount,
    image: p.images[0] ? { url: p.images[0].url, alt: p.images[0].alt } : null,
    inStock: qty > 0,
    lowStock: qty > 0 && qty <= LOW_STOCK,
  };
}

export const productCardInclude = cardInclude;

export async function listCategories() {
  return prisma.category.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { products: { where: { isActive: true, deletedAt: null } } } },
    },
    orderBy: { name: 'asc' },
  });
}

export async function listProducts(q: z.infer<typeof listQuerySchema>) {
  const where: Prisma.ProductWhereInput = { isActive: true, deletedAt: null };
  if (q.q) {
    where.OR = [
      { name: { contains: q.q, mode: 'insensitive' } },
      { brand: { contains: q.q, mode: 'insensitive' } },
      { description: { contains: q.q, mode: 'insensitive' } },
    ];
  }
  if (q.category) where.category = { slug: q.category };
  if (q.minPrice !== undefined || q.maxPrice !== undefined) {
    where.priceMinor = { gte: q.minPrice, lte: q.maxPrice };
  }
  if (q.minRating) where.ratingAvg = { gte: q.minRating };
  if (q.inStock === 'true') where.inventory = { is: { quantity: { gt: 0 } } };

  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    q.sort === 'price_asc'
      ? [{ priceMinor: 'asc' }, { id: 'asc' }]
      : q.sort === 'price_desc'
        ? [{ priceMinor: 'desc' }, { id: 'asc' }]
        : q.sort === 'rating'
          ? [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }, { id: 'asc' }]
          : q.sort === 'newest'
            ? [{ createdAt: 'desc' }, { id: 'asc' }]
            : [{ ratingCount: 'desc' }, { id: 'asc' }];

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy,
      include: cardInclude,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return {
    items: rows.map(toCard),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

export async function getProductBySlug(slug: string) {
  const p = await prisma.product.findFirst({
    where: { slug, isActive: true, deletedAt: null },
    include: { images: { orderBy: { position: 'asc' } }, inventory: true, category: true },
  });
  if (!p) throw notFound('Product not found');
  const [related, dist] = await Promise.all([
    prisma.product.findMany({
      where: { categoryId: p.categoryId, id: { not: p.id }, isActive: true, deletedAt: null },
      include: cardInclude,
      orderBy: { ratingCount: 'desc' },
      take: 4,
    }),
    prisma.review.groupBy({ by: ['rating'], where: { productId: p.id }, _count: { _all: true } }),
  ]);
  const qty = p.inventory?.quantity ?? 0;
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const d of dist) distribution[d.rating] = d._count._all;
  return {
    id: p.id,
    slug: p.slug,
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    description: p.description,
    priceMinor: p.priceMinor,
    mrpMinor: p.mrpMinor,
    ratingAvg: Math.round(p.ratingAvg * 10) / 10,
    ratingCount: p.ratingCount,
    distribution,
    category: { name: p.category.name, slug: p.category.slug },
    images: p.images.map((i) => ({ url: i.url, alt: i.alt })),
    inStock: qty > 0,
    lowStock: qty > 0 && qty <= LOW_STOCK,
    maxQuantity: Math.min(qty, MAX_PER_ITEM),
    related: related.map((r) => toCard(r as CardProduct)),
  };
}

export async function listReviews(productId: string, page: number, pageSize = 10) {
  const [total, rows] = await Promise.all([
    prisma.review.count({ where: { productId } }),
    prisma.review.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { name: true } } },
    }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      createdAt: r.createdAt,
      // Data minimisation: only first name + initial of the surname is public.
      author: r.user.name
        .split(' ')
        .map((w, i) => (i === 0 ? w : w[0] + '.'))
        .join(' '),
    })),
    page,
    pageSize,
    total,
  };
}

/** A customer may review a product only after a DELIVERED order containing it, once. */
export async function reviewEligibility(userId: string, productId: string) {
  const [purchased, existing] = await Promise.all([
    prisma.orderItem.findFirst({
      where: { productId, order: { userId, status: 'DELIVERED' } },
      select: { id: true },
    }),
    prisma.review.findUnique({
      where: { productId_userId: { productId, userId } },
      select: { id: true },
    }),
  ]);
  if (existing) return { eligible: false, reason: 'ALREADY_REVIEWED' as const };
  if (!purchased) return { eligible: false, reason: 'NO_DELIVERED_PURCHASE' as const };
  return { eligible: true, reason: null };
}

export async function createReview(
  userId: string,
  productId: string,
  input: { rating: number; title: string; body: string },
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true },
  });
  if (!product) throw notFound('Product not found');
  const elig = await reviewEligibility(userId, productId);
  if (!elig.eligible) {
    if (elig.reason === 'ALREADY_REVIEWED')
      throw conflict('You have already reviewed this product', 'ALREADY_REVIEWED');
    throw forbidden(
      'Only customers with a delivered order can review this product',
      'REVIEW_NOT_ELIGIBLE',
    );
  }
  return prisma.$transaction(async (tx) => {
    const review = await tx.review.create({ data: { ...input, productId, userId } });
    const agg = await tx.review.aggregate({
      where: { productId },
      _avg: { rating: true },
      _count: { _all: true },
    });
    await tx.product.update({
      where: { id: productId },
      data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count._all },
    });
    return review;
  });
}
