import { create } from 'zustand';

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

type Session = { token: string | null; login: (token: string) => void; logout: () => void };
export const useSession = create<Session>((set) => ({
  token: read('startup.token'),
  login: (token) => {
    write('startup.token', token);
    set({ token });
  },
  logout: () => {
    write('startup.token', null);
    set({ token: null });
  },
}));

/** UI-only state (selected company, mobile drawer). Server data lives in TanStack Query. */
type Ui = { companyId: string | null; setCompany: (id: string | null) => void; drawer: boolean; setDrawer: (v: boolean) => void };
export const useUi = create<Ui>((set) => ({
  companyId: read('startup.company'),
  setCompany: (companyId) => {
    write('startup.company', companyId);
    set({ companyId });
  },
  drawer: false,
  setDrawer: (drawer) => set({ drawer }),
}));

type Toast = { id: number; kind: 'ok' | 'err' | 'info'; text: string };
type Toasts = { list: Toast[]; push: (kind: Toast['kind'], text: string) => void; drop: (id: number) => void };
export const useToasts = create<Toasts>((set, get) => ({
  list: [],
  push: (kind, text) => {
    const id = Date.now() + Math.random();
    set({ list: [...get().list.slice(-3), { id, kind, text }] });
    setTimeout(() => get().drop(id), 4500);
  },
  drop: (id) => set({ list: get().list.filter((t) => t.id !== id) }),
}));
export const toast = {
  ok: (t: string) => useToasts.getState().push('ok', t),
  err: (t: string) => useToasts.getState().push('err', t),
  info: (t: string) => useToasts.getState().push('info', t),
};
