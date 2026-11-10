import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { PageHeader, Panel, Money, Badge, Tabs, Loading, Empty, TableWrap } from '@/components/ui';
import { Bars } from '@/components/charts';
import { num, pct, dayLabel } from '@/lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Market() {
  const [tab, setTab] = useState<'consumer' | 'b2b' | 'economy'>('consumer');
  const consumer = useQuery({ queryKey: ['consumer'], queryFn: () => api<{ sellers: any[]; daily: any[] }>('/market/consumer') });
  const b2b = useQuery({ queryKey: ['b2b'], queryFn: () => api<any[]>('/market/b2b'), enabled: tab === 'b2b' });
  const eco = useQuery({ queryKey: ['economy'], queryFn: () => api<any>('/economy'), enabled: tab === 'economy' });

  const byGood = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const s of consumer.data?.sellers ?? []) m.set(s.good_name, [...(m.get(s.good_name) ?? []), s]);
    return [...m.entries()];
  }, [consumer.data]);
  const daily = useMemo(() => {
    const m = new Map<number, Record<string, number>>();
    for (const r of consumer.data?.daily ?? []) {
      const row: Record<string, number> = m.get(r.day) ?? { day: r.day };
      row.revenue = (row.revenue ?? 0) + Number(r.revenue);
      m.set(r.day, row);
    }
    return [...m.values()].map((r) => ({ ...r, label: dayLabel(r.day!) }));
  }, [consumer.data]);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Kinh doanh" title="Thị trường" subtitle="Giá do doanh nghiệp tự niêm yết. Người dân chia ngân sách cho các cửa hàng theo giá, uy tín, thương hiệu và vị trí. Không có giá nào do hệ thống tự đặt ngẫu nhiên." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'consumer', label: 'Bán lẻ' },
          { id: 'b2b', label: 'Bán buôn nguyên liệu' },
          { id: 'economy', label: 'Kinh tế vĩ mô' },
        ]}
      />
      {tab === 'consumer' &&
        (consumer.isLoading ? (
          <Loading />
        ) : (
          <>
            <Panel title="Tổng chi tiêu của người dân" eyebrow="Theo ngày game">
              {daily.length ? <Bars data={daily} x="label" bars={[{ key: 'revenue', color: '#38BDF8', name: 'Chi tiêu' }]} /> : <Empty title="Chưa có giao dịch" />}
            </Panel>
            {byGood.map(([good, sellers]) => {
              const total = sellers.reduce((s, x) => s + Number(x.sold_3d), 0);
              return (
                <Panel key={good} title={good} eyebrow={`${sellers.length} cửa hàng · giá tham chiếu ${Number(sellers[0].ref_price).toLocaleString('vi-VN')} ₫`}>
                  <TableWrap>
                    <table className="table min-w-[640px]">
                      <thead>
                        <tr>
                          <th>Cửa hàng</th>
                          <th className="text-right">Giá</th>
                          <th className="text-right">Uy tín</th>
                          <th className="text-right">Bán 3 ngày</th>
                          <th className="text-right">Thị phần</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sellers.map((s) => (
                          <tr key={s.company_id}>
                            <td>
                              <Link to={`/library/${s.slug}`} className="text-white hover:text-sky-200">
                                {s.company_name}
                              </Link>
                              <div className="text-xs text-ink-400">
                                {s.location_name} · {s.is_npc ? 'NPC' : 'Người chơi'}
                              </div>
                            </td>
                            <td className="text-right">
                              <Money value={s.price} />
                            </td>
                            <td className="num text-right">{Number(s.reputation).toFixed(0)}</td>
                            <td className="num text-right">{num(s.sold_3d)}</td>
                            <td className="num text-right">{total ? pct(Number(s.sold_3d) / total) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                </Panel>
              );
            })}
          </>
        ))}
      {tab === 'b2b' && (
        <Panel title="Chào bán buôn" eyebrow="Mua từ trang quản lý doanh nghiệp, tab Mua hàng & Vận chuyển">
          {b2b.isLoading ? (
            <Loading />
          ) : (
            <TableWrap>
              <table className="table min-w-[680px]">
                <thead>
                  <tr>
                    <th>Mặt hàng</th>
                    <th>Nhà cung cấp</th>
                    <th className="text-right">Giá</th>
                    <th className="text-right">So với tham chiếu</th>
                    <th className="text-right">Còn hàng</th>
                  </tr>
                </thead>
                <tbody>
                  {b2b.data?.map((o) => (
                    <tr key={`${o.company_id}-${o.good_code}`}>
                      <td className="text-white">{o.good_name}</td>
                      <td>
                        {o.company_name} <Badge tone={o.is_npc ? 'muted' : 'sky'}>{o.is_npc ? 'NPC' : 'Người chơi'}</Badge>
                      </td>
                      <td className="text-right">
                        <Money value={o.price} />
                      </td>
                      <td className={`num text-right ${o.price > o.ref_price ? 'text-loss' : 'text-gain'}`}>{pct(o.price / o.ref_price)}</td>
                      <td className="num text-right">
                        {num(o.available)} {o.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>
      )}
      {tab === 'economy' && eco.data && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Cung tiền minh bạch" eyebrow="Kiểm toán sổ cái toàn hệ thống">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-400">Tổng tiền đã phát hành</dt>
                <dd>
                  <Money value={eco.data.audit.moneyIssued} compact />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-400">Tiền đang lưu thông</dt>
                <dd>
                  <Money value={eco.data.audit.cashInCirculation} compact />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-400">Sổ cái cân bằng</dt>
                <dd>{eco.data.audit.ok ? <Badge tone="gain">Cân bằng</Badge> : <Badge tone="loss">Lệch</Badge>}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-ink-400">Nguồn tiền duy nhất: vốn khởi nghiệp cho người chơi mới, vốn điều lệ ngân hàng và doanh nghiệp NPC lúc khởi tạo, và trợ cấp dân cư hằng ngày. Mọi khoản đều có bút toán.</p>
          </Panel>
          <Panel title="Giá thị trường hiện tại">
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Mặt hàng</th>
                    <th className="text-right">Tham chiếu</th>
                    <th className="text-right">Thấp nhất</th>
                    <th className="text-right">Bán gần đây</th>
                  </tr>
                </thead>
                <tbody>
                  {eco.data.prices.map((p: any) => (
                    <tr key={p.code}>
                      <td>{p.name}</td>
                      <td className="text-right">
                        <Money value={p.ref_price} compact />
                      </td>
                      <td className="text-right">{p.min_price ? <Money value={p.min_price} compact /> : '—'}</td>
                      <td className="num text-right">{num(p.sold_recent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Panel>
        </div>
      )}
    </div>
  );
}
