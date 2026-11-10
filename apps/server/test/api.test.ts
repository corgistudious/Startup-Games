import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createPool, migrate, initWorld, resetEpochCache, createAdmin, type Db } from '@startup/engine';
import { buildApp } from '../src/app';

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/startup_test';
let db: Db;
let app: FastifyInstance;

async function call(method: string, url: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({ method: method as 'GET', url, payload: body as object, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
  return { status: res.statusCode, body: res.json() };
}

let player: string;
let admin: string;
let companyId: string;

beforeAll(async () => {
  db = createPool(URL);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  resetEpochCache();
  await migrate(db);
  await initWorld(db);
  app = await buildApp(db, { rateLimit: false });
  await createAdmin(db, 'quantri', 'Very-long-admin-pass-2026', 'Ban Quản Trị');
});
afterAll(async () => {
  await app.close();
  await db.end();
});

describe('auth', () => {
  it('rejects weak passwords and invalid usernames with readable messages', async () => {
    const r = await call('POST', '/auth/register', undefined, { username: 'ab', password: 'x', displayName: 'A' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Dữ liệu không hợp lệ/);
    const w = await call('POST', '/auth/register', undefined, { username: 'weakling', password: 'password123', displayName: 'Weak' });
    expect(w.body.message).toMatch(/dễ đoán/);
  });

  it('registers, receives starter capital, logs in, and reads /me', async () => {
    const r = await call('POST', '/auth/register', undefined, { username: 'minh_anh', password: 'Ca-phe-sua-da-9', displayName: 'Minh Anh' });
    expect(r.status).toBe(200);
    player = r.body.token;
    const me = await call('GET', '/me', player);
    expect(me.body).toMatchObject({ username: 'minh_anh', role: 'player', stage: 1 });
    const ov = await call('GET', '/me/overview', player);
    expect(ov.body.cash).toBe(600_000_000);
    const bad = await call('POST', '/auth/login', undefined, { username: 'minh_anh', password: 'wrong-pass-1' });
    expect(bad.status).toBe(401);
    expect((await call('GET', '/me')).status).toBe(401);
  });

  it('no default admin exists; admin login works only with the operator-set password', async () => {
    expect((await call('POST', '/auth/login', undefined, { username: 'admin', password: 'admin' })).status).toBe(401);
    const a = await call('POST', '/auth/login', undefined, { username: 'quantri', password: 'Very-long-admin-pass-2026' });
    admin = a.body.token;
    expect((await call('GET', '/me', admin)).body.role).toBe('admin');
  });
});

describe('gameplay over HTTP', () => {
  it('server decides prices and money; client-sent amounts are only intents', async () => {
    const r = await call('POST', '/companies', player, { name: 'Xưởng Mộc Minh Anh', industry: 'noi_that', location: 'binh_duong', capital: 350_000_000 });
    expect(r.status).toBe(200);
    companyId = r.body.id;
    const detail = await call('GET', `/companies/${companyId}`, player);
    expect(detail.body.company.status).toBe('licensing');
    const farm = (await call('GET', '/market/b2b?good=go', player)).body[0];
    const cheat = await call('POST', `/companies/${companyId}/purchases`, player, { sellerCompanyId: farm.company_id, good: 'go', qty: 10, maxUnitPrice: 1 });
    expect(cheat.status).toBe(400);
    expect(cheat.body.message).toMatch(/Giá đã thay đổi/);
  });

  it('a repeated submit with the same Idempotency-Key is applied once', async () => {
    const before = (await call('GET', `/companies/${companyId}`, player)).body.balanceSheet.assets.cash;
    const h = { 'idempotency-key': 'eq-click-0001' };
    const a = await call('POST', `/companies/${companyId}/equipment`, player, { type: 'may_cnc', count: 1 }, h);
    const b = await call('POST', `/companies/${companyId}/equipment`, player, { type: 'may_cnc', count: 1 }, h);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const after = (await call('GET', `/companies/${companyId}`, player)).body;
    expect(after.equipment).toHaveLength(1);
    expect(after.balanceSheet.assets.cash).toBe(before - 260_000_000);
  });

  it('cannot manage someone else’s company', async () => {
    const other = (await call('POST', '/auth/register', undefined, { username: 'other_guy', password: 'Banh-xeo-ngon-7', displayName: 'Other' })).body.token;
    expect((await call('GET', `/companies/${companyId}`, other)).status).toBe(403);
    expect((await call('POST', `/companies/${companyId}/capital`, other, { amount: 1000 })).status).toBe(403);
  });
});

describe('admin permissions', () => {
  it('players get 403 on every admin endpoint', async () => {
    for (const url of ['/admin/overview', '/admin/users', '/admin/companies', '/admin/audit', '/admin/reviewers']) {
      expect((await call('GET', url, player)).status).toBe(403);
    }
  });

  it('locking requires a reason, revokes sessions immediately and is audited', async () => {
    const users = (await call('GET', '/admin/users?q=other_guy', admin)).body;
    const target = users[0].id;
    expect((await call('POST', `/admin/users/${target}/lock`, admin, { locked: true, reason: '' })).status).toBe(400);
    expect((await call('POST', `/admin/users/${target}/lock`, admin, { locked: true, reason: 'Gian lận đánh giá' })).status).toBe(200);
    expect((await call('POST', '/auth/login', undefined, { username: 'other_guy', password: 'Banh-xeo-ngon-7' })).body.message).toMatch(/khóa/);
    const log = (await call('GET', '/admin/audit', admin)).body;
    expect(log.some((l: { action: string }) => l.action === 'user.lock')).toBe(true);
  });

  it('economy audit endpoint reports a balanced ledger', async () => {
    const o = (await call('GET', '/admin/overview', admin)).body;
    expect(o.ledger.ok).toBe(true);
  });

  it('Yêu Thích cannot be granted manually', async () => {
    const r = await call('POST', `/admin/companies/${companyId}/titles`, admin, { title: 'yeu_thich', grant: true, reason: 'Thử cấp tay' });
    expect(r.status).toBe(400);
  });

  it('reviewer flow over HTTP: invite → accept → quiz → active with 15 reputation', async () => {
    const me = (await call('GET', '/me', player)).body;
    expect((await call('POST', '/admin/reviewers/invite', admin, { userId: me.id, note: 'Mời tham gia đội Reviewer' })).status).toBe(200);
    expect((await call('POST', '/reviewer/respond', player, { accept: true })).status).toBe(200);
    const quiz = (await call('GET', '/reviewer/me', player)).body.quiz;
    expect(quiz).toHaveLength(5);
    expect(JSON.stringify(quiz)).not.toMatch(/answer/i);
    const res = (await call('POST', '/reviewer/quiz', player, { answers: [1, 2, 1, 2, 1] })).body;
    expect(res.passed).toBe(true);
    expect((await call('GET', '/reviewer/me', player)).body.reviewer.reputation).toBe(15);
  });
});

describe('expansion endpoints', () => {
  it('/metrics requires the token and exposes game gauges', async () => {
    process.env.METRICS_TOKEN = 'metrics-test-token';
    expect((await app.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(401);
    const r = await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer metrics-test-token' } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/startup_world_tick_lag \d+/);
    expect(r.body).toMatch(/startup_ledger_balanced 1/);
    expect(r.body).toMatch(/startup_http_requests_total\{method="GET",route="\/me"/);
    delete process.env.METRICS_TOKEN;
  });

  it('HR policy, bonus validation and personal deposits over HTTP', async () => {
    expect((await call('PUT', `/companies/${companyId}/hr-policy`, player, { benefitLevel: 2, overtimeHours: 1 })).status).toBe(200);
    expect((await call('PUT', `/companies/${companyId}/hr-policy`, player, { overtimeHours: 5 })).status).toBe(400);
    expect((await call('POST', `/companies/${companyId}/bonus`, player, { personIds: [], amountEach: 1000 })).status).toBe(400);
    const d = await call('POST', '/bank/deposits', player, { amount: 5_000_000, termDays: 0 });
    expect(d.status).toBe(200);
    const list = (await call('GET', '/bank/deposits', player)).body;
    expect(list.deposits).toHaveLength(1);
    const w = await call('POST', `/bank/deposits/${d.body.id}/withdraw`, player, {});
    expect(w.body).toMatchObject({ early: false });
  });

  it('contracts, group and cash flow are visible only to the owner', async () => {
    expect((await call('GET', `/companies/${companyId}/contracts`, player)).status).toBe(200);
    expect((await call('GET', `/companies/${companyId}/group`, player)).body).toHaveProperty('consolidatedEquity');
    const detail = (await call('GET', `/companies/${companyId}`, player)).body;
    expect(detail.cashFlow.closing).toBe(detail.balanceSheet.assets.cash + detail.balanceSheet.assets.cashLocked);
    const stranger = (await call('POST', '/auth/register', undefined, { username: 'curious_guy', password: 'Pho-bo-ngon-88', displayName: 'Curious' })).body.token;
    expect((await call('GET', `/companies/${companyId}/contracts`, stranger)).status).toBe(403);
    expect((await call('GET', `/companies/${companyId}/group`, stranger)).status).toBe(403);
  });

  it('surveillance and dispute admin endpoints are admin-only', async () => {
    for (const url of ['/admin/surveillance', '/admin/disputes']) {
      expect((await call('GET', url, player)).status).toBe(403);
      expect((await call('GET', url, admin)).status).toBe(200);
    }
  });
});

