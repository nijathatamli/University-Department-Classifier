/**
 * Database CLI:  npm run db:setup | db:migrate | db:seed | db:reset
 */
import pg from 'pg';
import { env } from '../config/env.ts';
import { closePool } from './pool.ts';
import { dropAll, runMigrations } from './migrate.ts';
import { runSeed } from './seeds/index.ts';

/** Connects to the maintenance database so the target database can be created. */
async function createDatabaseIfMissing(): Promise<boolean> {
  const url = new URL(env.databaseUrl);
  const dbName = url.pathname.replace(/^\//, '');
  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';

  const admin = new pg.Client({
    connectionString: adminUrl.toString(),
    ...(env.databaseSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rowCount === 0) {
      // Identifier cannot be parameterised; quote it instead.
      await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
      return true;
    }
    return false;
  } finally {
    await admin.end();
  }
}

const command = process.argv[2] ?? 'migrate';

try {
  switch (command) {
    case 'setup': {
      const created = await createDatabaseIfMissing();
      console.log(created ? 'Database created.' : 'Database already exists.');
      console.log('Running migrations...');
      await runMigrations();
      console.log('Seeding...');
      await runSeed();
      console.log('Setup complete.');
      break;
    }
    case 'migrate':
      console.log('Running migrations...');
      await runMigrations();
      console.log('Migrations up to date.');
      break;
    case 'seed':
      console.log('Seeding...');
      await runSeed();
      console.log('Seed complete.');
      break;
    case 'reset': {
      if (env.isProduction) throw new Error('Refusing to run db:reset with NODE_ENV=production.');
      await createDatabaseIfMissing();
      console.log('Dropping schema...');
      await dropAll();
      console.log('Running migrations...');
      await runMigrations();
      console.log('Seeding...');
      await runSeed();
      console.log('Reset complete.');
      break;
    }
    default:
      console.error(`Unknown command "${command}". Use: setup | migrate | seed | reset`);
      process.exitCode = 1;
  }
} catch (error) {
  console.error(`\n${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
