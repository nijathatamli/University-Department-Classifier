/**
 * Every failure the API returns deliberately is an AppError. Anything else that
 * reaches the error handler is treated as an unexpected fault and reported as a
 * generic 500 with no internal detail (see lib/error-handler.ts).
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new AppError(400, 'VALIDATION_ERROR', message, details);

export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have access to this resource') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (resource = 'Resource') =>
  new AppError(404, 'NOT_FOUND', `${resource} not found`);

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError(409, 'CONFLICT', message, details);

export const unprocessable = (message: string, details?: Record<string, unknown>) =>
  new AppError(422, 'UNPROCESSABLE', message, details);
