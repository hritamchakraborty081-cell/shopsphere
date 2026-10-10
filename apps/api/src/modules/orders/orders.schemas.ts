import { z } from 'zod';
import { SHIPPING_METHODS } from '@shopsphere/shared';

const coupon = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{3,32}$/)
  .optional();

export const quoteSchema = z
  .object({ shippingMethod: z.enum(SHIPPING_METHODS), couponCode: coupon })
  .strict();

// NOTE: there is deliberately no price / total / quantity field: the server derives them.
export const createOrderSchema = z
  .object({
    addressId: z.string().uuid(),
    shippingMethod: z.enum(SHIPPING_METHODS),
    couponCode: coupon,
  })
  .strict();

export const idempotencyKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{16,64}$/, 'Idempotency-Key must be 16-64 URL-safe characters');
export const payMockSchema = z.object({ outcome: z.enum(['success', 'failure']) }).strict();

export const webhookEventSchema = z.object({
  eventId: z.string().min(8).max(64),
  type: z.enum(['payment.succeeded', 'payment.failed']),
  providerOrderId: z.string().min(8).max(80),
  providerPaymentId: z.string().min(8).max(80).optional(),
  timestamp: z.number().int(), // unix seconds; used for replay protection
});
export type WebhookEventPayload = z.infer<typeof webhookEventSchema>;
