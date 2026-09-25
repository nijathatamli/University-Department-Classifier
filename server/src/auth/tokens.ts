import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.ts';

export type Role = 'STUDENT' | 'DEPARTMENT' | 'ADMIN';

export interface TokenClaims {
  sub: string;
  email: string;
  role: Role;
}

const secret = new TextEncoder().encode(env.jwtSecret);
const ISSUER = 'udc';
const AUDIENCE = 'udc-web';

export async function signAccessToken(claims: TokenClaims): Promise<string> {
  return new SignJWT({ email: claims.email, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(env.refreshTokenTtl)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<TokenClaims> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: AUDIENCE });
  return {
    sub: String(payload.sub),
    email: String(payload.email),
    role: payload.role as Role,
  };
}

/** Returns the raw token (emailed to the user) and the SHA-256 stored in the DB. */
export function createResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashResetToken(token) };
}

export const hashResetToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const SESSION_COOKIE = 'udc_session';
