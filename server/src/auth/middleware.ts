import type { FastifyReply, FastifyRequest } from 'fastify';
// Pulls in @fastify/cookie's module augmentation for request.cookies.
import type {} from '@fastify/cookie';
import { forbidden, unauthorized } from '../lib/errors.ts';
import { findUserById } from '../repositories/users.repo.ts';
import { SESSION_COOKIE, verifyAccessToken, type Role } from './tokens.ts';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: {
      id: string;
      email: string;
      role: Role;
      /** Set only for DEPARTMENT staff: the queue they are allowed to work on. */
      departmentId: string | null;
    };
  }
}

function extractToken(request: FastifyRequest): string | null {
  const cookie = request.cookies?.[SESSION_COOKIE];
  if (cookie) return cookie;
  // Bearer is accepted so the API is usable from non-browser clients too.
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** Populates request.currentUser when a valid session exists. Never throws. */
export async function attachUser(request: FastifyRequest): Promise<void> {
  const token = extractToken(request);
  if (!token) return;
  try {
    const claims = await verifyAccessToken(token);
    // Re-read the user so a deactivated or deleted account loses access
    // immediately rather than when its token happens to expire.
    const user = await findUserById(claims.sub);
    if (!user || !user.is_active) return;
    request.currentUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      departmentId: user.department_id,
    };
  } catch {
    // Invalid or expired token: treated as anonymous.
  }
}

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.currentUser) throw unauthorized();
}

export function requireRole(...roles: Role[]) {
  return async function roleGuard(request: FastifyRequest): Promise<void> {
    if (!request.currentUser) throw unauthorized();
    if (!roles.includes(request.currentUser.role)) throw forbidden();
  };
}

/** True when the requester owns the resource or is an admin. */
export function canAccess(request: FastifyRequest, ownerId: string): boolean {
  const user = request.currentUser;
  if (!user) return false;
  return user.id === ownerId || user.role === 'ADMIN';
}
