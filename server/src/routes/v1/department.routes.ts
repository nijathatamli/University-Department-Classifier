import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../auth/middleware.ts';
import { forbidden } from '../../lib/errors.ts';
import { paginated } from '../../lib/http.ts';
import { parsePagination } from '../../lib/validation.ts';
import { findDepartment } from '../../repositories/departments.repo.ts';
import {
  listRequestsForDepartment, requestStats, type RequestStatus,
} from '../../repositories/requests.repo.ts';
import { shapeRequest } from './requests.routes.ts';

const STATUSES = ['NEW', 'IN_REVIEW', 'RESOLVED'] as const;

/**
 * The department-side queue.
 *
 * Staff only ever see their own department's tickets: the department id comes
 * from the authenticated session, never from a query parameter, so there is no
 * parameter to tamper with.
 */
export default async function departmentQueueRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireRole('DEPARTMENT', 'ADMIN'));

  app.get('/me', async (request) => {
    const user = request.currentUser!;
    if (user.role === 'ADMIN') return { department: null, role: 'ADMIN' };
    if (!user.departmentId) throw forbidden('No department is assigned to this account');
    const department = await findDepartment(user.departmentId);
    return {
      department: department
        ? { id: department.id, name: department.name, slug: department.slug }
        : null,
      role: user.role,
    };
  });

  app.get('/requests', async (request) => {
    const user = request.currentUser!;
    const q = request.query as Record<string, unknown>;
    const { page, pageSize } = parsePagination(q, 25);
    const status = STATUSES.includes(q.status as never) ? (q.status as RequestStatus) : undefined;

    // An admin may inspect any queue; staff are pinned to their own.
    const departmentId =
      user.role === 'ADMIN' && typeof q.departmentId === 'string' && q.departmentId
        ? q.departmentId
        : user.departmentId;

    if (!departmentId) throw forbidden('No department is assigned to this account');

    const { items, total } = await listRequestsForDepartment({
      departmentId, page, pageSize, ...(status ? { status } : {}),
    });
    return paginated(items.map((r) => shapeRequest(r, true)), total, page, pageSize);
  });

  /** Counts for the queue header, scoped to the caller's department. */
  app.get('/stats', async (request) => {
    const user = request.currentUser!;
    const departmentId = user.departmentId;
    if (user.role === 'ADMIN' && !departmentId) return requestStats();
    if (!departmentId) throw forbidden('No department is assigned to this account');

    const counts = await Promise.all(
      STATUSES.map(async (status) => {
        const { total } = await listRequestsForDepartment({
          departmentId, page: 1, pageSize: 1, status,
        });
        return [status, total] as const;
      }),
    );
    return { byStatus: Object.fromEntries(counts) };
  });
}
