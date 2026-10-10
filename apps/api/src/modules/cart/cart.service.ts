import { prisma } from '../../db/prisma';
import { AppError, conflict, notFound } from '../../utils/errors';
import { MAX_PER_ITEM } from '../catalog/catalog.service';

const MAX_DISTINCT_ITEMS = 25;

async function ensureCart(userId: string) {
  return prisma.cart.upsert({ where: { userId }, update: {}, create: { userId } });
}

/** The cart view is always computed from CURRENT server-side prices and stock. */
export async function getCart(userId: string) {
  const cart = await ensureCart(userId);
  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id, product: { isActive: true, deletedAt: null } },
    include: {
      product: { include: { images: { orderBy: { position: 'asc' }, take: 1 }, inventory: true } },
    },
    orderBy: { id: 'asc' },
  });
  const lines = items.map((i) => {
    const available = i.product.inventory?.quantity ?? 0;
    return {
      productId: i.productId,
      slug: i.product.slug,
      name: i.product.name,
      image: i.product.images[0]?.url ?? null,
      unitPriceMinor: i.product.priceMinor,
      quantity: i.quantity,
      lineTotalMinor: i.product.priceMinor * i.quantity,
      available,
      issue:
        available === 0 ? 'OUT_OF_STOCK' : i.quantity > available ? 'INSUFFICIENT_STOCK' : null,
    };
  });
  return {
    items: lines,
    itemCount: lines.reduce((n, l) => n + l.quantity, 0),
    subtotalMinor: lines.reduce((n, l) => n + l.lineTotalMinor, 0),
    hasIssues: lines.some((l) => l.issue !== null),
  };
}

async function activeProductWithStock(productId: string) {
  const p = await prisma.product.findFirst({
    where: { id: productId, isActive: true, deletedAt: null },
    include: { inventory: true },
  });
  if (!p) throw notFound('Product not found');
  return { product: p, available: p.inventory?.quantity ?? 0 };
}

export async function addItem(userId: string, productId: string, quantity: number) {
  const { available } = await activeProductWithStock(productId);
  const cart = await ensureCart(userId);
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_productId: { cartId: cart.id, productId } },
  });
  const target = (existing?.quantity ?? 0) + quantity;
  if (target > MAX_PER_ITEM)
    throw new AppError(422, 'QUANTITY_LIMIT', `You can buy at most ${MAX_PER_ITEM} of one item`);
  if (target > available)
    throw conflict(
      available === 0 ? 'This item is out of stock' : `Only ${available} left in stock`,
      'INSUFFICIENT_STOCK',
      { available },
    );
  if (!existing) {
    const distinct = await prisma.cartItem.count({ where: { cartId: cart.id } });
    if (distinct >= MAX_DISTINCT_ITEMS) throw conflict('Your cart is full', 'CART_FULL');
  }
  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId } },
    update: { quantity: target },
    create: { cartId: cart.id, productId, quantity },
  });
  return getCart(userId);
}

export async function setQuantity(userId: string, productId: string, quantity: number) {
  const cart = await ensureCart(userId);
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_productId: { cartId: cart.id, productId } },
  });
  if (!existing) throw notFound('Item is not in your cart');
  const { available } = await activeProductWithStock(productId);
  if (quantity > available)
    throw conflict(
      available === 0 ? 'This item is out of stock' : `Only ${available} left in stock`,
      'INSUFFICIENT_STOCK',
      { available },
    );
  await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity } });
  return getCart(userId);
}

export async function removeItem(userId: string, productId: string) {
  const cart = await ensureCart(userId);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
  return getCart(userId);
}
