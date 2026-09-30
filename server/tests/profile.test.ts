import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getApp, loginAs, registerUser, setupDatabase, teardown,
} from './helpers.ts';
import { pool } from '../src/db/pool.ts';

before(setupDatabase);
after(teardown);

describe('own account profile', () => {
  it('requires authentication', async () => {
    const app = await getApp();
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/profile' })).statusCode, 401);
    assert.equal((await app.inject({
      method: 'PATCH', url: '/api/v1/profile', payload: { firstName: 'X' },
    })).statusCode, 401);
  });

  it('returns the signed-in user\'s account with a completion figure', async () => {
    const app = await getApp();
    const session = await registerUser({ firstName: 'Aynur', lastName: 'Quliyeva' });

    const response = await app.inject({
      method: 'GET', url: '/api/v1/profile', headers: { cookie: session.cookie },
    });
    assert.equal(response.statusCode, 200);

    const { profile, completion } = response.json();
    assert.equal(profile.id, session.user.id);
    assert.equal(profile.firstName, 'Aynur');
    assert.equal(profile.role, 'STUDENT');
    assert.equal(profile.phone, null);
    assert.equal(profile.studentId, null);
    // Two of the four editable fields are set.
    assert.equal(completion, 50);
    assert.ok(!('password_hash' in profile), 'the hash must never be returned');
    assert.ok(!('passwordHash' in profile));
  });

  it('persists an update to the database', async () => {
    const app = await getApp();
    const session = await registerUser();

    const response = await app.inject({
      method: 'PATCH', url: '/api/v1/profile', headers: { cookie: session.cookie },
      payload: {
        firstName: 'Leyla', lastName: 'Məmmədova',
        phone: '+994 50 111 22 33', studentId: 'ST-2024-0117',
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().completion, 100);

    // Read straight from PostgreSQL, not from the response.
    const { rows } = await pool.query(
      'SELECT first_name, last_name, phone, student_id FROM users WHERE id = $1',
      [session.user.id],
    );
    assert.equal(rows[0].first_name, 'Leyla');
    assert.equal(rows[0].last_name, 'Məmmədova');
    assert.equal(rows[0].phone, '+994 50 111 22 33');
    assert.equal(rows[0].student_id, 'ST-2024-0117');
  });

  it('clears an optional field when sent empty', async () => {
    const app = await getApp();
    const session = await registerUser();
    await app.inject({
      method: 'PATCH', url: '/api/v1/profile', headers: { cookie: session.cookie },
      payload: { phone: '0501112233' },
    });
    const cleared = await app.inject({
      method: 'PATCH', url: '/api/v1/profile', headers: { cookie: session.cookie },
      payload: { phone: '' },
    });
    assert.equal(cleared.json().profile.phone, null);
  });

  it('rejects a malformed phone and student ID', async () => {
    const app = await getApp();
    const session = await registerUser();

    const phone = await app.inject({
      method: 'PATCH', url: '/api/v1/profile', headers: { cookie: session.cookie },
      payload: { phone: 'not a phone!!' },
    });
    assert.equal(phone.statusCode, 400);
    assert.ok(phone.json().error.details.fields.phone);

    const studentId = await app.inject({
      method: 'PATCH', url: '/api/v1/profile', headers: { cookie: session.cookie },
      payload: { studentId: 'no spaces allowed' },
    });
    assert.equal(studentId.statusCode, 400);
    assert.ok(studentId.json().error.details.fields.studentId);
  });

  it('refuses a student ID already registered to another account', async () => {
    const app = await getApp();
    const first = await registerUser();
    const second = await registerUser();

    await app.inject({
      method: 'PATCH', url: '/api/v1/profile', headers: { cookie: first.cookie },
      payload: { studentId: 'ST-DUPLICATE-1' },
    });
    const clash = await app.inject({
      method: 'PATCH', url: '/api/v1/profile', headers: { cookie: second.cookie },
      payload: { studentId: 'st-duplicate-1' },   // case-insensitive
    });
    assert.equal(clash.statusCode, 409);
  });

  it('ignores email, role, department and is_active in the request body', async () => {
    const app = await getApp();
    const session = await registerUser();
    const before = session.user.email;

    const response = await app.inject({
      method: 'PATCH', url: '/api/v1/profile', headers: { cookie: session.cookie },
      payload: {
        firstName: 'Ok',
        email: 'attacker@evil.test',
        role: 'ADMIN',
        isActive: false,
        departmentId: '11111111-1111-1111-1111-111111111111',
        id: '22222222-2222-2222-2222-222222222222',
      },
    });
    assert.equal(response.statusCode, 200);

    const { rows } = await pool.query(
      'SELECT email, role, is_active, department_id FROM users WHERE id = $1', [session.user.id],
    );
    assert.equal(rows[0].email, before, 'email must not be changeable here');
    assert.equal(rows[0].role, 'STUDENT', 'role escalation must be impossible');
    assert.equal(rows[0].is_active, true);
    assert.equal(rows[0].department_id, null);
  });

  it('edits only the caller\'s own account, whoever else exists', async () => {
    const app = await getApp();
    const victim = await registerUser({ firstName: 'Victim' });
    const attacker = await registerUser();

    await app.inject({
      method: 'PATCH', url: '/api/v1/profile', headers: { cookie: attacker.cookie },
      // A user id in the body must have no effect: the server uses the session.
      payload: { firstName: 'Hacked', userId: victim.user.id, id: victim.user.id },
    });

    const { rows } = await pool.query('SELECT first_name FROM users WHERE id = $1', [victim.user.id]);
    assert.equal(rows[0].first_name, 'Victim', 'another account must be untouched');
  });

  it('records an audit entry for a profile update', async () => {
    const app = await getApp();
    const session = await registerUser();
    await app.inject({
      method: 'PATCH', url: '/api/v1/profile', headers: { cookie: session.cookie },
      payload: { firstName: 'Audited' },
    });
    const { rows } = await pool.query(
      "SELECT action FROM audit_logs WHERE user_id = $1 AND action = 'PROFILE_UPDATED'",
      [session.user.id],
    );
    assert.equal(rows.length, 1);
  });

  it('shows department staff their department name', async () => {
    const app = await getApp();
    const staff = await loginAs('it@udc.local', 'ItPass123!');
    const { profile } = (await app.inject({
      method: 'GET', url: '/api/v1/profile', headers: { cookie: staff.cookie },
    })).json();
    assert.equal(profile.role, 'DEPARTMENT');
    assert.equal(profile.departmentName, 'İT Dəstək');
  });
});

describe('change password', () => {
  it('requires authentication', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/change-password',
      payload: { currentPassword: 'a', newPassword: 'NewPass123' },
    });
    assert.equal(response.statusCode, 401);
  });

  it('rejects a wrong current password', async () => {
    const app = await getApp();
    const session = await registerUser({ password: 'TestPass123' });
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/change-password', headers: { cookie: session.cookie },
      payload: { currentPassword: 'NotTheOne1', newPassword: 'BrandNew123' },
    });
    assert.equal(response.statusCode, 400);
    assert.ok(response.json().error.details.fields.currentPassword);
  });

  it('rejects a weak new password', async () => {
    const app = await getApp();
    const session = await registerUser({ password: 'TestPass123' });
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/change-password', headers: { cookie: session.cookie },
      payload: { currentPassword: 'TestPass123', newPassword: 'short' },
    });
    assert.equal(response.statusCode, 400);
    assert.ok(response.json().error.details.fields.newPassword);
  });

  it('rejects reusing the current password', async () => {
    const app = await getApp();
    const session = await registerUser({ password: 'TestPass123' });
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/change-password', headers: { cookie: session.cookie },
      payload: { currentPassword: 'TestPass123', newPassword: 'TestPass123' },
    });
    assert.equal(response.statusCode, 400);
  });

  it('changes the password so the old one stops working', async () => {
    const app = await getApp();
    const email = `pw${Date.now()}@test.dev`;
    const session = await registerUser({ email, password: 'TestPass123' });

    const changed = await app.inject({
      method: 'POST', url: '/api/v1/auth/change-password', headers: { cookie: session.cookie },
      payload: { currentPassword: 'TestPass123', newPassword: 'CompletelyNew456' },
    });
    assert.equal(changed.statusCode, 200);

    assert.equal((await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'CompletelyNew456' },
    })).statusCode, 200, 'the new password works');

    assert.equal((await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'TestPass123' },
    })).statusCode, 401, 'the old password stops working');
  });
});
