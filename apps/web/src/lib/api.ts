import { useSession } from './store';

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8080';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/**
 * Fetch wrapper. Mutations carry an Idempotency-Key so a double click or a retry
 * after a dropped connection is applied by the server only once.
 */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const token = useSession.getState().token;
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['idempotency-key'] = init.idempotencyKey ?? crypto.randomUUID();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  } catch {
    throw new ApiError(0, 'network', 'Không kết nối được máy chủ. Kiểm tra mạng và thử lại.');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && token) useSession.getState().logout();
    throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? 'Có lỗi xảy ra.');
  }
  return data as T;
}
