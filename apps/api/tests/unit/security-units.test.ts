import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { ORDER_TRANSITIONS, formatPaise } from '@shopsphere/shared';
import { parseEnv } from '../../src/config/env';
import { hmacHex, randomToken, safeEqual, sha256 } from '../../src/utils/crypto';
import { REDACT_PATHS } from '../../src/utils/logger';
import { passwordSchema } from '../../src/modules/auth/auth.schemas';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  CORS_ORIGINS: 'https://shop.example',
  APP_URL: 'https://shop.example',
  PAYMENT_WEBHOOK_SECRET: 'a'.repeat(40),
  NODE_ENV: 'production',
  COOKIE_SECURE: 'true',
};

describe('environment validation', () => {
  it('accepts a valid production config', () => expect(parseEnv({ ...base })).toBeTruthy());
  it('refuses the dev outbox in production', () =>
    expect(() => parseEnv({ ...base, ENABLE_DEV_OUTBOX: 'true' })).toThrow(/ENABLE_DEV_OUTBOX/));
  it('refuses insecure cookies in production', () =>
    expect(() => parseEnv({ ...base, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/));
  it('refuses placeholder webhook secrets in production', () =>
    expect(() =>
      parseEnv({ ...base, PAYMENT_WEBHOOK_SECRET: 'CHANGE_ME_' + 'x'.repeat(30) }),
    ).toThrow(/PAYMENT_WEBHOOK_SECRET/));
  it('does not echo secret values in error messages', () => {
    try {
      parseEnv({ ...base, DATABASE_URL: 'not-a-url-with-secret-hunter2' });
    } catch (e) {
      expect(String(e)).not.toContain('hunter2');
    }
  });
});

describe('crypto helpers', () => {
  it('generates unique 256-bit tokens', () => {
    expect(randomToken()).not.toBe(randomToken());
    expect(randomToken().length).toBeGreaterThanOrEqual(43);
  });
  it('hashes deterministically and compares in constant time', () => {
    expect(sha256('a')).toBe(sha256('a'));
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(hmacHex('k', 'm')).toHaveLength(64);
  });
});

describe('log redaction', () => {
  it('removes passwords, cookies and tokens from log lines', () => {
    let out = '';
    const sink = new Writable({
      write(chunk, _e, cb) {
        out += chunk.toString();
        cb();
      },
    });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, sink);
    log.info(
      {
        req: { headers: { cookie: 'sid=SECRETCOOKIE', authorization: 'Bearer SECRETBEARER' } },
        body: { password: 'SECRETPASS', token: 'SECRETTOKEN', email: 'a@b.test' },
      },
      'x',
    );
    for (const s of ['SECRETCOOKIE', 'SECRETBEARER', 'SECRETPASS', 'SECRETTOKEN', 'a@b.test'])
      expect(out).not.toContain(s);
  });
});

describe('password policy', () => {
  it.each(['short1', 'onlyletterslongenough', '1234567890123', 'Password123'])('rejects %s', (p) =>
    expect(passwordSchema.safeParse(p).success).toBe(false),
  );
  it('accepts a strong password', () =>
    expect(passwordSchema.safeParse('correct-horse-9-battery').success).toBe(true));
});

describe('shared helpers', () => {
  it('formats paise as rupees', () => expect(formatPaise(129900)).toContain('1,299.00'));
  it('does not allow leaving terminal order states', () => {
    expect(ORDER_TRANSITIONS.CANCELLED).toEqual([]);
    expect(ORDER_TRANSITIONS.REFUNDED).toEqual([]);
    expect(ORDER_TRANSITIONS.PENDING_PAYMENT).not.toContain('SHIPPED');
  });
});
