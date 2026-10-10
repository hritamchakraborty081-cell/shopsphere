import { Router } from 'express';
import { z } from 'zod';
import { ORDER_STATUSES } from '@shopsphere/shared';
import { prisma } from '../../db/prisma';
import { currentUser, requireAuth, requireRole } from '../../middleware/auth';
import { audit } from '../../services/audit';
import { conflict, forbidden, notFound } from '../../utils/errors';
import { ah, parse } from '../../utils/http';
import { changeOrderStatus, toOrderDto } from '../orders/orders.service';

const idSchema = z.string().uuid();
const pageSchema = z.coerce.number().int().min(1).max(10_000).default(1);
const PAGE_SIZE = 20;

/**
 * Images are only STORED and rendered by the browser (never fetched by the server -> no SSRF).
 * Only https:// URLs or the app's own /products/ assets are accepted; javascript:/data: are rejected.
 */
const imageUrl = z
  .string()
  .max(500)
  .refine(
    (u) => /^https:\/\/[^\s"'<>]+$/.test(u) || /^\/products\/[\w.-]+$/.test(u),
    'Image URL must be https:// or /products/<file>',
  );
const imageSchema = z.object({ url: imageUrl, alt: z.string().trim().min(1).max(200) }).strict();

const productFields = {
  sku: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{3,40}$/, 'SKU must be 3-40 chars of A-Z, 0-9 and -'),
  name: z.string().trim().min(2).max(160),
  brand: z.string().trim().min(1).max(80),
  description: z.string().trim().min(10).max(5000),
  priceMinor: z.number().int().min(100).max(100_000_000),
  mrpMinor: z.number().int().min(100).max(100_000_000),
  categoryId: idSchema,
  isActive: z.boolean(),
};
const createProductSchema = z
  .object({
    ...productFields,
    isActive: productFields.isActive.default(true),
    stock: z.number().int().min(0).max(100_000),
    images: z.array(imageSchema).max(8).default([]),
  })
  .strict()
  .refine((p) => p.mrpMinor >= p.priceMinor, {
    message: 'mrpMinor must be >= priceMinor',
    path: ['mrpMinor'],
  });
const updateProductSchema = z
  .object({ ...productFields, images: z.array(imageSchema).max(8) })
  .partial()
  .strict();

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

export function adminRouter() {
  const r = Router();
  r.use(requireAuth, requireRole('ADMIN')); // server-side RBAC on EVERY admin route

  r.get(
    '/stats',
    ah(async (_req, res) => {
      const [users, orders, revenue, lowStock, byStatus] = await Promise.all([
        prisma.user.count({ where: { deletedAt: null } }),
        prisma.order.count(),
        prisma.order.aggregate({
          _sum: { totalMinor: true },
          where: { status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] } },
        }),
        prisma.inventory.count({ where: { quantity: { lte: 5 }, product: { deletedAt: null } } }),
        prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      ]);
      res.json({
        users,
        orders,
        revenueMinor: revenue._sum.totalMinor ?? 0,
        lowStockProducts: lowStock,
        ordersByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      });
    }),
  );

  /* ---- products ---- */
  r.get(
    '/products',
    ah(async (req, res) => {
      const page = parse(pageSchema, req.query.page);
      const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : undefined;
      const where = {
        deletedAt: null,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' as const } },
                { sku: { contains: q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.product.count({ where }),
        prisma.product.findMany({
          where,
          include: { inventory: true, category: true, images: { orderBy: { position: 'asc' } } },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);
      res.json({
        total,
        page,
        pageSize: PAGE_SIZE,
        items: rows.map((p) => ({
          id: p.id,
          sku: p.sku,
          slug: p.slug,
          name: p.name,
          brand: p.brand,
          description: p.description,
          priceMinor: p.priceMinor,
          mrpMinor: p.mrpMinor,
          isActive: p.isActive,
          stock: p.inventory?.quantity ?? 0,
          category: { id: p.category.id, name: p.category.name },
          images: p.images.map((i) => ({ url: i.url, alt: i.alt })),
        })),
      });
    }),
  );

  r.post(
    '/products',
    ah(async (req, res) => {
      const { stock, images, ...data } = parse(createProductSchema, req.body);
      const category = await prisma.category.findUnique({ where: { id: data.categoryId } });
      if (!category) throw notFound('Category not found');
      const slug = `${slugify(data.name)}-${data.sku.toLowerCase()}`;
      const product = await prisma.product.create({
        data: {
          ...data,
          slug,
          inventory: { create: { quantity: stock } },
          images: { create: images.map((i, position) => ({ ...i, position })) },
        },
      });
      await audit(currentUser(req).id, 'admin.product_created', 'Product', product.id, {
        sku: product.sku,
      });
      res.status(201).json({ id: product.id, slug: product.slug });
    }),
  );

  r.patch(
    '/products/:id',
    ah(async (req, res) => {
      const id = parse(idSchema, req.params.id);
      const { images, ...data } = parse(updateProductSchema, req.body);
      const current = await prisma.product.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw notFound('Product not found');
      const price = data.priceMinor ?? current.priceMinor;
      const mrp = data.mrpMinor ?? current.mrpMinor;
      if (mrp < price) throw conflict('mrpMinor must be >= priceMinor', 'INVALID_PRICE');
      await prisma.$transaction(async (tx) => {
        await tx.product.update({ where: { id }, data });
        if (images) {
          await tx.productImage.deleteMany({ where: { productId: id } });
          await tx.productImage.createMany({
            data: images.map((i, position) => ({ ...i, productId: id, position })),
          });
        }
      });
      await audit(currentUser(req).id, 'admin.product_updated', 'Product', id, {
        fields: Object.keys(req.body),
      });
      res.json({ id });
    }),
  );

  r.delete(
    '/products/:id',
    ah(async (req, res) => {
      const id = parse(idSchema, req.params.id);
      const done = await prisma.product.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date(), isActive: false },
      });
      if (done.count === 0) throw notFound('Product not found'); // soft delete: order history keeps its snapshot
      await audit(currentUser(req).id, 'admin.product_deleted', 'Product', id);
      res.status(204).end();
    }),
  );

  r.patch(
    '/products/:id/inventory',
    ah(async (req, res) => {
      const id = parse(idSchema, req.params.id);
      const { quantity } = parse(
        z.object({ quantity: z.number().int().min(0).max(100_000) }).strict(),
        req.body,
      );
      const done = await prisma.inventory.updateMany({
        where: { productId: id, product: { deletedAt: null } },
        data: { quantity },
      });
      if (done.count === 0) throw notFound('Product not found');
      await audit(currentUser(req).id, 'admin.inventory_set', 'Product', id, { quantity });
      res.json({ productId: id, quantity });
    }),
  );

  /* ---- categories ---- */
  r.post(
    '/categories',
    ah(async (req, res) => {
      const { name } = parse(
        z.object({ name: z.string().trim().min(2).max(60) }).strict(),
        req.body,
      );
      const c = await prisma.category.create({ data: { name, slug: slugify(name) } });
      await audit(currentUser(req).id, 'admin.category_created', 'Category', c.id);
      res.status(201).json({ id: c.id, name: c.name, slug: c.slug });
    }),
  );
  r.patch(
    '/categories/:id',
    ah(async (req, res) => {
      const id = parse(idSchema, req.params.id);
      const { name } = parse(
        z.object({ name: z.string().trim().min(2).max(60) }).strict(),
        req.body,
      );
      const c = await prisma.category.update({
        where: { id },
        data: { name, slug: slugify(name) },
      });
      await audit(currentUser(req).id, 'admin.category_updated', 'Category', id);
      res.json({ id: c.id, name: c.name, slug: c.slug });
    }),
  );
  r.delete(
    '/categories/:id',
    ah(async (req, res) => {
      const id = parse(idSchema, req.params.id);
      if ((await prisma.product.count({ where: { categoryId: id } })) > 0) {
        throw conflict('Category still has products', 'CATEGORY_NOT_EMPTY');
      }
      const done = await prisma.category.deleteMany({ where: { id } });
      if (done.count === 0) throw notFound('Category not found');
      await audit(currentUser(req).id, 'admin.category_deleted', 'Category', id);
      res.status(204).end();
    }),
  );

  /* ---- orders ---- */
  r.get(
    '/orders',
    ah(async (req, res) => {
      const page = parse(pageSchema, req.query.page);
      const status =
        req.query.status === undefined
          ? undefined
          : parse(z.enum(ORDER_STATUSES), req.query.status);
      const where = status ? { status } : {};
      const [total, rows] = await Promise.all([
        prisma.order.count({ where }),
        prisma.order.findMany({
          where,
          include: {
            items: true,
            payment: true,
            history: { orderBy: { createdAt: 'asc' } },
            user: { select: { email: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);
      res.json({
        total,
        page,
        pageSize: PAGE_SIZE,
        items: rows.map((o) => ({ ...toOrderDto(o), customer: o.user })),
      });
    }),
  );
  r.patch(
    '/orders/:id/status',
    ah(async (req, res) => {
      const { status, note } = parse(
        z
          .object({ status: z.enum(ORDER_STATUSES), note: z.string().trim().max(200).optional() })
          .strict(),
        req.body,
      );
      res.json(
        await changeOrderStatus(currentUser(req).id, parse(idSchema, req.params.id), status, note),
      );
    }),
  );

  /* ---- users & roles ---- */
  r.get(
    '/users',
    ah(async (req, res) => {
      const page = parse(pageSchema, req.query.page);
      const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : undefined;
      const where = {
        deletedAt: null,
        ...(q
          ? {
              OR: [
                { email: { contains: q.toLowerCase() } },
                { name: { contains: q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            emailVerifiedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);
      res.json({
        total,
        page,
        pageSize: PAGE_SIZE,
        items: rows.map((u) => ({
          ...u,
          emailVerified: !!u.emailVerifiedAt,
          emailVerifiedAt: undefined,
        })),
      });
    }),
  );
  r.patch(
    '/users/:id/role',
    ah(async (req, res) => {
      const id = parse(idSchema, req.params.id);
      const { role } = parse(z.object({ role: z.enum(['CUSTOMER', 'ADMIN']) }).strict(), req.body);
      const actor = currentUser(req);
      if (id === actor.id) throw forbidden('You cannot change your own role', 'SELF_ROLE_CHANGE');
      const target = await prisma.user.findFirst({ where: { id, deletedAt: null } });
      if (!target) throw notFound('User not found');
      if (
        target.role === 'ADMIN' &&
        role !== 'ADMIN' &&
        (await prisma.user.count({ where: { role: 'ADMIN', deletedAt: null } })) <= 1
      ) {
        throw conflict('At least one administrator must remain', 'LAST_ADMIN');
      }
      await prisma.$transaction([
        prisma.user.update({ where: { id }, data: { role } }),
        // Force re-login so the new privilege level is applied everywhere.
        prisma.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
      await audit(actor.id, 'admin.role_changed', 'User', id, { from: target.role, to: role });
      res.json({ id, role });
    }),
  );

  /* ---- moderation & logs ---- */
  r.delete(
    '/reviews/:id',
    ah(async (req, res) => {
      const id = parse(idSchema, req.params.id);
      const review = await prisma.review.findUnique({ where: { id } });
      if (!review) throw notFound('Review not found');
      await prisma.$transaction(async (tx) => {
        await tx.review.delete({ where: { id } });
        const agg = await tx.review.aggregate({
          where: { productId: review.productId },
          _avg: { rating: true },
          _count: { _all: true },
        });
        await tx.product.update({
          where: { id: review.productId },
          data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count._all },
        });
      });
      await audit(currentUser(req).id, 'admin.review_deleted', 'Review', id);
      res.status(204).end();
    }),
  );
  r.get(
    '/audit-logs',
    ah(async (req, res) => {
      const page = parse(pageSchema, req.query.page);
      const [total, rows] = await Promise.all([
        prisma.auditLog.count(),
        prisma.auditLog.findMany({
          include: { actor: { select: { email: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);
      res.json({
        total,
        page,
        pageSize: PAGE_SIZE,
        items: rows.map((l) => ({
          id: l.id,
          action: l.action,
          entity: l.entity,
          entityId: l.entityId,
          actor: l.actor?.email ?? null,
          metadata: l.metadata,
          createdAt: l.createdAt,
        })),
      });
    }),
  );
  r.get(
    '/support-messages',
    ah(async (req, res) => {
      const page = parse(pageSchema, req.query.page);
      const rows = await prisma.supportMessage.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      });
      res.json({ items: rows });
    }),
  );

  return r;
}
