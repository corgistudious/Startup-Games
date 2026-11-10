import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createPool, createAdmin, migrate } from '@startup/engine';

/** Bundled admin-creation CLI for the production image. There is no default admin. */
const rl = createInterface({ input: stdin, output: stdout });
const username = process.env.ADMIN_USERNAME ?? (await rl.question('Tên đăng nhập Admin: '));
const displayName = process.env.ADMIN_DISPLAY_NAME ?? (await rl.question('Tên hiển thị: '));
const password = process.env.ADMIN_PASSWORD ?? (await rl.question('Mật khẩu (tối thiểu 14 ký tự): '));
rl.close();
const db = createPool();
try {
  await migrate(db);
  console.log(`Admin created: ${await createAdmin(db, username.trim(), password, displayName.trim() || username.trim())}`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
