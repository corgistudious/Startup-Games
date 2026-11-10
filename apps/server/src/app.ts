import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import { ZodError, type ZodTypeAny, type infer as ZInfer } from 'zod';
import { authenticate, GameError, mapDbError, type AuthUser, type Db, type Tx, withTx, nowMinute } from '@startup/engine';
import { registerRoutes } from './routes/index.js';
import { attachRealtime } from './realtime.js';
import { attachMetrics } from './metrics.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export type Ctx = {
  db: Db;
  /** Validate a body against a zod schema; throws 400 with Vietnamese messages. */
  parse: <S extends ZodTypeAny>(schema: S, data: unknown) => ZInfer<S>;
  requireUser: (req: FastifyRequest) => AuthUser;
  requireAdmin: (req: FastifyRequest) => AuthUser;
  /** Stable ledger key for a player action; repeated submits of one action share it. */
  actionKey: (req: FastifyRequest, action: string) => string;
  /** Run a mutation in a transaction with the current game minute. */
  mutate: <T>(fn: (tx: Tx, minute: number) => Promise<T>) => Promise<T>;
};

export async function buildApp(db: Db, opts: { logger?: boolean; corsOrigins?: string[]; rateLimit?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 64 * 1024 });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: opts.corsOrigins?.length ? opts.corsOrigins : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });
  if (opts.rateLimit !== false) {
    await app.register(rateLimit, { max: 300, timeWindow: '1 minute', keyGenerator: (req) => req.ip });
  }
  await app.register(websocket);

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const h = req.headers.authorization;
    req.user = h?.startsWith('Bearer ') ? await authenticate(db, h.slice(7)) : null;
  });

  app.setErrorHandler((err, req, reply) => {
    const e = mapDbError(err);
    if (e instanceof GameError) return reply.status(e.status).send({ error: e.code, message: e.message });
    if (e instanceof ZodError) {
      const first = e.issues[0];
      return reply.status(400).send({ error: 'validation', message: `Dữ liệu không hợp lệ${first ? ` (${first.path.join('.')}): ${first.message}` : ''}`, issues: e.issues });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ error: 'rate_limited', message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.' });
    if (status && status < 500) return reply.status(status).send({ error: 'bad_request', message: (err as Error).message });
    req.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'Hệ thống gặp lỗi. Thao tác chưa được thực hiện, vui lòng thử lại.' });
  });

  const ctx: Ctx = {
    db,
    parse: (schema, data) => schema.parse(data ?? {}),
    requireUser: (req) => {
      if (!req.user) throw new GameError('unauthorized', 'Vui lòng đăng nhập.', 401);
      return req.user;
    },
    requireAdmin: (req) => {
      const u = ctx.requireUser(req);
      if (u.role !== 'admin') throw new GameError('forbidden', 'Chỉ Ban Quản Trị được thực hiện thao tác này.', 403);
      return u;
    },
    actionKey: (req, action) => {
      const k = String(req.headers['idempotency-key'] ?? '').slice(0, 64);
      const safe = /^[a-zA-Z0-9-]{8,64}$/.test(k) ? k : randomUUID();
      return `act:${req.user?.id ?? 'anon'}:${action}:${safe}`;
    },
    mutate: (fn) => withTx(db, async (tx) => fn(tx, await nowMinute(tx))),
  };

  app.get('/health', async () => {
    await db.query('SELECT 1');
    return { ok: true, time: new Date().toISOString() };
  });

  attachMetrics(app, db);
  await registerRoutes(app, ctx);
  attachRealtime(app, db);
  return app;
}

export type Reply = FastifyReply;
