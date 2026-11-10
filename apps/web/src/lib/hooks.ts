import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { gameMinuteAt, toGameDate } from '@startup/shared';
import { api, API_URL } from './api';
import { toast, useSession } from './store';

export type World = { epoch: number; scale: number; serverTime: number; minute: number; households: number; stats: Record<string, number> };

export function useWorld() {
  return useQuery({ queryKey: ['world'], queryFn: () => api<World>('/world'), staleTime: 60_000 });
}

/** Live game clock computed locally from the server epoch, corrected for clock skew. */
export function useGameClock() {
  const { data } = useWorld();
  const [now, setNow] = useState(Date.now());
  const skew = useRef(0);
  useEffect(() => {
    if (data) skew.current = data.serverTime - Date.now();
  }, [data]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 2000); // 2 real seconds = 1 game minute
    return () => clearInterval(t);
  }, []);
  if (!data) return null;
  return toGameDate(gameMinuteAt(now + skew.current, data.epoch));
}

export function useMe() {
  const token = useSession((s) => s.token);
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), enabled: !!token });
}
export type Me = { id: string; username: string; display_name: string; role: 'player' | 'admin'; stage: number; bio: string; avatar_hue: number; unread: number; reviewer: { status: string; reputation: number; eval_points: number } | null };

/**
 * Mutation helper: one idempotency key per form submission (kept across retries of the
 * same submission), toast on success/error, invalidate the given queries.
 */
export function useAction<TBody = unknown, TRes = unknown>(path: string | ((b: TBody) => string), opts: { method?: string; invalidate?: QueryKey[]; success?: string | ((r: TRes) => string) } = {}) {
  const qc = useQueryClient();
  const key = useRef<string>(crypto.randomUUID());
  const inFlight = useRef(false);
  const m = useMutation({
    mutationFn: (body: TBody) => api<TRes>(typeof path === 'function' ? path(body) : path, { method: opts.method ?? 'POST', body, idempotencyKey: key.current }),
    onSuccess: (res) => {
      key.current = crypto.randomUUID();
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
      qc.invalidateQueries({ queryKey: ['me'] });
      if (opts.success) toast.ok(typeof opts.success === 'function' ? opts.success(res) : opts.success);
    },
    onError: (e: Error) => {
      key.current = crypto.randomUUID();
      toast.err(e.message);
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  // Synchronous guard: a double click fires twice before React re-renders the disabled button.
  const mutate: typeof m.mutate = (body, o) => {
    if (inFlight.current) return;
    inFlight.current = true;
    m.mutate(body, o);
  };
  const mutateAsync: typeof m.mutateAsync = async (body, o) => {
    if (inFlight.current) return undefined as never;
    inFlight.current = true;
    return m.mutateAsync(body, o);
  };
  return { ...m, mutate, mutateAsync };
}

/** Websocket: refresh data when the world ticks or a notification arrives. */
export function useRealtime() {
  const token = useSession((s) => s.token);
  const qc = useQueryClient();
  useEffect(() => {
    if (!token) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      ws = new WebSocket(API_URL.replace(/^http/, 'ws') + '/ws');
      ws.onopen = () => ws?.send(JSON.stringify({ t: 'auth', token }));
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m.t === 'notification') {
            qc.invalidateQueries({ queryKey: ['me'] });
            qc.invalidateQueries({ queryKey: ['notifications'] });
          }
          if (m.t === 'tick') {
            qc.invalidateQueries({ queryKey: ['company'] });
            qc.invalidateQueries({ queryKey: ['overview'] });
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [token, qc]);
}
