import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import pg from 'pg';
import { authenticate, type Db } from '@startup/engine';

/**
 * Realtime fan-out: the worker and API publish with pg_notify('events', ...);
 * one LISTEN connection per server forwards events to subscribed sockets.
 * Clients authenticate with their session token in the first message.
 */
export function attachRealtime(app: FastifyInstance, db: Db) {
  const sockets = new Map<WebSocket, string | null>();
  let listener: pg.Client | null = null;

  async function listen() {
    if (listener || !process.env.DATABASE_URL) return;
    listener = new pg.Client({ connectionString: process.env.DATABASE_URL });
    listener.on('error', () => {
      listener = null;
      setTimeout(listen, 3000);
    });
    await listener.connect();
    await listener.query('LISTEN events');
    listener.on('notification', (msg) => {
      if (!msg.payload) return;
      let data: { t: string; userId?: string };
      try {
        data = JSON.parse(msg.payload);
      } catch {
        return;
      }
      for (const [ws, uid] of sockets) {
        if (data.userId && data.userId !== uid) continue;
        if (ws.readyState === 1) ws.send(msg.payload);
      }
    });
  }

  app.get('/ws', { websocket: true }, (socket: WebSocket) => {
    sockets.set(socket, null);
    void listen().catch(() => undefined);
    socket.on('message', async (raw: Buffer) => {
      try {
        const m = JSON.parse(raw.toString()) as { t: string; token?: string };
        if (m.t === 'auth' && m.token) {
          const u = await authenticate(db, m.token);
          sockets.set(socket, u?.id ?? null);
          socket.send(JSON.stringify({ t: 'auth', ok: !!u }));
        }
      } catch {
        /* ignore malformed messages */
      }
    });
    socket.on('close', () => sockets.delete(socket));
  });

  app.addHook('onClose', async () => {
    for (const ws of sockets.keys()) ws.close();
    await listener?.end().catch(() => undefined);
  });
}
