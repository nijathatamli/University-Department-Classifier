import { query } from '../db/pool.ts';

/**
 * Append-only audit trail for sensitive actions (auth, deletions, role changes,
 * admin writes). Metadata must never contain credentials or tokens.
 */
export async function recordAudit(entry: {
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, resource, resource_id, metadata, ip_address)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [entry.userId ?? null, entry.action, entry.resource, entry.resourceId ?? null,
       JSON.stringify(entry.metadata ?? {}), entry.ipAddress ?? null],
    );
  } catch {
    // Auditing must never break the request it is recording.
  }
}

export async function listAudit(params: { page: number; pageSize: number }) {
  const count = await query<{ count: number }>('SELECT count(*)::int AS count FROM audit_logs');
  const { rows } = await query(
    `SELECT a.*, u.email AS user_email FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
    [params.pageSize, (params.page - 1) * params.pageSize],
  );
  return { items: rows, total: count.rows[0]?.count ?? 0 };
}
