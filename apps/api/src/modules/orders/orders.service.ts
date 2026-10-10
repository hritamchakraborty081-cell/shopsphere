import { Prisma } from '../../generated/prisma/client';
import type { OrderStatus } from '../../generated/prisma/client';
import { ORDER_TRANSITIONS } from '@shopsphere/shared';
import { env } from '../../config/env';
import { prisma, type Tx } from '../../db/prisma';
import { audit } from '../../services/audit';
import { hmacHex, randomToken, safeEqual } from '../../utils/crypto';
import { AppError, badRequest, conflict, notFound, unprocessable } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { computeTotals, type CouponRule } from './pricing';
import { webhookEventSchema, type WebhookEventPayload } from './orders.schemas';

const PROVIDER = 'mock';
const WEBHOOK_TOLERANCE_SECONDS = 300;

const orderInclude = {
  items: true,
  payment: true,
  history: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.OrderInclude;

type OrderWithRels = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function toOrderDto(o: OrderWithRels) {
  return {
    id: o.id,
    status: o.status,
    createdAt: o.createdAt,
    subtotalMinor: o.subtotalMinor,
    discountMinor: o.discountMinor,
    taxMinor: o.taxMinor,
    shippingMinor: o.shippingMinor,
    totalMinor: o.totalMinor,
    shippingMethod: o.shippingMethod,
    couponCode: o.couponCode,
    shippingAddress: {
      name: o.shipName,
      phone: o.shipPhone,
      line1: o.shipLine1,
      line2: o.shipLine2,
      city: o.shipCity,
      state: o.shipState,
      postalCode: o.shipPostalCode,
      country: o.shipCountry,
    },
    items: o.items.map((i) => ({
      productId: i.productId,
      sku: i.sku,
      name: i.name,
      unitPriceMinor: i.unitPriceMinor,
      quantity: i.quantity,
      lineTotalMinor: i.lineTotalMinor,
    })),
    payment: o.payment && {
      provider: o.payment.provider,
      status: o.payment.status,
      providerOrderId: o.payment.providerOrderId,
      amountMinor: o.payment.amountMinor,
      currency: o.payment.currency,
      isMock: o.payment.provider === 'mock',
    },
    tracking: o.history.map((h) => ({ status: h.status, note: h.note, at: h.createdAt })),
  };
}

async function loadCoupon(tx: Tx | typeof prisma, code: string | undefined, subtotal: number) {
  if (!code) return null;
  const c = await tx.coupon.findUnique({ where: { code } });
  const now = new Date();
  if (
    !c ||
    !c.active ||
    (c.expiresAt && c.expiresAt <= now) ||
    (c.maxUses !== null && c.usedCount >= c.maxUses) ||
    subtotal < c.minOrderMinor
  ) {
    throw unprocessable('This coupon is not valid for your order', [
      { path: 'couponCode', message: 'Invalid or expired coupon' },
    ]);
  }
  return c;
}

export async function quote(
  userId: string,
  input: { shippingMethod: 'STANDARD' | 'EXPRESS'; couponCode?: string },
) {
  const items = await prisma.cartItem.findMany({
    where: { cart: { userId }, product: { isActive: true, deletedAt: null } },
    include: { product: true },
  });
  if (items.length === 0) throw unprocessable('Your cart is empty');
  const lines = items.map((i) => ({ unitPriceMinor: i.product.priceMinor, quantity: i.quantity }));
  const subtotal = lines.reduce((n, l) => n + l.unitPriceMinor * l.quantity, 0);
  const coupon = await loadCoupon(prisma, input.couponCode, subtotal);
  const rule: CouponRule | null = coupon ? { type: coupon.type, value: coupon.value } : null;
  return { ...computeTotals(lines, input.shippingMethod, rule), couponCode: coupon?.code ?? null };
}

export async function createOrder(
  userId: string,
  input: { addressId: string; shippingMethod: 'STANDARD' | 'EXPRESS'; couponCode?: string },
  idempotencyKey: string,
) {
  const findExisting = () =>
    prisma.order.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include: orderInclude,
    });

  const prior = await findExisting();
  if (prior) return { order: toOrderDto(prior), replayed: true };

  const address = await prisma.address.findFirst({
    where: { id: input.addressId, userId, deletedAt: null },
  });
  if (!address)
    throw unprocessable('Shipping address not found', [
      { path: 'addressId', message: 'Unknown address' },
    ]);

  try {
    const created = await prisma.$transaction(async (tx) => {
      // Read cart + CURRENT prices inside the transaction so totals reflect committed data.
      const cartItems = await tx.cartItem.findMany({
        where: { cart: { userId } },
        include: { product: true },
        orderBy: { productId: 'asc' }, // consistent lock order prevents deadlocks between checkouts
      });
      if (cartItems.length === 0) throw unprocessable('Your cart is empty');
      for (const ci of cartItems) {
        if (!ci.product.isActive || ci.product.deletedAt) {
          throw conflict(`"${ci.product.name}" is no longer available`, 'PRODUCT_UNAVAILABLE');
        }
      }

      /*
       * OVERSELL PREVENTION: a single atomic conditional UPDATE per product. PostgreSQL takes a
       * row lock, re-checks "quantity >= n" against the latest committed value and either
       * decrements or matches zero rows. Two concurrent checkouts for the last unit therefore
       * serialize on the row: exactly one wins. A CHECK (quantity >= 0) constraint backs it up.
       */
      for (const ci of cartItems) {
        const updated = await tx.$executeRaw`
          UPDATE "Inventory" SET "quantity" = "quantity" - ${ci.quantity}, "updatedAt" = now()
          WHERE "productId" = ${ci.productId}::uuid AND "quantity" >= ${ci.quantity}`;
        if (updated !== 1) {
          throw conflict(`Not enough stock for "${ci.product.name}"`, 'INSUFFICIENT_STOCK', {
            productId: ci.productId,
          });
        }
      }

      const lines = cartItems.map((ci) => ({
        unitPriceMinor: ci.product.priceMinor,
        quantity: ci.quantity,
      }));
      const subtotal = lines.reduce((n, l) => n + l.unitPriceMinor * l.quantity, 0);
      const coupon = await loadCoupon(tx, input.couponCode, subtotal);
      if (coupon) {
        const used = await tx.$executeRaw`
          UPDATE "Coupon" SET "usedCount" = "usedCount" + 1
          WHERE "id" = ${coupon.id}::uuid AND "active" = true AND ("maxUses" IS NULL OR "usedCount" < "maxUses")`;
        if (used !== 1) throw unprocessable('This coupon is no longer available');
      }
      const totals = computeTotals(
        lines,
        input.shippingMethod,
        coupon && { type: coupon.type, value: coupon.value },
      );

      const order = await tx.order.create({
        data: {
          userId,
          idempotencyKey,
          shippingMethod: input.shippingMethod,
          couponId: coupon?.id ?? null,
          couponCode: coupon?.code ?? null,
          ...totals,
          shipName: address.fullName,
          shipPhone: address.phone,
          shipLine1: address.line1,
          shipLine2: address.line2,
          shipCity: address.city,
          shipState: address.state,
          shipPostalCode: address.postalCode,
          shipCountry: address.country,
          items: {
            // Historical snapshot: later catalog edits never change existing orders.
            create: cartItems.map((ci) => ({
              productId: ci.productId,
              sku: ci.product.sku,
              name: ci.product.name,
              unitPriceMinor: ci.product.priceMinor,
              quantity: ci.quantity,
              lineTotalMinor: ci.product.priceMinor * ci.quantity,
            })),
          },
          payment: {
            create: {
              provider: PROVIDER,
              providerOrderId: `mock_order_${randomToken(12)}`,
              amountMinor: totals.totalMinor,
            },
          },
          history: {
            create: { status: 'PENDING_PAYMENT', note: 'Order placed, awaiting payment' },
          },
        },
        include: orderInclude,
      });
      await tx.cartItem.deleteMany({ where: { cart: { userId } } });
      return order;
    });
    await audit(userId, 'order.created', 'Order', created.id, { totalMinor: created.totalMinor });
    return { order: toOrderDto(created), replayed: false };
  } catch (err) {
    // Two simultaneous requests with the same Idempotency-Key: the loser returns the winner's order.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await findExisting();
      if (existing) return { order: toOrderDto(existing), replayed: true };
    }
    throw err;
  }
}

/** Return reserved stock (and the coupon use) to the shelf. Call only after winning a status transition. */
async function releaseReservation(tx: Tx, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true },
  });
  for (const it of order.items) {
    await tx.$executeRaw`
      UPDATE "Inventory" SET "quantity" = "quantity" + ${it.quantity}, "updatedAt" = now()
      WHERE "productId" = ${it.productId}::uuid`;
  }
  if (order.couponId) {
    await tx.$executeRaw`UPDATE "Coupon" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE "id" = ${order.couponId}::uuid`;
  }
}

export async function listOrders(userId: string, page: number, pageSize = 10) {
  const where = { userId };
  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { items: rows.map(toOrderDto), page, pageSize, total };
}

/** Object-level authorization: ownership is part of the query, so foreign ids behave like missing ones. */
export async function getOrder(userId: string, orderId: string) {
  const o = await prisma.order.findFirst({ where: { id: orderId, userId }, include: orderInclude });
  if (!o) throw notFound('Order not found');
  return toOrderDto(o);
}

export async function cancelOrderByCustomer(userId: string, orderId: string) {
  await prisma.$transaction(async (tx) => {
    const won = await tx.order.updateMany({
      where: { id: orderId, userId, status: 'PENDING_PAYMENT' },
      data: { status: 'CANCELLED' },
    });
    if (won.count !== 1) {
      const exists = await tx.order.findFirst({
        where: { id: orderId, userId },
        select: { id: true },
      });
      if (!exists) throw notFound('Order not found');
      throw conflict(
        'Only orders awaiting payment can be cancelled by the customer',
        'NOT_CANCELLABLE',
      );
    }
    await tx.payment.updateMany({
      where: { orderId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    await tx.orderStatusHistory.create({
      data: { orderId, status: 'CANCELLED', note: 'Cancelled by customer' },
    });
    await releaseReservation(tx, orderId);
  });
  await audit(userId, 'order.cancelled', 'Order', orderId);
  return getOrder(userId, orderId);
}

/* ------------------------------ payments (mock provider) ------------------------------ */

export const signPayload = (rawBody: string | Buffer) =>
  hmacHex(env.PAYMENT_WEBHOOK_SECRET, rawBody);

/**
 * Entry point for provider webhooks. The signature is verified over the RAW bytes with a
 * constant-time comparison BEFORE anything is parsed or trusted.
 */
export async function handleWebhook(rawBody: Buffer, signature: string | undefined) {
  if (!signature || !safeEqual(signature, signPayload(rawBody))) {
    throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid webhook signature');
  }
  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw badRequest('Malformed JSON body', 'INVALID_JSON');
  }
  const parsed = webhookEventSchema.safeParse(json);
  if (!parsed.success) throw badRequest('Invalid webhook payload', 'INVALID_PAYLOAD');
  const event = parsed.data;
  if (Math.abs(Date.now() / 1000 - event.timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    throw new AppError(400, 'STALE_EVENT', 'Webhook timestamp outside tolerance');
  }
  return processPaymentEvent(event);
}

/** Idempotent: replaying the same event (same eventId) or a late duplicate changes nothing. */
export async function processPaymentEvent(event: WebhookEventPayload) {
  return prisma.$transaction(async (tx) => {
    // 1) Idempotency ledger. ON CONFLICT DO NOTHING -> 0 rows means "already processed".
    const inserted = await tx.$executeRaw`
      INSERT INTO "WebhookEvent" ("provider", "eventId") VALUES (${PROVIDER}, ${event.eventId})
      ON CONFLICT ("provider", "eventId") DO NOTHING`;
    if (inserted === 0) return { status: 'duplicate' as const };

    const payment = await tx.payment.findUnique({
      where: { providerOrderId: event.providerOrderId },
    });
    if (!payment) {
      logger.warn({ eventId: event.eventId }, 'webhook for unknown payment ignored');
      return { status: 'ignored' as const };
    }

    if (event.type === 'payment.succeeded') {
      const paid = await tx.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: {
          status: 'SUCCEEDED',
          providerPaymentId: event.providerPaymentId ?? `mock_pay_${randomToken(9)}`,
        },
      });
      if (paid.count !== 1) return { status: 'noop' as const };
      const moved = await tx.order.updateMany({
        where: { id: payment.orderId, status: 'PENDING_PAYMENT' },
        data: { status: 'PAID' },
      });
      if (moved.count === 1) {
        await tx.orderStatusHistory.create({
          data: {
            orderId: payment.orderId,
            status: 'PAID',
            note: 'Payment received (mock provider)',
          },
        });
        return { status: 'paid' as const, orderId: payment.orderId };
      }
      // Payment arrived for an order that is no longer payable (e.g. cancelled): flag for refund.
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
      logger.warn(
        { orderId: payment.orderId },
        'late payment for non-pending order marked refunded',
      );
      return { status: 'refunded_late' as const };
    }

    const failed = await tx.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    if (failed.count !== 1) return { status: 'noop' as const };
    const cancelled = await tx.order.updateMany({
      where: { id: payment.orderId, status: 'PENDING_PAYMENT' },
      data: { status: 'CANCELLED' },
    });
    if (cancelled.count === 1) {
      await tx.orderStatusHistory.create({
        data: { orderId: payment.orderId, status: 'CANCELLED', note: 'Payment failed' },
      });
      await releaseReservation(tx, payment.orderId);
    }
    return { status: 'failed' as const, orderId: payment.orderId };
  });
}

/** LOCAL DEVELOPMENT ONLY: simulates the provider by sending a correctly signed event through the real webhook path. */
export async function simulateMockPayment(
  userId: string,
  orderId: string,
  outcome: 'success' | 'failure',
) {
  if (env.PAYMENT_PROVIDER !== 'mock') throw new AppError(404, 'NOT_FOUND', 'Not found');
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: { payment: true },
  });
  if (!order || !order.payment) throw notFound('Order not found');
  if (order.status !== 'PENDING_PAYMENT')
    throw conflict('This order is not awaiting payment', 'NOT_PAYABLE');
  const payload: WebhookEventPayload = {
    eventId: `evt_${randomToken(12)}`,
    type: outcome === 'success' ? 'payment.succeeded' : 'payment.failed',
    providerOrderId: order.payment.providerOrderId,
    providerPaymentId: outcome === 'success' ? `mock_pay_${randomToken(9)}` : undefined,
    timestamp: Math.floor(Date.now() / 1000),
  };
  const raw = Buffer.from(JSON.stringify(payload));
  await handleWebhook(raw, signPayload(raw));
  return getOrder(userId, orderId);
}

/* ----------------------------- admin order operations ----------------------------- */

export async function changeOrderStatus(
  actorId: string,
  orderId: string,
  next: OrderStatus,
  note?: string,
) {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw notFound('Order not found');
    if (!ORDER_TRANSITIONS[order.status].includes(next)) {
      throw conflict(`Cannot change order from ${order.status} to ${next}`, 'INVALID_TRANSITION');
    }
    // Compare-and-set on the current status protects against two admins racing.
    const won = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: next },
    });
    if (won.count !== 1)
      throw conflict('Order was changed by someone else, please reload', 'STALE_STATE');
    await tx.orderStatusHistory.create({
      data: { orderId, status: next, note: note ?? `Status set to ${next} by admin` },
    });
    if (next === 'CANCELLED' || (next === 'REFUNDED' && order.status !== 'DELIVERED')) {
      await releaseReservation(tx, orderId);
    }
    if (next === 'CANCELLED')
      await tx.payment.updateMany({
        where: { orderId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
    if (next === 'CANCELLED' || next === 'REFUNDED') {
      await tx.payment.updateMany({
        where: { orderId, status: 'SUCCEEDED' },
        data: { status: 'REFUNDED' },
      });
    }
    return { from: order.status, to: next };
  });
  await audit(actorId, 'admin.order_status_changed', 'Order', orderId, result);
  return result;
}
