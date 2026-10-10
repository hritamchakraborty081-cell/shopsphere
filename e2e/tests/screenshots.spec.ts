import { test } from '@playwright/test';
import { demo, signIn } from './helpers';

// Run only on demand:  SCREENSHOTS=1 npm run test:e2e -- screenshots
test.skip(!process.env.SCREENSHOTS, 'screenshot capture is opt-in (set SCREENSHOTS=1)');
const out = (name: string) => ({ path: `../docs/screenshots/${name}.png`, fullPage: false });

test('capture desktop screenshots of key pages', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 860 });
  await page.goto('/');
  await page
    .getByRole('link', { name: /Electronics/ })
    .first()
    .waitFor();
  await page.locator('article').first().waitFor();
  await page.waitForLoadState('networkidle');
  await page.screenshot(out('01-home'));
  await page.goto('/products?category=electronics');
  await page.getByText('5 results').waitFor();
  await page.locator('article img').first().waitFor();
  await page.waitForLoadState('networkidle');
  await page.screenshot(out('02-listing'));
  await page.getByRole('link', { name: 'Aurora Wireless Earbuds Pro' }).first().click();
  await page.getByRole('heading', { name: 'Aurora Wireless Earbuds Pro' }).waitFor();
  await page.waitForLoadState('networkidle');
  await page.screenshot(out('03-product'));
  await signIn(page, demo.customer);
  await page.goto('/products/aurora-wireless-earbuds-pro-elec-1001');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.getByText('Added to cart').waitFor();
  await page.goto('/cart');
  await page.getByRole('heading', { name: 'Shopping cart' }).waitFor();
  await page.screenshot(out('04-cart'));
  await page.goto('/checkout');
  await page.getByRole('heading', { name: 'Checkout' }).waitFor();
  await page.screenshot(out('05-checkout'));
  await page.goto('/orders');
  await page.getByRole('heading', { name: /Your orders/ }).waitFor();
  await page.screenshot(out('06-orders'));
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await signIn(page, demo.admin);
  await page.goto('/admin');
  await page.getByText('Revenue (paid orders)').waitFor();
  await page.screenshot(out('07-admin'));
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('capture mobile screenshot', async ({ page }) => {
    await page.goto('/products?category=books');
    await page.getByText('5 results').waitFor();
    await page.screenshot(out('08-mobile-listing'));
  });
});
