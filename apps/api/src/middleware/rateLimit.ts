import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { AppError } from '../utils/errors';

export interface RateLimitConfig {
  global: number;
  auth: number;
  login: number;
  register: number;
  passwordReset: number;
  checkout: number;
}

export const DEFAULT_LIMITS: RateLimitConfig = {
  global: 600, // per 15 min per IP
  auth: 100, // all /auth POSTs per 15 min per IP
  login: 10, // per IP+email per 15 min
  register: 10, // per hour per IP
  passwordReset: 5, // per hour per IP
  checkout: 30, // per 15 min per IP
};

const make = (windowMs: number, limit: number, keyGenerator?: (req: Request) => string) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many requests, please try again later')),
  });

const MIN15 = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const ip = (req: Request) => req.ip ?? 'unknown';
const emailOf = (req: Request) =>
  typeof req.body?.email === 'string' ? req.body.email.toLowerCase().slice(0, 254) : '';

/**
 * Limiters are created per app instance. NOTE: the default store is in-memory, so limits are
 * per process. Behind several instances, use a shared store (e.g. Redis) - documented limitation.
 */
export function createLimiters(cfg: RateLimitConfig) {
  return {
    global: make(MIN15, cfg.global, ip),
    auth: make(MIN15, cfg.auth, ip),
    login: make(MIN15, cfg.login, (req) => `${ip(req)}|${emailOf(req)}`),
    register: make(HOUR, cfg.register, ip),
    passwordReset: make(HOUR, cfg.passwordReset, ip),
    checkout: make(MIN15, cfg.checkout, ip),
  };
}
