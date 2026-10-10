import { beforeEach, describe, expect, it } from 'vitest';
import {
  API,
  ORIGIN,
  PASSWORD,
  lastLinkToken,
  loginAs,
  makeApp,
  makeUser,
  prisma,
  request,
  resetData,
  send,
} from '../helpers';
import { getOutbox } from '../../src/services/mailer';
import { sha256 } from '../../src/utils/crypto';

const app = makeApp();
beforeEach(resetData);

const register = (body: object) =>
  request(app).post(`${API}/auth/register`).set('Origin', ORIGIN).send(body);

describe('registration + email verification', () => {
  it('registers, verifies the email once, then logs in', async () => {
    const email = 'new.user@example.test';
    const res = await register({ email, password: PASSWORD, name: 'New User' });
    expect(res.status).toBe(202);
    const token = lastLinkToken(email);
    const ok = await request(app)
      .post(`${API}/auth/verify-email`)
      .set('Origin', ORIGIN)
      .send({ token });
    expect(ok.status).toBe(200);
    const again = await request(app)
      .post(`${API}/auth/verify-email`)
      .set('Origin', ORIGIN)
      .send({ token });
    expect(again.status).toBe(400); // single-use
    const login = await request(app)
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.emailVerified).toBe(true);
  });

  it('stores only an Argon2id hash, never the plaintext password', async () => {
    await register({ email: 'hash@example.test', password: PASSWORD, name: 'H' });
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'hash@example.test' } });
    expect(u.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(u.passwordHash).not.toContain(PASSWORD);
  });

  it('responds identically for an already-registered email (no account enumeration)', async () => {
    await makeUser({ email: 'taken@example.test' });
    const res = await register({ email: 'taken@example.test', password: PASSWORD, name: 'X' });
    const fresh = await register({ email: 'fresh@example.test', password: PASSWORD, name: 'X' });
    expect(res.status).toBe(fresh.status);
    expect(res.body).toEqual(fresh.body);
    expect(await prisma.user.count({ where: { email: 'taken@example.test' } })).toBe(1);
  });

  it('rejects weak passwords and unknown fields (mass assignment)', async () => {
    expect((await register({ email: 'a@example.test', password: 'short', name: 'A' })).status).toBe(
      422,
    );
    const res = await register({
      email: 'b@example.test',
      password: PASSWORD,
      name: 'B',
      role: 'ADMIN',
    });
    expect(res.status).toBe(422);
    expect(await prisma.user.count({ where: { email: 'b@example.test' } })).toBe(0);
  });

  it('rejects an expired verification token', async () => {
    await register({ email: 'exp@example.test', password: PASSWORD, name: 'E' });
    const token = lastLinkToken('exp@example.test');
    await prisma.emailVerificationToken.updateMany({
      where: { tokenHash: sha256(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      (await request(app).post(`${API}/auth/verify-email`).set('Origin', ORIGIN).send({ token }))
        .status,
    ).toBe(400);
  });
});

describe('login, session and logout', () => {
  it('logs in with an HttpOnly cookie, exposes /me, and logs out (revoking the session)', async () => {
    const user = await makeUser();
    const login = await request(app)
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email: user.email, password: PASSWORD });
    expect(login.status).toBe(200);
    const cookie = String(login.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(login.body)).not.toMatch(/passwordHash/);

    const s = await loginAs(app, user);
    expect((await s.agent.get(`${API}/auth/me`)).body.user.email).toBe(user.email);
    expect((await send(s, 'post', '/auth/logout')).status).toBe(204);
    expect((await s.agent.get(`${API}/auth/me`)).body.user).toBeNull();
    expect((await s.agent.get(`${API}/cart`)).status).toBe(401);
  });

  it('rejects wrong password and unknown user with the same response', async () => {
    const user = await makeUser();
    const a = await request(app)
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email: user.email, password: 'Wrong-password-1' });
    const b = await request(app)
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email: 'nobody@example.test', password: 'Wrong-password-1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.code).toBe(b.body.error.code);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('locks the account after repeated failures, even for the right password, then unlocks', async () => {
    const user = await makeUser();
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post(`${API}/auth/login`)
        .set('Origin', ORIGIN)
        .send({ email: user.email, password: 'Wrong-password-1' });
    }
    const blocked = await request(app)
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email: user.email, password: PASSWORD });
    expect(blocked.status).toBe(401);
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    expect(
      (
        await request(app)
          .post(`${API}/auth/login`)
          .set('Origin', ORIGIN)
          .send({ email: user.email, password: PASSWORD })
      ).status,
    ).toBe(200);
  });

  it('rejects expired, idle-timed-out and revoked sessions', async () => {
    const user = await makeUser();
    const s = await loginAs(app, user);
    expect((await s.agent.get(`${API}/cart`)).status).toBe(200);

    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await s.agent.get(`${API}/cart`)).status).toBe(401); // expired

    const s2 = await loginAs(app, user);
    await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { lastSeenAt: new Date(Date.now() - 25 * 3600 * 1000) },
    });
    expect((await s2.agent.get(`${API}/cart`)).status).toBe(401); // idle timeout

    const s3 = await loginAs(app, user);
    await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    expect((await s3.agent.get(`${API}/cart`)).status).toBe(401); // revoked
  });

  it('does not accept a forged or tampered session cookie', async () => {
    const res = await request(app).get(`${API}/cart`).set('Cookie', 'sid=not-a-real-session-token');
    expect(res.status).toBe(401);
  });
});

describe('CSRF and request hygiene', () => {
  it('rejects mutating requests without the CSRF token, or from a foreign origin', async () => {
    const user = await makeUser();
    const s = await loginAs(app, user);
    const noToken = await s.agent.post(`${API}/auth/logout`).set('Origin', ORIGIN);
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('CSRF_INVALID');
    const badToken = await s.agent
      .post(`${API}/auth/logout`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', 'x'.repeat(32));
    expect(badToken.status).toBe(403);
    const evil = await s.agent
      .post(`${API}/auth/logout`)
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', s.csrf);
    expect(evil.status).toBe(403);
    expect(evil.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    const noOrigin = await s.agent.post(`${API}/auth/logout`).set('X-CSRF-Token', s.csrf);
    expect(noOrigin.status).toBe(403); // cookie present but no Origin/Referer
  });

  it('rejects non-JSON bodies (form posts)', async () => {
    const res = await request(app)
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .type('form')
      .send('email=a@b.test&password=x');
    expect(res.status).toBe(415);
  });
});

describe('password reset', () => {
  it('works once, expires, is invalidated by newer requests, and revokes sessions', async () => {
    const user = await makeUser();
    const s = await loginAs(app, user);
    const forgot = () =>
      request(app)
        .post(`${API}/auth/forgot-password`)
        .set('Origin', ORIGIN)
        .send({ email: user.email });
    expect((await forgot()).status).toBe(202);
    const first = lastLinkToken(user.email);
    expect((await forgot()).status).toBe(202);
    const second = lastLinkToken(user.email);
    const reset = (token: string, password: string) =>
      request(app)
        .post(`${API}/auth/reset-password`)
        .set('Origin', ORIGIN)
        .send({ token, password });

    expect((await reset(first, 'Brand-New-Passw0rd')).status).toBe(400); // superseded by the newer link
    expect((await reset(second, 'weak')).status).toBe(422);
    expect((await reset(second, 'Brand-New-Passw0rd')).status).toBe(200);
    expect((await reset(second, 'Another-Passw0rd-2')).status).toBe(400); // single use
    expect((await s.agent.get(`${API}/cart`)).status).toBe(401); // old sessions revoked
    expect(
      (
        await request(app)
          .post(`${API}/auth/login`)
          .set('Origin', ORIGIN)
          .send({ email: user.email, password: 'Brand-New-Passw0rd' })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`${API}/auth/login`)
          .set('Origin', ORIGIN)
          .send({ email: user.email, password: PASSWORD })
      ).status,
    ).toBe(401);
  });

  it('rejects an expired reset token and gives the same answer for unknown emails', async () => {
    const user = await makeUser();
    await request(app)
      .post(`${API}/auth/forgot-password`)
      .set('Origin', ORIGIN)
      .send({ email: user.email });
    const token = lastLinkToken(user.email);
    await prisma.passwordResetToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      (
        await request(app)
          .post(`${API}/auth/reset-password`)
          .set('Origin', ORIGIN)
          .send({ token, password: 'Brand-New-Passw0rd' })
      ).status,
    ).toBe(400);
    const unknown = await request(app)
      .post(`${API}/auth/forgot-password`)
      .set('Origin', ORIGIN)
      .send({ email: 'ghost@example.test' });
    expect(unknown.status).toBe(202);
    expect(getOutbox().some((m) => m.to === 'ghost@example.test')).toBe(false);
  });

  it('stores reset tokens only as hashes', async () => {
    const user = await makeUser();
    await request(app)
      .post(`${API}/auth/forgot-password`)
      .set('Origin', ORIGIN)
      .send({ email: user.email });
    const token = lastLinkToken(user.email);
    const rows = await prisma.passwordResetToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(token);
    expect(rows[0]!.tokenHash).toBe(sha256(token));
  });
});
