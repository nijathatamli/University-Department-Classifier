import { buildApp } from './app.ts';
import { env } from './config/env.ts';
import { closePool, pool } from './db/pool.ts';

const app = await buildApp();

try {
  // Fail fast with a clear message rather than serving a broken app.
  await pool.query('SELECT 1');
} catch (error) {
  app.log.error(
    `Cannot reach PostgreSQL at DATABASE_URL. Run "npm run db:setup". (${(error as Error).message})`,
  );
  process.exit(1);
}

await app.listen({ port: env.port, host: env.host });
app.log.info(`UDC server listening on http://${env.host}:${env.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await closePool();
    process.exit(0);
  });
}
