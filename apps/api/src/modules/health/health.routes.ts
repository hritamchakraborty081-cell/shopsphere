import { Router } from 'express';
import { prisma } from '../../db/prisma';
import { env } from '../../config/env';
import { clearOutbox, getOutbox } from '../../services/mailer';
import { ah } from '../../utils/http';

export function healthRouter() {
  const r = Router();
  r.get('/health', (_req, res) => res.json({ status: 'ok', uptime: Math.round(process.uptime()) }));
  r.get(
    '/ready',
    ah(async (_req, res) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: 'ready' });
      } catch {
        res.status(503).json({ status: 'unavailable' }); // no internals leaked
      }
    }),
  );
  return r;
}

/** DEVELOPMENT ONLY. Never mounted in production (env validation also forbids the flag there). */
export function devOutboxRouter() {
  const r = Router();
  if (!env.ENABLE_DEV_OUTBOX || env.NODE_ENV === 'production') return r;
  r.get('/outbox', (_req, res) => res.json({ items: getOutbox() }));
  r.delete('/outbox', (_req, res) => {
    clearOutbox();
    res.status(204).end();
  });
  return r;
}
