import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { csrfProtection, loadSession, requireJsonBody } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { createLimiters, DEFAULT_LIMITS, type RateLimitConfig } from './middleware/rateLimit';
import { adminRouter } from './modules/admin/admin.routes';
import { authRouter } from './modules/auth/auth.routes';
import { cartRouter } from './modules/cart/cart.routes';
import { catalogRouter } from './modules/catalog/catalog.routes';
import { devOutboxRouter, healthRouter } from './modules/health/health.routes';
import { ordersRouter, webhookRouter } from './modules/orders/orders.routes';
import { supportRouter } from './modules/support/support.routes';
import { usersRouter } from './modules/users/users.routes';
import { openApiDocument } from './openapi';
import { logger } from './utils/logger';

export function createApp(opts: { limits?: Partial<RateLimitConfig> } = {}): Express {
  const app = express();
  const limits = createLimiters({ ...DEFAULT_LIMITS, ...opts.limits });

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  // Request id: accept a sane inbound id (for tracing) or generate one.
  app.use((req, res, next) => {
    const inbound = req.get('x-request-id');
    req.id = inbound && /^[A-Za-z0-9-]{8,64}$/.test(inbound) ? inbound : randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      customLogLevel: (_r, res, err) => (err || res.statusCode >= 500 ? 'error' : 'info'),
    }),
  );

  // Swagger UI needs inline scripts, so it gets its own (relaxed) CSP; everything else is locked down.
  if (env.ENABLE_DOCS) {
    app.use(
      '/api/v1/docs',
      helmet({ contentSecurityPolicy: false }),
      swaggerUi.serve,
      swaggerUi.setup(openApiDocument),
    );
  }

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      strictTransportSecurity: env.NODE_ENV === 'production',
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'],
      maxAge: 600,
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(limits.global);

  const api = express.Router();
  // Webhooks first: they need the RAW body for signature verification and use no cookies.
  api.use('/payments/webhook', webhookRouter());

  api.use(express.json({ limit: '100kb', strict: true }));
  api.use(cookieParser());
  api.use(requireJsonBody);
  api.use(loadSession);
  api.use(csrfProtection);

  api.use(healthRouter());
  api.use('/dev', devOutboxRouter());
  api.use('/auth', authRouter(limits));
  api.use('/users', usersRouter());
  api.use(catalogRouter());
  api.use(cartRouter());
  api.use(ordersRouter(limits));
  api.use('/support', supportRouter(limits.register));
  api.use('/admin', adminRouter());

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
