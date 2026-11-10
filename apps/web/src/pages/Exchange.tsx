import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { PageHeader, Panel, Money, Badge, Loading, Empty, TableWrap } from '@/components/ui';
import { num } from '@/lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Exchange() {
  const q = useQuery({ queryKey: ['exchange'], queryFn: () => api<any[]>('/exchange'), refetchInterval: 20_000 });
  const pf = useQuery({ queryKey: ['portfolio'], queryFn: () => api<any>('/exchange/me/portfolio') });
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Tài chính" title="Sàn chứng khoán" subtitle="Lệnh mua bán khớp theo ưu tiên giá rồi thời gian. Tiền và cổ phiếu bị phong tỏa khi đặt lệnh. Không có thanh khoản ảo: không có người bán thì không mua được." />
      <Panel title="Bảng giá">
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <Empty title="Chưa có doanh nghiệp niêm yết" text="Doanh nghiệp đạt điều kiện (giai đoạn Doanh nghiệp vừa, có lãi, đủ nhân sự) có thể IPO từ trang quản lý." />
        ) : (
          <TableWrap>
            <table className="table min-w-[640px]">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Doanh nghiệp</th>
                  <th className="text-right">Giá</th>
                  <th className="text-right">Thay đổi 1 ngày</th>
                  <th className="text-right">KL 1 ngày</th>
                  <th className="text-right">Vốn hóa</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((s) => {
                  const prev = s.prev_price ?? s.ipo_price;
                  const ch = prev ? (s.last_price - prev) / prev : 0;
                  return (
                    <tr key={s.symbol}>
                      <td>
                        <Link to={`/exchange/${s.symbol}`} className="num font-semibold text-sky-200 hover:underline">
                          {s.symbol}
                        </Link>
                        {s.status !== 'listed' && (
                          <Badge tone="warn">
                            {s.status === 'halted' ? 'Tạm ngừng' : 'Hủy niêm yết'}
                          </Badge>
                        )}
                      </td>
                      <td>
                        <div className="text-white">{s.name}</div>
                        <div className="text-xs text-ink-400">{s.industry}</div>
                      </td>
                      <td className="text-right">
                        <Money value={s.last_price} />
                      </td>
                      <td className={`num text-right ${ch > 0 ? 'text-gain' : ch < 0 ? 'text-loss' : 'text-ink-300'}`}>
                        {ch > 0 ? '+' : ''}
                        {(ch * 100).toFixed(2)}%
                      </td>
                      <td className="num text-right">{num(s.volume_day)}</td>
                      <td className="text-right">
                        <Money value={s.last_price * s.shares_total} compact />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
      <Panel title="Danh mục của bạn" eyebrow={pf.data ? `Tiền khả dụng ${Number(pf.data.cash).toLocaleString('vi-VN')} ₫ · phong tỏa ${Number(pf.data.locked).toLocaleString('vi-VN')} ₫` : undefined}>
        {!pf.data?.holdings.length ? (
          <Empty title="Chưa nắm giữ cổ phiếu" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th className="text-right">Số lượng</th>
                  <th className="text-right">Giá vốn TB</th>
                  <th className="text-right">Giá trị</th>
                  <th className="text-right">Lãi/lỗ</th>
                </tr>
              </thead>
              <tbody>
                {pf.data.holdings.map((h: any) => {
                  const value = h.qty * (h.last_price ?? 0);
                  return (
                    <tr key={h.symbol}>
                      <td>
                        <Link to={`/exchange/${h.symbol}`} className="num font-semibold text-sky-200">
                          {h.symbol}
                        </Link>
                      </td>
                      <td className="num text-right">
                        {num(h.qty)}
                        {h.locked > 0 && <div className="text-[11px] text-ink-400">phong tỏa {num(h.locked)}</div>}
                      </td>
                      <td className="text-right">
                        <Money value={h.qty ? Math.round(h.cost / h.qty) : 0} />
                      </td>
                      <td className="text-right">
                        <Money value={value} compact />
                      </td>
                      <td className="text-right">
                        <Money value={value - h.cost} compact signed />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}
