import type { ErrorRequestHandler, RequestHandler } from 'express';
import { env } from '../config/env';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Route not found', requestId: req.id },
  });
};

/** One consistent error shape; production responses never include stack traces or internals. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details: unknown;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    status = 409;
    code = 'CONFLICT';
    message = 'A record with these details already exists';
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    status = 404;
    code = 'NOT_FOUND';
    message = 'Resource not found';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body too large';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON body';
  } else if (err?.code === 'ECONNREFUSED' || err?.code === '57P01') {
    status = 503;
    code = 'SERVICE_UNAVAILABLE';
    message = 'Service temporarily unavailable';
  }

  if (status >= 500) logger.error({ err, requestId: req.id }, 'unhandled error');
  const body: Record<string, unknown> = { code, message, requestId: req.id };
  if (details !== undefined) body.details = details;
  if (env.NODE_ENV !== 'production' && status >= 500 && err instanceof Error) {
    body.debug = err.message; // development only; never in production
  }
  res.status(status).json({ error: body });
};
