import { Router } from 'express';
import type { createLimiters } from '../../middleware/rateLimit';
import { clearSessionCookie, createSession, requireAuth } from '../../middleware/auth';
import { ah, parse } from '../../utils/http';
import * as svc from './auth.service';
import {
  forgotSchema,
  loginSchema,
  registerSchema,
  resendSchema,
  resetSchema,
  tokenOnlySchema,
} from './auth.schemas';

type Limiters = ReturnType<typeof createLimiters>;

export function authRouter(limits: Limiters) {
  const r = Router();
  r.use(limits.auth);

  r.post(
    '/register',
    limits.register,
    ah(async (req, res) => {
      await svc.register(parse(registerSchema, req.body));
      res
        .status(202)
        .json({ message: 'If this email can be registered, a verification link has been sent.' });
    }),
  );

  r.post(
    '/resend-verification',
    limits.passwordReset,
    ah(async (req, res) => {
      await svc.resendVerification(parse(resendSchema, req.body).email);
      res
        .status(202)
        .json({ message: 'If the account needs verification, a new link has been sent.' });
    }),
  );

  r.post(
    '/verify-email',
    ah(async (req, res) => {
      await svc.verifyEmail(parse(tokenOnlySchema, req.body).token);
      res.json({ message: 'Email verified' });
    }),
  );

  r.post(
    '/login',
    limits.login,
    ah(async (req, res) => {
      const { email, password } = parse(loginSchema, req.body);
      const user = await svc.authenticate(email, password);
      const { csrfToken } = await createSession(res, user.id, req.get('user-agent'));
      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          emailVerified: !!user.emailVerifiedAt,
        },
        csrfToken,
      });
    }),
  );

  r.post(
    '/logout',
    requireAuth,
    ah(async (req, res) => {
      await svc.revokeSession(req.auth!.sessionId);
      clearSessionCookie(res);
      res.status(204).end();
    }),
  );

  r.get('/me', (req, res) => {
    if (!req.auth) return res.json({ user: null, csrfToken: null });
    const u = req.auth.user;
    res.json({
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        emailVerified: !!u.emailVerifiedAt,
      },
      csrfToken: req.auth.csrfToken,
    });
  });

  r.post(
    '/forgot-password',
    limits.passwordReset,
    ah(async (req, res) => {
      await svc.requestPasswordReset(parse(forgotSchema, req.body).email);
      res.status(202).json({ message: 'If an account exists, a reset link has been sent.' });
    }),
  );

  r.post(
    '/reset-password',
    limits.passwordReset,
    ah(async (req, res) => {
      const { token, password } = parse(resetSchema, req.body);
      await svc.resetPassword(token, password);
      res.json({ message: 'Password updated. Please sign in.' });
    }),
  );

  return r;
}
