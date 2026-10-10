import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { currentUser, requireAuth } from '../../middleware/auth';
import { changePassword } from '../auth/auth.service';
import { passwordSchema } from '../auth/auth.schemas';
import { audit } from '../../services/audit';
import { conflict, notFound } from '../../utils/errors';
import { ah, parse } from '../../utils/http';

const MAX_ADDRESSES = 10;

// All fields are explicitly allow-listed (+ .strict()) -> no mass assignment of userId/isDeleted etc.
const addressSchema = z
  .object({
    fullName: z.string().trim().min(1).max(80),
    phone: z
      .string()
      .trim()
      .regex(/^[0-9+\-\s]{7,15}$/, 'Invalid phone number'),
    line1: z.string().trim().min(3).max(120),
    line2: z.string().trim().max(120).optional().nullable(),
    city: z.string().trim().min(2).max(60),
    state: z.string().trim().min(2).max(60),
    postalCode: z
      .string()
      .trim()
      .regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code'),
    isDefault: z.boolean().optional(),
  })
  .strict();

const profileSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
const passwordChangeSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
  .strict();

const addrSelect = {
  id: true,
  fullName: true,
  phone: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  isDefault: true,
} as const;

export function usersRouter() {
  const r = Router();
  r.use(requireAuth);

  r.get('/me', (req, res) => {
    const u = currentUser(req);
    res.json({
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        emailVerified: !!u.emailVerifiedAt,
      },
    });
  });

  r.patch(
    '/me',
    ah(async (req, res) => {
      const { name } = parse(profileSchema, req.body);
      const u = await prisma.user.update({ where: { id: currentUser(req).id }, data: { name } });
      res.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role } });
    }),
  );

  r.post(
    '/me/password',
    ah(async (req, res) => {
      const { currentPassword, newPassword } = parse(passwordChangeSchema, req.body);
      await changePassword(currentUser(req).id, currentPassword, newPassword, req.auth!.sessionId);
      res.json({ message: 'Password changed. Other devices were signed out.' });
    }),
  );

  r.get(
    '/me/addresses',
    ah(async (req, res) => {
      const items = await prisma.address.findMany({
        where: { userId: currentUser(req).id, deletedAt: null },
        select: addrSelect,
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });
      res.json({ items });
    }),
  );

  r.post(
    '/me/addresses',
    ah(async (req, res) => {
      const userId = currentUser(req).id;
      const data = parse(addressSchema, req.body);
      const count = await prisma.address.count({ where: { userId, deletedAt: null } });
      if (count >= MAX_ADDRESSES)
        throw conflict(`You can save up to ${MAX_ADDRESSES} addresses`, 'ADDRESS_LIMIT');
      const makeDefault = data.isDefault || count === 0;
      const created = await prisma.$transaction(async (tx) => {
        if (makeDefault)
          await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
        return tx.address.create({
          data: { ...data, userId, isDefault: makeDefault },
          select: addrSelect,
        });
      });
      res.status(201).json({ address: created });
    }),
  );

  r.patch(
    '/me/addresses/:id',
    ah(async (req, res) => {
      const userId = currentUser(req).id;
      const id = parse(z.string().uuid(), req.params.id);
      const data = parse(addressSchema.partial(), req.body);
      // Object-level authorization: the owner is part of the lookup, so another user's id is a 404.
      const existing = await prisma.address.findFirst({ where: { id, userId, deletedAt: null } });
      if (!existing) throw notFound('Address not found');
      const updated = await prisma.$transaction(async (tx) => {
        if (data.isDefault)
          await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
        return tx.address.update({ where: { id }, data, select: addrSelect });
      });
      res.json({ address: updated });
    }),
  );

  r.delete(
    '/me/addresses/:id',
    ah(async (req, res) => {
      const userId = currentUser(req).id;
      const id = parse(z.string().uuid(), req.params.id);
      const result = await prisma.address.updateMany({
        where: { id, userId, deletedAt: null },
        data: { deletedAt: new Date(), isDefault: false },
      });
      if (result.count === 0) throw notFound('Address not found');
      res.status(204).end();
    }),
  );

  r.delete(
    '/me',
    ah(async (req, res) => {
      // Account deactivation (soft delete) + session revocation; data retention is documented.
      const userId = currentUser(req).id;
      await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
      await prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await audit(userId, 'user.deactivated', 'User', userId);
      res.status(204).end();
    }),
  );

  return r;
}
