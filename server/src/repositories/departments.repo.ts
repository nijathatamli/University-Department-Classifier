import { query } from '../db/pool.ts';

export interface DepartmentRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  email: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export async function listDepartments(includeInactive = false): Promise<DepartmentRow[]> {
  const { rows } = await query<DepartmentRow>(
    `SELECT * FROM departments ${includeInactive ? '' : 'WHERE is_active = true'} ORDER BY name`,
  );
  return rows;
}

export async function findDepartment(idOrSlug: string): Promise<DepartmentRow | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const { rows } = await query<DepartmentRow>(
    `SELECT * FROM departments WHERE ${isUuid ? 'id = $1' : 'slug = $1'}`, [idOrSlug],
  );
  return rows[0] ?? null;
}

/** Resolves a model label ("İT Dəstək") to the department row it routes to. */
export async function findDepartmentByName(name: string): Promise<DepartmentRow | null> {
  const { rows } = await query<DepartmentRow>(
    'SELECT * FROM departments WHERE lower(name) = lower($1)', [name],
  );
  return rows[0] ?? null;
}

export async function createDepartment(input: {
  name: string; slug: string; description?: string; email?: string | null;
}): Promise<DepartmentRow> {
  const { rows } = await query<DepartmentRow>(
    `INSERT INTO departments (name, slug, description, email)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [input.name, input.slug, input.description ?? '', input.email ?? null],
  );
  return rows[0]!;
}

export async function updateDepartment(
  id: string,
  input: Partial<{ name: string; slug: string; description: string; email: string | null; isActive: boolean }>,
): Promise<DepartmentRow | null> {
  const map: Record<string, string> = {
    name: 'name', slug: 'slug', description: 'description', email: 'email', isActive: 'is_active',
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(map)) {
    const value = (input as Record<string, unknown>)[key];
    if (value === undefined) continue;
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }
  if (sets.length === 0) return findDepartment(id);
  values.push(id);
  const { rows } = await query<DepartmentRow>(
    `UPDATE departments SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values,
  );
  return rows[0] ?? null;
}
