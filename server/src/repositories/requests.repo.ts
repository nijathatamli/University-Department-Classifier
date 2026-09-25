import { query, withTransaction } from '../db/pool.ts';
import type { Probability } from '../lib/classifier-client.ts';

export type RequestStatus = 'NEW' | 'IN_REVIEW' | 'RESOLVED';

export interface RequestRow {
  id: string;
  ticket_number: number;
  user_id: string;
  message: string;
  status: RequestStatus;
  assigned_department_id: string | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** A request joined with its department and latest prediction, for display. */
export interface RequestView extends RequestRow {
  department_name: string | null;
  department_slug: string | null;
  confidence: number | null;
  model_version: string | null;
  probabilities: Probability[] | null;
  student_first_name?: string;
  student_last_name?: string;
  student_email?: string;
}

const VIEW_SELECT = `
  SELECT r.*,
         d.name AS department_name,
         d.slug AS department_slug,
         p.confidence,
         p.model_version,
         p.probabilities
  FROM requests r
  LEFT JOIN departments d ON d.id = r.assigned_department_id
  LEFT JOIN LATERAL (
    SELECT confidence, model_version, probabilities
    FROM request_predictions
    WHERE request_id = r.id
    ORDER BY created_at DESC
    LIMIT 1
  ) p ON true`;

/**
 * Creates the ticket and stores the classification that routed it, atomically.
 * A request must never exist without the prediction that assigned it.
 */
export async function createRequestWithPrediction(input: {
  userId: string;
  message: string;
  departmentId: string;
  confidence: number;
  modelVersion: string;
  probabilities: Probability[];
}): Promise<RequestRow> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<RequestRow>(
      `INSERT INTO requests (user_id, message, assigned_department_id, status)
       VALUES ($1,$2,$3,'NEW') RETURNING *`,
      [input.userId, input.message, input.departmentId],
    );
    const request = rows[0]!;

    await client.query(
      `INSERT INTO request_predictions
         (request_id, department_id, confidence, model_version, probabilities)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [request.id, input.departmentId, input.confidence, input.modelVersion,
       JSON.stringify(input.probabilities)],
    );

    return request;
  });
}

/**
 * A single request, including who submitted it. The student fields are always
 * selected here; whether they are serialised is decided by the route, which
 * knows the viewer's role.
 */
export async function findRequest(id: string): Promise<RequestView | null> {
  const { rows } = await query<RequestView>(
    `SELECT v.*, u.first_name AS student_first_name, u.last_name AS student_last_name,
            u.email AS student_email
     FROM (${VIEW_SELECT} WHERE r.id = $1) v
     JOIN users u ON u.id = v.user_id`,
    [id],
  );
  return rows[0] ?? null;
}

/** A student's own requests, newest first. */
export async function listRequestsForUser(params: {
  userId: string; page: number; pageSize: number; status?: RequestStatus;
}): Promise<{ items: RequestView[]; total: number }> {
  const where = ['r.user_id = $1'];
  const values: unknown[] = [params.userId];
  if (params.status) {
    values.push(params.status);
    where.push(`r.status = $${values.length}::request_status`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const count = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM requests r ${whereSql}`, values,
  );
  values.push(params.pageSize, (params.page - 1) * params.pageSize);
  const { rows } = await query<RequestView>(
    `${VIEW_SELECT} ${whereSql} ORDER BY r.created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return { items: rows, total: count.rows[0]?.count ?? 0 };
}

/**
 * The queue for one department. Staff see the student's name here — they need
 * it to act on the ticket — but never another department's queue.
 */
export async function listRequestsForDepartment(params: {
  departmentId: string; page: number; pageSize: number; status?: RequestStatus;
}): Promise<{ items: RequestView[]; total: number }> {
  const where = ['r.assigned_department_id = $1'];
  const values: unknown[] = [params.departmentId];
  if (params.status) {
    values.push(params.status);
    where.push(`r.status = $${values.length}::request_status`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const count = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM requests r ${whereSql}`, values,
  );
  values.push(params.pageSize, (params.page - 1) * params.pageSize);
  const { rows } = await query<RequestView>(
    `SELECT v.*, u.first_name AS student_first_name, u.last_name AS student_last_name,
            u.email AS student_email
     FROM (${VIEW_SELECT} ${whereSql}) v
     JOIN users u ON u.id = v.user_id
     ORDER BY
       CASE v.status WHEN 'NEW' THEN 0 WHEN 'IN_REVIEW' THEN 1 ELSE 2 END,
       v.created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return { items: rows, total: count.rows[0]?.count ?? 0 };
}

export async function updateStatus(
  id: string, status: RequestStatus,
): Promise<RequestView | null> {
  await query(
    `UPDATE requests
     SET status = $2::request_status,
         resolved_at = CASE WHEN $2 = 'RESOLVED' THEN now() ELSE NULL END
     WHERE id = $1`,
    [id, status],
  );
  return findRequest(id);
}

export async function reassign(
  id: string, departmentId: string,
): Promise<RequestView | null> {
  await query('UPDATE requests SET assigned_department_id = $2 WHERE id = $1', [id, departmentId]);
  return findRequest(id);
}

// --- admin / analytics ------------------------------------------------------

export async function adminListRequests(params: {
  page: number; pageSize: number; departmentId?: string; status?: RequestStatus; search?: string;
}) {
  const where: string[] = [];
  const values: unknown[] = [];
  if (params.departmentId) {
    values.push(params.departmentId);
    where.push(`r.assigned_department_id = $${values.length}`);
  }
  if (params.status) {
    values.push(params.status);
    where.push(`r.status = $${values.length}::request_status`);
  }
  if (params.search?.trim()) {
    values.push(`%${params.search.trim()}%`);
    where.push(`r.message ILIKE $${values.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const count = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM requests r ${whereSql}`, values,
  );
  values.push(params.pageSize, (params.page - 1) * params.pageSize);
  const { rows } = await query<RequestView>(
    `SELECT v.*, u.email AS student_email
     FROM (${VIEW_SELECT} ${whereSql}) v
     JOIN users u ON u.id = v.user_id
     ORDER BY v.created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return { items: rows, total: count.rows[0]?.count ?? 0 };
}

export async function requestStats() {
  const [totals, byDepartment, byStatus, avgConfidence, volume] = await Promise.all([
    query<{ count: number }>('SELECT count(*)::int AS count FROM requests'),
    query<{ name: string; slug: string; count: number }>(
      `SELECT d.name, d.slug, count(r.id)::int AS count
       FROM departments d
       LEFT JOIN requests r ON r.assigned_department_id = d.id
       GROUP BY d.id, d.name, d.slug
       ORDER BY count DESC, d.name`),
    query<{ status: string; count: number }>(
      `SELECT status::text AS status, count(*)::int AS count
       FROM requests GROUP BY status`),
    query<{ avg: number | null }>(
      'SELECT avg(confidence)::float AS avg FROM request_predictions'),
    query<{ day: string; count: number }>(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS count
       FROM requests WHERE created_at > now() - interval '14 days'
       GROUP BY 1 ORDER BY 1`),
  ]);

  return {
    totalRequests: totals.rows[0]?.count ?? 0,
    byDepartment: byDepartment.rows,
    byStatus: byStatus.rows,
    averageConfidence: avgConfidence.rows[0]?.avg ?? null,
    volume: volume.rows,
  };
}

/** Low-confidence tickets are the ones worth reviewing by hand. */
export async function lowConfidenceRequests(threshold = 0.5, limit = 10) {
  const { rows } = await query<RequestView>(
    `${VIEW_SELECT}
     WHERE EXISTS (
       SELECT 1 FROM request_predictions p2
       WHERE p2.request_id = r.id AND p2.confidence < $1
     )
     ORDER BY r.created_at DESC LIMIT $2`,
    [threshold, limit],
  );
  return rows;
}
