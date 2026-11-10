import type { FastifyInstance } from 'fastify';
import { auditLedger, nowMinute, one, type Db } from '@startup/engine';

/**
 * Prometheus metrics (text exposition format, no extra dependency).
 * Protected by METRICS_TOKEN (Bearer) when set; otherwise only reachable from localhost.
 */
const BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
type Hist = { buckets: number[]; sum: number; count: number };
const requests = new Map<string, number>(); // method|route|status
const latency = new Map<string, Hist>(); // route

let ledgerCache: { at: number; ok: boolean; issued: number; circulating: number } | null = null;

export function attachMetrics(app: FastifyInstance, db: Db) {
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url ?? 'unmatched';
    if (route === '/metrics') return;
    const k = `${req.method}|${route}|${reply.statusCode}`;
    requests.set(k, (requests.get(k) ?? 0) + 1);
    const secs = reply.elapsedTime / 1000;
    const h = latency.get(route) ?? { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 };
    BUCKETS.forEach((b, i) => {
      if (secs <= b) h.buckets[i]!++;
    });
    h.sum += secs;
    h.count++;
    latency.set(route, h);
  });

  app.get('/metrics', async (req, reply) => {
    const token = process.env.METRICS_TOKEN;
    const auth = req.headers.authorization;
    if (token ? auth !== `Bearer ${token}` : !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip)) {
      return reply.status(401).send({ error: 'unauthorized', message: 'Metrics require a token.' });
    }
    const lines: string[] = [];
    const metric = (name: string, type: string, help: string) => lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    metric('startup_http_requests_total', 'counter', 'HTTP requests by method, route and status');
    for (const [k, v] of requests) {
      const [method, route, status] = k.split('|');
      lines.push(`startup_http_requests_total{method="${method}",route="${esc(route!)}",status="${status}"} ${v}`);
    }
    metric('startup_http_request_duration_seconds', 'histogram', 'HTTP request latency by route');
    for (const [route, h] of latency) {
      BUCKETS.forEach((b, i) => lines.push(`startup_http_request_duration_seconds_bucket{route="${esc(route)}",le="${b}"} ${h.buckets[i]}`));
      lines.push(`startup_http_request_duration_seconds_bucket{route="${esc(route)}",le="+Inf"} ${h.count}`);
      lines.push(`startup_http_request_duration_seconds_sum{route="${esc(route)}"} ${h.sum}`);
      lines.push(`startup_http_request_duration_seconds_count{route="${esc(route)}"} ${h.count}`);
    }

    const current = Math.floor((await nowMinute(db)) / 30);
    const g = await one<{ last_tick: number | null; pending: number; failed: number; beat_age: number | null; alerts: number; disputes: number; players: number; companies: number }>(
      db,
      `SELECT (SELECT MAX(tick) FROM world_ticks) AS last_tick,
              (SELECT count(*)::int FROM jobs WHERE status='pending' AND run_after <= now()) AS pending,
              (SELECT count(*)::int FROM jobs WHERE status='failed') AS failed,
              (SELECT EXTRACT(EPOCH FROM now() - MAX(last_beat))::float FROM worker_heartbeats) AS beat_age,
              (SELECT count(*)::int FROM surveillance_alerts WHERE status='open') AS alerts,
              (SELECT count(*)::int FROM contract_deliveries WHERE status='disputed') AS disputes,
              (SELECT count(*)::int FROM users WHERE status='active') AS players,
              (SELECT count(*)::int FROM companies WHERE status IN ('active','insolvent')) AS companies`,
    );
    if (!ledgerCache || Date.now() - ledgerCache.at > 5 * 60_000) {
      const a = await auditLedger(db);
      ledgerCache = { at: Date.now(), ok: a.ok, issued: a.moneyIssued, circulating: a.cashInCirculation };
    }
    const gauge = (name: string, help: string, v: number) => {
      metric(name, 'gauge', help);
      lines.push(`${name} ${v}`);
    };
    gauge('startup_world_tick_lag', 'Ticks between game time and the last scheduled tick', current - (g.last_tick ?? current));
    gauge('startup_jobs_pending', 'Jobs due and not yet processed', g.pending);
    gauge('startup_jobs_failed', 'Jobs that exhausted their retries', g.failed);
    gauge('startup_worker_heartbeat_age_seconds', 'Seconds since the most recent worker heartbeat', g.beat_age ?? 1e9);
    gauge('startup_surveillance_open_alerts', 'Open market surveillance alerts', g.alerts);
    gauge('startup_contract_disputes_open', 'Contract deliveries awaiting a dispute decision', g.disputes);
    gauge('startup_players_active', 'Active player accounts', g.players);
    gauge('startup_companies_operating', 'Companies active or insolvent', g.companies);
    gauge('startup_ledger_balanced', '1 when the global ledger audit passes', ledgerCache.ok ? 1 : 0);
    gauge('startup_money_issued_vnd', 'Total money issued by the central bank', ledgerCache.issued);
    gauge('startup_money_circulating_vnd', 'Cash held across all accounts', ledgerCache.circulating);
    metric('startup_process_resident_memory_bytes', 'gauge', 'Resident memory of the API process');
    lines.push(`startup_process_resident_memory_bytes ${process.memoryUsage().rss}`);
    reply.header('content-type', 'text/plain; version=0.0.4');
    return lines.join('\n') + '\n';
  });
}
