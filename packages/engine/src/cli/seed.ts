import { createPool } from '../db';
import { migrate } from '../migrate';
import { initWorld } from '../genesis';

/** Idempotent: creates the world only if it does not exist; refreshes catalogue otherwise. */
const db = createPool();
await migrate(db);
await initWorld(db);
console.log('World ready.');
await db.end();
