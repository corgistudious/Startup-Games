import { createPool, type Db, withTx, one, many } from '../src/db';
import { migrate } from '../src/migrate';
import { initWorld } from '../src/genesis';
import { setNow, resetEpochCache, nowMinute } from '../src/clock';
import { processDueTicks, handlers } from '../src/world';
import { runOneJob } from '../src/jobs';
import { registerUser } from '../src/auth';

export const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/startup_test';

let now = Date.UTC(2026, 10, 1, 0, 0, 0);
export const clock = {
  get: () => now,
  set: (ms: number) => {
    now = ms;
  },
  /** Advance real time by game minutes (1 real minute = 30 game minutes). */
  advanceGame: (gameMinutes: number) => {
    now += (gameMinutes * 60_000) / 30;
  },
};
setNow(() => now);

/** Fresh schema per test file. */
export async function freshWorld(opts: { npcs?: boolean } = {}): Promise<Db> {
  const db = createPool(TEST_URL);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  resetEpochCache();
  await migrate(db);
  now = Date.UTC(2026, 10, 1, 0, 0, 0);
  // Epoch chosen so the world starts at 07:00 Thứ Hai.
  await initWorld(db, { epochMs: now - (7 * 60 * 60_000) / 30, npcs: opts.npcs });
  return db;
}

export async function drainJobs(db: Db, limit = 100_000) {
  let n = 0;
  while (n < limit && (await runOneJob(db, 'test-worker', handlers))) n++;
  const failed = await many<{ kind: string; last_error: string }>(db, `SELECT kind, last_error FROM jobs WHERE status IN ('failed') OR (status='pending' AND attempts > 0)`);
  if (failed.length) throw new Error(`jobs failed: ${failed.slice(0, 3).map((f) => `${f.kind}: ${f.last_error}`).join(' | ')}`);
  return n;
}

/** Advance the world by game minutes, processing every tick and job in order. */
export async function advance(db: Db, gameMinutes: number) {
  const step = 30;
  for (let m = 0; m < gameMinutes; m += step) {
    clock.advanceGame(step);
    await processDueTicks(db, 10_000);
    await drainJobs(db);
  }
}

export async function newPlayer(db: Db, username: string) {
  const id = await registerUser(db, { username, password: 'Correct-horse-42', displayName: username });
  // Pretend the account is older than the anti-spam window for reviews.
  await db.query(`UPDATE users SET created_at = now() - interval '1 day' WHERE id=$1`, [id]);
  return id;
}

export const minute = (db: Db) => nowMinute(db);
export const tx = withTx;
export { one, many };
