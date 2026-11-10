import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from 'node:crypto';
import type { Db, Tx, Queryable } from './db';
import { maybe, one, withTx } from './db';
import { fail } from './errors';
import { post, acct, SYS } from './ledger';
import { ECON } from './config';
import { nowMinute } from './clock';
import { notify } from './notify';

const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scrypt(pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => _scrypt(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64, PARAMS);
  return ['scrypt', PARAMS.N, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, n, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const key = Buffer.from(keyB64, 'base64');
  if (key.length === 0) return false;
  const test = await scrypt(pw, Buffer.from(saltB64, 'base64'), key.length, { ...PARAMS, N: Number(n) });
  return timingSafeEqual(key, test);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const DUMMY_HASH = ['scrypt', 16384, 'AAAAAAAAAAAAAAAAAAAAAA==', Buffer.alloc(64).toString('base64')].join('$');

export type AuthUser = { id: string; username: string; display_name: string; role: 'player' | 'admin'; status: string; stage: number };

const WEAK = ['password', '12345678', 'qwerty', 'startup', 'matkhau'];

export async function registerUser(db: Db, input: { username: string; password: string; displayName: string }) {
  if (WEAK.some((w) => input.password.toLowerCase().includes(w))) fail('weak_password', 'Mật khẩu quá dễ đoán.');
  if (!/[a-zA-Z]/.test(input.password) || !/[0-9]/.test(input.password)) fail('weak_password', 'Mật khẩu cần có cả chữ và số.');
  const hash = await hashPassword(input.password);
  return withTx(db, async (tx) => {
    const exists = await maybe(tx, 'SELECT 1 FROM users WHERE username = $1', [input.username]);
    if (exists) fail('username_taken', 'Tên đăng nhập đã được sử dụng.', 409);
    const u = await one<{ id: string }>(
      tx,
      `INSERT INTO users (username, display_name, password_hash, avatar_hue) VALUES ($1,$2,$3,$4) RETURNING id`,
      [input.username, input.displayName, hash, Math.floor(Math.random() * 360)],
    );
    await grantStarterCapital(tx, u.id);
    return u.id;
  });
}

/** The only way money reaches a player without a counterparty: a documented central-bank issuance. */
export async function grantStarterCapital(tx: Tx, userId: string) {
  const minute = await nowMinute(tx);
  const amt = ECON.starterGrant;
  await post(tx, {
    key: `grant:starter:${userId}`,
    kind: 'starter_grant',
    memo: 'Vốn khởi nghiệp ban đầu',
    minute,
    lines: [
      { ...acct('user', userId, 'cash'), amount: amt },
      { ...acct('user', userId, 'capital'), amount: -amt },
      { ...SYS.centralBank('policy_expense'), amount: amt },
      { ...SYS.centralBank('currency_issued'), amount: -amt },
    ],
  });
  await notify(tx, userId, 'system', 'Chào mừng đến Startup', `Bạn nhận ${amt.toLocaleString('vi-VN')} ₫ vốn khởi nghiệp. Hãy chọn ngành và thành lập doanh nghiệp đầu tiên.`);
}

export async function login(db: Db, username: string, password: string, meta: { ip?: string; ua?: string }) {
  const u = await maybe<AuthUser & { password_hash: string; lock_reason: string | null }>(db, 'SELECT * FROM users WHERE username = $1', [username]);
  // Always run one hash comparison so unknown usernames take similar time.
  const ok = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok) return fail('bad_credentials', 'Sai tên đăng nhập hoặc mật khẩu.', 401);
  if (u.status === 'locked') fail('locked', `Tài khoản đang bị khóa${u.lock_reason ? `: ${u.lock_reason}` : ''}.`, 403);
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent) VALUES ($1,$2, now() + interval '30 days', $3, $4)`,
    [u.id, sha256(token), meta.ip ?? null, meta.ua?.slice(0, 200) ?? null],
  );
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
  return { token, userId: u.id };
}

export async function authenticate(q: Queryable, token: string): Promise<AuthUser | null> {
  if (!token || token.length > 100) return null;
  return maybe<AuthUser>(
    q,
    `SELECT u.id, u.username, u.display_name, u.role, u.status, u.stage FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'`,
    [sha256(token)],
  );
}

export async function logout(q: Queryable, token: string) {
  await q.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [sha256(token)]);
}

export async function revokeAllSessions(q: Queryable, userId: string) {
  await q.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

/** Creates an admin. The password always comes from the operator, never a default. */
export async function createAdmin(db: Db, username: string, password: string, displayName: string) {
  if (password.length < 14) fail('weak_password', 'Mật khẩu Admin cần tối thiểu 14 ký tự.');
  const id = await registerUser(db, { username, password, displayName });
  await db.query(`UPDATE users SET role='admin' WHERE id=$1`, [id]);
  return id;
}
