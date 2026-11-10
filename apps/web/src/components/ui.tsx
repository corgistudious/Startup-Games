import { useEffect, useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X, CheckCircle2, AlertTriangle, Info, Inbox } from 'lucide-react';
import { useToasts } from '@/lib/store';
import { vnd } from '@/lib/format';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'success' | 'danger';

export function Button({
  variant = 'primary',
  size,
  shimmer,
  loading,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'lg'; shimmer?: boolean; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      type={type}
      className={clsx('btn', `btn-${variant}`, size && `btn-${size}`, shimmer && variant === 'primary' && 'btn-shimmer', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function Panel({ title, eyebrow, action, children, className, bodyClass }: { title?: ReactNode; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={clsx('panel rise', className)}>
      {(title || action) && (
        <header className="panel-head">
          <div className="min-w-0">
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && <h2 className="truncate text-[15px] font-semibold">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      <div className={clsx('p-4 sm:p-5', bodyClass)}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'gain' | 'loss' | 'warn'; icon?: ReactNode }) {
  return (
    <div className="panel rise flex min-w-0 flex-col gap-1 p-4">
      <div className="flex items-center justify-between gap-2 text-xs text-ink-300">
        <span className="truncate">{label}</span>
        {icon && <span className="text-sky-300/80">{icon}</span>}
      </div>
      <div className="num truncate text-lg font-semibold text-white sm:text-2xl">{value}</div>
      {hint && <div className={clsx('truncate text-xs', tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : tone === 'warn' ? 'text-warn' : 'text-ink-400')}>{hint}</div>}
    </div>
  );
}

export function Money({ value, compact, signed, className }: { value: number | string | null | undefined; compact?: boolean; signed?: boolean; className?: string }) {
  const n = Number(value ?? 0);
  return <span className={clsx('num', signed && (n > 0 ? 'text-gain' : n < 0 ? 'text-loss' : ''), className)}>{signed && n > 0 ? '+' : ''}{vnd(n, compact)}</span>;
}

const TONES = {
  sky: 'bg-sky-400/15 text-sky-200 ring-1 ring-sky-400/30',
  gain: 'bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/30',
  loss: 'bg-red-400/15 text-red-200 ring-1 ring-red-400/30',
  warn: 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30',
  muted: 'bg-ink-600/50 text-ink-200 ring-1 ring-ink-500/40',
  gold: 'bg-gradient-to-b from-amber-200 to-amber-400 text-amber-950 ring-1 ring-amber-300',
} as const;
export function Badge({ tone = 'muted', children, icon }: { tone?: keyof typeof TONES; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={clsx('chip', TONES[tone])}>
      {icon}
      {children}
    </span>
  );
}

export function Progress({ value, max = 100, tone = 'sky' }: { value: number; max?: number; tone?: 'sky' | 'gain' | 'warn' | 'loss' }) {
  const p = Math.max(0, Math.min(100, (value / max) * 100));
  const c = { sky: 'from-sky-300 to-sky-500', gain: 'from-emerald-300 to-emerald-500', warn: 'from-amber-200 to-amber-400', loss: 'from-red-300 to-red-500' }[tone];
  return (
    <div className="h-2 overflow-hidden rounded-full bg-ink-700/70" role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}>
      <div className={clsx('h-full rounded-full bg-gradient-to-r transition-[width] duration-700', c)} style={{ width: `${p}%` }} />
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}

/** Dialog: bottom sheet on phones (keeps the confirm button above the keyboard), centred card on desktop. */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/70 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={title}>
      <div className={clsx('panel rise flex max-h-[92dvh] w-full flex-col rounded-b-none sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="panel-head">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn btn-ghost btn-sm !px-2" onClick={onClose} aria-label="Đóng">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5" style={{ borderColor: 'var(--line)' }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A destructive action that asks for confirmation (and optionally a reason) in-page. */
export function ConfirmButton({ label, title, message, onConfirm, needReason, variant = 'danger', size = 'sm', icon }: { label: string; title: string; message: ReactNode; onConfirm: (reason: string) => Promise<unknown> | void; needReason?: boolean; variant?: Variant; size?: 'sm' | 'lg'; icon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant={variant === 'danger' ? 'outline' : variant} size={size} icon={icon} onClick={() => setOpen(true)} className={variant === 'danger' ? '!border-red-400/50 !text-red-300' : undefined}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Hủy
            </Button>
            <Button
              variant={variant}
              loading={busy}
              disabled={needReason && reason.trim().length < 5}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm(reason.trim());
                  setOpen(false);
                  setReason('');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Xác nhận
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-ink-200">
          <div>{message}</div>
          {needReason && (
            <Field label="Lý do (bắt buộc, ghi vào nhật ký kiểm toán)">{(id) => <textarea id={id} className="field min-h-[80px]" value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          )}
        </div>
      </Modal>
    </>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; icon?: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            'inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-medium transition',
            value === t.id ? 'bg-sky-400/15 text-sky-100 ring-1 ring-sky-400/40' : 'text-ink-300 hover:bg-ink-700/50 hover:text-white',
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <Inbox className="text-ink-500" size={28} />
      <div className="font-medium text-ink-200">{title}</div>
      {text && <p className="max-w-sm text-sm text-ink-400">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Đang tải">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-2xl bg-ink-800/70" />
      ))}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="panel flex items-start gap-3 border-red-400/30 p-4 text-sm text-red-200">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      {(error as Error)?.message ?? 'Có lỗi xảy ra'}
    </div>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">{children}</div>;
}

export function Toaster() {
  const list = useToasts((s) => s.list);
  const drop = useToasts((s) => s.drop);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:top-auto sm:items-end" aria-live="polite">
      {list.map((t) => (
        <button
          key={t.id}
          onClick={() => drop(t.id)}
          className={clsx(
            'panel rise pointer-events-auto flex w-full max-w-md items-start gap-2.5 px-4 py-3 text-left text-sm',
            t.kind === 'ok' ? 'border-emerald-400/40' : t.kind === 'err' ? 'border-red-400/40' : 'border-sky-400/40',
          )}
        >
          {t.kind === 'ok' ? <CheckCircle2 size={18} className="shrink-0 text-gain" /> : t.kind === 'err' ? <AlertTriangle size={18} className="shrink-0 text-loss" /> : <Info size={18} className="shrink-0 text-sky-300" />}
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-300">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Logo({ hue, glyph, size = 40 }: { hue: number; glyph: string; size?: number }) {
  return (
    <div
      className="grid shrink-0 place-items-center rounded-xl font-display font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(160deg, hsl(${hue} 70% 58%), hsl(${(hue + 30) % 360} 70% 32%))`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.35)' }}
      aria-hidden
    >
      {glyph}
    </div>
  );
}
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
