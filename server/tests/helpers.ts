import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { closePool, pool } from '../src/db/pool.ts';
import { dropAll, runMigrations } from '../src/db/migrate.ts';
import { runSeed } from '../src/db/seeds/index.ts';
import { env } from '../src/config/env.ts';

/**
 * Tests run against their own database (TEST_DATABASE_URL), which is dropped
 * and rebuilt once per run, so a test can never touch development data.
 */
let app: FastifyInstance | null = null;

export async function setupDatabase(): Promise<void> {
  const url = new URL(env.databaseUrl);
  const dbName = url.pathname.replace(/^\//, '');
  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rowCount === 0) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  } finally {
    await admin.end();
  }

  await dropAll();
  await runMigrations(() => {});
  await runSeed(() => {});
}

/**
 * The integration tests exercise the real classification path, so the Python
 * inference service must be running. Failing here with a clear instruction
 * beats a wall of confusing 503s.
 */
export async function requireClassifier(): Promise<void> {
  const { classifierHealthy } = await import('../src/lib/classifier-client.ts');
  if (!(await classifierHealthy())) {
    throw new Error(
      'The classification service is not running. Start it with "npm run ml:serve" ' +
      '(and "npm run ml:train" first if models/ is empty), then re-run the tests.',
    );
  }
}

export async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    app = await buildApp();
    await app.ready();
  }
  return app;
}

export async function teardown(): Promise<void> {
  if (app) await app.close();
  app = null;
  await closePool();
}

export interface Session {
  cookie: string;
  user: { id: string; email: string; role: string };
}

/** Registers a new user and returns their session cookie. */
export async function registerUser(overrides: Partial<{
  email: string; password: string; firstName: string; lastName: string;
}> = {}): Promise<Session> {
  const instance = await getApp();
  const email = overrides.email ?? `user${Date.now()}${Math.random().toString(36).slice(2, 8)}@test.dev`;
  const response = await instance.inject({
    method: 'POST', url: '/api/v1/auth/register',
    payload: {
      email,
      password: overrides.password ?? 'TestPass123',
      firstName: overrides.firstName ?? 'Test',
      lastName: overrides.lastName ?? 'User',
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`registerUser failed: ${response.statusCode} ${response.body}`);
  }
  return {
    cookie: extractCookie(response.headers['set-cookie']),
    user: response.json().user,
  };
}

export async function loginAs(email: string, password: string): Promise<Session> {
  const instance = await getApp();
  const response = await instance.inject({
    method: 'POST', url: '/api/v1/auth/login', payload: { email, password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`loginAs failed: ${response.statusCode} ${response.body}`);
  }
  return { cookie: extractCookie(response.headers['set-cookie']), user: response.json().user };
}

function extractCookie(header: string | string[] | undefined): string {
  const list = Array.isArray(header) ? header : [header ?? ''];
  const session = list.find((c) => c.startsWith('udc_session='));
  if (!session) throw new Error('No session cookie was set');
  return session.split(';')[0]!;
}

/** Looks up a department id by slug so tests do not hard-code UUIDs. */
export async function departmentIdBySlug(slug: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM departments WHERE slug = $1', [slug],
  );
  if (!rows[0]) throw new Error(`No department with slug "${slug}"`);
  return rows[0].id;
}

/** Messages whose routing the model gets right, used across several tests. */
export const SAMPLE_REQUESTS = {
  finance: 'Salam, təhsil haqqımın ödənişi ilə bağlı problem yaşayıram.',
  library: 'Kitabxanadan götürdüyüm kitabı sistemdə qaytara bilmirəm.',
  it: 'Wi-Fi işləmədiyi üçün universitet portalına daxil ola bilmirəm.',
  dean: 'İmtahan nəticəmlə bağlı müraciət etmək istəyirəm.',
} as const;

/** Submits a request as the given session and returns the created ticket. */
export async function submitRequest(session: Session, message: string) {
  const app = await getApp();
  const response = await app.inject({
    method: 'POST', url: '/api/v1/requests',
    headers: { cookie: session.cookie }, payload: { message },
  });
  if (response.statusCode !== 201) {
    throw new Error(`submitRequest failed: ${response.statusCode} ${response.body}`);
  }
  return response.json().request;
}
