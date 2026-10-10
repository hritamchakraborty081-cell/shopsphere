import { expect, test } from '@playwright/test';
import { demo, signIn } from './helpers';

test('customers cannot reach the admin area, admins can manage products and see audit logs', async ({
  page,
}) => {
  await signIn(page, demo.customer);
  await page.goto('/admin');
  await expect(page).not.toHaveURL(/\/admin/); // UI guard
  const api = await page.request.get('/api/v1/admin/stats');
  expect(api.status()).toBe(403); // the real enforcement is on the server
  await page.getByRole('button', { name: 'Sign out' }).first().click();

  await signIn(page, demo.admin);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
  await expect(page.getByText('Revenue (paid orders)')).toBeVisible();
  await page.getByRole('tab', { name: 'Products' }).click();
  await page.getByLabel('Search admin products').fill('ELEC-1001'); // list is paginated (20/page)
  await expect(page.getByRole('cell', { name: 'ELEC-1001' })).toBeVisible();
  await page.getByRole('tab', { name: 'Orders' }).click();
  await page.getByRole('tab', { name: 'Audit log' }).click();
  await expect(page.getByRole('table', { name: 'Audit log' })).toBeVisible();
});

test('session cookie is HttpOnly and nothing sensitive is kept in web storage', async ({
  page,
  context,
}) => {
  await signIn(page, demo.customer);
  const cookies = await context.cookies();
  const sid = cookies.find((c) => c.name === 'sid');
  expect(sid?.httpOnly).toBe(true);
  expect(sid?.sameSite).toBe('Lax');
  const visible = await page.evaluate(() => document.cookie);
  expect(visible).not.toContain('sid=');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toMatch(/csrf|token|session|sid/i);
});

test('rendered pages contain no inline event-handler attributes (CSP-friendly DOM)', async ({
  page,
}) => {
  // The API-level XSS handling (inert JSON, nosniff) is covered by integration tests.
  await page.goto('/products');
  const inline = await page.locator('[onerror], [onclick], [onload]').count();
  expect(inline).toBe(0);
});

test('API rejects cross-origin and token-less mutations from the browser context', async ({
  page,
}) => {
  await signIn(page, demo.customer);
  const noCsrf = await page.request.post('/api/v1/auth/logout', {
    headers: { Origin: 'http://localhost:5273' },
  });
  expect(noCsrf.status()).toBe(403);
  const evil = await page.request.post('/api/v1/auth/logout', {
    headers: { Origin: 'https://evil.example' },
  });
  expect(evil.status()).toBe(403);
  await page.goto('/orders');
  await expect(page.getByRole('heading', { name: /Your orders|No orders/ })).toBeVisible(); // still signed in
});
