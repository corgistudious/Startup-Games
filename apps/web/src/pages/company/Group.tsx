import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Store, Building2, Handshake, GitMerge } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useMe } from '@/lib/hooks';
import { useCatalog } from '@/lib/catalog';
import { Panel, Button, Badge, Field, Modal, Empty, Loading, ConfirmButton, Money, Stat } from '@/components/ui';
import { vnd, gameTime } from '@/lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function Group({ d }: { d: any }) {
  const c = d.company;
  const { data: me } = useMe();
  const cat = useCatalog();
  const q = useQuery({ queryKey: ['group', c.id], queryFn: () => api<any>(`/companies/${c.id}/group`) });
  const targets = useQuery({ queryKey: ['mna-targets'], queryFn: () => api<any[]>('/mna/targets') });
  const inv = [['group', c.id], ['company', c.id], ['overview']];
  const openBranch = useAction(`/companies/${c.id}/branches`, { invalidate: inv, success: 'Đã mở chi nhánh' });
  const closeBranch = useAction<{ id: string }>((b) => `/companies/${c.id}/branches/${b.id}`, { method: 'DELETE', invalidate: inv, success: 'Đã đóng chi nhánh' });
  const offer = useAction<object, { id: string }>(`/companies/${c.id}/offers`, { invalidate: inv, success: 'Đã gửi đề nghị mua lại' });
  const respond = useAction<{ id: string; accept: boolean }>((b) => `/offers/${b.id}/respond`, { invalidate: inv, success: 'Đã trả lời đề nghị' });
  const cancelOffer = useAction<{ id: string }>((b) => `/offers/${b.id}/cancel`, { invalidate: inv, success: 'Đã rút đề nghị' });
  const merge = useAction<{ sub: string }>((b) => `/companies/${c.id}/merge/${b.sub}`, { invalidate: inv, success: 'Đã sáp nhập công ty con' });
  const [loc, setLoc] = useState('');
  const [mna, setMna] = useState<{ targetCompanyId: string; price: number; note: string } | null>(null);
  if (q.isLoading) return <Loading />;
  const g = q.data;
  const retail = c.industry_kind === 'manufacturer_retail';
  const stage = me?.stage ?? 1;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Vốn chủ sở hữu hợp nhất" value={<Money value={g.consolidatedEquity} compact />} hint="Công ty này cộng các công ty con" />
        <Stat label="Công ty con" value={g.subsidiaries.length} />
        <Stat label="Chi nhánh" value={g.branches.length} hint="Mỗi chi nhánh tăng lượng khách" />
        <Stat label="Công ty mẹ" value={g.parent ? g.parent.name : '—'} />
      </div>

      <Panel title="Chi nhánh bán hàng" eyebrow={stage < 3 ? 'Mở khóa từ giai đoạn Doanh nghiệp vừa' : `Phí mở ${vnd(60_000_000, true)} · thuê theo địa điểm · tối đa 5`}>
        {g.branches.length === 0 ? (
          <p className="text-sm text-ink-400">Chưa có chi nhánh. Chi nhánh cộng thêm 60% lưu lượng khách của địa điểm vào sức hút cửa hàng.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {g.branches.map((b: any) => (
              <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-950/40 px-3 py-2">
                <span className="flex items-center gap-2">
                  <Store size={15} className="text-sky-300" />
                  {b.location_name} · thuê {vnd(b.rent_day, true)}/ngày · từ {gameTime(b.opened_minute)}
                </span>
                <ConfirmButton label="Đóng" title="Đóng chi nhánh" message="Ngừng trả tiền thuê và mất phần lưu lượng khách của chi nhánh." onConfirm={() => closeBranch.mutateAsync({ id: b.id })} />
              </li>
            ))}
          </ul>
        )}
        {retail && stage >= 3 && (
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <Field label="Địa điểm">
              {(fid) => (
                <select id={fid} className="field min-w-[220px]" value={loc} onChange={(e) => setLoc(e.target.value)}>
                  <option value="">Chọn địa điểm…</option>
                  {cat.data?.locations
                    .filter((l) => l.code !== c.location_code && !g.branches.some((b: any) => b.location_code === l.code))
                    .map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.name} (thuê {vnd(l.rent_day, true)}/ngày, lưu lượng ×{l.traffic})
                      </option>
                    ))}
                </select>
              )}
            </Field>
            <Button disabled={!loc} loading={openBranch.isPending} onClick={() => openBranch.mutate({ location: loc })}>
              Mở chi nhánh
            </Button>
          </div>
        )}
      </Panel>

      <Panel title="Công ty con" eyebrow="Sáp nhập theo giá trị sổ sách: tài sản, nợ, nhân sự, thiết bị chuyển về công ty mẹ">
        {g.subsidiaries.length === 0 ? (
          <Empty title="Chưa có công ty con" text="Mua lại doanh nghiệp khác, hoặc nắm trên 50% cổ phần của một doanh nghiệp niêm yết." />
        ) : (
          <ul className="space-y-2">
            {g.subsidiaries.map((s: any) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--line)' }}>
                <span className="flex items-center gap-2">
                  <Building2 size={15} className="text-sky-300" />
                  <Link to={`/companies/${s.id}`} className="text-white hover:text-sky-200">
                    {s.name}
                  </Link>
                  <span className="text-xs text-ink-400">
                    {s.industry} · {s.employees} người · tiền {vnd(s.cash, true)}
                  </span>
                </span>
                <ConfirmButton variant="secondary" icon={<GitMerge size={14} />} label="Sáp nhập" title={`Sáp nhập ${s.name}`} message="Không được còn hàng đang vận chuyển, lệnh sản xuất, hợp đồng hay lệnh chứng khoán đang mở. Công ty con sẽ đóng sau khi sáp nhập." onConfirm={() => merge.mutateAsync({ sub: s.id })} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Mua bán và sáp nhập (M&A)"
        eyebrow={stage < 4 ? 'Chào mua mở khóa từ giai đoạn Doanh nghiệp lớn' : 'Mua 100% doanh nghiệp chưa niêm yết; doanh nghiệp niêm yết được thâu tóm qua sàn'}
        action={
          stage >= 4 && (
            <Button size="sm" icon={<Handshake size={15} />} onClick={() => setMna({ targetCompanyId: '', price: 0, note: '' })}>
              Chào mua
            </Button>
          )
        }
      >
        {g.offers.length === 0 ? (
          <p className="text-sm text-ink-400">Chưa có đề nghị mua bán nào.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {g.offers.map((o: any) => {
              const incoming = o.target_company_id === c.id;
              return (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink-950/40 px-3 py-2">
                  <span>
                    {incoming ? `${o.acquirer_name} muốn mua công ty này` : `Chào mua ${o.target_name}`} · <Money value={o.price} compact />
                    {o.note && <span className="text-xs text-ink-400"> · “{o.note}”</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={o.status === 'pending' ? 'sky' : o.status === 'accepted' ? 'gain' : 'muted'}>{({ pending: 'Đang chờ', accepted: 'Đã chấp nhận', rejected: 'Bị từ chối', expired: 'Hết hạn', cancelled: 'Đã hủy' } as Record<string, string>)[o.status]}</Badge>
                    {o.status === 'pending' && incoming && (
                      <>
                        <ConfirmButton variant="primary" label="Bán" title="Chấp nhận bán toàn bộ doanh nghiệp" message={`Bạn nhận ${vnd(o.price)} và chuyển quyền sở hữu cho bên mua. Không thể hoàn tác.`} onConfirm={() => respond.mutateAsync({ id: o.id, accept: true })} />
                        <Button size="sm" variant="ghost" onClick={() => respond.mutate({ id: o.id, accept: false })}>
                          Từ chối
                        </Button>
                      </>
                    )}
                    {o.status === 'pending' && !incoming && (
                      <Button size="sm" variant="ghost" onClick={() => cancelOffer.mutate({ id: o.id })}>
                        Rút
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Modal
        open={!!mna}
        onClose={() => setMna(null)}
        title="Đề nghị mua lại doanh nghiệp"
        footer={
          <Button disabled={!mna?.targetCompanyId || !mna.price} loading={offer.isPending} onClick={() => mna && offer.mutate(mna, { onSuccess: () => setMna(null) })}>
            Gửi đề nghị
          </Button>
        }
      >
        {mna && (
          <div className="space-y-4">
            <Field label="Doanh nghiệp mục tiêu">
              {(fid) => (
                <select id={fid} className="field" value={mna.targetCompanyId} onChange={(e) => setMna({ ...mna, targetCompanyId: e.target.value })}>
                  <option value="">Chọn…</option>
                  {(targets.data ?? [])
                    .filter((t) => t.id !== c.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.industry}, {t.is_npc ? 'NPC' : t.owner})
                      </option>
                    ))}
                </select>
              )}
            </Field>
            <Field label="Giá mua toàn bộ" hint="Doanh nghiệp NPC chỉ bán khi giá từ 130% giá trị sổ sách. Đề nghị hết hạn sau 2 ngày game.">
              {(fid) => <input id={fid} type="number" inputMode="numeric" className="field num" step={10_000_000} value={mna.price} onChange={(e) => setMna({ ...mna, price: Number(e.target.value) })} />}
            </Field>
            <Field label="Lời nhắn">{(fid) => <input id={fid} className="field" maxLength={300} value={mna.note} onChange={(e) => setMna({ ...mna, note: e.target.value })} />}</Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
