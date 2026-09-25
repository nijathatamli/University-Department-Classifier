import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  departmentIdBySlug, getApp, loginAs, registerUser, requireClassifier,
  SAMPLE_REQUESTS, setupDatabase, submitRequest, teardown,
} from './helpers.ts';

// The whole file shares one database and one app instance; each block creates
// its own users so they cannot interfere with each other.
before(async () => {
  await requireClassifier();
  await setupDatabase();
});
after(teardown);

describe('public surface', () => {
  it('lists the four routing departments', async () => {
    const app = await getApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/departments' });
    assert.equal(response.statusCode, 200);

    const names = response.json().items.map((d: { name: string }) => d.name).sort();
    assert.deepEqual(names, ['Dekanat', 'Kitabxana', 'Maliyyə', 'İT Dəstək'].sort());
  });

  it('exposes model metrics measured at training time', async () => {
    const app = await getApp();
    const info = (await app.inject({ method: 'GET', url: '/api/v1/model/info' })).json();

    assert.match(info.modelVersion, /^request-router-v/);
    assert.match(info.algorithm, /TF-IDF/);
    assert.ok(info.metrics.accuracy > 0 && info.metrics.accuracy <= 1);
    assert.ok(info.metrics.f1Macro > 0 && info.metrics.f1Macro <= 1);
    // Above chance for four balanced classes.
    assert.ok(info.metrics.cvAccuracyMean > 0.25, 'model must beat random guessing');
    assert.equal(info.labels.length, 4);
  });

  it('reports classifier availability in the health check', async () => {
    const app = await getApp();
    const health = (await app.inject({ method: 'GET', url: '/api/v1/health' })).json();
    assert.equal(health.status, 'ok');
    assert.equal(health.classifier, 'up');
  });

  it('accepts and stores a contact message', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'POST', url: '/api/v1/contact',
      payload: {
        name: 'Nigar', email: 'nigar@test.dev', subject: 'Sual',
        message: 'Model hansı şöbələri tanıyır?',
      },
    });
    assert.equal(response.statusCode, 201);
  });
});

describe('classification and routing', () => {
  it('requires authentication to submit', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'POST', url: '/api/v1/requests', payload: { message: SAMPLE_REQUESTS.it },
    });
    assert.equal(response.statusCode, 401);
  });

  it('rejects a message that is too short', async () => {
    const app = await getApp();
    const session = await registerUser();
    const response = await app.inject({
      method: 'POST', url: '/api/v1/requests',
      headers: { cookie: session.cookie }, payload: { message: 'salam' },
    });
    assert.equal(response.statusCode, 400);
    assert.ok(response.json().error.details.fields.message);
  });

  it('routes each canonical example to the expected department', async () => {
    const session = await registerUser();
    const cases: Array<[string, string]> = [
      [SAMPLE_REQUESTS.finance, 'Maliyyə'],
      [SAMPLE_REQUESTS.library, 'Kitabxana'],
      [SAMPLE_REQUESTS.it, 'İT Dəstək'],
      [SAMPLE_REQUESTS.dean, 'Dekanat'],
    ];
    for (const [message, expected] of cases) {
      const ticket = await submitRequest(session, message);
      assert.equal(ticket.department.name, expected, `"${message.slice(0, 40)}"`);
    }
  });

  it('returns a real probability distribution, not a fabricated number', async () => {
    const session = await registerUser();
    const ticket = await submitRequest(session, SAMPLE_REQUESTS.it);

    assert.ok(ticket.confidence > 0 && ticket.confidence <= 1);
    assert.equal(ticket.probabilities.length, 4, 'one probability per department');

    const total = ticket.probabilities.reduce(
      (sum: number, p: { probability: number }) => sum + p.probability, 0,
    );
    assert.ok(Math.abs(total - 1) < 0.01, `probabilities should sum to 1, got ${total}`);

    // Sorted descending, and the winner matches the assigned department.
    const top = ticket.probabilities[0];
    assert.equal(top.label, ticket.department.name);
    assert.equal(Math.round(top.probability * 1000), Math.round(ticket.confidence * 1000));
    for (let i = 1; i < ticket.probabilities.length; i += 1) {
      assert.ok(ticket.probabilities[i - 1].probability >= ticket.probabilities[i].probability);
    }
  });

  it('gives different confidence for different messages', async () => {
    const session = await registerUser();
    const a = await submitRequest(session, SAMPLE_REQUESTS.finance);
    const b = await submitRequest(session, 'Bilmirəm kimə yazmalıyam, ümumi sualım var.');
    assert.notEqual(a.confidence, b.confidence, 'confidence must depend on the text');
  });

  it('creates the ticket, records the prediction and assigns the department', async () => {
    const app = await getApp();
    const session = await registerUser();
    const ticket = await submitRequest(session, SAMPLE_REQUESTS.finance);

    assert.ok(ticket.ticketNumber >= 1000, 'human-readable ticket number');
    assert.equal(ticket.status, 'NEW');
    assert.ok(ticket.department.id);
    assert.match(ticket.modelVersion, /^request-router-v/);

    // Read it back from the database, not from the create response.
    const fetched = await app.inject({
      method: 'GET', url: `/api/v1/requests/${ticket.id}`, headers: { cookie: session.cookie },
    });
    assert.equal(fetched.statusCode, 200);
    const stored = fetched.json().request;
    assert.equal(stored.message, SAMPLE_REQUESTS.finance);
    assert.equal(stored.department.name, ticket.department.name);
    assert.equal(stored.confidence, ticket.confidence);
  });

  it('lists a student\'s own requests with pagination', async () => {
    const app = await getApp();
    const session = await registerUser();
    await submitRequest(session, SAMPLE_REQUESTS.it);
    await submitRequest(session, SAMPLE_REQUESTS.library);

    const body = (await app.inject({
      method: 'GET', url: '/api/v1/requests?pageSize=1', headers: { cookie: session.cookie },
    })).json();
    assert.equal(body.pagination.total, 2);
    assert.equal(body.items.length, 1);
    assert.equal(body.pagination.totalPages, 2);
  });

  it('clamps an oversized pageSize', async () => {
    const app = await getApp();
    const session = await registerUser();
    const body = (await app.inject({
      method: 'GET', url: '/api/v1/requests?pageSize=100000', headers: { cookie: session.cookie },
    })).json();
    assert.ok(body.pagination.pageSize <= 25);
  });
});

describe('data ownership', () => {
  it('never lets one student read another student\'s request', async () => {
    const app = await getApp();
    const owner = await registerUser();
    const intruder = await registerUser();
    const ticket = await submitRequest(owner, SAMPLE_REQUESTS.finance);

    const read = await app.inject({
      method: 'GET', url: `/api/v1/requests/${ticket.id}`, headers: { cookie: intruder.cookie },
    });
    assert.equal(read.statusCode, 403);

    // And it is absent from their list.
    const list = (await app.inject({
      method: 'GET', url: '/api/v1/requests', headers: { cookie: intruder.cookie },
    })).json();
    assert.equal(list.pagination.total, 0);

    // Anonymous access is rejected before ownership is even considered.
    assert.equal((await app.inject({
      method: 'GET', url: `/api/v1/requests/${ticket.id}`,
    })).statusCode, 401);
  });

  it('does not let a student change their own request status', async () => {
    const app = await getApp();
    const owner = await registerUser();
    const ticket = await submitRequest(owner, SAMPLE_REQUESTS.finance);

    const response = await app.inject({
      method: 'PATCH', url: `/api/v1/requests/${ticket.id}/status`,
      headers: { cookie: owner.cookie }, payload: { status: 'RESOLVED' },
    });
    assert.equal(response.statusCode, 403, 'only staff may resolve a ticket');
  });

  it('lets an admin read any request', async () => {
    const app = await getApp();
    const owner = await registerUser();
    const admin = await loginAs('admin@udc.local', 'AdminPass123!');
    const ticket = await submitRequest(owner, SAMPLE_REQUESTS.dean);

    const response = await app.inject({
      method: 'GET', url: `/api/v1/requests/${ticket.id}`, headers: { cookie: admin.cookie },
    });
    assert.equal(response.statusCode, 200);
  });
});

describe('department isolation', () => {
  it('shows staff only the queue for their own department', async () => {
    const app = await getApp();
    const student = await registerUser();
    await submitRequest(student, SAMPLE_REQUESTS.finance);
    await submitRequest(student, SAMPLE_REQUESTS.it);

    const finance = await loginAs('maliyye@udc.local', 'MaliyyePass123!');
    const queue = (await app.inject({
      method: 'GET', url: '/api/v1/department/requests', headers: { cookie: finance.cookie },
    })).json();

    assert.ok(queue.items.length > 0);
    for (const item of queue.items) {
      assert.equal(item.department.name, 'Maliyyə', 'no other department may appear');
    }
  });

  it('refuses a department parameter from staff trying to read another queue', async () => {
    const app = await getApp();
    const finance = await loginAs('maliyye@udc.local', 'MaliyyePass123!');
    const itDepartmentId = await departmentIdBySlug('it-destek');

    const queue = (await app.inject({
      method: 'GET', url: `/api/v1/department/requests?departmentId=${itDepartmentId}`,
      headers: { cookie: finance.cookie },
    })).json();

    for (const item of queue.items) {
      assert.equal(item.department.name, 'Maliyyə',
        'the departmentId parameter must be ignored for non-admins');
    }
  });

  it('blocks staff from opening a ticket assigned elsewhere', async () => {
    const app = await getApp();
    const student = await registerUser();
    const ticket = await submitRequest(student, SAMPLE_REQUESTS.finance);
    const it = await loginAs('it@udc.local', 'ItPass123!');

    assert.equal((await app.inject({
      method: 'GET', url: `/api/v1/requests/${ticket.id}`, headers: { cookie: it.cookie },
    })).statusCode, 403);

    assert.equal((await app.inject({
      method: 'PATCH', url: `/api/v1/requests/${ticket.id}/status`,
      headers: { cookie: it.cookie }, payload: { status: 'RESOLVED' },
    })).statusCode, 403);
  });

  it('blocks students from the department area entirely', async () => {
    const app = await getApp();
    const student = await registerUser();
    for (const url of ['/api/v1/department/me', '/api/v1/department/requests', '/api/v1/department/stats']) {
      const response = await app.inject({ method: 'GET', url, headers: { cookie: student.cookie } });
      assert.equal(response.statusCode, 403, url);
    }
  });

  it('moves a ticket through its statuses and the student sees the change', async () => {
    const app = await getApp();
    const student = await registerUser();
    const ticket = await submitRequest(student, SAMPLE_REQUESTS.library);
    const library = await loginAs('kitabxana@udc.local', 'KitabxanaPass123!');

    const review = await app.inject({
      method: 'PATCH', url: `/api/v1/requests/${ticket.id}/status`,
      headers: { cookie: library.cookie }, payload: { status: 'IN_REVIEW' },
    });
    assert.equal(review.statusCode, 200);
    assert.equal(review.json().request.status, 'IN_REVIEW');

    const resolved = await app.inject({
      method: 'PATCH', url: `/api/v1/requests/${ticket.id}/status`,
      headers: { cookie: library.cookie }, payload: { status: 'RESOLVED' },
    });
    assert.equal(resolved.json().request.status, 'RESOLVED');
    assert.ok(resolved.json().request.resolvedAt, 'resolvedAt is stamped');

    // The student sees it from the database, not from any client state.
    const studentView = (await app.inject({
      method: 'GET', url: `/api/v1/requests/${ticket.id}`, headers: { cookie: student.cookie },
    })).json();
    assert.equal(studentView.request.status, 'RESOLVED');
  });

  it('rejects an unknown status value', async () => {
    const app = await getApp();
    const student = await registerUser();
    const ticket = await submitRequest(student, SAMPLE_REQUESTS.it);
    const it = await loginAs('it@udc.local', 'ItPass123!');

    const response = await app.inject({
      method: 'PATCH', url: `/api/v1/requests/${ticket.id}/status`,
      headers: { cookie: it.cookie }, payload: { status: 'DELETED' },
    });
    assert.equal(response.statusCode, 422);
  });

  it('does not expose the student identity to the student themselves', async () => {
    const app = await getApp();
    const student = await registerUser();
    const ticket = await submitRequest(student, SAMPLE_REQUESTS.dean);

    const own = (await app.inject({
      method: 'GET', url: `/api/v1/requests/${ticket.id}`, headers: { cookie: student.cookie },
    })).json();
    assert.equal(own.request.student, undefined, 'students do not need their own details echoed');

    const dean = await loginAs('dekanat@udc.local', 'DekanatPass123!');
    const staffView = (await app.inject({
      method: 'GET', url: `/api/v1/requests/${ticket.id}`, headers: { cookie: dean.cookie },
    })).json();
    assert.ok(staffView.request.student?.email, 'staff need to know who wrote it');
  });
});

describe('administration', () => {
  it('blocks students and department staff from admin endpoints', async () => {
    const app = await getApp();
    const student = await registerUser();
    const staff = await loginAs('it@udc.local', 'ItPass123!');
    const routes = [
      '/api/v1/admin/stats', '/api/v1/admin/users', '/api/v1/admin/requests',
      '/api/v1/admin/departments', '/api/v1/admin/contacts', '/api/v1/admin/audit',
      '/api/v1/admin/models',
    ];
    for (const url of routes) {
      assert.equal((await app.inject({
        method: 'GET', url, headers: { cookie: student.cookie },
      })).statusCode, 403, `student ${url}`);
      assert.equal((await app.inject({
        method: 'GET', url, headers: { cookie: staff.cookie },
      })).statusCode, 403, `staff ${url}`);
    }
  });

  it('reports statistics computed from the database', async () => {
    const app = await getApp();
    const student = await registerUser();
    await submitRequest(student, SAMPLE_REQUESTS.finance);
    const admin = await loginAs('admin@udc.local', 'AdminPass123!');

    const stats = (await app.inject({
      method: 'GET', url: '/api/v1/admin/stats', headers: { cookie: admin.cookie },
    })).json();

    assert.ok(stats.totalRequests > 0);
    assert.equal(stats.byDepartment.length, 4, 'every department is represented');
    const finance = stats.byDepartment.find((d: { slug: string }) => d.slug === 'maliyye');
    assert.ok(finance.count > 0);
    assert.ok(stats.averageConfidence > 0 && stats.averageConfidence <= 1);
  });

  it('creates a department and flags that retraining is required', async () => {
    const app = await getApp();
    const admin = await loginAs('admin@udc.local', 'AdminPass123!');
    const response = await app.inject({
      method: 'POST', url: '/api/v1/admin/departments', headers: { cookie: admin.cookie },
      payload: { name: 'Karyera Mərkəzi', description: 'Karyera və məşğulluq dəstəyi.' },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().retrainingRequired, true,
      'a new label is useless until the model is retrained');
    assert.equal(response.json().department.slug, 'karyera-merkezi');
  });

  it('requires a department when granting the DEPARTMENT role', async () => {
    const app = await getApp();
    const admin = await loginAs('admin@udc.local', 'AdminPass123!');
    const target = await registerUser();

    const missing = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/users/${target.user.id}`,
      headers: { cookie: admin.cookie }, payload: { role: 'DEPARTMENT' },
    });
    assert.equal(missing.statusCode, 400);

    const ok = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/users/${target.user.id}`,
      headers: { cookie: admin.cookie },
      payload: { role: 'DEPARTMENT', departmentId: await departmentIdBySlug('dekanat') },
    });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().user.role, 'DEPARTMENT');
    assert.ok(ok.json().user.departmentId);
  });

  it('stops an admin from deactivating their own account', async () => {
    const app = await getApp();
    const admin = await loginAs('admin@udc.local', 'AdminPass123!');
    const response = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/users/${admin.user.id}`,
      headers: { cookie: admin.cookie }, payload: { isActive: false },
    });
    assert.equal(response.statusCode, 400);
  });

  it('writes an audit entry for submissions and status changes', async () => {
    const app = await getApp();
    const admin = await loginAs('admin@udc.local', 'AdminPass123!');
    const audit = (await app.inject({
      method: 'GET', url: '/api/v1/admin/audit?pageSize=50', headers: { cookie: admin.cookie },
    })).json();

    const actions = audit.items.map((a: { action: string }) => a.action);
    assert.ok(actions.includes('REQUEST_SUBMITTED'));
    assert.ok(actions.includes('REQUEST_STATUS_CHANGED'));
    assert.ok(actions.includes('LOGIN_SUCCESS'));
  });
});

describe('error handling', () => {
  it('returns the documented error envelope for a 404', async () => {
    const app = await getApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/nothing-here' });
    assert.equal(response.statusCode, 404);
    assert.ok(response.json().error.code);
    assert.ok(response.json().error.message);
  });

  it('never leaks a stack trace or filesystem path', async () => {
    const app = await getApp();
    const session = await registerUser();
    const response = await app.inject({
      method: 'GET', url: '/api/v1/requests/not-a-uuid', headers: { cookie: session.cookie },
    });
    assert.ok(!response.body.includes('at '), 'no stack frames');
    assert.ok(!/\/Users\//.test(response.body), 'no filesystem paths');
  });
});
