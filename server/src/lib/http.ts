import type { FastifyReply, FastifyRequest } from 'fastify';
import type {} from '@fastify/cookie';
// Pulls in @fastify/rate-limit's augmentation of FastifyContextConfig.
import type {} from '@fastify/rate-limit';
import { AppError } from './errors.ts';
import { env } from '../config/env.ts';
import { SESSION_COOKIE } from '../auth/tokens.ts';

export interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/**
 * Centralised error handler.
 *
 * Deliberate failures (AppError) surface their code and message. Anything else
 * is an unexpected fault: it is logged server-side with full detail and
 * returned to the client as a generic 500 with no stack trace or internal text.
 */
export function errorHandler(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    } satisfies ErrorBody);
  }

  const err = error as { statusCode?: number; code?: string; message?: string; validation?: unknown };

  // Fastify's own client errors (bad JSON, rate limit, payload too large).
  if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
    return reply.status(err.statusCode).send({
      error: {
        code: err.statusCode === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST',
        message:
          err.statusCode === 429
            ? 'Too many requests. Please slow down and try again shortly.'
            : 'The request could not be processed.',
      },
    } satisfies ErrorBody);
  }

  request.log.error({ err: error, url: request.url }, 'Unhandled error');
  return reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Please try again.',
    },
  } satisfies ErrorBody);
}

export function notFoundHandler(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply.status(404).send({
    error: { code: 'NOT_FOUND', message: `No route for ${request.method} ${request.url}` },
  } satisfies ErrorBody);
}

/** httpOnly so JavaScript (and therefore XSS) cannot read the session token. */
export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/**
 * Per-route rate limits. Disabled under NODE_ENV=test so the suite can register
 * many users quickly; the limits are exercised against a running server instead
 * (see SECURITY.md).
 */
export const rateLimitConfig = (max: number, timeWindow: string) => ({
  // `false` is the plugin's own "disable for this route" value.
  rateLimit: env.isTest ? (false as const) : { max, timeWindow },
});

export const paginated = <T>(items: T[], total: number, page: number, pageSize: number) => ({
  items,
  pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
});
