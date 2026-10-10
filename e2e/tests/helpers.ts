import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { DEMO_PASSWORD } from '../env';

export const demo = {
  customer: 'customer@shopsphere.test',
  admin: 'admin@shopsphere.test',
  password: DEMO_PASSWORD,
};

export async function signIn(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible();
}

/** Reads the most recent single-use link emailed to `to` from the DEV-only outbox endpoint. */
export async function emailedLink(
  request: APIRequestContext,
  to: string,
  kind: 'verify-email' | 'reset-password',
): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await request.get('/api/v1/dev/outbox');
    const items: { to: string; text: string }[] = (await res.json()).items;
    const mail = [...items].reverse().find((m) => m.to === to && m.text.includes(kind));
    const url = mail?.text.match(/https?:\/\/[^\s]+/)?.[0];
    if (url) return new URL(url).pathname + new URL(url).search;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no ${kind} email for ${to}`);
}
