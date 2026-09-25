import { classifyText } from '../lib/classifier-client.ts';
import { AppError, forbidden, notFound, unprocessable } from '../lib/errors.ts';
import { recordAudit } from '../repositories/audit.repo.ts';
import { findDepartmentByName } from '../repositories/departments.repo.ts';
import {
  createRequestWithPrediction, findRequest, updateStatus,
  type RequestStatus, type RequestView,
} from '../repositories/requests.repo.ts';
import type { Role } from '../auth/tokens.ts';

/**
 * Submits a student message: classify -> resolve the department -> create the
 * ticket assigned to it. All three happen before anything is returned, so a
 * student never sees a prediction that was not actually routed.
 */
export async function submitRequest(params: {
  userId: string; message: string; ip?: string;
}): Promise<RequestView> {
  const message = params.message.trim();

  // The prediction comes from the trained model, never from keyword rules here.
  const prediction = await classifyText(message);

  const department = await findDepartmentByName(prediction.label);
  if (!department) {
    // The model knows a label the database has no department for — a
    // retraining/seed mismatch. Fail loudly rather than mis-routing.
    throw new AppError(500, 'ROUTING_FAILED',
      'The predicted department is not configured. Please contact an administrator.');
  }

  const request = await createRequestWithPrediction({
    userId: params.userId,
    message,
    departmentId: department.id,
    confidence: prediction.confidence,
    modelVersion: prediction.modelVersion,
    probabilities: prediction.probabilities,
  });

  await recordAudit({
    userId: params.userId, action: 'REQUEST_SUBMITTED', resource: 'request',
    resourceId: request.id,
    metadata: {
      department: department.name,
      confidence: prediction.confidence,
      modelVersion: prediction.modelVersion,
    },
    ipAddress: params.ip,
  });

  const view = await findRequest(request.id);
  if (!view) throw notFound('Request');
  return view;
}

/**
 * Ownership rules for a single ticket, enforced here rather than in a route:
 *   - the student who submitted it,
 *   - staff of the department it is assigned to,
 *   - any admin.
 */
export async function getRequestFor(
  requestId: string,
  viewer: { id: string; role: Role; departmentId: string | null },
): Promise<RequestView> {
  const request = await findRequest(requestId);
  if (!request) throw notFound('Request');

  if (viewer.role === 'ADMIN') return request;
  if (request.user_id === viewer.id) return request;
  if (
    viewer.role === 'DEPARTMENT' &&
    viewer.departmentId &&
    request.assigned_department_id === viewer.departmentId
  ) {
    return request;
  }
  throw forbidden();
}

const ALLOWED: RequestStatus[] = ['NEW', 'IN_REVIEW', 'RESOLVED'];

/**
 * Only department staff handling the ticket, or an admin, may move its status.
 * A student can read their ticket but cannot resolve it themselves.
 */
export async function changeStatus(params: {
  requestId: string;
  status: string;
  actor: { id: string; role: Role; departmentId: string | null };
  ip?: string;
}): Promise<RequestView> {
  if (!ALLOWED.includes(params.status as RequestStatus)) {
    throw unprocessable(`status must be one of: ${ALLOWED.join(', ')}`, { field: 'status' });
  }

  const request = await findRequest(params.requestId);
  if (!request) throw notFound('Request');

  const isAdmin = params.actor.role === 'ADMIN';
  const isOwningDepartment =
    params.actor.role === 'DEPARTMENT' &&
    !!params.actor.departmentId &&
    request.assigned_department_id === params.actor.departmentId;

  if (!isAdmin && !isOwningDepartment) throw forbidden();

  const updated = await updateStatus(params.requestId, params.status as RequestStatus);
  if (!updated) throw notFound('Request');

  await recordAudit({
    userId: params.actor.id, action: 'REQUEST_STATUS_CHANGED', resource: 'request',
    resourceId: params.requestId,
    metadata: { from: request.status, to: params.status },
    ipAddress: params.ip,
  });

  return updated;
}
