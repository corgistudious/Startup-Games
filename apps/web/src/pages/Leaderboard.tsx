import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { stageName } from '@startup/shared';
import { api } from '@/lib/api';
import { PageHeader, Panel, Money, Loading, Badge, Logo, initials } from '@/components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Leaderboard() {
  const q = useQuery({ queryKey: ['leaderboard'], queryFn: () => api<any>('/leaderboard') });
  if (q.isLoading) return <Loading />;
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Cộng đồng" title="Bảng xếp hạng" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Doanh nghiệp doanh thu cao nhất" eyebrow="7 ngày game gần nhất">
          <ol className="space-y-3">
            {q.data.companies.map((c: any, i: number) => (
              <li key={c.id} className="flex items-center gap-3">
                <span className={`num w-6 text-center font-semibold ${i < 3 ? 'text-sky-300' : 'text-ink-500'}`}>{i + 1}</span>
                <Logo hue={c.logo_hue} glyph={initials(c.name)} size={34} />
                <div className="min-w-0 flex-1">
                  <Link to={`/library/${c.slug}`} className="truncate text-white hover:text-sky-200">
                    {c.name}
                  </Link>
                  <div className="text-xs text-ink-400">
                    {c.industry} · {c.is_npc ? 'NPC' : c.owner}
                  </div>
                </div>
                <Money value={c.revenue_7d} compact />
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title="Doanh nhân">
          <ol className="space-y-3">
            {q.data.players.map((p: any, i: number) => (
              <li key={p.id} className="flex items-center gap-3">
                <span className={`num w-6 text-center font-semibold ${i < 3 ? 'text-sky-300' : 'text-ink-500'}`}>{i + 1}</span>
                <div className="grid h-9 w-9 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: `hsl(${p.avatar_hue} 60% 40%)` }}>
                  {p.display_name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-white">{p.display_name}</div>
                  <div className="text-xs text-ink-400">{p.companies} doanh nghiệp</div>
                </div>
                <Badge tone="sky">{stageName(p.stage)}</Badge>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}
