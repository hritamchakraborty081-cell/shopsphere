import { hash, verify, Algorithm } from '@node-rs/argon2';
import { env } from '../../config/env';
import { prisma } from '../../db/prisma';
import { audit } from '../../services/audit';
import { sendMail } from '../../services/mailer';
import { randomToken, sha256 } from '../../utils/crypto';
import { AppError, badRequest } from '../../utils/errors';

// OWASP-recommended Argon2id minimum profile (19 MiB, t=2, p=1).
const ARGON_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};
export const hashPassword = (pw: string) => hash(pw, ARGON_OPTS);

let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword('dummy-password-for-timing-equalisation'));

const VERIFY_TTL_MS = 24 * 3600 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

async function issueVerificationEmail(user: { id: string; email: string }) {
  const token = randomToken(32);
  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
    },
  });
  await sendMail({
    to: user.email,
    subject: 'Verify your ShopSphere email',
    text: `Verify your email: ${env.APP_URL}/verify-email?token=${token}\nThis link expires in 24 hours.`,
  });
}

/**
 * Responds identically whether or not the email is already registered (prevents account
 * enumeration). Existing owners get a notice email instead.
 */
export async function register(input: { email: string; password: string; name: string }) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    await sendMail({
      to: existing.email,
      subject: 'ShopSphere sign-up attempt',
      text: 'Someone tried to register with your email. If it was you, sign in or reset your password.',
    });
    return;
  }
  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
    },
  });
  await issueVerificationEmail(user);
  await audit(user.id, 'auth.register', 'User', user.id);
}

export async function resendVerification(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.emailVerifiedAt && !user.deletedAt) await issueVerificationEmail(user);
}

export async function verifyEmail(token: string) {
  const now = new Date();
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: sha256(token) },
  });
  if (!record || record.usedAt || record.expiresAt <= now) {
    throw badRequest('This verification link is invalid or has expired', 'INVALID_TOKEN');
  }
  // Conditional update makes the token single-use even under concurrent requests.
  const claimed = await prisma.emailVerificationToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claimed.count !== 1)
    throw badRequest('This verification link is invalid or has expired', 'INVALID_TOKEN');
  await prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: now } });
  await audit(record.userId, 'auth.verify_email', 'User', record.userId);
}

export async function authenticate(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  const now = new Date();
  const locked = user?.lockedUntil && user.lockedUntil > now;
  // Always run one Argon2 verification so response time does not reveal whether the account exists.
  const ok = await verify(
    user && !user.deletedAt ? user.passwordHash : await getDummyHash(),
    password,
  ).catch(() => false);
  const fail = new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  if (!user || user.deletedAt) throw fail;
  if (locked) {
    await audit(user.id, 'auth.login_blocked_locked', 'User', user.id);
    throw fail; // same response as a wrong password: do not reveal the lock
  }
  if (!ok) {
    const count = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data:
        count >= MAX_FAILED
          ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) }
          : { failedLoginCount: count },
    });
    await audit(
      user.id,
      count >= MAX_FAILED ? 'auth.account_locked' : 'auth.login_failed',
      'User',
      user.id,
    );
    throw fail;
  }
  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }
  await audit(user.id, 'auth.login', 'User', user.id);
  return user;
}

export async function revokeSession(sessionId: string) {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
}

export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.deletedAt) return; // same response either way
  // Invalidate earlier unused tokens so only the newest link works.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  const token = randomToken(32);
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });
  await sendMail({
    to: user.email,
    subject: 'Reset your ShopSphere password',
    text: `Reset your password: ${env.APP_URL}/reset-password?token=${token}\nThis link expires in 1 hour and works once.`,
  });
  await audit(user.id, 'auth.password_reset_requested', 'User', user.id);
}

export async function resetPassword(token: string, newPassword: string) {
  const now = new Date();
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: sha256(token) },
  });
  if (!record || record.usedAt || record.expiresAt <= now) {
    throw badRequest('This reset link is invalid or has expired', 'INVALID_TOKEN');
  }
  const claimed = await prisma.passwordResetToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claimed.count !== 1)
    throw badRequest('This reset link is invalid or has expired', 'INVALID_TOKEN');
  await prisma.user.update({
    where: { id: record.userId },
    data: { passwordHash: await hashPassword(newPassword), failedLoginCount: 0, lockedUntil: null },
  });
  await revokeAllSessions(record.userId); // a reset logs out every device
  await audit(record.userId, 'auth.password_reset', 'User', record.userId);
}

export async function changePassword(
  userId: string,
  current: string,
  next: string,
  keepSessionId: string,
) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verify(user.passwordHash, current).catch(() => false))) {
    throw new AppError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(next) },
  });
  await revokeAllSessions(userId, keepSessionId);
  await audit(userId, 'auth.password_changed', 'User', userId);
}
