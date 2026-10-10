export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, code = 'BAD_REQUEST', details?: unknown) =>
  new AppError(400, code, msg, details);
export const unauthorized = (msg = 'Authentication required', code = 'UNAUTHENTICATED') =>
  new AppError(401, code, msg);
export const forbidden = (msg = 'You do not have permission to do that', code = 'FORBIDDEN') =>
  new AppError(403, code, msg);
export const notFound = (msg = 'Resource not found', code = 'NOT_FOUND') =>
  new AppError(404, code, msg);
export const conflict = (msg: string, code = 'CONFLICT', details?: unknown) =>
  new AppError(409, code, msg, details);
export const unprocessable = (msg: string, details?: unknown) =>
  new AppError(422, 'VALIDATION_ERROR', msg, details);
