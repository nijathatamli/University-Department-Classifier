import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getApp, loginAs, registerUser, setupDatabase, teardown } from './helpers.ts';
import { hashPassword, verifyPassword } from '../src/auth/password.ts';
import { pool } from '../src/db/pool.ts';

describe('authentication', () => {
  before(setupDatabase);
  after(teardown);

  it('hashes passwords with argon2id and never stores them in plain text', async () => {
    const hash = await hashPassword('SuperSecret123');
    assert.ok(hash.startsWith('$argon2id$'), `expected argon2id, got ${hash.slice(0, 20)}`);
    assert.ok(!hash.includes('SuperSecret123'));
    assert.equal(await verifyPassword(hash, 'SuperSecret123'), true);
    assert.equal(await verifyPassword(hash, 'wrong'), false);
  });

  it('registers a user, sets an httpOnly cookie and stores only the hash', async () => {
    const app = await getApp();
    const email = `reg${Date.now()}@test.dev`;
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email, password: 'TestPass123', firstName: 'Ada', lastName: 'Lovelace' },
    });
    assert.equal(response.statusCode, 201);

    const body = response.json();
    assert.equal(body.user.email, email);
    assert.equal(body.user.role, 'STUDENT');
    assert.ok(!('passwordHash' in body.user), 'the hash must never be returned');

    const cookies = [response.headers['set-cookie']].flat().join(';');
    assert.match(cookies, /udc_session=/);
    assert.match(cookies, /HttpOnly/i);
    assert.match(cookies, /SameSite=Lax/i);

    const { rows } = await pool.query('SELECT password_hash FROM users WHERE lower(email) = $1', [email]);
    assert.ok(rows[0].password_hash.startsWith('$argon2id$'));
  });

  it('rejects a weak password', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'weak@test.dev', password: 'abc', firstName: 'A', lastName: 'B' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'VALIDATION_ERROR');
    assert.ok(response.json().error.details.fields.password);
  });

  it('rejects a malformed email', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'not-an-email', password: 'TestPass123', firstName: 'A', lastName: 'B' },
    });
    assert.equal(response.statusCode, 400);
  });

  it('rejects a duplicate email', async () => {
    const app = await getApp();
    const email = `dupe${Date.now()}@test.dev`;
    const payload = { email, password: 'TestPass123', firstName: 'A', lastName: 'B' };
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload })).statusCode, 201);
    const second = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload });
    assert.equal(second.statusCode, 409);
    assert.equal(second.json().error.code, 'CONFLICT');
  });

  it('logs in with valid credentials and rejects a wrong password', async () => {
    const app = await getApp();
    const email = `login${Date.now()}@test.dev`;
    await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email, password: 'TestPass123', firstName: 'A', lastName: 'B' },
    });

    const good = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'TestPass123' },
    });
    assert.equal(good.statusCode, 200);

    const bad = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'WrongPass123' },
    });
    assert.equal(bad.statusCode, 401);
  });

  it('gives the same message for an unknown email as for a wrong password', async () => {
    const app = await getApp();
    const email = `enum${Date.now()}@test.dev`;
    await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email, password: 'TestPass123', firstName: 'A', lastName: 'B' },
    });
    const wrongPassword = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'Nope12345' },
    });
    const unknownEmail = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email: 'nobody-here@test.dev', password: 'Nope12345' },
    });
    assert.equal(wrongPassword.statusCode, unknownEmail.statusCode);
    assert.equal(wrongPassword.json().error.message, unknownEmail.json().error.message);
  });

  it('returns the current user for a valid session and 401 without one', async () => {
    const app = await getApp();
    const session = await registerUser();

    const authed = await app.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { cookie: session.cookie },
    });
    assert.equal(authed.statusCode, 200);
    assert.equal(authed.json().user.id, session.user.id);

    const anon = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    assert.equal(anon.statusCode, 401);
  });

  it('rejects a forged session token', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'GET', url: '/api/v1/auth/me',
      headers: { cookie: 'udc_session=not.a.real.token' },
    });
    assert.equal(response.statusCode, 401);
  });

  it('completes the password reset flow and invalidates the token afterwards', async () => {
    const app = await getApp();
    const email = `reset${Date.now()}@test.dev`;
    await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email, password: 'TestPass123', firstName: 'A', lastName: 'B' },
    });

    const request = await app.inject({
      method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email },
    });
    assert.equal(request.statusCode, 200);
    const token = request.json().devToken;
    assert.ok(token, 'a dev token is returned outside production');

    const reset = await app.inject({
      method: 'POST', url: '/api/v1/auth/reset-password',
      payload: { token, password: 'BrandNewPass456' },
    });
    assert.equal(reset.statusCode, 200);

    assert.equal((await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'BrandNewPass456' },
    })).statusCode, 200);

    assert.equal((await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'TestPass123' },
    })).statusCode, 401);

    // A reset token is single-use.
    const replay = await app.inject({
      method: 'POST', url: '/api/v1/auth/reset-password',
      payload: { token, password: 'AnotherPass789' },
    });
    assert.equal(replay.statusCode, 401);
  });

  it('does not reveal whether an email is registered on forgot-password', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/forgot-password',
      payload: { email: 'definitely-not-registered@test.dev' },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().devToken, undefined);
  });

  it('blocks a deactivated account immediately', async () => {
    const app = await getApp();
    const session = await registerUser();
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [session.user.id]);

    const response = await app.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { cookie: session.cookie },
    });
    assert.equal(response.statusCode, 401, 'an existing token must stop working once deactivated');
  });

  it('signs the seeded admin in with the documented credentials', async () => {
    const session = await loginAs('admin@udc.local', 'AdminPass123!');
    assert.equal(session.user.role, 'ADMIN');
  });

  it('signs a seeded department account in and carries its department', async () => {
    const session = await loginAs('it@udc.local', 'ItPass123!');
    assert.equal(session.user.role, 'DEPARTMENT');
    assert.ok(session.user.departmentId, 'staff must be bound to a department');
  });
});
