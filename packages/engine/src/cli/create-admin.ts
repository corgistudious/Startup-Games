import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createPool } from '../db';
import { createAdmin } from '../auth';

/**
 * Create an administrator. There is no default admin account: the operator provides
 * the password interactively (or via ADMIN_PASSWORD in a one-off secure environment).
 */
const rl = createInterface({ input: stdin, output: stdout });
const username = process.env.ADMIN_USERNAME ?? (await rl.question('Tên đăng nhập Admin: '));
const displayName = process.env.ADMIN_DISPLAY_NAME ?? (await rl.question('Tên hiển thị: '));
const password = process.env.ADMIN_PASSWORD ?? (await rl.question('Mật khẩu (tối thiểu 14 ký tự): '));
rl.close();
const db = createPool();
try {
  const id = await createAdmin(db, username.trim(), password, displayName.trim() || username.trim());
  console.log(`Admin created: ${id}`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
