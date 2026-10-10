import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { currentUser, requireAuth } from '../../middleware/auth';
import { ah, parse } from '../../utils/http';
import { notFound } from '../../utils/errors';
import { MAX_PER_ITEM, productCardInclude, toCard } from '../catalog/catalog.service';
import * as svc from './cart.service';

const idSchema = z.string().uuid();
const qty = z.number().int().min(1).max(MAX_PER_ITEM);
const addSchema = z.object({ productId: idSchema, quantity: qty }).strict();
const setSchema = z.object({ quantity: qty }).strict();

export function cartRouter() {
  const r = Router();
  // Scoped guard: this router is mounted at the API root, so it must not intercept unrelated paths.
  r.use(['/cart', '/wishlist'], requireAuth);

  r.get(
    '/cart',
    ah(async (req, res) => res.json(await svc.getCart(currentUser(req).id))),
  );
  r.post(
    '/cart/items',
    ah(async (req, res) => {
      const { productId, quantity } = parse(addSchema, req.body);
      res.status(201).json(await svc.addItem(currentUser(req).id, productId, quantity));
    }),
  );
  r.patch(
    '/cart/items/:productId',
    ah(async (req, res) => {
      const { quantity } = parse(setSchema, req.body);
      res.json(
        await svc.setQuantity(currentUser(req).id, parse(idSchema, req.params.productId), quantity),
      );
    }),
  );
  r.delete(
    '/cart/items/:productId',
    ah(async (req, res) => {
      res.json(await svc.removeItem(currentUser(req).id, parse(idSchema, req.params.productId)));
    }),
  );

  r.get(
    '/wishlist',
    ah(async (req, res) => {
      const rows = await prisma.wishlistItem.findMany({
        where: { userId: currentUser(req).id, product: { isActive: true, deletedAt: null } },
        include: { product: { include: productCardInclude } },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ items: rows.map((w) => toCard(w.product)) });
    }),
  );
  r.put(
    '/wishlist/:productId',
    ah(async (req, res) => {
      const productId = parse(idSchema, req.params.productId);
      const userId = currentUser(req).id;
      const p = await prisma.product.findFirst({
        where: { id: productId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (!p) throw notFound('Product not found');
      await prisma.wishlistItem.upsert({
        where: { userId_productId: { userId, productId } },
        update: {},
        create: { userId, productId },
      });
      res.status(204).end();
    }),
  );
  r.delete(
    '/wishlist/:productId',
    ah(async (req, res) => {
      await prisma.wishlistItem.deleteMany({
        where: { userId: currentUser(req).id, productId: parse(idSchema, req.params.productId) },
      });
      res.status(204).end();
    }),
  );

  return r;
}
