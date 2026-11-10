import { hostname } from 'node:os';
import { createPool, migrate, initWorld, processDueTicks, runOneJob, recoverStaleJobs, handlers, applyReviewerInactivity, withTx } from '@startup/engine';

/**
 * World worker: the only process that advances time.
 *  - every 2s: schedule any due ticks (catch-up after downtime included);
 *  - continuously: run queued jobs (several worker processes may run safely: SKIP LOCKED);
 *  - every 10 min: real-time reviewer inactivity rule;
 *  - heartbeat row for the admin dashboard.
 * Only one process should schedule ticks; scheduling is idempotent anyway (tick PK).
 */
const db = createPool();
const id = `${hostname()}:${process.pid}`;
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 2);
let stopping = false;
let processed = 0;

if (process.env.MIGRATE_ON_START !== 'false') await migrate(db);
if (process.env.INIT_WORLD !== 'false') await initWorld(db);
const recovered = await recoverStaleJobs(db, 0);
console.log(`[worker ${id}] started, recovered ${recovered} stale jobs`);

async function scheduler() {
  while (!stopping) {
    try {
      const r = await processDueTicks(db);
      if (r.scheduled) console.log(`[worker] ticks ${r.from}..${r.to}: ${r.scheduled} jobs`);
    } catch (e) {
      console.error('[worker] scheduler error', e);
    }
    await sleep(2000);
  }
}

async function runner(n: number) {
  while (!stopping) {
    try {
      const did = await runOneJob(db, `${id}#${n}`, handlers);
      if (did) {
        processed++;
        continue;
      }
    } catch (e) {
      console.error('[worker] runner error', e);
    }
    await sleep(500);
  }
}

async function housekeeping() {
  while (!stopping) {
    try {
      await recoverStaleJobs(db, 120);
      const penalties = await withTx(db, (tx) => applyReviewerInactivity(tx));
      if (penalties) console.log(`[worker] reviewer inactivity penalties: ${penalties}`);
      await db.query(`DELETE FROM jobs WHERE status='done' AND finished_at < now() - interval '3 days'`);
    } catch (e) {
      console.error('[worker] housekeeping error', e);
    }
    await sleep(10 * 60_000);
  }
}

async function heartbeat() {
  while (!stopping) {
    await db
      .query(
        `INSERT INTO worker_heartbeats (worker_id, role, last_beat, info) VALUES ($1,'world',now(),$2)
         ON CONFLICT (worker_id) DO UPDATE SET last_beat=now(), info=EXCLUDED.info`,
        [id, { processed, concurrency, rss: process.memoryUsage().rss }],
      )
      .catch(() => undefined);
    await sleep(15_000);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const loops = [scheduler(), heartbeat(), housekeeping(), ...Array.from({ length: concurrency }, (_, i) => runner(i))];

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    console.log(`[worker] ${sig}: finishing current jobs`);
    stopping = true;
    // Housekeeping sleeps up to 10 minutes; do not wait for it.
    await Promise.race([Promise.all(loops), sleep(15_000)]);
    await db.end();
    process.exit(0);
  });
}
