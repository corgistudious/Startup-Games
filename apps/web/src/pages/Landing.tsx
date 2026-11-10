import { useState } from 'react';
import { Factory, LineChart, Users, Landmark, ShieldCheck, Clock3 } from 'lucide-react';
import { Button, Field } from '@/components/ui';
import { Brand } from '@/components/Shell';
import { api } from '@/lib/api';
import { toast, useSession } from '@/lib/store';
import { useGameClock, useWorld } from '@/lib/hooks';
import { WEEKDAY_NAMES } from '@startup/shared';
import { num } from '@/lib/format';

const FEATURES = [
  { icon: Factory, title: 'Sản xuất thật', text: 'Nguyên liệu, máy móc, nhân công theo ca và thời gian sản xuất. Thiếu một thứ là dây chuyền dừng.' },
  { icon: Users, title: 'Nhân sự có tính cách', text: 'Ứng viên có kỹ năng, kỳ vọng lương, tinh thần. Nợ lương là họ nghỉ việc.' },
  { icon: LineChart, title: 'Sàn chứng khoán', text: 'IPO, sổ lệnh, khớp theo giá và thời gian. Không có người bán thì không có cổ phiếu.' },
  { icon: Landmark, title: 'Kế toán kép', text: 'Mỗi đồng tiền có chứng từ. Báo cáo tháng chốt tự động sau mỗi 7 ngày game.' },
];

export default function Landing() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ username: '', password: '', displayName: '' });
  const [busy, setBusy] = useState(false);
  const login = useSession((s) => s.login);
  const clock = useGameClock();
  const { data: world } = useWorld();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = mode === 'login' ? { username: form.username, password: form.password } : form;
      const r = await api<{ token: string }>(`/auth/${mode}`, { method: 'POST', body });
      login(r.token);
      toast.ok(mode === 'login' ? 'Chào mừng trở lại!' : 'Tài khoản đã sẵn sàng. Bạn nhận 600 triệu ₫ vốn khởi nghiệp.');
    } catch (err) {
      toast.err((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid min-h-dvh max-w-6xl items-center gap-10 px-4 py-10 lg:grid-cols-[1.15fr_1fr] lg:px-8">
      <div className="rise">
        <Brand />
        <h1 className="mt-8 text-4xl font-semibold leading-tight sm:text-5xl">
          Xây đế chế kinh doanh
          <br />
          <span className="bg-gradient-to-r from-sky-200 via-sky-400 to-sky-600 bg-clip-text text-transparent">trong một nền kinh tế sống.</span>
        </h1>
        <p className="mt-4 max-w-xl text-ink-300">
          Bắt đầu với 600 triệu đồng. Thành lập doanh nghiệp, tuyển người, mua nguyên liệu, sản xuất, cạnh tranh giá với người chơi khác và NPC. Thế giới vẫn chạy khi bạn offline.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          {clock && (
            <span className="chip bg-sky-400/12 py-1.5 text-sky-100 ring-1 ring-sky-400/30">
              <Clock3 size={13} /> Giờ thế giới: {String(clock.hour).padStart(2, '0')}:{String(clock.minuteOfHour).padStart(2, '0')} {WEEKDAY_NAMES[clock.weekday]}
            </span>
          )}
          {world && <span className="chip bg-ink-700/60 py-1.5 text-ink-200">{num(world.stats.companies)} doanh nghiệp đang hoạt động</span>}
          {world && <span className="chip bg-ink-700/60 py-1.5 text-ink-200">{num(world.stats.employed)} người đang đi làm</span>}
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="panel p-4">
              <f.icon className="text-sky-300" size={20} />
              <div className="mt-2 font-medium text-white">{f.title}</div>
              <p className="mt-1 text-sm text-ink-400">{f.text}</p>
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={submit} className="panel rise w-full p-6 sm:p-8">
        <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-ink-950/60 p-1" role="tablist">
          {(['login', 'register'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`min-h-[42px] rounded-lg text-sm font-medium transition ${mode === m ? 'bg-sky-400/15 text-sky-100 ring-1 ring-sky-400/40' : 'text-ink-400'}`}>
              {m === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
            </button>
          ))}
        </div>
        <div className="space-y-4">
          <Field label="Tên đăng nhập">{(id) => <input id={id} className="field" autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required minLength={3} />}</Field>
          {mode === 'register' && (
            <Field label="Tên hiển thị (tên doanh nhân)">{(id) => <input id={id} className="field" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required minLength={2} />}</Field>
          )}
          <Field label="Mật khẩu" hint={mode === 'register' ? 'Tối thiểu 10 ký tự, gồm chữ và số.' : undefined}>
            {(id) => <input id={id} type="password" className="field" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={mode === 'register' ? 10 : 1} />}
          </Field>
        </div>
        <Button type="submit" size="lg" shimmer loading={busy} className="mt-6 w-full">
          {mode === 'login' ? 'Vào thế giới kinh doanh' : 'Bắt đầu khởi nghiệp'}
        </Button>
        <p className="mt-4 flex items-center gap-2 text-xs text-ink-400">
          <ShieldCheck size={14} className="text-sky-300" /> Mật khẩu được băm bằng scrypt. Không ai, kể cả Ban Quản Trị, xem được mật khẩu của bạn.
        </p>
      </form>
    </div>
  );
}
