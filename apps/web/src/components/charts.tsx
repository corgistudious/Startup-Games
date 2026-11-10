import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, LineChart, Line } from 'recharts';
import { vnd } from '@/lib/format';

const axis = { stroke: '#64779F', fontSize: 11, tickLine: false, axisLine: false } as const;
const tip = {
  contentStyle: { background: '#0E1832', border: '1px solid rgba(148,163,194,.2)', borderRadius: 12, fontSize: 12, color: '#E6EBF5' },
  labelStyle: { color: '#94A3C2' },
  cursor: { stroke: 'rgba(56,189,248,.35)' },
};
const compact = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)}tỷ` : Math.abs(v) >= 1e6 ? `${Math.round(v / 1e6)}tr` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v));

export function AreaSeries({ data, x, y, height = 220, money = true }: { data: Record<string, unknown>[]; x: string; y: string; height?: number; money?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`fill-${y}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#38BDF8" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(148,163,194,.08)" vertical={false} />
        <XAxis dataKey={x} {...axis} />
        <YAxis {...axis} width={48} tickFormatter={money ? compact : undefined} />
        <Tooltip {...tip} formatter={(v: number) => (money ? vnd(v) : v.toLocaleString('vi-VN'))} />
        <Area type="monotone" dataKey={y} stroke="#38BDF8" strokeWidth={2} fill={`url(#fill-${y})`} dot={false} activeDot={{ r: 4, fill: '#7DD3FC' }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function Bars({ data, x, bars, height = 240 }: { data: Record<string, unknown>[]; x: string; bars: { key: string; color: string; name: string }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(148,163,194,.08)" vertical={false} />
        <XAxis dataKey={x} {...axis} />
        <YAxis {...axis} width={48} tickFormatter={compact} />
        <Tooltip {...tip} cursor={{ fill: 'rgba(56,189,248,.06)' }} formatter={(v: number) => vnd(v)} />
        {bars.map((b) => (
          <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color} radius={[6, 6, 0, 0]} maxBarSize={28} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PriceLine({ data, height = 260 }: { data: { t: string; price: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(148,163,194,.08)" vertical={false} />
        <XAxis dataKey="t" {...axis} minTickGap={30} />
        <YAxis {...axis} width={56} domain={['auto', 'auto']} tickFormatter={compact} />
        <Tooltip {...tip} formatter={(v: number) => vnd(v)} />
        <Line type="stepAfter" dataKey="price" stroke="#38BDF8" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
