import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.js';
import { many, one, getEpoch, nowMinute, auditLedger, balance, SYS } from '@startup/engine';

export async function worldRoutes(app: FastifyInstance, ctx: Ctx) {
  /** Clock: clients render the time locally from epoch + scale, so it never drifts. */
  app.get('/world', async () => {
    const epoch = await getEpoch(ctx.db);
    const minute = await nowMinute(ctx.db);
    const households = await balance(ctx.db, SYS.households('cash'));
    const stats = await one(ctx.db, `SELECT (SELECT count(*)::int FROM users) AS players, (SELECT count(*)::int FROM companies WHERE status IN ('active','insolvent')) AS companies, (SELECT count(*)::int FROM people WHERE status='employed') AS employed, (SELECT count(*)::int FROM people WHERE status='seeking') AS seeking`);
    return { epoch, scale: 30, serverTime: Date.now(), minute, households, stats };
  });

  app.get('/catalog', async () => {
    const [goods, industries, recipes, equipment, locations] = await Promise.all([
      many(ctx.db, 'SELECT * FROM goods ORDER BY category, code'),
      many(ctx.db, 'SELECT * FROM industries ORDER BY min_capital'),
      many(ctx.db, 'SELECT * FROM recipes ORDER BY code'),
      many(ctx.db, 'SELECT * FROM equipment_types ORDER BY price'),
      many(ctx.db, 'SELECT * FROM locations ORDER BY rent_day DESC'),
    ]);
    return { goods, industries, recipes, equipment, locations };
  });

  app.get('/leaderboard', async () => {
    const companies = await many(
      ctx.db,
      `SELECT c.id, c.name, c.slug, c.logo_hue, c.is_npc, c.reputation, i.name AS industry, u.display_name AS owner,
              COALESCE((SELECT SUM(revenue) FROM sales_daily s WHERE s.company_id=c.id AND s.day >= (SELECT MAX(day) - 7 FROM sales_daily)),0)::bigint AS revenue_7d
         FROM companies c JOIN industries i ON i.code=c.industry_code LEFT JOIN users u ON u.id=c.owner_user_id
        WHERE c.status IN ('active','insolvent') ORDER BY revenue_7d DESC LIMIT 20`,
    );
    const players = await many(
      ctx.db,
      `SELECT u.id, u.display_name, u.stage, u.avatar_hue,
              (SELECT COALESCE(SUM(a.balance),0) FROM accounts a WHERE a.owner_type='user' AND a.owner_id=u.id::text AND a.code IN ('cash','cash_locked'))::bigint AS cash,
              (SELECT count(*)::int FROM companies c WHERE c.owner_user_id=u.id AND c.status IN ('active','insolvent')) AS companies
         FROM users u WHERE u.status='active' ORDER BY u.stage DESC, cash DESC LIMIT 20`,
    );
    return { companies, players };
  });

  /** Public economy transparency: money supply and where it sits. */
  app.get('/economy', async () => {
    const audit = await auditLedger(ctx.db);
    const sectors = await many(ctx.db, `SELECT owner_type, SUM(balance)::bigint AS cash FROM accounts WHERE code IN ('cash','cash_locked') GROUP BY owner_type`);
    const prices = await many(
      ctx.db,
      `SELECT g.code, g.name, g.unit, g.ref_price, g.category,
              (SELECT MIN(price) FROM listings l WHERE l.good_code=g.code AND l.active) AS min_price,
              (SELECT AVG(price)::bigint FROM listings l WHERE l.good_code=g.code AND l.active) AS avg_price,
              (SELECT COALESCE(SUM(qty),0)::bigint FROM sales_daily s WHERE s.good_code=g.code AND s.day >= (SELECT COALESCE(MAX(day),0) - 1 FROM sales_daily)) AS sold_recent
         FROM goods g ORDER BY g.category, g.code`,
    );
    return { audit, sectors, prices };
  });
}
