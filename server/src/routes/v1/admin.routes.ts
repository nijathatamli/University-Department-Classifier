import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../auth/middleware.ts';
import { paginated } from '../../lib/http.ts';
import { Validator, parsePagination } from '../../lib/validation.ts';
import { badRequest, notFound } from '../../lib/errors.ts';
import { listAudit, recordAudit } from '../../repositories/audit.repo.ts';
import { listContacts, setContactStatus } from '../../repositories/contacts.repo.ts';
import { listUsers, setUserActive, setUserRole } from '../../repositories/users.repo.ts';
import {
  createDepartment, findDepartment, listDepartments, updateDepartment,
} from '../../repositories/departments.repo.ts';
import {
  adminListRequests, lowConfidenceRequests, requestStats, type RequestStatus,
} from '../../repositories/requests.repo.ts';
import { listModels } from '../../repositories/models.repo.ts';
import { shapeRequest } from './requests.routes.ts';

const ROLES = ['STUDENT', 'DEPARTMENT', 'ADMIN'] as const;
const STATUSES = ['NEW', 'IN_REVIEW', 'RESOLVED'] as const;

const slugify = (s: string) =>
  s.toLowerCase().trim()
    .replace(/ə/g, 'e').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export default async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireRole('ADMIN'));

  /** Dashboard figures. Every value is a live database aggregate. */
  app.get('/stats', async () => {
    const [stats, lowConfidence] = await Promise.all([
      requestStats(),
      lowConfidenceRequests(0.5, 8),
    ]);
    return {
      ...stats,
      lowConfidence: lowConfidence.map((r) => shapeRequest(r)),
    };
  });

  // --- requests -------------------------------------------------------------
  app.get('/requests', async (request) => {
    const q = request.query as Record<string, unknown>;
    const { page, pageSize } = parsePagination(q, 50);
    const status = STATUSES.includes(q.status as never) ? (q.status as RequestStatus) : undefined;

    const { items, total } = await adminListRequests({
      page, pageSize,
      ...(status ? { status } : {}),
      ...(typeof q.departmentId === 'string' && q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(typeof q.search === 'string' ? { search: q.search } : {}),
    });
    return paginated(items.map((r) => shapeRequest(r, true)), total, page, pageSize);
  });

  // --- users ----------------------------------------------------------------
  app.get('/users', async (request) => {
    const q = request.query as Record<string, unknown>;
    const { page, pageSize } = parsePagination(q, 50);
    const role = ROLES.includes(q.role as never) ? (q.role as (typeof ROLES)[number]) : undefined;
    const { items, total } = await listUsers({
      search: typeof q.search === 'string' ? q.search : undefined,
      ...(role ? { role } : {}),
      page, pageSize,
    });
    return paginated(items, total, page, pageSize);
  });

  app.patch('/users/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const actor = request.currentUser!;

    if (typeof body.isActive === 'boolean') {
      // Guard against an admin locking themselves out.
      if (id === actor.id && !body.isActive) {
        throw badRequest('You cannot deactivate your own account');
      }
      const user = await setUserActive(id, body.isActive);
      if (!user) throw notFound('User');
      await recordAudit({
        userId: actor.id, action: body.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
        resource: 'user', resourceId: id, ipAddress: request.ip,
      });
      return { user };
    }

    if (typeof body.role === 'string') {
      const v = new Validator(body);
      const role = v.enum('role', ROLES, true);
      v.assert();
      if (id === actor.id && role !== 'ADMIN') {
        throw badRequest('You cannot remove your own admin role');
      }
      // A DEPARTMENT account is meaningless without a department.
      let departmentId: string | null = null;
      if (role === 'DEPARTMENT') {
        if (typeof body.departmentId !== 'string' || !body.departmentId) {
          throw badRequest('departmentId is required when assigning the DEPARTMENT role',
            { field: 'departmentId' });
        }
        if (!(await findDepartment(body.departmentId))) throw notFound('Department');
        departmentId = body.departmentId;
      }
      const user = await setUserRole(id, role!, departmentId);
      if (!user) throw notFound('User');
      await recordAudit({
        userId: actor.id, action: 'USER_ROLE_CHANGED', resource: 'user',
        resourceId: id, metadata: { role, departmentId }, ipAddress: request.ip,
      });
      return { user };
    }

    throw badRequest('Provide isActive or role');
  });

  // --- departments ----------------------------------------------------------
  app.get('/departments', async () => ({ items: await listDepartments(true) }));

  app.post('/departments', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const v = new Validator(body);
    const name = v.string('name', { required: true, min: 2, max: 80 });
    const description = v.string('description', { max: 2000 });
    const email = v.string('email', { max: 200 });
    v.assert();

    const department = await createDepartment({
      name: name!, slug: slugify(name!),
      description: description ?? '', email: email ?? null,
    });
    await recordAudit({
      userId: request.currentUser!.id, action: 'DEPARTMENT_CREATED',
      resource: 'department', resourceId: department.id, ipAddress: request.ip,
    });
    // A new department gets no traffic until the model is retrained with
    // labelled examples for it — the admin page says so explicitly.
    return reply.status(201).send({ department, retrainingRequired: true });
  });

  app.patch('/departments/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const v = new Validator(body);
    const name = v.string('name', { min: 2, max: 80 });
    const description = v.string('description', { max: 2000 });
    const email = v.string('email', { max: 200 });
    v.assert();

    const department = await updateDepartment(id, {
      ...(name ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(typeof body.isActive === 'boolean' ? { isActive: body.isActive } : {}),
    });
    if (!department) throw notFound('Department');
    await recordAudit({
      userId: request.currentUser!.id, action: 'DEPARTMENT_UPDATED',
      resource: 'department', resourceId: id, ipAddress: request.ip,
    });
    return { department };
  });

  // --- models ---------------------------------------------------------------
  app.get('/models', async () => ({ items: await listModels() }));

  // --- contact messages -----------------------------------------------------
  app.get('/contacts', async (request) => {
    const q = request.query as Record<string, unknown>;
    const { page, pageSize } = parsePagination(q, 50);
    const status = ['NEW', 'READ', 'RESOLVED'].includes(q.status as string)
      ? (q.status as 'NEW' | 'READ' | 'RESOLVED') : undefined;
    const { items, total } = await listContacts({ ...(status ? { status } : {}), page, pageSize });
    return paginated(items, total, page, pageSize);
  });

  app.patch('/contacts/:id', async (request) => {
    const { id } = request.params as { id: string };
    const v = new Validator(request.body as Record<string, unknown>);
    const status = v.enum('status', ['NEW', 'READ', 'RESOLVED'] as const, true);
    v.assert();
    const contact = await setContactStatus(id, status!);
    if (!contact) throw notFound('Message');
    return { contact };
  });

  // --- audit ----------------------------------------------------------------
  app.get('/audit', async (request) => {
    const { page, pageSize } = parsePagination(request.query as Record<string, unknown>, 50);
    const { items, total } = await listAudit({ page, pageSize });
    return paginated(items, total, page, pageSize);
  });
}
