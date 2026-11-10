import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, MapPin, Users, Clock3, Percent } from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCatalog } from '@/lib/catalog';
import { PageHeader, Panel, Button, Modal, Field, Money, Badge, Empty, Loading, Logo, initials } from '@/components/ui';
import { STATUS_LABEL, vnd, pct } from '@/lib/format';

type Ov = { cash: number; companies: { id: string; name: string; status: string; industry_name: string; cash: number; employees: number; revenue_7d: number; reputation: number; logo_hue: number }[] };

export default function Companies() {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get('new') === '1');
  const q = useQuery({ queryKey: ['overview'], queryFn: () => api<Ov>('/me/overview') });
  useEffect(() => setOpen(params.get('new') === '1'), [params]);
  const close = () => setParams({});

  return (
    <div>
      <PageHeader
        eyebrow="Kinh doanh"
        title="Doanh nghiệp"
        subtitle="Mỗi doanh nghiệp có tài khoản, tài sản, công nợ và nhân sự riêng. Giai đoạn phát triển quyết định số doanh nghiệp bạn được sở hữu."
        actions={
          <Button shimmer={!q.data?.companies.length} icon={<Plus size={17} />} onClick={() => setParams({ new: '1' })}>
            Thành lập doanh nghiệp
          </Button>
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.companies.length ? (
        <Panel>
          <Empty title="Chưa có doanh nghiệp nào" text="Hãy chọn ngành, địa điểm và vốn điều lệ để nộp hồ sơ đăng ký kinh doanh." action={<Button onClick={() => setParams({ new: '1' })}>Bắt đầu</Button>} />
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.companies.map((c) => (
            <Link key={c.id} to={`/companies/${c.id}`} className="panel rise block p-5 transition hover:border-sky-400/40">
              <div className="flex items-center gap-3">
                <Logo hue={c.logo_hue} glyph={initials(c.name)} size={46} />
                <div className="min-w-0">
                  <div className="truncate font-display text-lg font-semibold text-white">{c.name}</div>
                  <div className="text-sm text-ink-400">{c.industry_name}</div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <div className="text-xs text-ink-400">Tiền mặt</div>
                  <Money value={c.cash} compact className="text-white" />
                </div>
                <div>
                  <div className="text-xs text-ink-400">Doanh thu 7 ngày</div>
                  <Money value={c.revenue_7d} compact className="text-white" />
                </div>
                <div>
                  <div className="text-xs text-ink-400">Nhân sự</div>
                  <span className="num text-white">{c.employees}</span>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <Badge tone={c.status === 'active' ? 'gain' : c.status === 'licensing' ? 'sky' : 'loss'}>{STATUS_LABEL[c.status]}</Badge>
                <span className="text-xs text-ink-400">Uy tín {Number(c.reputation).toFixed(0)}/100</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      <FoundModal open={open} onClose={close} cash={q.data?.cash ?? 0} />
    </div>
  );
}

function FoundModal({ open, onClose, cash }: { open: boolean; onClose: () => void; cash: number }) {
  const cat = useCatalog();
  const nav = useNavigate();
  const [industry, setIndustry] = useState('');
  const [location, setLocation] = useState('');
  const [name, setName] = useState('');
  const [capital, setCapital] = useState(0);
  const [description, setDescription] = useState('');
  const ind = cat.industry(industry);
  const loc = cat.data?.locations.find((l) => l.code === location);
  useEffect(() => {
    if (ind) setCapital((c) => Math.max(c, ind.min_capital));
  }, [ind]);
  const recipes = useMemo(() => cat.data?.recipes.filter((r) => r.industry_code === industry) ?? [], [cat.data, industry]);
  const found = useAction<object, { id: string }>('/companies', { invalidate: [['overview']], success: 'Đã nộp hồ sơ đăng ký kinh doanh' });
  const total = capital + (ind?.register_fee ?? 0);
  const ok = !!ind && !!loc && name.trim().length >= 3 && capital >= (ind?.min_capital ?? 0) && total <= cash;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Đăng ký thành lập doanh nghiệp"
      wide
      footer={
        <>
          <div className="mr-auto text-sm text-ink-300">
            Tổng cần: <Money value={total} className="font-semibold text-white" /> · Bạn có <Money value={cash} compact />
          </div>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button
            shimmer
            disabled={!ok}
            loading={found.isPending}
            onClick={() => found.mutate({ name: name.trim(), industry, location, capital, description }, { onSuccess: (r) => (onClose(), nav(`/companies/${r.id}`)) })}
          >
            Nộp hồ sơ
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <div className="label">1. Ngành nghề</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {cat.data?.industries.map((i) => (
              <button key={i.code} onClick={() => setIndustry(i.code)} className={clsx('rounded-xl border p-3 text-left transition', industry === i.code ? 'border-sky-400/70 bg-sky-400/10' : 'hover:border-sky-400/30')} style={industry === i.code ? undefined : { borderColor: 'var(--line)' }}>
                <div className="font-medium text-white">{i.name}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-ink-400">{i.description}</div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-300">
                  <span>Vốn tối thiểu {vnd(i.min_capital, true)}</span>
                  <span className="inline-flex items-center gap-1">
                    <Percent size={11} />
                    Thuế {pct(i.tax_rate)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock3 size={11} />
                    Giấy phép {i.license_hours}h game
                  </span>
                </div>
              </button>
            ))}
          </div>
          {recipes.length > 0 && (
            <p className="mt-2 text-xs text-ink-400">
              Sản xuất được: {recipes.map((r) => `${cat.good(r.output_good)?.name}${r.inputs.length ? ` (từ ${r.inputs.map((x) => cat.good(x.good)?.name).join(', ')})` : ''}`).join(' · ')}
            </p>
          )}
        </div>
        <div>
          <div className="label">2. Địa điểm</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {cat.data?.locations.map((l) => (
              <button key={l.code} onClick={() => setLocation(l.code)} className={clsx('rounded-xl border p-3 text-left transition', location === l.code ? 'border-sky-400/70 bg-sky-400/10' : 'hover:border-sky-400/30')} style={location === l.code ? undefined : { borderColor: 'var(--line)' }}>
                <div className="flex items-center gap-1.5 text-sm font-medium text-white">
                  <MapPin size={13} />
                  {l.name}
                </div>
                <div className="mt-1 text-[11px] text-ink-400">
                  Thuê {vnd(l.rent_day, true)}/ngày · <Users size={10} className="inline" /> lưu lượng ×{l.traffic}
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="3. Tên doanh nghiệp">{(id) => <input id={id} className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="VD: Bánh Mì Sương Mai" />}</Field>
          <Field label="Vốn điều lệ góp ban đầu" hint={ind ? `Tối thiểu ${vnd(ind.min_capital)} · Lệ phí đăng ký ${vnd(ind.register_fee)}` : undefined}>
            {(id) => <input id={id} className="field num" type="number" inputMode="numeric" min={ind?.min_capital} step={10_000_000} value={capital || ''} onChange={(e) => setCapital(Number(e.target.value))} />}
          </Field>
        </div>
        <Field label="Giới thiệu (hiển thị trong Thư viện doanh nghiệp)">{(id) => <textarea id={id} className="field min-h-[72px]" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        {loc && ind && (
          <div className="rounded-xl bg-sky-400/5 p-3 text-xs text-ink-300 ring-1 ring-sky-400/20">
            Chi phí cố định ước tính mỗi ngày: thuê mặt bằng {vnd(loc.rent_day)} + bảo trì thiết bị + lương nhân sự. Doanh nghiệp được cấp phép sau {ind.license_hours} giờ trong game ({Math.round((ind.license_hours * 2))} phút thực).
          </div>
        )}
      </div>
    </Modal>
  );
}
