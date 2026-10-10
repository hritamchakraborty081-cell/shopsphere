import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { randomToken, safeEqual, sha256 } from '../utils/crypto';
import { AppError, forbidden, unauthorized } from '../utils/errors';
import { ah } from '../utils/http';
import type { Role } from '../generated/prisma/client';

/** "__Host-" prefix (HTTPS only, no Domain, Path=/) is used whenever cookies are Secure. */
export const SESSION_COOKIE = env.COOKIE_SECURE ? '__Host-sid' : 'sid';
const SESSION_TTL_MS = env.SESSION_TTL_HOURS * 3600 * 1000;
const IDLE_TIMEOUT_MS = 24 * 3600 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const cookieOptions = (): CookieOptions => ({
  httpOnly: true, // not readable by JavaScript -> XSS cannot steal the session id
  secure: env.COOKIE_SECURE,
  sameSite: 'lax', // blocks cross-site POSTs; CSRF token + Origin check are additional layers
  path: '/',
});

export async function createSession(res: Response, userId: string, userAgent?: string) {
  const token = randomToken(32); // 256-bit, only its SHA-256 hash is stored
  const csrfToken = randomToken(24);
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      csrfToken,
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: userAgent?.slice(0, 200),
    },
  });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_TTL_MS });
  return { csrfToken };
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/** Soft authentication: attaches req.auth when a valid session exists; never rejects. */
export const loadSession: RequestHandler = ah(async (req, _res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length === 0 || token.length > 128) return next();
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  const now = Date.now();
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt.getTime() <= now ||
    now - session.lastSeenAt.getTime() > IDLE_TIMEOUT_MS ||
    session.user.deletedAt
  ) {
    return next();
  }
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  const u = session.user;
  req.auth = {
    sessionId: session.id,
    csrfToken: session.csrfToken,
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      emailVerifiedAt: u.emailVerifiedAt,
    },
  };
  next();
});

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function requestOrigin(req: Request): string | null {
  const origin = req.get('origin');
  if (origin) return origin;
  const referer = req.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * CSRF defence in depth for cookie-authenticated APIs:
 *  1. SameSite=Lax cookie, 2. JSON-only bodies (no <form> posts), 3. strict Origin allow-list,
 *  4. per-session CSRF token that must be echoed in the X-CSRF-Token header.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (!UNSAFE_METHODS.has(req.method)) return next();
  const origin = requestOrigin(req);
  const hasCookie = typeof req.cookies?.[SESSION_COOKIE] === 'string';
  if (origin) {
    if (!env.corsOrigins.includes(origin)) {
      return next(forbidden('Origin not allowed', 'ORIGIN_NOT_ALLOWED'));
    }
  } else if (hasCookie) {
    return next(forbidden('Origin header required', 'ORIGIN_REQUIRED'));
  }
  if (req.auth) {
    const sent = req.get('x-csrf-token');
    if (!sent || !safeEqual(sent, req.auth.csrfToken)) {
      return next(forbidden('Invalid or missing CSRF token', 'CSRF_INVALID'));
    }
  }
  next();
};

/** Reject non-JSON bodies on unsafe methods (blocks classic cross-site form posts). */
export const requireJsonBody: RequestHandler = (req, _res, next) => {
  if (UNSAFE_METHODS.has(req.method)) {
    const len = Number(req.get('content-length') ?? 0);
    if (len > 0 && !req.is('application/json')) {
      return next(
        new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json'),
      );
    }
  }
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) =>
  req.auth ? next() : next(unauthorized());

export const requireVerifiedEmail: RequestHandler = (req, _res, next) =>
  req.auth?.user.emailVerifiedAt
    ? next()
    : next(forbidden('Please verify your email address first', 'EMAIL_NOT_VERIFIED'));

/** Server-side RBAC. Always combined with requireAuth; checked on every admin route. */
export const requireRole =
  (role: Role): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    if (req.auth.user.role !== role) return next(forbidden());
    next();
  };

/** Helper for route handlers after requireAuth. */
export const currentUser = (req: Request) => {
  if (!req.auth) throw unauthorized();
  return req.auth.user;
};
