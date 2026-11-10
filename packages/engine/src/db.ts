import pg from 'pg';

// int8 -> number (all amounts stay well below 2^53), numeric -> number.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error('DATABASE_URL is not set');
  return new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10) });
}

const RETRYABLE = new Set(['40001', '40P01']); // serialization failure, deadlock

/** Run fn inside a transaction. Retries on deadlock/serialization failures. */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      const code = (err as { code?: string }).code;
      if (code && RETRYABLE.has(code) && attempt < retries) continue;
      throw err;
    } finally {
      client.release();
    }
  }
}

let spSeq = 0;
/**
 * Run fn inside a savepoint: on failure, roll back only fn's work and return undefined,
 * leaving the outer transaction usable (Postgres aborts a transaction on any error otherwise).
 */
export async function attempt<T>(tx: Tx, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const sp = `sp_${++spSeq}`;
  await tx.query(`SAVEPOINT ${sp}`);
  try {
    const value = await fn();
    await tx.query(`RELEASE SAVEPOINT ${sp}`);
    return { ok: true, value };
  } catch (error) {
    await tx.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    return { ok: false, error };
  }
}

export async function one<T = Record<string, unknown>>(q: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const r = await q.query(sql, params);
  if (r.rowCount === 0) throw new Error(`expected one row: ${sql.slice(0, 80)}`);
  return r.rows[0] as T;
}
export async function maybe<T = Record<string, unknown>>(q: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await q.query(sql, params);
  return (r.rows[0] as T) ?? null;
}
export async function many<T = Record<string, unknown>>(q: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await q.query(sql, params);
  return r.rows as T[];
}
