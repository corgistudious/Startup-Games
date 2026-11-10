import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { Panel, Money, Button, Field, Badge, Loading, ErrorBox, Empty, TableWrap, PageHeader } from '@/components/ui';
import { PriceLine } from '@/components/charts';
import { num, gameTime, vnd, ago } from '@/lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Symbol() {
  const { symbol = '' } = useParams();
  const q = useQuery({ queryKey: ['symbol', symbol], queryFn: () => api<any>(`/exchange/${symbol}`), refetchInterval: 10_000 });
  const pf = useQuery({ queryKey: ['portfolio'], queryFn: () => api<any>('/exchange/me/portfolio') });
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'limit' | 'market'>('limit');
  const [qty, setQty] = useState(100);
  const [price, setPrice] = useState(0);
  const place = useAction('/exchange/orders', { invalidate: [['symbol', symbol], ['portfolio'], ['overview']], success: (r: any) => (r.trades ? `Đã khớp ${r.trades} giao dịch` : 'Lệnh đã vào sổ, chờ khớp') });
  const cancel = useAction<{ id: string }>((b) => `/exchange/orders/${b.id}`, { method: 'DELETE', invalidate: [['symbol', symbol], ['portfolio']], success: 'Đã hủy lệnh, tài sản phong tỏa được giải phóng' });
  if (q.isLoading) return <Loading rows={4} />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { instrument: ins, book, trades, disclosures, holders } = q.data;
  const ref = ins.last_price ?? ins.ipo_price;
  const p = price || ref;
  const holding = pf.data?.holdings.find((h: any) => h.symbol === symbol);
  const myOrders = (pf.data?.orders ?? []).filter((o: any) => o.symbol === symbol);
  const series = [...trades].reverse().map((t: any) => ({ t: gameTime(t.game_minute).split(',')[0]!, price: t.price }));
  const maxQty = Math.max(1, ...book.bids.map((b: any) => b.qty), ...book.asks.map((a: any) => a.qty));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={ins.status === 'listed' ? 'Đang giao dịch' : ins.status === 'halted' ? `Tạm ngừng: ${ins.halt_reason}` : 'Hủy niêm yết'}
        title={`${ins.symbol} · ${ins.name}`}
        subtitle={<Link to={`/library/${ins.slug}`} className="text-sky-300 hover:underline">Hồ sơ doanh nghiệp</Link>}
        actions={
          <div className="text-right">
            <div className="num text-3xl font-semibold text-white">{num(ref)} ₫</div>
            <div className="text-xs text-ink-400">Giá IPO {vnd(ins.ipo_price)} · Vốn hóa {vnd(ref * ins.shares_total, true)}</div>
          </div>
        }
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Diễn biến giá khớp" className="xl:col-span-2">
          {series.length > 1 ? <PriceLine data={series} /> : <Empty title="Chưa đủ giao dịch để vẽ biểu đồ" />}
        </Panel>
        <Panel title="Đặt lệnh">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink-950/60 p-1">
            {(['buy', 'sell'] as const).map((s) => (
              <button key={s} onClick={() => setSide(s)} className={clsx('min-h-[40px] rounded-lg text-sm font-semibold', side === s ? (s === 'buy' ? 'bg-emerald-400/20 text-emerald-200' : 'bg-red-400/20 text-red-200') : 'text-ink-400')}>
                {s === 'buy' ? 'Mua' : 'Bán'}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-ink-950/60 p-1">
            {(['limit', 'market'] as const).map((t) => (
              <button key={t} onClick={() => setType(t)} className={clsx('min-h-[36px] rounded-lg text-xs font-medium', type === t ? 'bg-sky-400/15 text-sky-100' : 'text-ink-400')}>
                {t === 'limit' ? 'Lệnh giới hạn' : 'Lệnh thị trường'}
              </button>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {type === 'limit' && <Field label="Giá (bội số 100 ₫, biên độ ±30%)">{(id) => <input id={id} type="number" inputMode="numeric" step={100} className="field num" value={p} onChange={(e) => setPrice(Number(e.target.value))} />}</Field>}
            <Field label="Khối lượng (bội số 10)" hint={side === 'sell' ? `Khả dụng: ${num((holding?.qty ?? 0) - (holding?.locked ?? 0))}` : `Tiền khả dụng: ${vnd(pf.data?.cash ?? 0, true)}`}>
              {(id) => <input id={id} type="number" inputMode="numeric" step={10} min={10} className="field num" value={qty} onChange={(e) => setQty(Number(e.target.value))} />}
            </Field>
            {type === 'limit' && (
              <div className="text-sm text-ink-300">
                Giá trị lệnh: <Money value={p * qty} className="text-white" />
                {side === 'buy' && <div className="text-xs text-ink-400">Số tiền này được phong tỏa đến khi lệnh khớp hoặc bị hủy.</div>}
              </div>
            )}
            <Button
              variant={side === 'buy' ? 'success' : 'danger'}
              className="w-full"
              size="lg"
              disabled={ins.status !== 'listed' || qty <= 0}
              loading={place.isPending}
              onClick={() => place.mutate({ symbol, side, type, qty, price: type === 'limit' ? p : undefined })}
            >
              {side === 'buy' ? 'Đặt lệnh mua' : 'Đặt lệnh bán'}
            </Button>
          </div>
        </Panel>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Sổ lệnh" eyebrow="10 mức giá tốt nhất">
          <div className="grid grid-cols-2 gap-3 text-sm">
            {(['bids', 'asks'] as const).map((k) => (
              <div key={k}>
                <div className={clsx('mb-2 text-xs font-semibold', k === 'bids' ? 'text-gain' : 'text-loss')}>{k === 'bids' ? 'Chờ mua' : 'Chờ bán'}</div>
                {book[k].length === 0 && <div className="text-xs text-ink-500">Trống</div>}
                {book[k].map((l: any) => (
                  <div key={l.price} className="relative mb-1 flex justify-between overflow-hidden rounded-md px-2 py-1">
                    <div className={clsx('absolute inset-y-0', k === 'bids' ? 'right-0 bg-emerald-400/10' : 'left-0 bg-red-400/10')} style={{ width: `${(l.qty / maxQty) * 100}%` }} />
                    <span className="num relative">{num(l.price)}</span>
                    <span className="num relative text-ink-300">{num(l.qty)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Lệnh của bạn">
          {myOrders.length === 0 ? (
            <Empty title="Chưa có lệnh" />
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Lệnh</th>
                    <th className="text-right">Khớp</th>
                    <th>Trạng thái</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {myOrders.map((o: any) => (
                    <tr key={o.id}>
                      <td>
                        <span className={o.side === 'buy' ? 'text-gain' : 'text-loss'}>{o.side === 'buy' ? 'Mua' : 'Bán'}</span> {num(o.qty)} @ {o.price ? num(o.price) : 'TT'}
                        <div className="text-[11px] text-ink-400">{ago(o.created_at)}</div>
                      </td>
                      <td className="num text-right">{num(o.filled)}</td>
                      <td>
                        <Badge tone={o.status === 'filled' ? 'gain' : o.status === 'open' ? 'sky' : 'muted'}>{o.status === 'filled' ? 'Đã khớp' : o.status === 'open' ? 'Chờ khớp' : 'Đã hủy'}</Badge>
                      </td>
                      <td className="text-right">
                        {o.status === 'open' && (
                          <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate({ id: o.id })}>
                            Hủy
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Cổ đông lớn">
          <ul className="space-y-2 text-sm">
            {holders.map((h: any, i: number) => (
              <li key={i} className="flex justify-between">
                <span>{h.name}</span>
                <span className="num text-ink-300">
                  {num(h.qty)} ({((h.qty / ins.shares_total) * 100).toFixed(2)}%)
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Công bố thông tin">
          {disclosures.length === 0 ? (
            <Empty title="Chưa có công bố" />
          ) : (
            <ul className="space-y-3 text-sm">
              {disclosures.map((x: any) => (
                <li key={x.id}>
                  <div className="font-medium text-white">{x.title}</div>
                  <div className="text-ink-300">{x.body}</div>
                  <div className="text-[11px] text-ink-500">{gameTime(x.game_minute)}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
