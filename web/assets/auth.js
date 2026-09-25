import { api, ApiError } from './api.js';

/**
 * Session state. The token itself lives in an httpOnly cookie the page cannot
 * read, so "who am I" is always answered by the server.
 */
let cached;

export async function currentUser({ force = false } = {}) {
  if (!force && cached !== undefined) return cached;
  try {
    const { user } = await api.auth.me();
    cached = user;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) cached = null;
    else cached = null;
  }
  return cached;
}

export const clearCachedUser = () => { cached = undefined; };

/** Where each role belongs after signing in, or when they hit a page they cannot use. */
export function homeFor(role) {
  if (role === 'ADMIN') return '/admin';
  if (role === 'DEPARTMENT') return '/department';
  return '/classifier';
}

/**
 * Client-side route guard. Convenience only — every protected endpoint is
 * enforced server-side regardless of what the browser does.
 */
export async function requireUser({ roles } = {}) {
  const user = await currentUser();
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`/login?next=${next}`);
    return null;
  }
  if (roles && !roles.includes(user.role)) {
    location.replace(homeFor(user.role));
    return null;
  }
  return user;
}

export async function logout() {
  try { await api.auth.logout(); } finally {
    clearCachedUser();
    location.href = '/';
  }
}
