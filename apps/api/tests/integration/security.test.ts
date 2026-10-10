import { beforeEach, describe, expect, it } from 'vitest';
import {
  API,
  ORIGIN,
  PASSWORD,
  loginAs,
  makeApp,
  makeProduct,
  makeUser,
  request,
  resetData,
} from '../helpers';

beforeEach(resetData);
const app = makeApp();

describe('HTTP security headers and error hygiene', () => {
  it('sets hardening headers and hides the framework', async () => {
    const res = await request(app).get(`${API}/health`);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('returns a uniform error shape with a request id and no stack traces', async () => {
    const res = await request(app).get(`${API}/nope`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts|node_modules|stack/i);
  });

  it('handles malformed JSON (400) and oversized bodies (413) cleanly', async () => {
    const bad = await request(app)
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');
    const big = await request(app)
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email: 'a@b.test', password: 'x'.repeat(200_000) });
    expect(big.status).toBe(413);
  });

  it('does not echo submitted values in validation errors', async () => {
    const res = await request(app)
      .post(`${API}/auth/register`)
      .set('Origin', ORIGIN)
      .send({ email: 'x@example.test', password: 'SuperSecretValue1', name: '' });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).not.toContain('SuperSecretValue1');
  });

  it('accepts a sane inbound request id and replaces a malicious one', async () => {
    expect(
      (await request(app).get(`${API}/health`).set('X-Request-Id', 'trace-1234-abcd')).headers[
        'x-request-id'
      ],
    ).toBe('trace-1234-abcd');
    const evil = await request(app)
      .get(`${API}/health`)
      .set('X-Request-Id', 'bad id with spaces; <script>');
    expect(evil.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('CORS', () => {
  it('only reflects allow-listed origins and supports credentials for them', async () => {
    const ok = await request(app).get(`${API}/health`).set('Origin', ORIGIN);
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const evil = await request(app).get(`${API}/health`).set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('rate limiting', () => {
  it('throttles repeated login attempts per IP+email with 429', async () => {
    const limited = makeApp({ login: 3 });
    const user = await makeUser();
    const attempt = () =>
      request(limited)
        .post(`${API}/auth/login`)
        .set('Origin', ORIGIN)
        .send({ email: user.email, password: 'Wrong-password-1' });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await attempt()).status);
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes.slice(3)).toEqual([429, 429]);
    const res = await attempt();
    expect(res.body.error.code).toBe('RATE_LIMITED');
    // A different account is not affected by the first account's throttle.
    const other = await makeUser();
    expect(
      (
        await request(limited)
          .post(`${API}/auth/login`)
          .set('Origin', ORIGIN)
          .send({ email: other.email, password: PASSWORD })
      ).status,
    ).toBe(200);
  });

  it('throttles registration and password-reset requests', async () => {
    const limited = makeApp({ register: 2, passwordReset: 2 });
    const reg = (i: number) =>
      request(limited)
        .post(`${API}/auth/register`)
        .set('Origin', ORIGIN)
        .send({ email: `r${i}@example.test`, password: PASSWORD, name: 'R' });
    expect([(await reg(1)).status, (await reg(2)).status, (await reg(3)).status]).toEqual([
      202, 202, 429,
    ]);
    const forgot = () =>
      request(limited)
        .post(`${API}/auth/forgot-password`)
        .set('Origin', ORIGIN)
        .send({ email: 'x@example.test' });
    expect([(await forgot()).status, (await forgot()).status, (await forgot()).status]).toEqual([
      202, 202, 429,
    ]);
  });
});

describe('health and misc', () => {
  it('reports liveness and readiness (database reachable)', async () => {
    expect((await request(app).get(`${API}/health`)).body.status).toBe('ok');
    expect((await request(app).get(`${API}/ready`)).body.status).toBe('ready');
  });

  it('stores support messages with validation', async () => {
    const good = await request(app).post(`${API}/support/messages`).set('Origin', ORIGIN).send({
      name: 'A',
      email: 'a@example.test',
      subject: 'Help me',
      message: 'My order has not arrived yet.',
    });
    expect(good.status).toBe(201);
    expect(
      (
        await request(app)
          .post(`${API}/support/messages`)
          .set('Origin', ORIGIN)
          .send({ name: 'A', email: 'bad', subject: 'x', message: 'y' })
      ).status,
    ).toBe(422);
  });

  it('wishlist add/remove works and is per-user', async () => {
    const p = await makeProduct();
    const a = await loginAs(app, await makeUser());
    const b = await loginAs(app, await makeUser());
    await a.agent.put(`${API}/wishlist/${p.id}`).set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf);
    expect((await a.agent.get(`${API}/wishlist`)).body.items).toHaveLength(1);
    expect((await b.agent.get(`${API}/wishlist`)).body.items).toHaveLength(0);
    await a.agent
      .delete(`${API}/wishlist/${p.id}`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', a.csrf);
    expect((await a.agent.get(`${API}/wishlist`)).body.items).toHaveLength(0);
  });
});
