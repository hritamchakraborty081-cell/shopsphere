import express, { Router } from 'express';
import { z } from 'zod';
import type { createLimiters } from '../../middleware/rateLimit';
import { currentUser, requireAuth, requireVerifiedEmail } from '../../middleware/auth';
import { badRequest } from '../../utils/errors';
import { ah, parse } from '../../utils/http';
import {
  createOrderSchema,
  idempotencyKeySchema,
  payMockSchema,
  quoteSchema,
} from './orders.schemas';
import * as svc from './orders.service';

type Limiters = ReturnType<typeof createLimiters>;
const idSchema = z.string().uuid();

export function ordersRouter(limits: Limiters) {
  const r = Router();
  // Scoped guard: this router is mounted at the API root, so it must not intercept unrelated paths.
  r.use(['/checkout', '/orders'], requireAuth);

  r.post(
    '/checkout/quote',
    limits.checkout,
    ah(async (req, res) => {
      res.json(await svc.quote(currentUser(req).id, parse(quoteSchema, req.body)));
    }),
  );

  r.post(
    '/orders',
    limits.checkout,
    requireVerifiedEmail,
    ah(async (req, res) => {
      const key = req.get('idempotency-key');
      if (!key) throw badRequest('Idempotency-Key header is required', 'IDEMPOTENCY_KEY_REQUIRED');
      const { order, replayed } = await svc.createOrder(
        currentUser(req).id,
        parse(createOrderSchema, req.body),
        parse(idempotencyKeySchema, key),
      );
      res.status(replayed ? 200 : 201).json({ order });
    }),
  );

  r.get(
    '/orders',
    ah(async (req, res) => {
      const page = parse(z.coerce.number().int().min(1).max(1000).default(1), req.query.page);
      res.json(await svc.listOrders(currentUser(req).id, page));
    }),
  );

  r.get(
    '/orders/:id',
    ah(async (req, res) => {
      res.json({ order: await svc.getOrder(currentUser(req).id, parse(idSchema, req.params.id)) });
    }),
  );

  r.post(
    '/orders/:id/cancel',
    ah(async (req, res) => {
      res.json({
        order: await svc.cancelOrderByCustomer(currentUser(req).id, parse(idSchema, req.params.id)),
      });
    }),
  );

  // MOCK PAYMENT (development only). Sends a signed event through the same code path as a real webhook.
  r.post(
    '/orders/:id/pay/mock',
    ah(async (req, res) => {
      const { outcome } = parse(payMockSchema, req.body);
      res.json({
        order: await svc.simulateMockPayment(
          currentUser(req).id,
          parse(idSchema, req.params.id),
          outcome,
        ),
      });
    }),
  );

  return r;
}

/** Mounted BEFORE express.json(): the signature must be verified over the raw request bytes. */
export function webhookRouter() {
  const r = Router();
  r.post(
    '/mock',
    express.raw({ type: 'application/json', limit: '50kb' }),
    ah(async (req, res) => {
      if (!Buffer.isBuffer(req.body)) throw badRequest('Expected a JSON body', 'INVALID_PAYLOAD');
      const result = await svc.handleWebhook(req.body, req.get('x-signature') ?? undefined);
      res.json({ received: true, result: result.status });
    }),
  );
  return r;
}
