import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.js';
import { many, nowMinute } from '@startup/engine';

export async function marketRoutes(app: FastifyInstance, ctx: Ctx) {
  /** Wholesale offers from every company (players and NPCs) with stock on hand. */
  app.get('/market/b2b', async (req) => {
    ctx.requireUser(req);
    const q = z.object({ good: z.string().max(40).optional() }).parse(req.query);
    return many(
      ctx.db,
      `SELECT l.company_id, c.name AS company_name, c.slug, c.is_npc, c.reputation, loc.name AS location_name, loc.logistics_km,
              l.good_code, g.name AS good_name, g.unit, l.price, g.ref_price, GREATEST(i.qty - i.reserved, 0) AS available
         FROM listings l JOIN companies c ON c.id=l.company_id AND c.status IN ('active','insolvent')
         JOIN goods g ON g.code=l.good_code JOIN locations loc ON loc.code=c.location_code
         LEFT JOIN inventory i ON i.company_id=l.company_id AND i.good_code=l.good_code
        WHERE l.b2b AND l.active AND ($1::text IS NULL OR l.good_code=$1)
        ORDER BY g.name, l.price`,
      [q.good ?? null],
    );
  });

  /** Consumer market: who sells what at which price, and recent market share. */
  app.get('/market/consumer', async (req) => {
    ctx.requireUser(req);
    const day = Math.floor((await nowMinute(ctx.db)) / 1440);
    const sellers = await many(
      ctx.db,
      `SELECT l.company_id, c.name AS company_name, c.slug, c.is_npc, c.reputation, c.brand, loc.name AS location_name, l.good_code, g.name AS good_name, g.unit, l.price, g.ref_price,
              COALESCE((SELECT SUM(qty) FROM sales_daily s WHERE s.company_id=l.company_id AND s.good_code=l.good_code AND s.day >= $1),0)::bigint AS sold_3d
         FROM listings l JOIN companies c ON c.id=l.company_id AND c.status IN ('active','insolvent')
         JOIN goods g ON g.code=l.good_code JOIN locations loc ON loc.code=c.location_code
        WHERE NOT l.b2b AND l.active ORDER BY g.name, sold_3d DESC`,
      [day - 3],
    );
    const daily = await many(ctx.db, `SELECT day, good_code, SUM(qty)::bigint AS qty, SUM(revenue)::bigint AS revenue FROM sales_daily WHERE day >= $1 GROUP BY day, good_code ORDER BY day`, [day - 13]);
    return { sellers, daily };
  });
}
