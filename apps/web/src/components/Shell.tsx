import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard,
  Building2,
  Store,
  Landmark,
  CandlestickChart,
  Library,
  BadgeCheck,
  Bell,
  LifeBuoy,
  Trophy,
  UserRound,
  ShieldCheck,
  Menu,
  X,
  LogOut,
  Sun,
  Moon,
  Clock3,
} from 'lucide-react';
import { WEEKDAY_NAMES, stageName } from '@startup/shared';
import { useGameClock, useMe, useRealtime } from '@/lib/hooks';
import { useSession, useUi } from '@/lib/store';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Money } from './ui';

const NAV = [
  { group: 'Tổng quan', items: [{ to: '/', label: 'Bảng điều khiển', icon: LayoutDashboard, end: true }] },
  {
    group: 'Kinh doanh',
    items: [
      { to: '/companies', label: 'Doanh nghiệp', icon: Building2 },
      { to: '/market', label: 'Thị trường', icon: Store },
    ],
  },
  {
    group: 'Tài chính',
    items: [
      { to: '/bank', label: 'Ngân hàng', icon: Landmark },
      { to: '/exchange', label: 'Chứng khoán', icon: CandlestickChart },
    ],
  },
  {
    group: 'Cộng đồng',
    items: [
      { to: '/library', label: 'Thư viện doanh nghiệp', icon: Library },
      { to: '/reviewer', label: 'Reviewer', icon: BadgeCheck },
      { to: '/leaderboard', label: 'Bảng xếp hạng', icon: Trophy },
    ],
  },
  {
    group: 'Cá nhân',
    items: [
      { to: '/inbox', label: 'Hộp thư', icon: Bell },
      { to: '/profile', label: 'Hồ sơ doanh nhân', icon: UserRound },
      { to: '/support', label: 'Hỗ trợ', icon: LifeBuoy },
    ],
  },
];

const MOBILE = [
  { to: '/', label: 'Tổng quan', icon: LayoutDashboard, end: true },
  { to: '/companies', label: 'Doanh nghiệp', icon: Building2 },
  { to: '/market', label: 'Thị trường', icon: Store },
  { to: '/exchange', label: 'Chứng khoán', icon: CandlestickChart },
];

function ClockPill() {
  const d = useGameClock();
  if (!d) return null;
  const working = d.weekday < 5 && ((d.hour >= 8 && d.hour < 12) || (d.hour >= 13 && d.hour < 17));
  const lunch = d.weekday < 5 && d.hour === 12;
  return (
    <div className="flex items-center gap-2.5 rounded-xl border px-3 py-1.5" style={{ borderColor: 'var(--line)' }} title="1 phút thực = 30 phút trong game">
      {d.hour >= 6 && d.hour < 18 ? <Sun size={16} className="text-amber-300" /> : <Moon size={16} className="text-sky-300" />}
      <div className="leading-tight">
        <div className="num text-sm font-semibold text-white">
          {String(d.hour).padStart(2, '0')}:{String(d.minuteOfHour).padStart(2, '0')}
        </div>
        <div className="hidden text-[11px] text-ink-400 sm:block">
          {WEEKDAY_NAMES[d.weekday]} · N{d.dayOfMonth + 1} · T{d.monthOfYear + 1}/{d.year + 1}
        </div>
      </div>
      <span className={clsx('chip hidden md:inline-flex', working ? 'bg-emerald-400/15 text-emerald-200' : lunch ? 'bg-amber-400/15 text-amber-200' : 'bg-ink-600/60 text-ink-300')}>
        <Clock3 size={11} />
        {working ? 'Giờ làm việc' : lunch ? 'Nghỉ trưa' : d.weekday >= 5 ? 'Cuối tuần' : 'Ngoài giờ'}
      </span>
    </div>
  );
}

function SideNav({ admin, onNavigate }: { admin: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-5" aria-label="Điều hướng chính">
      {[...NAV, ...(admin ? [{ group: 'Quản trị', items: [{ to: '/admin', label: 'Admin Dashboard', icon: ShieldCheck }] }] : [])].map((g) => (
        <div key={g.group}>
          <div className="mb-1.5 px-3 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-500">{g.group}</div>
          <div className="flex flex-col gap-0.5">
            {g.items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={(i as { end?: boolean }).end ?? false}
                onClick={onNavigate}
                className={({ isActive }) =>
                  clsx('flex min-h-[40px] items-center gap-3 rounded-xl px-3 text-sm transition', isActive ? 'bg-sky-400/12 font-medium text-sky-100 ring-1 ring-sky-400/30' : 'text-ink-300 hover:bg-ink-700/40 hover:text-white')
                }
              >
                <i.icon size={18} />
                {i.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function Shell() {
  useRealtime();
  const { data: me } = useMe();
  const logout = useSession((s) => s.logout);
  const { drawer, setDrawer } = useUi();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: ov } = useQuery({ queryKey: ['overview'], queryFn: () => api<{ cash: number; netWorth: number }>('/me/overview'), refetchInterval: 60_000 });
  const doLogout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    logout();
    qc.clear();
  };

  return (
    <div className="min-h-dvh lg:pl-[260px]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[260px] flex-col border-r bg-ink-950/70 px-3 py-5 backdrop-blur lg:flex" style={{ borderColor: 'var(--line)' }}>
        <Brand />
        <div className="mt-7 flex-1 overflow-y-auto pr-1">
          <SideNav admin={me?.role === 'admin'} />
        </div>
        <button className="btn btn-ghost mt-3 justify-start" onClick={doLogout}>
          <LogOut size={17} /> Đăng xuất
        </button>
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-sm lg:hidden" onClick={() => setDrawer(false)}>
          <div className="panel absolute inset-y-0 left-0 w-[86%] max-w-[320px] overflow-y-auto rounded-none rounded-r-2xl px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-6 flex items-center justify-between">
              <Brand />
              <button className="btn btn-ghost btn-sm" onClick={() => setDrawer(false)} aria-label="Đóng menu">
                <X size={18} />
              </button>
            </div>
            <SideNav admin={me?.role === 'admin'} onNavigate={() => setDrawer(false)} />
            <button className="btn btn-ghost mt-6 w-full justify-start" onClick={doLogout}>
              <LogOut size={17} /> Đăng xuất
            </button>
          </div>
        </div>
      )}

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b bg-ink-900/80 backdrop-blur-md" style={{ borderColor: 'var(--line)', paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:h-16 sm:px-6">
          <button className="btn btn-ghost btn-sm !px-2 lg:hidden" onClick={() => setDrawer(true)} aria-label="Mở menu">
            <Menu size={20} />
          </button>
          <ClockPill />
          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-[11px] text-ink-400">Tiền mặt cá nhân</div>
              <Money value={ov?.cash} compact className="text-sm font-semibold text-white" />
            </div>
            <button className="btn btn-ghost btn-sm relative !px-2.5" onClick={() => nav('/inbox')} aria-label={`Hộp thư, ${me?.unread ?? 0} chưa đọc`}>
              <Bell size={19} />
              {!!me?.unread && <span className="num absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-sky-400 px-1 text-[10px] font-bold text-ink-950">{me.unread > 99 ? '99+' : me.unread}</span>}
            </button>
            <button onClick={() => nav('/profile')} className="flex items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-ink-700/40" aria-label="Hồ sơ">
              <div className="grid h-9 w-9 place-items-center rounded-full font-semibold text-white" style={{ background: `hsl(${me?.avatar_hue ?? 200} 60% 40%)` }}>
                {me?.display_name?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="hidden text-left leading-tight md:block">
                <div className="max-w-[140px] truncate text-sm font-medium text-white">{me?.display_name}</div>
                <div className="text-[11px] text-sky-300">{stageName(me?.stage ?? 1)}</div>
              </div>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 pb-28 pt-5 sm:px-6 lg:pb-12">
        <Outlet />
      </main>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-ink-950/90 backdrop-blur-md lg:hidden" style={{ borderColor: 'var(--line)', paddingBottom: 'env(safe-area-inset-bottom)' }} aria-label="Điều hướng nhanh">
        <div className="grid grid-cols-5">
          {MOBILE.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => clsx('flex min-h-[58px] flex-col items-center justify-center gap-1 text-[10.5px]', isActive ? 'text-sky-300' : 'text-ink-400')}>
              <i.icon size={20} />
              {i.label}
            </NavLink>
          ))}
          <button className="flex min-h-[58px] flex-col items-center justify-center gap-1 text-[10.5px] text-ink-400" onClick={() => setDrawer(true)}>
            <Menu size={20} />
            Thêm
          </button>
        </div>
      </nav>
    </div>
  );
}

export function Brand() {
  return (
    <div className="flex items-center gap-3 px-2">
      <img src="/favicon.svg" alt="" className="h-9 w-9" />
      <div className="leading-tight">
        <div className="font-display text-[17px] font-semibold tracking-wide text-white">STARTUP</div>
        <div className="text-[11px] text-sky-300/90">Khởi Nghiệp Đâu Dễ</div>
      </div>
    </div>
  );
}
