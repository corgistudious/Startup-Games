import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSignature } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useCatalog } from '@/lib/catalog';
import { Panel, Button, Badge, Field, Modal, Empty, Loading, ConfirmButton, TableWrap, Money } from '@/components/ui';
import { vnd, num, gameTime, pct } from '@/lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUS: Record<string, [string, 'sky' | 'gain' | 'loss' | 'warn' | 'muted']> = {
  proposed: ['Chờ ký', 'sky'],
  active: ['Đang hiệu lực', 'gain'],
  completed: ['Hoàn thành', 'muted'],
  rejected: ['Bị từ chối', 'muted'],
  cancelled: ['Đã hủy', 'warn'],
  breached: ['Vi phạm', 'loss'],
};
const DSTATUS: Record<string, [string, 'sky' | 'gain' | 'loss' | 'warn' | 'muted']> = {
  shipped: ['Đang vận chuyển', 'sky'],
  delivered: ['Chờ nghiệm thu', 'warn'],
  accepted: ['Đã nghiệm thu', 'gain'],
  disputed: ['Đang tranh chấp', 'loss'],
  resolved: ['Đã phân xử', 'muted'],
  missed_seller: ['Bên bán không giao', 'loss'],
  missed_buyer: ['Bên mua không nhận', 'loss'],
};

export function Contracts({ d }: { d: any }) {
  const c = d.company;
  const cat = useCatalog();
  const q = useQuery({ queryKey: ['contracts', c.id], queryFn: () => api<any>(`/companies/${c.id}/contracts`) });
  const offers = useQuery({ queryKey: ['b2b'], queryFn: () => api<any[]>('/market/b2b') });
  const inv = [['contracts', c.id], ['company', c.id]];
  const accept = useAction<{ id: string }>((b) => `/contracts/${b.id}/accept`, { invalidate: inv, success: 'Đã ký hợp đồng' });
  const reject = useAction<{ id: string; reason: string }>((b) => `/contracts/${b.id}/reject`, { invalidate: inv, success: 'Đã từ chối' });
  const cancel = useAction<{ id: string }>((b) => `/contracts/${b.id}/cancel`, { invalidate: inv, success: 'Đã chấm dứt hợp đồng' });
  const inspect = useAction<{ id: string; accept: boolean; reason?: string }>((b) => `/contract-deliveries/${b.id}/inspect`, { invalidate: inv, success: 'Đã ghi nhận nghiệm thu' });
  const propose = useAction<object, { id: string }>(`/companies/${c.id}/contracts`, { invalidate: inv, success: 'Đã gửi đề nghị hợp đồng' });
  const [open, setOpen] = useState(false);
  const [dispute, setDispute] = useState<{ id: string; reason: string } | null>(null);
  const [form, setForm] = useState({ sellerCompanyId: '', good: '', qtyPerDelivery: 50, unitPrice: 0, deliveries: 4, intervalDays: 2, depositRate: 0.1, penaltyRate: 0.1 });
  const sellers = (offers.data ?? []).filter((o) => o.company_id !== c.id);
  const ref = cat.good(form.good)?.ref_price ?? 0;
  const total = form.unitPrice * form.qtyPerDelivery * form.deliveries;

  if (q.isLoading) return <Loading />;
  const { contracts, deliveries } = q.data;
  return (
    <div className="space-y-5">
      <Panel
        title="Hợp đồng cung ứng dài hạn"
        eyebrow="Đặt cọc qua tài khoản ký quỹ · giao định kỳ · nghiệm thu trong 1 ngày · phạt vi phạm"
        action={
          <Button size="sm" icon={<FileSignature size={15} />} onClick={() => setOpen(true)}>
            Đề nghị hợp đồng mua
          </Button>
        }
      >
        {contracts.length === 0 ? (
          <Empty title="Chưa có hợp đồng" text="Hợp đồng dài hạn khóa giá và nguồn cung. Nhà cung cấp NPC tự động chấp nhận nếu giá và khối lượng hợp lý." />
        ) : (
          <div className="space-y-4">
            {contracts.map((k: any) => {
              const iAmSeller = k.seller_company_id === c.id;
              const ds = deliveries.filter((x: any) => x.contract_id === k.id);
              return (
                <div key={k.id} className="rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-white">
                        {iAmSeller ? `Bán cho ${k.buyer_name}` : `Mua từ ${k.seller_name}`}: {num(k.qty_per_delivery)} {k.unit} {k.good_name} × {k.deliveries_total} lần
                      </div>
                      <div className="text-xs text-ink-400">
                        Đơn giá {vnd(k.unit_price)} · mỗi {k.interval_days} ngày · cọc {vnd(k.deposit)} · phạt {pct(Number(k.penalty_rate))} giá trị lần giao
                        {k.next_delivery_minute && k.status === 'active' ? ` · lần giao tới ${gameTime(k.next_delivery_minute)}` : ''}
                      </div>
                      {k.ended_reason && <div className="mt-1 text-xs text-ink-300">{k.ended_reason}</div>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={STATUS[k.status]?.[1] ?? 'muted'}>{STATUS[k.status]?.[0] ?? k.status}</Badge>
                      <span className="num text-xs text-ink-400">
                        {k.deliveries_done}/{k.deliveries_total}
                      </span>
                    </div>
                  </div>
                  {k.status === 'proposed' && iAmSeller && (
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" loading={accept.isPending} onClick={() => accept.mutate({ id: k.id })}>
                        Ký chấp nhận
                      </Button>
                      <ConfirmButton label="Từ chối" title="Từ chối đề nghị hợp đồng" message="Bên mua sẽ nhận được lý do." needReason onConfirm={(reason) => reject.mutateAsync({ id: k.id, reason })} />
                    </div>
                  )}
                  {k.status === 'active' && (
                    <div className="mt-3">
                      <ConfirmButton
                        label="Đơn phương chấm dứt"
                        title="Chấm dứt hợp đồng trước hạn"
                        message={iAmSeller ? `Bên bán chấm dứt: hoàn cọc cho bên mua và bồi thường thêm ${vnd(k.deposit)}.` : `Bên mua chấm dứt: mất tiền cọc ${vnd(k.deposit)}.`}
                        onConfirm={() => cancel.mutateAsync({ id: k.id })}
                      />
                    </div>
                  )}
                  {ds.length > 0 && (
                    <TableWrap>
                      <table className="table mt-3 min-w-[560px]">
                        <thead>
                          <tr>
                            <th>Lần</th>
                            <th>Trạng thái</th>
                            <th className="text-right">Giá trị</th>
                            <th>Ghi chú</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {ds.map((x: any) => (
                            <tr key={x.id}>
                              <td className="num">{x.seq}</td>
                              <td>
                                <Badge tone={DSTATUS[x.status]?.[1] ?? 'muted'}>{DSTATUS[x.status]?.[0] ?? x.status}</Badge>
                              </td>
                              <td className="text-right">
                                <Money value={x.value} compact />
                              </td>
                              <td className="text-xs text-ink-400">
                                {x.penalty ? `Phạt ${vnd(x.penalty)}` : ''}
                                {x.status === 'delivered' && x.accept_deadline_minute ? `Hạn nghiệm thu ${gameTime(x.accept_deadline_minute)}` : ''}
                                {x.resolution ? `${x.resolution} (hoàn ${vnd(x.refund)})` : ''}
                              </td>
                              <td className="whitespace-nowrap text-right">
                                {x.status === 'delivered' && !iAmSeller && (
                                  <>
                                    <Button size="sm" variant="success" onClick={() => inspect.mutate({ id: x.id, accept: true })}>
                                      Nghiệm thu
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setDispute({ id: x.id, reason: '' })}>
                                      Khiếu nại
                                    </Button>
                                  </>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableWrap>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Đề nghị hợp đồng cung ứng"
        wide
        footer={
          <>
            <div className="mr-auto text-sm text-ink-300">
              Tổng giá trị <Money value={total} compact className="text-white" /> · cọc <Money value={Math.round(total * form.depositRate)} compact className="text-white" />
            </div>
            <Button disabled={!form.sellerCompanyId || !form.unitPrice} loading={propose.isPending} onClick={() => propose.mutate(form, { onSuccess: () => setOpen(false) })}>
              Gửi đề nghị
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nhà cung cấp và mặt hàng">
            {(fid) => (
              <select
                id={fid}
                className="field"
                value={`${form.sellerCompanyId}|${form.good}`}
                onChange={(e) => {
                  const [sellerCompanyId, good] = e.target.value.split('|');
                  const o = sellers.find((x) => x.company_id === sellerCompanyId && x.good_code === good);
                  setForm({ ...form, sellerCompanyId: sellerCompanyId!, good: good!, unitPrice: o?.price ?? 0 });
                }}
              >
                <option value="|">Chọn…</option>
                {sellers.map((o) => (
                  <option key={`${o.company_id}|${o.good_code}`} value={`${o.company_id}|${o.good_code}`}>
                    {o.company_name}: {o.good_name} ({vnd(o.price)})
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Đơn giá hợp đồng" hint={ref ? `Cho phép 60%–160% giá tham chiếu ${vnd(ref)}` : undefined}>
            {(fid) => <input id={fid} type="number" inputMode="numeric" className="field num" step={100} value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: Number(e.target.value) })} />}
          </Field>
          <Field label="Khối lượng mỗi lần giao">{(fid) => <input id={fid} type="number" inputMode="numeric" className="field num" min={1} value={form.qtyPerDelivery} onChange={(e) => setForm({ ...form, qtyPerDelivery: Number(e.target.value) })} />}</Field>
          <Field label="Số lần giao">{(fid) => <input id={fid} type="number" inputMode="numeric" className="field num" min={1} max={60} value={form.deliveries} onChange={(e) => setForm({ ...form, deliveries: Number(e.target.value) })} />}</Field>
          <Field label="Chu kỳ giao (ngày game)">{(fid) => <input id={fid} type="number" inputMode="numeric" className="field num" min={1} max={14} value={form.intervalDays} onChange={(e) => setForm({ ...form, intervalDays: Number(e.target.value) })} />}</Field>
          <Field label="Tỷ lệ đặt cọc">
            {(fid) => (
              <select id={fid} className="field" value={form.depositRate} onChange={(e) => setForm({ ...form, depositRate: Number(e.target.value) })}>
                {[0, 0.05, 0.1, 0.2, 0.3].map((r) => (
                  <option key={r} value={r}>
                    {pct(r)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Mức phạt mỗi lần giao trễ">
            {(fid) => (
              <select id={fid} className="field" value={form.penaltyRate} onChange={(e) => setForm({ ...form, penaltyRate: Number(e.target.value) })}>
                {[0, 0.05, 0.1, 0.2].map((r) => (
                  <option key={r} value={r}>
                    {pct(r)} giá trị lần giao
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <p className="mt-4 text-xs text-ink-400">
          Tiền cọc được giữ ở tài khoản ký quỹ đến khi hợp đồng kết thúc. Mỗi lần giao, bên mua trả tiền hàng và cước như mua thường. Hàng về kho, bạn có 1 ngày game để nghiệm thu hoặc khiếu nại; quá hạn được xem là đã nghiệm thu.
        </p>
      </Modal>
      <Modal open={!!dispute} onClose={() => setDispute(null)} title="Khiếu nại lô hàng" footer={<Button variant="danger" disabled={(dispute?.reason.length ?? 0) < 10} loading={inspect.isPending} onClick={() => dispute && inspect.mutate({ id: dispute.id, accept: false, reason: dispute.reason }, { onSuccess: () => setDispute(null) })}>Gửi khiếu nại</Button>}>
        <Field label="Mô tả vấn đề (Ban Quản Trị sẽ phân xử)">{(fid) => <textarea id={fid} className="field min-h-[110px]" value={dispute?.reason ?? ''} onChange={(e) => dispute && setDispute({ ...dispute, reason: e.target.value })} />}</Field>
      </Modal>
    </div>
  );
}
