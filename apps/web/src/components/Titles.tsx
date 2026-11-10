import { Award, Heart, BadgeCheck } from 'lucide-react';
import { Badge } from './ui';

/** The three company titles, rendered consistently everywhere. */
export function TitleTags({ titles, recommendations, verified }: { titles: string[]; recommendations?: number; verified?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {titles.includes('tuyen_chon') && (
        <Badge tone="gold" icon={<Award size={12} />}>
          Tuyển Chọn
        </Badge>
      )}
      {titles.includes('yeu_thich') && (
        <Badge tone="loss" icon={<Heart size={12} />}>
          Yêu Thích
        </Badge>
      )}
      {!!recommendations && (
        <Badge tone="sky" icon={<BadgeCheck size={12} />}>
          Reviewer đề cử: {recommendations}
        </Badge>
      )}
      {verified && <Badge tone="gain">Verified</Badge>}
    </div>
  );
}

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-300" aria-label={`${value.toFixed(1)} trên 5 sao`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 20 20" fill={i <= Math.round(value) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.5} aria-hidden>
          <path d="M10 1.8l2.5 5.1 5.6.8-4 3.9.9 5.6L10 14.6 5 17.2l.9-5.6-4-3.9 5.6-.8z" />
        </svg>
      ))}
    </span>
  );
}
