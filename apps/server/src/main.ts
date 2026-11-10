import { createPool, migrate } from '@startup/engine';
import { buildApp } from './app.js';

const db = createPool();
if (process.env.MIGRATE_ON_START !== 'false') await migrate(db);
const app = await buildApp(db, {
  logger: true,
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
});
const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: '0.0.0.0' });

// Graceful shutdown: stop accepting requests, finish in-flight ones, close the pool.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    app.log.info(`${sig} received, shutting down`);
    await app.close();
    await db.end();
    process.exit(0);
  });
}
