import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { ah, parse } from '../../utils/http';
import { emailSchema } from '../auth/auth.schemas';

const schema = z
  .object({
    name: z.string().trim().min(1).max(80),
    email: emailSchema,
    subject: z.string().trim().min(3).max(120),
    message: z.string().trim().min(10).max(2000),
  })
  .strict();

export function supportRouter(limiter: import('express').RequestHandler) {
  const r = Router();
  r.post(
    '/messages',
    limiter,
    ah(async (req, res) => {
      const data = parse(schema, req.body);
      await prisma.supportMessage.create({ data: { ...data, userId: req.auth?.user.id ?? null } });
      res.status(201).json({ message: 'Thanks! Our team will get back to you by email.' });
    }),
  );
  return r;
}
