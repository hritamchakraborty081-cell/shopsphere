import { expect, test } from '@playwright/test';
import { demo, signIn } from './helpers';

// Meaningful when the web app is served by the production nginx config (E2E_EXPECT_CSP=1), which sends the CSP header.
test('main pages work under the production Content-Security-Policy with zero violations', async ({
  page,
}) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy|refused to (apply|load|execute)/i.test(m.text()))
      violations.push(m.text());
  });
  page.on('pageerror', (e) => violations.push(`pageerror: ${e.message}`));

  const res = await page.goto('/');
  if (process.env.E2E_EXPECT_CSP) {
    const csp = res?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res?.headers()['x-content-type-options']).toBe('nosniff');
  }
  await page.locator('article').first().waitFor();
  await page.goto('/products?category=books');
  await page.getByText('5 results').waitFor();
  await page.getByRole('link', { name: 'Python for Problem Solving' }).first().click();
  await page.getByRole('heading', { name: 'Python for Problem Solving' }).waitFor();
  await signIn(page, demo.customer);
  await page.goto('/orders');
  await page.getByRole('heading', { name: /Your orders/ }).waitFor();
  await page.goto('/checkout').catch(() => undefined);
  await page.goto('/support');
  await page.getByRole('heading', { name: 'Contact support' }).waitFor();
  await page.waitForLoadState('networkidle');
  expect(violations, violations.join('\n')).toEqual([]);
});
