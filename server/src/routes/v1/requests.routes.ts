import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../auth/middleware.ts';
import { paginated, rateLimitConfig } from '../../lib/http.ts';
import { Validator, parsePagination } from '../../lib/validation.ts';
import * as requestService from '../../services/request.service.ts';
import {
  listRequestsForUser, type RequestStatus, type RequestView,
} from '../../repositories/requests.repo.ts';

const STATUSES = ['NEW', 'IN_REVIEW', 'RESOLVED'] as const;

/** Shared response shape. Student identity is only included where allowed. */
export const shapeRequest = (r: RequestView, includeStudent = false) => ({
  id: r.id,
  ticketNumber: r.ticket_number,
  message: r.message,
  status: r.status,
  department: r.department_name
    ? { id: r.assigned_department_id, name: r.department_name, slug: r.department_slug }
    : null,
  confidence: r.confidence,
  modelVersion: r.model_version,
  probabilities: r.probabilities ?? [],
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  resolvedAt: r.resolved_at,
  ...(includeStudent
    ? {
        student: {
          firstName: r.student_first_name,
          lastName: r.student_last_name,
          email: r.student_email,
        },
      }
    : {}),
});

export default async function requestRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  /**
   * POST /api/v1/requests — the core flow.
   * Classifies the message with the trained model and creates the routed ticket.
   */
  app.post('/', { config: rateLimitConfig(20, '1 minute') }, async (request, reply) => {
    const v = new Validator(request.body as Record<string, unknown>);
    const message = v.string('message', { required: true, min: 10, max: 4000 });
    v.assert();

    const created = await requestService.submitRequest({
      userId: request.currentUser!.id,
      message: message!,
      ip: request.ip,
    });
    return reply.status(201).send({ request: shapeRequest(created) });
  });

  /** The signed-in student's own requests. */
  app.get('/', async (request) => {
    const q = request.query as Record<string, unknown>;
    const { page, pageSize } = parsePagination(q, 25);
    const status = STATUSES.includes(q.status as never)
      ? (q.status as RequestStatus) : undefined;

    const { items, total } = await listRequestsForUser({
      userId: request.currentUser!.id, page, pageSize, ...(status ? { status } : {}),
    });
    return paginated(items.map((r) => shapeRequest(r)), total, page, pageSize);
  });

  app.get('/:id', async (request) => {
    const { id } = request.params as { id: string };
    const viewer = request.currentUser!;
    const found = await requestService.getRequestFor(id, {
      id: viewer.id, role: viewer.role, departmentId: viewer.departmentId,
    });
    // Department staff and admins need to know who submitted it.
    return { request: shapeRequest(found, viewer.role !== 'STUDENT') };
  });

  app.patch('/:id/status', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const viewer = request.currentUser!;

    const updated = await requestService.changeStatus({
      requestId: id,
      status: String(body.status ?? ''),
      actor: { id: viewer.id, role: viewer.role, departmentId: viewer.departmentId },
      ip: request.ip,
    });
    return { request: shapeRequest(updated, viewer.role !== 'STUDENT') };
  });
}
