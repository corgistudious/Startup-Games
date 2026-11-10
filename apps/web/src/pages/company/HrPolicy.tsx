import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gift, Clock, HeartHandshake } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { Panel, Button, Field, Modal } from '@/components/ui';
import { vnd } from '@/lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function HrPolicy({ d }: { d: any }) {
  const c = d.company;
  const rules = useQuery({ queryKey: ['rules-expansion'], queryFn: () => api<any>('/rules/expansion'), staleTime: Infinity });
  const [policy, setPolicy] = useState({ benefitLevel: c.benefit_level ?? 0, overtimeHours: c.overtime_hours ?? 0 });
  useEffect(() => setPolicy({ benefitLevel: c.benefit_level ?? 0, overtimeHours: c.overtime_hours ?? 0 }), [c.benefit_level, c.overtime_hours]);
  const save = useAction(`/companies/${c.id}/hr-policy`, { method: 'PUT', invalidate: [['company', c.id]], success: 'Đã cập nhật chính sách nhân sự' });
  const [bonus, setBonus] = useState(false);
  const [amount, setAmount] = useState(500_000);
  const [picked, setPicked] = useState<string[]>([]);
  const pay = useAction<object, { total: number }>(`/companies/${c.id}/bonus`, { invalidate: [['company', c.id]], success: (r) => `Đã chi thưởng ${vnd(r.total)}` });
  const benefits = rules.data?.benefits ?? [];
  const daily = (benefits[policy.benefitLevel]?.costPerDay ?? 0) * d.staff.length;

  return (
    <Panel title="Chính sách nhân sự" eyebrow="Phúc lợi, tăng ca, thưởng, nghỉ phép">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Gói phúc lợi" hint={daily ? `Chi phí ${vnd(daily)}/ngày cho ${d.staff.length} người · tinh thần +${benefits[policy.benefitLevel]?.morale}/ngày` : 'Không có chi phí, không cộng tinh thần'}>
          {(id) => (
            <select id={id} className="field" value={policy.benefitLevel} onChange={(e) => setPolicy({ ...policy, benefitLevel: Number(e.target.value) })}>
              {benefits.map((b: any) => (
                <option key={b.level} value={b.level}>
                  {b.name}
                  {b.costPerDay ? ` (${vnd(b.costPerDay)}/người/ngày)` : ''}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Tăng ca sau 17:00 (ca ngày, Thứ Hai–Thứ Sáu)" hint="Trả 150% lương giờ; mỗi giờ tăng ca làm tinh thần giảm 1 điểm/ngày.">
          {(id) => (
            <select id={id} className="field" value={policy.overtimeHours} onChange={(e) => setPolicy({ ...policy, overtimeHours: Number(e.target.value) })}>
              {[0, 1, 2, 3].map((h) => (
                <option key={h} value={h}>
                  {h === 0 ? 'Không tăng ca' : `${h} giờ/ngày (17:00–${17 + h}:00)`}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="flex items-end gap-2">
          <Button variant="secondary" icon={<HeartHandshake size={15} />} loading={save.isPending} onClick={() => save.mutate(policy)}>
            Lưu chính sách
          </Button>
          <Button variant="outline" icon={<Gift size={15} />} disabled={!d.staff.length} onClick={() => (setPicked(d.staff.map((p: any) => p.id)), setBonus(true))}>
            Thưởng
          </Button>
        </div>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-400">
        <Clock size={12} /> Nghỉ phép có lương: {rules.data?.annualLeaveDays ?? 12} ngày/năm game cho mỗi nhân viên, cấp ở nút “Nghỉ phép” trong bảng đội ngũ. Người nghỉ phép vẫn được trả lương ca thường và hồi tinh thần.
      </p>
      <Modal
        open={bonus}
        onClose={() => setBonus(false)}
        title="Chi thưởng"
        footer={
          <Button disabled={!picked.length || amount <= 0} loading={pay.isPending} onClick={() => pay.mutate({ personIds: picked, amountEach: amount }, { onSuccess: () => setBonus(false) })}>
            Chi {vnd(amount * picked.length, true)}
          </Button>
        }
      >
        <Field label="Mức thưởng mỗi người" hint="Thưởng bằng khoảng 1 ngày lương tăng ~6 điểm tinh thần (tối đa 25).">
          {(id) => <input id={id} type="number" inputMode="numeric" className="field num" step={50_000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />}
        </Field>
        <div className="mt-4 max-h-64 space-y-1 overflow-y-auto">
          {d.staff.map((p: any) => (
            <label key={p.id} className="flex min-h-[40px] items-center gap-3 rounded-lg px-2 text-sm hover:bg-ink-700/30">
              <input type="checkbox" className="h-4 w-4 accent-sky-400" checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} />
              <span className="flex-1">{p.full_name}</span>
              <span className="text-xs text-ink-400">tinh thần {p.morale}</span>
            </label>
          ))}
        </div>
      </Modal>
    </Panel>
  );
}
