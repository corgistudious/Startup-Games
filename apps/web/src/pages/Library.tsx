import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { stageName } from '@startup/shared';
import { api } from '@/lib/api';
import { useCatalog } from '@/lib/catalog';
import { PageHeader, Loading, Empty, Logo, initials, Panel } from '@/components/ui';
import { TitleTags, Stars } from '@/components/Titles';
import { STATUS_LABEL } from '@/lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Library() {
  const cat = useCatalog();
  const [f, setF] = useState({ q: '', industry: '', title: '', sort: 'rating' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const q = useQuery({ queryKey: ['library', qs], queryFn: () => api<any[]>(`/library?${qs}`) });
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Cộng đồng" title="Thư viện doanh nghiệp" subtitle="Hồ sơ công khai của mọi doanh nghiệp do người chơi thành lập, cùng đánh giá cộng đồng và các danh hiệu Tuyển Chọn, Reviewer đề cử, Yêu Thích." />
      <Panel bodyClass="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input aria-label="Tìm kiếm" className="field pl-9" placeholder="Tìm theo tên" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        </div>
        <select aria-label="Ngành" className="field" value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })}>
          <option value="">Tất cả ngành</option>
          {cat.data?.industries.map((i) => (
            <option key={i.code} value={i.code}>
              {i.name}
            </option>
          ))}
        </select>
        <select aria-label="Danh hiệu" className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })}>
          <option value="">Mọi danh hiệu</option>
          <option value="tuyen_chon">Tuyển Chọn</option>
          <option value="de_cu">Có Reviewer đề cử</option>
          <option value="yeu_thich">Yêu Thích</option>
        </select>
        <select aria-label="Sắp xếp" className="field" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}>
          <option value="rating">Điểm đánh giá cao</option>
          <option value="reviews">Nhiều đánh giá</option>
          <option value="recommended">Nhiều Reviewer đề cử</option>
          <option value="newest">Mới thành lập</option>
        </select>
      </Panel>
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <Panel>
          <Empty title="Không tìm thấy doanh nghiệp" text="Thư viện chỉ hiển thị doanh nghiệp thật do người chơi thành lập." />
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((c) => (
            <Link key={c.id} to={`/library/${c.slug}`} className="panel rise flex flex-col p-5 transition hover:border-sky-400/40">
              <div className="flex items-start gap-3">
                <Logo hue={c.logo_hue} glyph={initials(c.name)} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-lg font-semibold text-white">{c.name}</div>
                  <div className="text-xs text-ink-400">
                    {c.industry} · {c.owner} · {stageName(c.owner_stage)}
                  </div>
                </div>
              </div>
              <p className="mt-3 line-clamp-2 min-h-[40px] text-sm text-ink-300">{c.description || 'Chưa có giới thiệu.'}</p>
              <div className="mt-3 flex items-center gap-2 text-sm">
                <Stars value={c.avg_rating ?? 0} />
                <span className="num text-ink-200">{c.avg_rating ? c.avg_rating.toFixed(1) : '—'}</span>
                <span className="text-xs text-ink-400">({c.review_count} đánh giá)</span>
                {c.status !== 'active' && <span className="ml-auto text-xs text-warn">{STATUS_LABEL[c.status]}</span>}
              </div>
              <div className="mt-3">
                <TitleTags titles={c.titles} recommendations={c.recommendations} verified={c.verified} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
