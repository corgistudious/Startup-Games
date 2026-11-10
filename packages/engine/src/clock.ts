import { gameMinuteAt, TICK_MINUTES } from '@startup/shared';
import { one, type Queryable } from './db';

let cachedEpoch: number | null = null;

export async function getEpoch(q: Queryable): Promise<number> {
  if (cachedEpoch !== null) return cachedEpoch;
  const r = await one<{ epoch: Date }>(q, 'SELECT epoch FROM world_config WHERE id = 1');
  cachedEpoch = r.epoch.getTime();
  return cachedEpoch;
}
export function resetEpochCache() {
  cachedEpoch = null;
}

/** Overridable clock source, used by tests and the simulation runner. */
let nowFn: () => number = () => Date.now();
export function setNow(fn: () => number) {
  nowFn = fn;
}
export const realNow = () => nowFn();

export async function nowMinute(q: Queryable): Promise<number> {
  return gameMinuteAt(nowFn(), await getEpoch(q));
}
export const tickOf = (minute: number) => Math.floor(minute / TICK_MINUTES);
