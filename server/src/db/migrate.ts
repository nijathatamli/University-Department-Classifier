import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pool } from './pool.ts';

const MIGRATIONS_DIR = resolve(import.meta.dirname, 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Applies every .sql file in migrations/ that has not run yet, in filename
 * order. Each migration runs inside its own transaction, so a failure leaves
 * the database on the last good migration rather than half-applied.
 */
export async function runMigrations(log: (m: string) => void = console.log): Promise<number> {
  await ensureMigrationsTable();

  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(resolve(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log(`  applied ${file}`);
      count += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
    } finally {
      client.release();
    }
  }

  if (count === 0) log('  no pending migrations');
  return count;
}

/** Drops every object in the public schema. Used by `db:reset` and the tests. */
export async function dropAll(): Promise<void> {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}
