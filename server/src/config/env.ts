import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const envFile = resolve(root, '.env');
if (existsSync(envFile)) loadDotenv({ path: envFile, quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

const nodeEnv = optional('NODE_ENV', 'development');
const isTest = nodeEnv === 'test';

// Tests run against their own database so a test run can never touch dev data.
const databaseUrl = isTest
  ? optional('TEST_DATABASE_URL', 'postgresql://localhost:5432/udc_test')
  : required('DATABASE_URL');

const jwtSecret = optional(
  'JWT_SECRET',
  isTest ? 'test-secret-value-that-is-long-enough-for-hs256' : '',
);
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be set and at least 32 characters long.');
}

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest,
  port: Number(optional('PORT', '4000')),
  host: optional('HOST', '127.0.0.1'),
  databaseUrl,
  jwtSecret,
  accessTokenTtl: optional('ACCESS_TOKEN_TTL', '15m'),
  refreshTokenTtl: optional('REFRESH_TOKEN_TTL', '7d'),
  corsOrigin: optional('CORS_ORIGIN', 'http://localhost:4000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  cookieSecure: optional('COOKIE_SECURE', 'false') === 'true',
  /** Python inference service (ml/serve.py). Localhost-only, never exposed. */
  mlServiceUrl: optional('ML_SERVICE_URL', 'http://127.0.0.1:8001'),

  /**
   * Managed Postgres (Render, Heroku, Neon…) terminates TLS with its own CA,
   * so verification is relaxed rather than disabled entirely — the connection
   * is still encrypted. Auto-enabled when the URL asks for it.
   */
  databaseSsl:
    optional('DATABASE_SSL', 'false') === 'true' || /[?&]sslmode=require/.test(databaseUrl),

  /**
   * Demo accounts have published passwords, so they are never seeded in
   * production unless someone explicitly asks for them.
   */
  seedDemoAccounts:
    optional('SEED_DEMO_ACCOUNTS', nodeEnv === 'production' ? 'false' : 'true') === 'true',

  /** Optional first admin, created by the seed when both are present. */
  adminEmail: optional('ADMIN_EMAIL', ''),
  adminPassword: optional('ADMIN_PASSWORD', ''),
  rateLimitMax: Number(optional('RATE_LIMIT_MAX', '300')),
  rateLimitWindow: optional('RATE_LIMIT_WINDOW', '1 minute'),
  apiUrl: optional('API_URL', 'http://localhost:4000'),
} as const;
