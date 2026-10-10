import { expect, test } from '@playwright/test';

test('mobile layout: hamburger menu, search and product grid are usable', async ({ page }) => {
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Open menu' });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole('navigation', { name: 'Mobile' })).toBeVisible();
  await page.getByRole('link', { name: 'All products' }).click();
  await expect(page.locator('article').first()).toBeVisible();
  // no horizontal scrolling on small screens
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
