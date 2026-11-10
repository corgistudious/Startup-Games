import type { Db, Tx, Queryable } from './db';
import { withTx, maybe } from './db';

export type Job = { id: number; kind: string; dedupe_key: string; payload: Record<string, unknown>; game_minute: number; attempts: number };
export type JobHandler = (tx: Tx, job: Job) => Promise<void>;

/** Enqueue once: a repeated dedupe key is ignored, so re-running a tick never duplicates work. */
export async function enqueue(q: Queryable, kind: string, dedupeKey: string, gameMinute: number, payload: Record<string, unknown> = {}, runAfter?: Date) {
  const r = await q.query(
    `INSERT INTO jobs (kind, dedupe_key, game_minute, payload, run_after) VALUES ($1,$2,$3,$4,COALESCE($5, now()))
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [kind, dedupeKey, gameMinute, payload, runAfter ?? null],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Return jobs left 'running' by a crashed worker to the queue. Safe because effects commit with 'done'. */
export async function recoverStaleJobs(db: Queryable, olderThanSeconds = 120) {
  const r = await db.query(
    `UPDATE jobs SET status='pending', locked_by=NULL, locked_at=NULL WHERE status='running' AND locked_at < now() - make_interval(secs => $1)`,
    [olderThanSeconds],
  );
  return r.rowCount ?? 0;
}

/**
 * Claim and run one job. The handler's effects and the 'done' marker commit in the
 * same transaction, so a job is applied exactly once even across crashes/retries.
 */
export async function runOneJob(db: Db, workerId: string, handlers: Record<string, JobHandler>): Promise<boolean> {
  const job = await maybe<Job>(
    db,
    `UPDATE jobs SET status='running', locked_by=$1, locked_at=now(), attempts=attempts+1
      WHERE id = (SELECT id FROM jobs WHERE status='pending' AND run_after <= now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id, kind, dedupe_key, payload, game_minute, attempts`,
    [workerId],
  );
  if (!job) return false;
  const handler = handlers[job.kind];
  try {
    if (!handler) throw new Error(`no handler for job kind ${job.kind}`);
    await withTx(db, async (tx) => {
      const lock = await maybe(tx, `SELECT id FROM jobs WHERE id=$1 AND status='running' AND locked_by=$2 FOR UPDATE`, [job.id, workerId]);
      if (!lock) return; // reclaimed by recovery; another worker owns it now
      await handler(tx, job);
      await tx.query(`UPDATE jobs SET status='done', finished_at=now(), last_error=NULL WHERE id=$1`, [job.id]);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const final = job.attempts >= 5;
    await db.query(
      `UPDATE jobs SET status=$2, last_error=$3, locked_by=NULL, locked_at=NULL,
              run_after = now() + make_interval(secs => $4) WHERE id=$1`,
      [job.id, final ? 'failed' : 'pending', msg.slice(0, 1000), Math.min(300, 2 ** job.attempts * 5)],
    );
  }
  return true;
}
