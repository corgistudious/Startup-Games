import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Wallet, Building2, TrendingUp, PiggyBank, Plus, ArrowRight, CheckCircle2, Circle, Bell, Users } from 'lucide-react';
import { stageName } from '@startup/shared';
import { api } from '@/lib/api';
import { useMe, useWorld } from '@/lib/hooks';
import { Panel, Stat, Money, Button, Badge, Empty, Loading, ErrorBox, Logo, initials, Progress } from '@/components/ui';
import { AreaSeries } from '@/components/charts';
import { dayLabel, STATUS_LABEL, ago, num } from '@/lib/format';

type Overview = {
  cash: number;
  cashLocked: number;
  portfolioValue: number;
  companyCash: number;
  netWorth: number;
  companies: { id: string; name: string; status: string; industry_name: string; cash: number; employees: number; revenue_7d: number; reputation: number; logo_hue: number }[];
  holdings: { symbol: string; qty: number; last_price: number; name: string }[];
  loans: { id: string; outstanding: number; status: string }[];
  stage: { reqs: Record<string, { label: string; met: boolean; detail: string }[]> };
  revenueSeries: { day: number; revenue: number }[];
};

export default function Dashboard() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const { data: world } = useWorld();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/me/overview') });
  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ id: number; title: string; body: string; created_at: string; read_at: string | null }[]>('/notifications') });
  if (q.isLoading) return <Loading rows={5} />;
  if (q.error) return <ErrorBox error={q.error} />;
  const o = q.data!;
  const next = (me?.stage ?? 1) + 1;
  const reqs = o.stage.reqs[next] ?? [];
  const met = reqs.filter((r) => r.met).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="eyebrow">{t('Bảng điều khiển')}</div>
          <h1 className="mt-1 text-2xl font-semibold sm:text-[28px]">{t('Xin chào')}, {me?.display_name}</h1>
          <p className="mt-1 text-sm text-ink-300">
            {t('Giai đoạn hiện tại')}: <span className="font-medium text-sky-200">{t(stageName(me?.stage ?? 1))}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => nav('/market')}>
            {t('Xem thị trường')}
          </Button>
          <Button shimmer={o.companies.length === 0} icon={<Plus size={17} />} onClick={() => nav('/companies?new=1')}>
            {t('Thành lập doanh nghiệp')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('Tài sản ròng')} value={<Money value={o.netWorth} compact />} icon={<TrendingUp size={16} />} hint={t('Tiền mặt + cổ phiếu + tiền doanh nghiệp − nợ cá nhân')} />
        <Stat label={t('Tiền mặt cá nhân')} value={<Money value={o.cash} compact />} icon={<Wallet size={16} />} hint={o.cashLocked ? `Đang phong tỏa ${(o.cashLocked / 1e6).toFixed(1)} tr cho lệnh mua` : t('Khả dụng')} />
        <Stat label={t('Tiền mặt doanh nghiệp')} value={<Money value={o.companyCash} compact />} icon={<Building2 size={16} />} hint={`${o.companies.length} doanh nghiệp`} />
        <Stat label={t('Danh mục cổ phiếu')} value={<Money value={o.portfolioValue} compact />} icon={<PiggyBank size={16} />} hint={`${o.holdings.length} mã`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title={t('Doanh thu bán hàng theo ngày')} eyebrow={t('14 ngày game gần nhất')} className="xl:col-span-2">
          {o.revenueSeries.length ? <AreaSeries data={o.revenueSeries.map((r) => ({ ...r, label: dayLabel(r.day) }))} x="label" y="revenue" /> : <Empty title={t('Chưa có doanh thu')} text={t('Doanh thu xuất hiện khi doanh nghiệp có hàng, có nhân viên bán hàng trong ca và giá cạnh tranh.')} />}
        </Panel>
        <Panel title={`Lộ trình lên ${stageName(next)}`} eyebrow="Phát triển doanh nghiệp">
          {next > 5 ? (
            <p className="text-sm text-ink-300">Bạn đã đạt giai đoạn cao nhất: Tập đoàn.</p>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between text-xs text-ink-300">
                <span>
                  {met}/{reqs.length} điều kiện
                </span>
              </div>
              <Progress value={met} max={Math.max(1, reqs.length)} />
              <ul className="mt-4 space-y-2.5">
                {reqs.map((r) => (
                  <li key={r.label} className="flex items-start gap-2.5 text-sm">
                    {r.met ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-gain" /> : <Circle size={17} className="mt-0.5 shrink-0 text-ink-500" />}
                    <div className="min-w-0">
                      <div className={r.met ? 'text-ink-200' : 'text-white'}>{r.label}</div>
                      <div className="text-xs text-ink-400">Hiện tại: {r.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title={t('Doanh nghiệp của bạn')} className="xl:col-span-2" action={<Link to="/companies" className="text-sm text-sky-300 hover:text-sky-200">{t('Tất cả')}</Link>}>
          {o.companies.length === 0 ? (
            <Empty title={t('Bạn chưa có doanh nghiệp')} text="Chọn ngành phù hợp với vốn: tiệm bánh và quán cà phê cần ít vốn, nông trại bán nguyên liệu cho người chơi khác." action={<Button onClick={() => nav('/companies?new=1')}>{t('Thành lập ngay')}</Button>} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {o.companies.map((c) => (
                <Link key={c.id} to={`/companies/${c.id}`} className="group flex items-center gap-3 rounded-xl border p-3 transition hover:border-sky-400/40 hover:bg-sky-400/5" style={{ borderColor: 'var(--line)' }}>
                  <Logo hue={c.logo_hue} glyph={initials(c.name)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-white">{c.name}</div>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-400">
                      {c.industry_name} · <Users size={12} /> {c.employees}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      <Badge tone={c.status === 'active' ? 'gain' : c.status === 'licensing' ? 'sky' : 'loss'}>{STATUS_LABEL[c.status]}</Badge>
                      <span className="text-ink-300">
                        Tiền: <Money value={c.cash} compact />
                      </span>
                    </div>
                  </div>
                  <ArrowRight size={16} className="text-ink-500 transition group-hover:translate-x-0.5 group-hover:text-sky-300" />
                </Link>
              ))}
            </div>
          )}
        </Panel>
        <Panel title={t('Thông báo gần đây')} action={<Link to="/inbox" className="text-sm text-sky-300">{t('Hộp thư')}</Link>}>
          {notes.data?.length ? (
            <ul className="space-y-3">
              {notes.data.slice(0, 6).map((n) => (
                <li key={n.id} className="flex gap-2.5 text-sm">
                  <Bell size={15} className={`mt-0.5 shrink-0 ${n.read_at ? 'text-ink-500' : 'text-sky-300'}`} />
                  <div className="min-w-0">
                    <div className="truncate text-ink-100">{n.title}</div>
                    <div className="line-clamp-2 text-xs text-ink-400">{n.body}</div>
                    <div className="text-[11px] text-ink-500">{ago(n.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title={t('Chưa có thông báo')} />
          )}
        </Panel>
      </div>

      {world && (
        <Panel title={t('Nhịp đập thế giới')} eyebrow={t('Kinh tế chung của mọi người chơi')}>
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <div className="text-ink-400">{t('Người chơi')}</div>
              <div className="num text-lg text-white">{num(world.stats.players)}</div>
            </div>
            <div>
              <div className="text-ink-400">{t('Doanh nghiệp hoạt động')}</div>
              <div className="num text-lg text-white">{num(world.stats.companies)}</div>
            </div>
            <div>
              <div className="text-ink-400">{t('Lao động có việc / tìm việc')}</div>
              <div className="num text-lg text-white">
                {num(world.stats.employed)} / {num(world.stats.seeking)}
              </div>
            </div>
            <div>
              <div className="text-ink-400">{t('Sức mua dân cư')}</div>
              <div className="text-lg text-white">
                <Money value={world.households} compact />
              </div>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
