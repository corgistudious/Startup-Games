import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.js';
import { authRoutes } from './auth.js';
import { worldRoutes } from './world.js';
import { companyRoutes } from './companies.js';
import { marketRoutes } from './market.js';
import { financeRoutes } from './finance.js';
import { communityRoutes } from './community.js';
import { adminRoutes } from './admin.js';
import { expansionRoutes } from './expansion.js';

export async function registerRoutes(app: FastifyInstance, ctx: Ctx) {
  await authRoutes(app, ctx);
  await worldRoutes(app, ctx);
  await companyRoutes(app, ctx);
  await marketRoutes(app, ctx);
  await financeRoutes(app, ctx);
  await communityRoutes(app, ctx);
  await adminRoutes(app, ctx);
  await expansionRoutes(app, ctx);
}
