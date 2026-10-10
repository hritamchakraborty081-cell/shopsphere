import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD } from '../env';
import { emailedLink } from './helpers';

test('new customer: register -> verify email -> search -> cart -> checkout -> mock payment -> order tracking', async ({
  page,
  request,
}) => {
  const email = `e2e-${Date.now()}@example.test`;

  // Register
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Eva Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByLabel('Confirm password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  // Verify email via the single-use link (dev outbox)
  const link = await emailedLink(request, email, 'verify-email');
  await page.goto(link);
  await expect(page.getByText('Your email is verified')).toBeVisible();

  // Sign in
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible();

  // Search and open a product
  await page.getByRole('search').first().getByLabel('Search products').fill('earbuds');
  await page.getByRole('search').first().getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/q=earbuds/);
  await expect(
    page.getByRole('link', { name: 'Aurora Wireless Earbuds Pro' }).first(),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Aurora Wireless Earbuds Pro' }).first().click();
  await expect(page.getByRole('heading', { name: 'Aurora Wireless Earbuds Pro' })).toBeVisible();

  // Add to cart
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('Added to cart')).toBeVisible();
  await page.getByRole('link', { name: /Cart, 1 items/ }).click();
  await expect(page.getByRole('heading', { name: 'Shopping cart' })).toBeVisible();
  await page.getByRole('link', { name: 'Proceed to checkout' }).click();

  // Checkout: add an address, apply coupon, place order
  await page.getByLabel('Full name').fill('Eva Tester');
  await page.getByLabel('Phone').fill('9876543210');
  await page.getByLabel('Address line 1').fill('42 Park Street');
  await page.getByLabel('City').fill('Kolkata');
  await page.getByLabel('State').fill('West Bengal');
  await page.getByLabel('PIN code').fill('700016');
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByText('42 Park Street')).toBeVisible();
  await page.getByLabel('Coupon code').fill('WELCOME10');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Discount')).toBeVisible();
  await expect(page.getByText('Mock payment mode.')).toBeVisible();
  await page.getByRole('button', { name: 'Place order' }).click();

  // Order is pending until the SERVER confirms a signed payment event
  await expect(page.getByRole('heading', { name: /Order #/ })).toBeVisible();
  await expect(page.getByText('Awaiting payment').first()).toBeVisible();
  await expect(page.getByText('MOCK PAYMENT - no real money')).toBeVisible();
  await page.getByRole('button', { name: 'Simulate successful payment' }).click();
  await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Payment received (mock provider)')).toBeVisible();

  // Appears in order history
  await page.goto('/orders');
  await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
  await expect(page.getByText('1× Aurora Wireless Earbuds Pro')).toBeVisible();

  // Sign out ends the session
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.goto('/orders');
  await expect(page).toHaveURL(/\/login/);
});

test('guest is redirected to sign in and returns to the page afterwards (safe redirect)', async ({
  page,
}) => {
  await page.goto('/cart');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Email').fill('customer@shopsphere.test');
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/cart$/);
});

test('catalogue filters, sorting and pagination work', async ({ page }) => {
  await page.goto('/products');
  await expect(page.getByText('40 results')).toBeVisible();
  await page.getByLabel('Category').selectOption('books');
  await expect(page.getByText('5 results')).toBeVisible();
  await page.getByLabel('Sort by').selectOption('price_desc');
  await expect(page.locator('article').first()).toContainText('Data Structures, Illustrated'); // most expensive book
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByText('40 results')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Page 2 of')).toBeVisible();
  await page.goto('/products?q=zzzzzz');
  await expect(page.getByRole('heading', { name: 'No products found' })).toBeVisible();
});
