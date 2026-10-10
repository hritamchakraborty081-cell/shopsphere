import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit URL-safe random token. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Tokens are stored only as SHA-256 hashes, so a database leak does not leak usable tokens. */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const hmacHex = (secret: string, payload: string | Buffer): string =>
  createHmac('sha256', secret).update(payload).digest('hex');

/** Constant-time string comparison (safe for differing lengths). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
