import { Router } from 'express';
import { z } from 'zod';
import { currentUser, requireAuth, requireVerifiedEmail } from '../../middleware/auth';
import { ah, parse } from '../../utils/http';
import { listQuerySchema, reviewSchema } from './catalog.schemas';
import * as svc from './catalog.service';

const idSchema = z.string().uuid();

export function catalogRouter() {
  const r = Router();

  r.get(
    '/categories',
    ah(async (_req, res) => {
      const rows = await svc.listCategories();
      res.json({
        items: rows.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          productCount: c._count.products,
        })),
      });
    }),
  );

  r.get(
    '/products',
    ah(async (req, res) => {
      const q = parse(listQuerySchema, req.query);
      if (q.minPrice !== undefined && q.maxPrice !== undefined && q.minPrice > q.maxPrice) {
        return res.status(422).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'minPrice cannot exceed maxPrice',
            requestId: req.id,
          },
        });
      }
      res.json(await svc.listProducts(q));
    }),
  );

  r.get(
    '/products/:slug',
    ah(async (req, res) => {
      const slug = parse(z.string().regex(/^[a-z0-9-]{1,120}$/), req.params.slug);
      res.json({ product: await svc.getProductBySlug(slug) });
    }),
  );

  r.get(
    '/products/:id/reviews',
    ah(async (req, res) => {
      const id = parse(idSchema, req.params.id);
      const page = parse(z.coerce.number().int().min(1).max(1000).default(1), req.query.page);
      res.json(await svc.listReviews(id, page));
    }),
  );

  r.get(
    '/products/:id/review-eligibility',
    requireAuth,
    ah(async (req, res) => {
      res.json(await svc.reviewEligibility(currentUser(req).id, parse(idSchema, req.params.id)));
    }),
  );

  r.post(
    '/products/:id/reviews',
    requireAuth,
    requireVerifiedEmail,
    ah(async (req, res) => {
      const review = await svc.createReview(
        currentUser(req).id,
        parse(idSchema, req.params.id),
        parse(reviewSchema, req.body),
      );
      res.status(201).json({
        review: { id: review.id, rating: review.rating, title: review.title, body: review.body },
      });
    }),
  );

  return r;
}
