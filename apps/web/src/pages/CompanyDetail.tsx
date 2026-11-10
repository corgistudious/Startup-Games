import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LayoutGrid, Users, Factory, Truck, Megaphone, Landmark, Plus, Wrench, PackageCheck, Clock3, AlertTriangle, TrendingUp, Star, Sparkles } from 'lucide-react';
import { DEPARTMENTS, SHIFTS, CHANNELS } from '@startup/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCatalog } from '@/lib/catalog';
import { Panel, Stat, Money, Button, Badge, Tabs, Modal, Field, Empty, Loading, ErrorBox, Progress, ConfirmButton, TableWrap, Logo, initials } from '@/components/ui';
import { AreaSeries, Bars } from '@/components/charts';
import { vnd, num, gameTime, dayLabel, monthLabel, STATUS_LABEL, pct } from '@/lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Detail = Record<string, any>;
type Tab = 'overview' | 'staff' | 'production' | 'supply' | 'sales' | 'finance';

export default function CompanyDetail() {
  const { id = '' } = useParams();
  const [tab, setTab] = useState<Tab>('overview');
  const q = useQuery({ queryKey: ['company', id], queryFn: () => api<Detail>(`/companies/${id}`), refetchInterval: 30_000 });
  if (q.isLoading) return <Loading rows={5} />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const c = d.company;
  const tabs: { id: Tab; label: string; icon: JSX.Element }[] = [
    { id: 'overview', label: 'Tổng quan', icon: <LayoutGrid size={16} /> },
    { id: 'staff', label: `Nhân sự (${d.staff.length})`, icon: <Users size={16} /> },
    { id: 'production', label: 'Sản xuất & Kho', icon: <Factory size={16} /> },
    { id: 'supply', label: 'Mua hàng & Vận chuyển', icon: <Truck size={16} /> },
    { id: 'sales', label: 'Bán hàng & Marketing', icon: <Megaphone size={16} /> },
    { id: 'finance', label: 'Tài chính & Báo cáo', icon: <Landmark size={16} /> },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Logo hue={c.logo_hue} glyph={initials(c.name)} size={56} />
        <div className="min-w-0 flex-1">
          <div className="eyebrow">{c.industry_name} · {c.location_name}</div>
          <h1 className="truncate text-2xl font-semibold sm:text-[28px]">{c.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone={c.status === 'active' ? 'gain' : c.status === 'licensing' ? 'sky' : 'loss'}>{STATUS_LABEL[c.status]}</Badge>
            {c.verified && <Badge tone="sky">Verified</Badge>}
            {d.instrument && <Badge tone="gold">Niêm yết: {d.instrument.symbol}</Badge>}
            <Link to={`/library/${c.slug}`} className="text-xs text-sky-300 hover:underline">
              Xem hồ sơ công khai
            </Link>
          </div>
        </div>
      </div>
      {c.status === 'licensing' && (
        <div className="panel flex items-center gap-3 border-sky-400/30 p-4 text-sm">
          <Clock3 className="shrink-0 text-sky-300" size={18} />
          <span>
            Giấy phép kinh doanh dự kiến cấp lúc <b className="text-white">{gameTime(c.license_ready_at)}</b>. Trong thời gian chờ, hãy mua thiết bị, tuyển người và nhập nguyên liệu.
          </span>
        </div>
      )}
      {c.status === 'insolvent' && (
        <div className="panel flex items-center gap-3 border-red-400/40 p-4 text-sm text-red-100">
          <AlertTriangle className="shrink-0 text-loss" size={18} />
          Doanh nghiệp đang mất khả năng thanh toán ({c.insolvent_days}/7 ngày). Góp thêm vốn, bán hàng tồn hoặc cắt giảm chi phí để tránh phá sản.
        </div>
      )}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'overview' && <Overview d={d} />}
      {tab === 'staff' && <Staff d={d} />}
      {tab === 'production' && <Production d={d} />}
      {tab === 'supply' && <Supply d={d} />}
      {tab === 'sales' && <Sales d={d} />}
      {tab === 'finance' && <Finance d={d} />}
    </div>
  );
}

function Overview({ d }: { d: Detail }) {
  const c = d.company;
  const m = d.monthToDate as Record<string, number>;
  const revenue = -((m.sales_revenue ?? 0) + (m.other_income ?? 0));
  const costs = ['cogs', 'wages', 'marketing', 'rent', 'maintenance', 'freight', 'fees', 'interest', 'depreciation', 'spoilage'].reduce((s, k) => s + (m[k] ?? 0), 0);
  const [capOpen, setCapOpen] = useState(false);
  const [amount, setAmount] = useState(50_000_000);
  const inject = useAction(`/companies/${c.id}/capital`, { invalidate: [['company', c.id], ['overview']], success: 'Đã góp thêm vốn' });
  const sales = d.sales.map((s: any) => ({ ...s, label: dayLabel(s.day) }));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Tiền mặt" value={<Money value={d.balanceSheet.assets.cash} compact />} hint={d.balanceSheet.liabilities.total ? `Nợ phải trả ${vnd(d.balanceSheet.liabilities.total, true)}` : 'Không có công nợ'} />
        <Stat label="Doanh thu tháng này" value={<Money value={revenue} compact />} hint="Ghi nhận theo bút toán thực tế" />
        <Stat label="Lợi nhuận tạm tính" value={<Money value={revenue - costs} compact signed />} tone={revenue - costs >= 0 ? 'gain' : 'loss'} hint="Trước thuế, từ đầu tháng" />
        <Stat label="Uy tín · Thương hiệu" value={`${Number(c.reputation).toFixed(0)} · ${Number(c.brand).toFixed(0)}`} hint="Ảnh hưởng lượng khách" />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Doanh thu bán hàng" eyebrow="14 ngày game" className="xl:col-span-2">
          {sales.length ? <AreaSeries data={sales} x="label" y="revenue" /> : <Empty title="Chưa bán được hàng" text="Cần: sản phẩm trong kho, giá niêm yết, nhân viên bán hàng đang trong ca và cửa hàng đang mở cửa." />}
        </Panel>
        <Panel title="Vận hành">
          <dl className="space-y-3 text-sm">
            <Row k="Giờ mở cửa" v={c.industry_kind === 'producer' ? 'Bán buôn 24/7' : `${c.open_hour}:00 – ${c.close_hour}:00`} />
            <Row k="Thuê mặt bằng" v={`${vnd(c.rent_day)}/ngày`} />
            <Row k="Thuế suất" v={pct(c.tax_rate)} />
            <Row k="Nhân sự" v={`${d.staff.length} người`} />
            <Row k="Thiết bị" v={`${d.equipment.length} máy`} />
            <Row k="Lệnh sản xuất đang chạy" v={d.orders.filter((o: any) => o.status === 'running').length} />
            <Row k="Hàng đang về" v={d.shipments.filter((s: any) => s.status === 'in_transit' && s.buyer_company_id === c.id).length} />
          </dl>
          <Button variant="secondary" className="mt-4 w-full" icon={<Plus size={16} />} onClick={() => setCapOpen(true)}>
            Góp thêm vốn
          </Button>
        </Panel>
      </div>
      <Modal
        open={capOpen}
        onClose={() => setCapOpen(false)}
        title="Góp thêm vốn từ tiền cá nhân"
        footer={
          <Button loading={inject.isPending} onClick={() => inject.mutate({ amount }, { onSuccess: () => setCapOpen(false) })}>
            Góp {vnd(amount, true)}
          </Button>
        }
      >
        <Field label="Số tiền" hint="Tiền chuyển từ tài khoản cá nhân vào vốn chủ sở hữu của doanh nghiệp.">
          {(id) => <input id={id} type="number" inputMode="numeric" className="field num" step={10_000_000} min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />}
        </Field>
      </Modal>
    </div>
  );
}

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-400">{k}</dt>
      <dd className="text-right text-ink-100">{v}</dd>
    </div>
  );
}

function Staff({ d }: { d: Detail }) {
  const c = d.company;
  const [hireOpen, setHireOpen] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const payroll = d.staff.reduce((s: number, p: any) => s + Number(p.wage), 0);
  const fire = useAction<{ personId: string }>((b) => `/companies/${c.id}/staff/${b.personId}`, { method: 'DELETE', invalidate: [['company', c.id]], success: 'Đã chấm dứt hợp đồng' });
  const byDept = useMemo(() => Object.entries(DEPARTMENTS).map(([k, v]) => ({ k, v, n: d.staff.filter((p: any) => p.department === k).length })), [d.staff]);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Quỹ lương / ngày làm đủ" value={<Money value={payroll} compact />} hint="Trả theo giờ làm thực tế mỗi 00:00" />
        <Stat label="Tinh thần trung bình" value={d.staff.length ? `${Math.round(d.staff.reduce((s: number, p: any) => s + p.morale, 0) / d.staff.length)}/100` : '—'} />
        <Stat label="Kỹ năng trung bình" value={d.staff.length ? Math.round(d.staff.reduce((s: number, p: any) => s + p.skill, 0) / d.staff.length) : '—'} />
        <Stat label="Lương còn nợ" value={<Money value={d.balanceSheet.liabilities.wages} compact />} tone={d.balanceSheet.liabilities.wages ? 'loss' : undefined} hint={d.balanceSheet.liabilities.wages ? 'Nợ lương 3 ngày nhân viên sẽ nghỉ' : 'Không nợ lương'} />
      </div>
      <Panel
        title="Đội ngũ"
        action={
          <Button size="sm" icon={<Plus size={15} />} onClick={() => setHireOpen(true)}>
            Tuyển dụng
          </Button>
        }
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {byDept.map((x) => (
            <Badge key={x.k} tone={x.n ? 'sky' : 'muted'}>
              {x.v}: {x.n}
            </Badge>
          ))}
        </div>
        {d.staff.length === 0 ? (
          <Empty title="Chưa có nhân sự" text="Sản xuất cần phòng Sản xuất; bán lẻ cần phòng Bán hàng có người trong ca lúc cửa hàng mở." />
        ) : (
          <TableWrap>
            <table className="table min-w-[760px]">
              <thead>
                <tr>
                  <th>Họ tên</th>
                  <th>Phòng ban</th>
                  <th>Ca</th>
                  <th className="text-right">Lương/ngày</th>
                  <th>Kỹ năng</th>
                  <th>Tinh thần</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.staff.map((p: any) => (
                  <tr key={p.id}>
                    <td>
                      <div className="font-medium text-white">{p.full_name}</div>
                      <div className="text-xs text-ink-400">{p.title ?? `${p.age} tuổi`}{p.unpaid_days ? ` · nợ lương ${p.unpaid_days} ngày` : ''}</div>
                    </td>
                    <td>{DEPARTMENTS[p.department as keyof typeof DEPARTMENTS]}</td>
                    <td className="text-xs text-ink-300">{SHIFTS[p.shift as keyof typeof SHIFTS]}</td>
                    <td className="text-right">
                      <Money value={p.wage} />
                    </td>
                    <td className="w-28">
                      <div className="num mb-1 text-xs">{p.skill}</div>
                      <Progress value={p.skill} />
                    </td>
                    <td className="w-28">
                      <div className="num mb-1 text-xs">{p.morale}</div>
                      <Progress value={p.morale} tone={p.morale < 35 ? 'loss' : p.morale < 60 ? 'warn' : 'gain'} />
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>
                        Điều chỉnh
                      </Button>
                      <ConfirmButton label="Cho nghỉ" title={`Chấm dứt hợp đồng ${p.full_name}?`} message={`Doanh nghiệp trả trợ cấp thôi việc 3 ngày lương (${vnd(p.wage * 3)}).`} onConfirm={() => fire.mutateAsync({ personId: p.id })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
      <HireModal open={hireOpen} onClose={() => setHireOpen(false)} companyId={c.id} />
      {edit && <EditStaff p={edit} companyId={c.id} onClose={() => setEdit(null)} />}
    </div>
  );
}

function HireModal({ open, onClose, companyId }: { open: boolean; onClose: () => void; companyId: string }) {
  const [minSkill, setMinSkill] = useState(0);
  const q = useQuery({ queryKey: ['people', minSkill], queryFn: () => api<any[]>(`/people?minSkill=${minSkill}`), enabled: open });
  const [pick, setPick] = useState<any>(null);
  const [form, setForm] = useState({ wage: 0, shift: 'day', department: 'san_xuat' });
  const hire = useAction(`/companies/${companyId}/staff`, { invalidate: [['company', companyId], ['people']], success: 'Đã ký hợp đồng lao động' });
  return (
    <Modal open={open} onClose={onClose} title="Thị trường lao động" wide>
      {!pick ? (
        <>
          <div className="mb-3 flex items-center gap-3">
            <label className="text-sm text-ink-300" htmlFor="minskill">
              Kỹ năng tối thiểu
            </label>
            <input id="minskill" type="range" min={0} max={90} step={10} value={minSkill} onChange={(e) => setMinSkill(Number(e.target.value))} className="flex-1 accent-sky-400" />
            <span className="num w-8 text-sm">{minSkill}</span>
          </div>
          {q.isLoading ? (
            <Loading />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {q.data?.map((p) => (
                <button key={p.id} onClick={() => (setPick(p), setForm((f) => ({ ...f, wage: p.wage_expectation })))} className="rounded-xl border p-3 text-left transition hover:border-sky-400/40 hover:bg-sky-400/5" style={{ borderColor: 'var(--line)' }}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">{p.full_name}</span>
                    <span className="text-xs text-ink-400">{p.age} tuổi</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    <span className="w-20">Kỹ năng {p.skill}</span>
                    <div className="flex-1">
                      <Progress value={p.skill} />
                    </div>
                  </div>
                  <div className="mt-1.5 text-xs text-ink-300">
                    Kỳ vọng: <Money value={p.wage_expectation} />/ngày
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-ink-950/50 p-3 text-sm">
            <b className="text-white">{pick.full_name}</b> · kỹ năng {pick.skill} · kỳ vọng {vnd(pick.wage_expectation)}/ngày. Trả thấp hơn 90% kỳ vọng ứng viên sẽ từ chối; trả cao hơn giúp tinh thần tốt hơn. Phí tuyển dụng bằng 1 ngày lương.
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Lương / ngày (8 giờ)">{(id) => <input id={id} type="number" inputMode="numeric" className="field num" step={5000} value={form.wage} onChange={(e) => setForm({ ...form, wage: Number(e.target.value) })} />}</Field>
            <Field label="Phòng ban">
              {(id) => (
                <select id={id} className="field" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                  {Object.entries(DEPARTMENTS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Ca làm việc">
              {(id) => (
                <select id={id} className="field" value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })}>
                  {Object.entries(SHIFTS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setPick(null)}>
              Chọn người khác
            </Button>
            <Button loading={hire.isPending} onClick={() => hire.mutate({ personId: pick.id, ...form }, { onSuccess: () => setPick(null) })}>
              Gửi đề nghị hợp đồng
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function EditStaff({ p, companyId, onClose }: { p: any; companyId: string; onClose: () => void }) {
  const [form, setForm] = useState({ wage: Number(p.wage), shift: p.shift, department: p.department, title: p.title ?? '' });
  const save = useAction<object>(`/companies/${companyId}/staff/${p.id}`, { method: 'PATCH', invalidate: [['company', companyId]], success: 'Đã cập nhật hợp đồng' });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Điều chỉnh: ${p.full_name}`}
      footer={
        <Button loading={save.isPending} onClick={() => save.mutate({ ...form, title: form.title || null }, { onSuccess: onClose })}>
          Lưu thay đổi
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lương / ngày" hint="Giảm lương làm tinh thần giảm mạnh.">{(id) => <input id={id} type="number" inputMode="numeric" className="field num" step={5000} value={form.wage} onChange={(e) => setForm({ ...form, wage: Number(e.target.value) })} />}</Field>
        <Field label="Chức danh (VD: Giám đốc điều hành)">{(id) => <input id={id} className="field" maxLength={40} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
        <Field label="Phòng ban">
          {(id) => (
            <select id={id} className="field" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
              {Object.entries(DEPARTMENTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Ca làm việc">
          {(id) => (
            <select id={id} className="field" value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })}>
              {Object.entries(SHIFTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
    </Modal>
  );
}

function Production({ d }: { d: Detail }) {
  const c = d.company;
  const cat = useCatalog();
  const recipes = cat.data?.recipes.filter((r) => r.industry_code === c.industry_code) ?? [];
  const usable = new Set(recipes.map((r) => r.equipment));
  const [eqOpen, setEqOpen] = useState(false);
  const [eqType, setEqType] = useState('');
  const [count, setCount] = useState(1);
  const [batches, setBatches] = useState<Record<string, number>>({});
  const buyEq = useAction(`/companies/${c.id}/equipment`, { invalidate: [['company', c.id]], success: 'Đã mua thiết bị' });
  const start = useAction(`/companies/${c.id}/production`, { invalidate: [['company', c.id]], success: 'Đã bắt đầu lệnh sản xuất' });
  const cancel = useAction<{ orderId: string }>((b) => `/companies/${c.id}/production/${b.orderId}`, { method: 'DELETE', invalidate: [['company', c.id]], success: 'Đã hủy lệnh sản xuất' });
  const stock = (g: string) => {
    const r = d.inventory.find((i: any) => i.good_code === g);
    return r ? r.qty - r.reserved : 0;
  };
  const producers = d.staff.filter((p: any) => p.department === 'san_xuat').length;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Dây chuyền & thiết bị"
          action={
            <Button size="sm" variant="secondary" icon={<Wrench size={15} />} onClick={() => setEqOpen(true)}>
              Mua thiết bị
            </Button>
          }
        >
          {d.equipment.length === 0 ? (
            <Empty title="Chưa có thiết bị" text="Mỗi công thức cần đúng loại máy. Công suất phụ thuộc số máy và tình trạng bảo trì." />
          ) : (
            <ul className="space-y-3">
              {d.equipment.map((e: any) => (
                <li key={e.id} className="flex items-center gap-3 text-sm">
                  <Factory size={16} className="shrink-0 text-sky-300" />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between">
                      <span className="truncate text-white">{e.name}</span>
                      <span className="num text-xs text-ink-400">{Number(e.condition).toFixed(0)}%</span>
                    </div>
                    <Progress value={e.condition} tone={e.condition < 30 ? 'loss' : e.condition < 60 ? 'warn' : 'gain'} />
                    <div className="mt-1 text-[11px] text-ink-400">
                      {e.batches_per_hour} mẻ/giờ · bảo trì {vnd(e.maintenance_day)}/ngày · giá trị sổ sách {vnd(e.book_value, true)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Kho hàng">
          {d.inventory.length === 0 ? (
            <Empty title="Kho trống" />
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Mặt hàng</th>
                    <th className="text-right">Tồn</th>
                    <th className="text-right">Giá vốn bình quân</th>
                    <th>Hao hụt/ngày</th>
                  </tr>
                </thead>
                <tbody>
                  {d.inventory.map((i: any) => (
                    <tr key={i.good_code}>
                      <td>
                        <span className="text-white">{i.name}</span> <Badge tone={i.category === 'raw' ? 'muted' : 'sky'}>{i.category === 'raw' ? 'Nguyên liệu' : 'Thành phẩm'}</Badge>
                      </td>
                      <td className="num text-right">
                        {num(i.qty)} {i.unit}
                      </td>
                      <td className="text-right">
                        <Money value={i.qty ? Math.round(i.value / i.qty) : 0} />
                      </td>
                      <td className="text-xs text-ink-400">{i.spoil_per_day ? pct(i.spoil_per_day) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>
      </div>

      <Panel title="Công thức sản xuất" eyebrow={`${producers} nhân viên sản xuất · làm việc theo ca`}>
        <div className="grid gap-3 md:grid-cols-2">
          {recipes.map((r) => {
            const b = batches[r.code] ?? 1;
            const missing = r.inputs.filter((x) => stock(x.good) < x.qty * b);
            const hasEq = d.equipment.some((e: any) => e.type_code === r.equipment && e.condition > 20);
            return (
              <div key={r.code} className="rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-white">{r.name}</div>
                    <div className="text-xs text-ink-400">
                      1 mẻ = {r.output_qty} {cat.good(r.output_good)?.unit} {cat.good(r.output_good)?.name} · {r.labor_hours} giờ công · máy: {cat.equipmentType(r.equipment)?.name}
                    </div>
                  </div>
                  {!hasEq && <Badge tone="warn">Thiếu máy</Badge>}
                </div>
                <ul className="mt-3 space-y-1 text-sm">
                  {r.inputs.length === 0 && <li className="text-ink-400">Không cần nguyên liệu đầu vào</li>}
                  {r.inputs.map((x) => (
                    <li key={x.good} className="flex justify-between">
                      <span className="text-ink-300">{cat.good(x.good)?.name}</span>
                      <span className={`num ${stock(x.good) < x.qty * b ? 'text-loss' : 'text-ink-200'}`}>
                        {num(x.qty * b)} / {num(stock(x.good))} {cat.good(x.good)?.unit}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex items-end gap-2">
                  <Field label="Số mẻ">{(id) => <input id={id} type="number" inputMode="numeric" min={1} max={500} className="field num w-24" value={b} onChange={(e) => setBatches({ ...batches, [r.code]: Math.max(1, Number(e.target.value)) })} />}</Field>
                  <Button className="flex-1" disabled={!hasEq || missing.length > 0 || !['active', 'insolvent'].includes(c.status)} loading={start.isPending && (start.variables as any)?.recipe === r.code} onClick={() => start.mutate({ recipe: r.code, batches: b })} icon={<PackageCheck size={16} />}>
                    Bắt đầu sản xuất
                  </Button>
                </div>
                {missing.length > 0 && <p className="mt-2 text-xs text-loss">Thiếu nguyên liệu. Mua ở tab Mua hàng & Vận chuyển.</p>}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Lệnh sản xuất">
        {d.orders.length === 0 ? (
          <Empty title="Chưa có lệnh sản xuất" />
        ) : (
          <TableWrap>
            <table className="table min-w-[640px]">
              <thead>
                <tr>
                  <th>Công thức</th>
                  <th>Tiến độ</th>
                  <th>Bắt đầu</th>
                  <th>Trạng thái</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.orders.map((o: any) => (
                  <tr key={o.id}>
                    <td className="text-white">{o.recipe_name}</td>
                    <td className="w-56">
                      <div className="num mb-1 text-xs">
                        {o.batches_done}/{o.batches} mẻ · {Number(o.labor_done).toFixed(1)}/{Number(o.labor_required).toFixed(0)} giờ công
                      </div>
                      <Progress value={o.labor_done} max={o.labor_required} tone={o.status === 'completed' ? 'gain' : 'sky'} />
                    </td>
                    <td className="text-xs text-ink-400">{gameTime(o.created_minute)}</td>
                    <td>
                      <Badge tone={o.status === 'completed' ? 'gain' : o.status === 'running' ? 'sky' : 'muted'}>{o.status === 'completed' ? 'Hoàn thành' : o.status === 'running' ? 'Đang chạy' : 'Đã hủy'}</Badge>
                    </td>
                    <td className="text-right">
                      {o.status === 'running' && <ConfirmButton label="Hủy" title="Hủy lệnh sản xuất?" message="Nguyên liệu đã xuất kho cho phần chưa hoàn thành sẽ bị ghi nhận hao hụt." onConfirm={() => cancel.mutateAsync({ orderId: o.id })} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>

      <Modal
        open={eqOpen}
        onClose={() => setEqOpen(false)}
        title="Mua thiết bị"
        footer={
          <Button disabled={!eqType} loading={buyEq.isPending} onClick={() => buyEq.mutate({ type: eqType, count }, { onSuccess: () => setEqOpen(false) })}>
            Mua {count} máy · {vnd((cat.equipmentType(eqType)?.price ?? 0) * count, true)}
          </Button>
        }
      >
        <div className="space-y-2">
          {cat.data?.equipment
            .filter((e) => usable.has(e.code))
            .map((e) => (
              <label key={e.code} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${eqType === e.code ? 'border-sky-400/70 bg-sky-400/10' : ''}`} style={eqType === e.code ? undefined : { borderColor: 'var(--line)' }}>
                <input type="radio" name="eq" className="accent-sky-400" checked={eqType === e.code} onChange={() => setEqType(e.code)} />
                <div className="flex-1">
                  <div className="text-white">{e.name}</div>
                  <div className="text-xs text-ink-400">
                    {e.batches_per_hour} mẻ/giờ khi có người vận hành · bảo trì {vnd(e.maintenance_day)}/ngày
                  </div>
                </div>
                <Money value={e.price} compact />
              </label>
            ))}
          <Field label="Số lượng">{(id) => <input id={id} type="number" inputMode="numeric" min={1} max={20} className="field num w-28" value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value)))} />}</Field>
        </div>
      </Modal>
    </div>
  );
}

function Supply({ d }: { d: Detail }) {
  const c = d.company;
  const cat = useCatalog();
  const needed = new Set((cat.data?.recipes.filter((r) => r.industry_code === c.industry_code) ?? []).flatMap((r) => r.inputs.map((x) => x.good)));
  const offers = useQuery({ queryKey: ['b2b'], queryFn: () => api<any[]>('/market/b2b') });
  const [buy, setBuy] = useState<any>(null);
  const [qty, setQty] = useState(10);
  const quote = useQuery({
    queryKey: ['quote', buy?.company_id, buy?.good_code, qty],
    queryFn: () => api<any>(`/companies/${c.id}/purchases/quote`, { method: 'POST', body: { sellerCompanyId: buy.company_id, good: buy.good_code, qty, maxUnitPrice: buy.price } }),
    enabled: !!buy && qty > 0,
  });
  const order = useAction(`/companies/${c.id}/purchases`, { invalidate: [['company', c.id], ['b2b']], success: 'Đã đặt hàng, hàng đang được vận chuyển' });
  const list = (offers.data ?? []).filter((o) => o.company_id !== c.id && (needed.size === 0 || needed.has(o.good_code)));
  const shipments = d.shipments;
  return (
    <div className="space-y-5">
      <Panel title="Nhà cung cấp" eyebrow={needed.size ? 'Đang lọc theo nguyên liệu ngành bạn cần' : 'Bán buôn'}>
        {offers.isLoading ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty title="Chưa có chào bán phù hợp" text="Ngành của bạn tự sản xuất nguyên liệu, hoặc chưa có nhà cung cấp còn hàng." />
        ) : (
          <TableWrap>
            <table className="table min-w-[700px]">
              <thead>
                <tr>
                  <th>Mặt hàng</th>
                  <th>Nhà cung cấp</th>
                  <th className="text-right">Giá</th>
                  <th className="text-right">Còn hàng</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((o) => (
                  <tr key={`${o.company_id}-${o.good_code}`}>
                    <td className="text-white">{o.good_name}</td>
                    <td>
                      <div>{o.company_name}</div>
                      <div className="text-xs text-ink-400">
                        {o.location_name} {o.is_npc ? '· NPC' : '· Người chơi'}
                      </div>
                    </td>
                    <td className="text-right">
                      <Money value={o.price} />
                      <div className={`text-[11px] ${o.price > o.ref_price ? 'text-loss' : 'text-gain'}`}>{o.price > o.ref_price ? '▲' : '▼'} so với giá tham chiếu</div>
                    </td>
                    <td className="num text-right">
                      {num(o.available)} {o.unit}
                    </td>
                    <td className="text-right">
                      <Button size="sm" variant="secondary" disabled={!o.available} onClick={() => (setBuy(o), setQty(Math.min(o.available, 10)))}>
                        Đặt mua
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
      <Panel title="Vận chuyển">
        {shipments.length === 0 ? (
          <Empty title="Chưa có lô hàng" />
        ) : (
          <TableWrap>
            <table className="table min-w-[720px]">
              <thead>
                <tr>
                  <th>Lô hàng</th>
                  <th>Chiều</th>
                  <th className="text-right">Giá trị</th>
                  <th>Dự kiến</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {shipments.map((s: any) => {
                  const incoming = s.buyer_company_id === c.id;
                  const late = s.status === 'in_transit' ? d.minute > s.quoted_eta_minute : s.eta_minute > s.quoted_eta_minute;
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="text-white">
                          {num(s.qty)} {s.unit} {s.good_name}
                        </div>
                        <div className="text-xs text-ink-400">{incoming ? `Từ ${s.seller_name}` : `Tới ${s.buyer_name}`}</div>
                      </td>
                      <td>
                        <Badge tone={incoming ? 'sky' : 'gain'}>{incoming ? 'Nhập' : 'Xuất'}</Badge>
                      </td>
                      <td className="text-right">
                        <Money value={s.goods_total} />
                        {incoming && <div className="text-[11px] text-ink-400">+ cước {vnd(s.freight, true)}</div>}
                      </td>
                      <td className="text-xs text-ink-300">{gameTime(s.quoted_eta_minute)}</td>
                      <td>{s.status === 'delivered' ? <Badge tone={late ? 'warn' : 'gain'}>{late ? 'Đã giao (trễ)' : 'Đã giao'}</Badge> : <Badge tone={late ? 'warn' : 'sky'}>{late ? 'Đang trễ' : 'Đang vận chuyển'}</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
      <Modal
        open={!!buy}
        onClose={() => setBuy(null)}
        title={buy ? `Đặt mua ${buy.good_name}` : ''}
        footer={
          <Button disabled={!quote.data} loading={order.isPending} onClick={() => order.mutate({ sellerCompanyId: buy.company_id, good: buy.good_code, qty, maxUnitPrice: buy.price }, { onSuccess: () => setBuy(null) })}>
            Xác nhận đặt hàng
          </Button>
        }
      >
        {buy && (
          <div className="space-y-4 text-sm">
            <Field label={`Số lượng (${buy.unit}) · còn ${num(buy.available)}`}>
              {(id) => <input id={id} type="number" inputMode="numeric" className="field num" min={1} max={buy.available} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(buy.available, Number(e.target.value))))} />}
            </Field>
            {quote.data && (
              <dl className="space-y-2 rounded-xl bg-ink-950/50 p-3">
                <Row k="Đơn giá (do nhà cung cấp niêm yết)" v={vnd(quote.data.unitPrice)} />
                <Row k="Tiền hàng" v={vnd(quote.data.goods)} />
                <Row k="Cước vận chuyển" v={vnd(quote.data.freight)} />
                <Row k="Thời gian vận chuyển dự kiến" v={`${Math.round(quote.data.etaMinutes / 60)} giờ game (≈${Math.round(quote.data.etaMinutes / 30)} phút thực)`} />
              </dl>
            )}
            <p className="text-xs text-ink-400">Thanh toán ngay khi đặt. Hàng chỉ vào kho khi xe tới nơi và có thể bị trễ.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Sales({ d }: { d: Detail }) {
  const c = d.company;
  const cat = useCatalog();
  const outputs = [...new Set((cat.data?.recipes.filter((r) => r.industry_code === c.industry_code) ?? []).map((r) => r.output_good))];
  const save = useAction(`/companies/${c.id}/listings`, { method: 'PUT', invalidate: [['company', c.id]], success: 'Đã cập nhật giá niêm yết' });
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [camp, setCamp] = useState({ channel: 'mang_xa_hoi', budget: 30_000_000, days: 3 });
  const launch = useAction(`/companies/${c.id}/campaigns`, { invalidate: [['company', c.id]], success: 'Chiến dịch đã được lên lịch' });
  const sales = d.sales.map((s: any) => ({ ...s, label: dayLabel(s.day) }));
  return (
    <div className="space-y-5">
      <Panel title="Niêm yết giá bán" eyebrow={c.industry_kind === 'producer' ? 'Bán buôn cho doanh nghiệp khác' : 'Bán lẻ cho người dân'}>
        <div className="grid gap-3 md:grid-cols-2">
          {outputs.map((g) => {
            const good = cat.good(g);
            const b2b = good?.category === 'raw';
            const l = d.listings.find((x: any) => x.good_code === g && x.b2b === b2b);
            const price = prices[g] ?? l?.price ?? good?.ref_price ?? 0;
            const ratio = good ? price / good.ref_price : 1;
            return (
              <div key={g} className="rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
                <div className="flex items-center justify-between">
                  <div className="font-medium text-white">{good?.name}</div>
                  {l?.active ? <Badge tone="gain">Đang bán</Badge> : <Badge>Chưa niêm yết</Badge>}
                </div>
                <div className="mt-1 text-xs text-ink-400">
                  Giá tham chiếu thị trường {vnd(good?.ref_price ?? 0)}/{good?.unit}. Giá cao hơn làm giảm lượng khách, giá thấp hơn có thể lỗ.
                </div>
                <div className="mt-3 flex items-end gap-2">
                  <Field label={`Giá / ${good?.unit ?? ''}`}>{(id) => <input id={id} type="number" inputMode="numeric" step={100} className="field num w-36" value={price} onChange={(e) => setPrices({ ...prices, [g]: Number(e.target.value) })} />}</Field>
                  <Button size="sm" loading={save.isPending} onClick={() => save.mutate({ good: g, price, active: true, b2b })}>
                    {l ? 'Cập nhật' : 'Niêm yết'}
                  </Button>
                  {l?.active && (
                    <Button size="sm" variant="ghost" onClick={() => save.mutate({ good: g, price: l.price, active: false, b2b })}>
                      Ngừng bán
                    </Button>
                  )}
                </div>
                <div className={`mt-2 text-xs ${ratio > 1.15 ? 'text-warn' : ratio < 0.85 ? 'text-sky-300' : 'text-ink-400'}`}>
                  {ratio > 1.15 ? 'Giá cao: sức hút giảm mạnh' : ratio < 0.85 ? 'Giá thấp: hút khách nhưng biên lợi nhuận mỏng' : 'Giá cạnh tranh'} ({pct(ratio)} tham chiếu)
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Lượng hàng bán ra" eyebrow="14 ngày game">
          {sales.length ? <AreaSeries data={sales} x="label" y="qty" money={false} /> : <Empty title="Chưa có số liệu" />}
        </Panel>
        <Panel title="Marketing" eyebrow="Có độ trễ, chi phí trả trước, hiệu quả giảm dần">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Kênh">
              {(id) => (
                <select id={id} className="field" value={camp.channel} onChange={(e) => setCamp({ ...camp, channel: e.target.value })}>
                  {Object.entries(CHANNELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Ngân sách">{(id) => <input id={id} type="number" inputMode="numeric" step={5_000_000} className="field num" value={camp.budget} onChange={(e) => setCamp({ ...camp, budget: Number(e.target.value) })} />}</Field>
            <Field label="Số ngày">{(id) => <input id={id} type="number" inputMode="numeric" min={1} max={28} className="field num" value={camp.days} onChange={(e) => setCamp({ ...camp, days: Number(e.target.value) })} />}</Field>
          </div>
          <Button className="mt-3 w-full" icon={<Sparkles size={16} />} loading={launch.isPending} onClick={() => launch.mutate(camp)}>
            Chạy chiến dịch
          </Button>
          <p className="mt-2 text-xs text-ink-400">Thương hiệu tăng sức hút cửa hàng nhưng không đảm bảo doanh thu: vẫn cần hàng, nhân viên và giá hợp lý. Thương hiệu suy giảm 4% mỗi ngày.</p>
          {d.campaigns.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm">
              {d.campaigns.map((x: any) => {
                const state = d.minute < x.start_minute ? 'Chờ hiệu lực' : d.minute < x.end_minute ? 'Đang chạy' : 'Kết thúc';
                return (
                  <li key={x.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-950/40 px-3 py-2">
                    <span>
                      {CHANNELS[x.channel as keyof typeof CHANNELS]} · <Money value={x.budget} compact />
                    </span>
                    <Badge tone={state === 'Đang chạy' ? 'gain' : state === 'Chờ hiệu lực' ? 'sky' : 'muted'}>{state}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Finance({ d }: { d: Detail }) {
  const c = d.company;
  const bs = d.balanceSheet;
  const [loan, setLoan] = useState({ amount: 100_000_000, termDays: 28 });
  const take = useAction(`/bank/loans?companyId=${c.id}`, { invalidate: [['company', c.id]], success: 'Ngân hàng đã giải ngân' });
  const repay = useAction<{ id: string; amount: number }>((b) => `/bank/loans/${b.id}/repay`, { invalidate: [['company', c.id]], success: 'Đã trả nợ' });
  const [ipo, setIpo] = useState({ symbol: '', totalShares: 1_000_000, offerShares: 200_000, offerPrice: 10_000 });
  const doIpo = useAction(`/companies/${c.id}/ipo`, { invalidate: [['company', c.id]], success: 'Đã niêm yết, lệnh chào bán đã lên sàn' });
  const [div, setDiv] = useState(100);
  const payDiv = useAction(`/companies/${c.id}/dividends`, { invalidate: [['company', c.id]], success: 'Đã chi trả cổ tức' });
  const reports = [...d.reports].reverse().map((r: any) => ({ ...r, label: monthLabel(r.month) }));
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Bảng cân đối kế toán" eyebrow="Từ sổ cái kép">
          <dl className="space-y-2 text-sm">
            <div className="eyebrow mb-1">Tài sản</div>
            <Row k="Tiền mặt" v={<Money value={bs.assets.cash} />} />
            {bs.assets.cashLocked > 0 && <Row k="Tiền phong tỏa" v={<Money value={bs.assets.cashLocked} />} />}
            <Row k="Hàng tồn kho (kể cả đang về, đang sản xuất)" v={<Money value={bs.assets.inventory} />} />
            <Row k="Thiết bị (sau khấu hao)" v={<Money value={bs.assets.equipment} />} />
            <Row k={<b className="text-white">Tổng tài sản</b>} v={<Money value={bs.assets.total} className="font-semibold text-white" />} />
            <div className="eyebrow mb-1 pt-3">Nợ phải trả</div>
            <Row k="Vay ngân hàng" v={<Money value={bs.liabilities.loans} />} />
            <Row k="Lương, thuế, khác" v={<Money value={bs.liabilities.wages + bs.liabilities.tax + bs.liabilities.other} />} />
            <div className="eyebrow mb-1 pt-3">Vốn chủ sở hữu</div>
            <Row k="Vốn góp" v={<Money value={bs.equity.shareCapital} />} />
            <Row k="Lợi nhuận giữ lại" v={<Money value={bs.equity.retained} signed />} />
            <Row k={<b className="text-white">Tổng vốn chủ sở hữu</b>} v={<Money value={bs.equity.total} className="font-semibold text-white" />} />
          </dl>
        </Panel>
        <Panel title="Kết quả kinh doanh theo tháng" className="xl:col-span-2">
          {reports.length ? (
            <Bars data={reports} x="label" bars={[{ key: 'revenue', color: '#38BDF8', name: 'Doanh thu' }, { key: 'net_profit', color: '#34D399', name: 'Lợi nhuận sau thuế' }]} />
          ) : (
            <Empty title="Chưa có báo cáo tháng" text="Báo cáo được chốt tự động sau mỗi 7 ngày game (5 giờ 36 phút thực)." />
          )}
        </Panel>
      </div>
      {d.reports.length > 0 && (
        <Panel title="Báo cáo tháng đã chốt">
          <TableWrap>
            <table className="table min-w-[860px]">
              <thead>
                <tr>
                  <th>Kỳ</th>
                  <th className="text-right">Doanh thu</th>
                  <th className="text-right">Giá vốn</th>
                  <th className="text-right">Lương</th>
                  <th className="text-right">Marketing</th>
                  <th className="text-right">Vận hành</th>
                  <th className="text-right">Lãi vay</th>
                  <th className="text-right">Thuế</th>
                  <th className="text-right">LN sau thuế</th>
                  <th className="text-right">Tiền cuối kỳ</th>
                </tr>
              </thead>
              <tbody>
                {d.reports.map((r: any) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-white">{monthLabel(r.month)}</td>
                    {['revenue', 'cogs', 'wages', 'marketing', 'operating', 'interest', 'tax'].map((k) => (
                      <td key={k} className="text-right">
                        <Money value={r[k]} compact />
                      </td>
                    ))}
                    <td className="text-right">
                      <Money value={r.net_profit} compact signed />
                    </td>
                    <td className="text-right">
                      <Money value={r.cash_end} compact />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {d.taxBills.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {d.taxBills.map((t: any) => (
                <Badge key={t.id} tone={t.status === 'paid' ? 'gain' : t.status === 'overdue' ? 'loss' : 'warn'}>
                  Thuế {monthLabel(t.month)}: {vnd(t.amount, true)} · {t.status === 'paid' ? 'đã nộp' : t.status === 'overdue' ? 'quá hạn' : 'chờ nộp'}
                </Badge>
              ))}
            </div>
          )}
        </Panel>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Vay vốn ngân hàng" eyebrow={`Hạn mức còn lại ${vnd(d.credit.limit, true)} · lãi 0,35%/ngày game`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Số tiền vay">{(id) => <input id={id} type="number" inputMode="numeric" step={10_000_000} className="field num" value={loan.amount} onChange={(e) => setLoan({ ...loan, amount: Number(e.target.value) })} />}</Field>
            <Field label="Kỳ hạn">
              {(id) => (
                <select id={id} className="field" value={loan.termDays} onChange={(e) => setLoan({ ...loan, termDays: Number(e.target.value) })}>
                  {[7, 14, 28, 56, 84].map((t) => (
                    <option key={t} value={t}>
                      {t} ngày ({t / 7} kỳ trả)
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Button className="mt-3 w-full" variant="secondary" disabled={loan.amount > d.credit.limit} loading={take.isPending} onClick={() => take.mutate(loan)}>
            Đề nghị giải ngân
          </Button>
          {d.credit.reason && <p className="mt-2 text-xs text-warn">{d.credit.reason}</p>}
          {d.loans.length > 0 && (
            <ul className="mt-4 space-y-2">
              {d.loans.map((l: any) => (
                <li key={l.id} className="rounded-xl bg-ink-950/40 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span>
                      Gốc còn <Money value={l.outstanding} /> · lãi chờ <Money value={l.interest_due} />
                    </span>
                    <Badge tone={l.status === 'active' ? 'sky' : l.status === 'repaid' ? 'gain' : 'loss'}>{({ active: 'Đang vay', overdue: 'Quá hạn', repaid: 'Đã tất toán', defaulted: 'Nợ xấu' } as Record<string, string>)[l.status]}</Badge>
                  </div>
                  {['active', 'overdue'].includes(l.status) && (
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-400">
                      <span>Kỳ tới: {gameTime(l.next_due_minute)} · trả {vnd(l.installment, true)} + lãi</span>
                      <Button size="sm" variant="outline" loading={repay.isPending} onClick={() => repay.mutate({ id: l.id, amount: l.outstanding + l.interest_due })}>
                        Tất toán
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Thị trường vốn" eyebrow={d.instrument ? `Mã ${d.instrument.symbol}` : 'Phát hành cổ phiếu lần đầu (IPO)'}>
          {d.instrument ? (
            <div className="space-y-3 text-sm">
              <Row k="Giá gần nhất" v={<Money value={d.instrument.last_price} />} />
              <Row k="Tổng số cổ phần" v={num(c.shares_total)} />
              <Link to={`/exchange/${d.instrument.symbol}`} className="btn btn-secondary w-full">
                <TrendingUp size={16} /> Mở bảng giá
              </Link>
              <div className="flex items-end gap-2 pt-2">
                <Field label="Cổ tức / cổ phiếu">{(id) => <input id={id} type="number" inputMode="numeric" min={1} className="field num w-32" value={div} onChange={(e) => setDiv(Number(e.target.value))} />}</Field>
                <ConfirmButton variant="primary" label="Chi trả cổ tức" title="Chi trả cổ tức tiền mặt" message={`Trả ${vnd(div)} cho mỗi cổ phiếu đang lưu hành (không gồm cổ phiếu chưa bán của đợt IPO).`} onConfirm={() => payDiv.mutateAsync({ perShare: div })} />
              </div>
            </div>
          ) : d.ipo.eligible ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Mã chứng khoán (3–5 chữ)">{(id) => <input id={id} className="field uppercase" maxLength={5} value={ipo.symbol} onChange={(e) => setIpo({ ...ipo, symbol: e.target.value.toUpperCase() })} />}</Field>
                <Field label="Giá chào bán / cổ phiếu">{(id) => <input id={id} type="number" inputMode="numeric" step={100} className="field num" value={ipo.offerPrice} onChange={(e) => setIpo({ ...ipo, offerPrice: Number(e.target.value) })} />}</Field>
                <Field label="Tổng số cổ phần">{(id) => <input id={id} type="number" inputMode="numeric" step={10_000} className="field num" value={ipo.totalShares} onChange={(e) => setIpo({ ...ipo, totalShares: Number(e.target.value) })} />}</Field>
                <Field label="Số cổ phần chào bán (10–49%)">{(id) => <input id={id} type="number" inputMode="numeric" step={10_000} className="field num" value={ipo.offerShares} onChange={(e) => setIpo({ ...ipo, offerShares: Number(e.target.value) })} />}</Field>
              </div>
              <ConfirmButton variant="primary" size="lg" label="Đăng ký IPO" title="Xác nhận niêm yết" message="Cổ phiếu chào bán được đặt lệnh bán trên sàn. Doanh nghiệp chỉ nhận tiền khi có nhà đầu tư mua thật." onConfirm={() => doIpo.mutateAsync(ipo)} />
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="text-ink-300">Chưa đủ điều kiện niêm yết:</p>
              <ul className="space-y-1.5">
                {d.ipo.reasons.map((r: string) => (
                  <li key={r} className="flex gap-2 text-ink-400">
                    <Star size={14} className="mt-0.5 shrink-0 text-ink-500" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>
      <Panel title="Sổ quỹ tiền mặt" eyebrow="60 bút toán gần nhất">
        <TableWrap>
          <table className="table min-w-[560px]">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Diễn giải</th>
                <th className="text-right">Số tiền</th>
              </tr>
            </thead>
            <tbody>
              {d.ledger.map((l: any, i: number) => (
                <tr key={i}>
                  <td className="whitespace-nowrap text-xs text-ink-400">{gameTime(l.game_minute)}</td>
                  <td>{l.memo}</td>
                  <td className="text-right">
                    <Money value={l.amount} signed />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Panel>
    </div>
  );
}
