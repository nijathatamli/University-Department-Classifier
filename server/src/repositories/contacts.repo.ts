import { query } from '../db/pool.ts';

export interface ContactRow {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: 'NEW' | 'READ' | 'RESOLVED';
  created_at: Date;
}

export async function createContact(input: {
  name: string; email: string; subject: string; message: string;
}): Promise<ContactRow> {
  const { rows } = await query<ContactRow>(
    `INSERT INTO contacts (name, email, subject, message)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [input.name, input.email.toLowerCase(), input.subject, input.message],
  );
  return rows[0]!;
}

export async function listContacts(params: {
  status?: ContactRow['status']; page: number; pageSize: number;
}): Promise<{ items: ContactRow[]; total: number }> {
  const values: unknown[] = [];
  let whereSql = '';
  if (params.status) {
    values.push(params.status);
    whereSql = `WHERE status = $${values.length}::contact_state`;
  }
  const count = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM contacts ${whereSql}`, values,
  );
  values.push(params.pageSize, (params.page - 1) * params.pageSize);
  const { rows } = await query<ContactRow>(
    `SELECT * FROM contacts ${whereSql} ORDER BY created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return { items: rows, total: count.rows[0]?.count ?? 0 };
}

export async function setContactStatus(
  id: string, status: ContactRow['status'],
): Promise<ContactRow | null> {
  const { rows } = await query<ContactRow>(
    'UPDATE contacts SET status = $2::contact_state WHERE id = $1 RETURNING *', [id, status],
  );
  return rows[0] ?? null;
}
