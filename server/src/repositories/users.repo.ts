import { query, type Queryable } from '../db/pool.ts';
import type { Role } from '../auth/tokens.ts';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: Role;
  department_id: string | null;
  phone: string | null;
  student_id: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Public shape — never includes password_hash. */
export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  departmentId: string | null;
  departmentName?: string | null;
  phone: string | null;
  studentId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const toPublicUser = (row: UserRow): PublicUser => ({
  id: row.id,
  email: row.email,
  firstName: row.first_name,
  lastName: row.last_name,
  role: row.role,
  departmentId: row.department_id,
  phone: row.phone,
  studentId: row.student_id,
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function createUser(input: {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role?: Role;
}, client?: Queryable): Promise<UserRow> {
  const { rows } = await query<UserRow>(
    `INSERT INTO users (email, password_hash, first_name, last_name, role)
     VALUES ($1,$2,$3,$4,$5::user_role) RETURNING *`,
    [input.email.toLowerCase(), input.passwordHash, input.firstName, input.lastName, input.role ?? 'STUDENT'],
    client,
  );
  return rows[0]!;
}

export async function updatePassword(userId: string, passwordHash: string): Promise<void> {
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
}

export interface ProfileUpdate {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  studentId?: string | null;
}

/**
 * Updates the account details a user is allowed to change about themselves.
 *
 * Deliberately cannot touch email, role, department or is_active — those are
 * not editable from the profile page, so they are not in the column map and no
 * amount of extra JSON in the request body can reach them.
 */
export async function updateOwnProfile(
  userId: string, input: ProfileUpdate,
): Promise<UserRow | null> {
  const map: Record<string, string> = {
    firstName: 'first_name', lastName: 'last_name',
    phone: 'phone', studentId: 'student_id',
  };
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [key, column] of Object.entries(map)) {
    if (!(key in input)) continue;
    values.push((input as Record<string, unknown>)[key]);
    sets.push(`${column} = $${values.length}`);
  }
  if (sets.length === 0) return findUserById(userId);

  values.push(userId);
  const { rows } = await query<UserRow>(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

/** True when another account already claims this student ID. */
export async function studentIdTaken(studentId: string, exceptUserId: string): Promise<boolean> {
  const { rowCount } = await query(
    'SELECT 1 FROM users WHERE lower(student_id) = lower($1) AND id <> $2',
    [studentId, exceptUserId],
  );
  return (rowCount ?? 0) > 0;
}

export async function listUsers(params: {
  search?: string; role?: Role; page: number; pageSize: number;
}): Promise<{ items: PublicUser[]; total: number }> {
  const where: string[] = [];
  const values: unknown[] = [];

  if (params.search?.trim()) {
    values.push(`%${params.search.trim()}%`);
    where.push(`(email ILIKE $${values.length} OR first_name ILIKE $${values.length} OR last_name ILIKE $${values.length})`);
  }
  if (params.role) {
    values.push(params.role);
    where.push(`role = $${values.length}::user_role`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const count = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM users u ${whereSql.replace(/\b(email|first_name|last_name|role)\b/g, 'u.$1')}`,
    values,
  );
  values.push(params.pageSize, (params.page - 1) * params.pageSize);
  const { rows } = await query<UserRow & { department_name: string | null }>(
    `SELECT u.*, d.name AS department_name
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     ${whereSql.replace(/\b(email|first_name|last_name|role)\b/g, 'u.$1')}
     ORDER BY u.created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return {
    items: rows.map((r) => ({ ...toPublicUser(r), departmentName: r.department_name })),
    total: count.rows[0]?.count ?? 0,
  };
}

export async function setUserActive(id: string, isActive: boolean): Promise<PublicUser | null> {
  const { rows } = await query<UserRow>(
    'UPDATE users SET is_active = $2 WHERE id = $1 RETURNING *', [id, isActive],
  );
  return rows[0] ? toPublicUser(rows[0]) : null;
}

/**
 * Changing a role also settles the department link: DEPARTMENT staff must have
 * one (the schema enforces it), and anyone else must not.
 */
export async function setUserRole(
  id: string, role: Role, departmentId?: string | null,
): Promise<PublicUser | null> {
  const { rows } = await query<UserRow>(
    `UPDATE users
     SET role = $2::user_role,
         department_id = CASE WHEN $2 = 'DEPARTMENT' THEN $3::uuid ELSE NULL END
     WHERE id = $1 RETURNING *`,
    [id, role, departmentId ?? null],
  );
  return rows[0] ? toPublicUser(rows[0]) : null;
}

// --- password reset ---------------------------------------------------------

export async function storeResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
  await query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
    [userId, tokenHash, expiresAt],
  );
}

export async function consumeResetToken(tokenHash: string): Promise<string | null> {
  // Single statement: marking used and reading the owner cannot race.
  const { rows } = await query<{ user_id: string }>(
    `UPDATE password_reset_tokens SET used_at = now()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [tokenHash],
  );
  return rows[0]?.user_id ?? null;
}
