import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@shopsphere/shared';

const COMMON_PASSWORDS = new Set([
  'password123',
  'password1234',
  '1234567890',
  'qwertyuiop',
  'iloveyou123',
  'welcome1234',
  'admin12345',
]);

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain letters and numbers')
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), 'Password is too common');

const tokenSchema = z.string().min(20).max(128);

// .strict() rejects unknown keys -> protects against mass assignment (e.g. a smuggled "role").
export const registerSchema = z
  .object({ email: emailSchema, password: passwordSchema, name: z.string().trim().min(1).max(80) })
  .strict();
export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(PASSWORD_MAX_LENGTH) })
  .strict();
export const tokenOnlySchema = z.object({ token: tokenSchema }).strict();
export const forgotSchema = z.object({ email: emailSchema }).strict();
export const resetSchema = z.object({ token: tokenSchema, password: passwordSchema }).strict();
export const resendSchema = z.object({ email: emailSchema }).strict();
