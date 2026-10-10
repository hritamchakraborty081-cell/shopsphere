import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, safeRedirect, setCsrfToken } from '../lib/api';

afterEach(() => {
  vi.restoreAllMocks();
  setCsrfToken(null);
});

describe('safeRedirect (open-redirect protection)', () => {
  it.each([
    ['/orders', '/orders'],
    ['/products?q=a', '/products?q=a'],
  ])('allows %s', (input, out) => expect(safeRedirect(input)).toBe(out));
  it.each([
    '//evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '/\\evil.example',
    '',
    null,
    undefined,
  ])('rejects %s', (input) => expect(safeRedirect(input as string)).toBe('/'));
});

describe('api client', () => {
  it('sends the CSRF header only on mutating requests, with same-origin credentials', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    setCsrfToken('tok123');
    await api('/cart');
    await api('/cart/items', { method: 'POST', body: { a: 1 } });
    const [get, post] = spy.mock.calls.map((c) => c[1] as RequestInit);
    expect((get!.headers as Record<string, string>)['X-CSRF-Token']).toBeUndefined();
    expect((post!.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok123');
    expect(post!.credentials).toBe('same-origin');
  });

  it('turns API error bodies into ApiError and never stores tokens in web storage', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'INSUFFICIENT_STOCK', message: 'Only 1 left' } }),
        { status: 409 },
      ),
    );
    await expect(api('/x')).rejects.toMatchObject({
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      message: 'Only 1 left',
    });
    setCsrfToken('secret-token');
    expect(JSON.stringify({ ...localStorage })).not.toContain('secret-token');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('secret-token');
  });

  it('reports network failures with a friendly message', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed'));
    const err = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('NETWORK_ERROR');
  });
});
