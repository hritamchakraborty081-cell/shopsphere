import { z } from 'zod';
import { PRODUCT_SORTS } from '@shopsphere/shared';

const intParam = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const listQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(80).optional(),
    category: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{1,60}$/)
      .optional(),
    minPrice: intParam(0, 100_000_000).optional(), // paise
    maxPrice: intParam(0, 100_000_000).optional(), // paise
    minRating: intParam(1, 5).optional(),
    inStock: z.enum(['true', 'false']).optional(),
    sort: z.enum(PRODUCT_SORTS).default('relevance'),
    page: intParam(1, 10_000).default(1),
    pageSize: intParam(1, 48).default(12), // hard upper bound protects the database
  })
  .strict();

export const reviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    title: z.string().trim().min(2).max(100),
    body: z.string().trim().min(5).max(2000),
  })
  .strict();
