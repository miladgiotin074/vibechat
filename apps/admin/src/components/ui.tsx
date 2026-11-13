'use client';

import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { fmtNum, STATUS_LABEL, STATUS_TONE } from '@/lib/format';

type Variant = 'primary' | 'ghost' | 'soft' | 'danger' | 'ok';

export function Button({
  variant = 'soft',
  size = 'md',
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
        variant === 'primary' && 'brand-gradient text-white shadow-lg shadow-brand/20 hover:brightness-110',
        variant === 'soft' && 'bg-surface-3 text-ink hover:bg-white/10',
        variant === 'ghost' && 'text-muted hover:text-ink hover:bg-white/5',
        variant === 'danger' && 'bg-danger/15 text-danger hover:bg-danger/25',
        variant === 'ok' && 'bg-ok/15 text-ok hover:bg-ok/25',
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

const TONES = {
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/15 text-warn',
  danger: 'bg-danger/15 text-danger',
  muted: 'bg-white/5 text-muted',
  info: 'bg-info/15 text-info',
  brand: 'bg-brand/15 text-brand',
  violet: 'bg-violet/15 text-violet',
} as const;

export function Badge({ tone = 'muted', children, className }: { tone?: keyof typeof TONES; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', TONES[tone], className)}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'muted'}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export function Card({ title, action, children, className, padded = true }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx('card', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={clsx(padded && 'p-5')}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, icon, tone = 'brand' }: { label: string; value: number | string | null | undefined; hint?: ReactNode; icon?: ReactNode; tone?: keyof typeof TONES }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-muted">{label}</div>
        {icon && <div className={clsx('grid size-9 place-items-center rounded-xl', TONES[tone])}>{icon}</div>}
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight">{typeof value === 'number' ? fmtNum(value) : value ?? '—'}</div>
      {hint && <div className="mt-1 text-xs text-faint">{hint}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={clsx('flex justify-center py-16 text-muted', className)}>
      <Loader2 className="size-6 animate-spin" />
    </div>
  );
}

export function Empty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      {icon && <div className="mb-2 grid size-14 place-items-center rounded-2xl bg-white/5 text-muted">{icon}</div>}
      <div className="font-medium">{title}</div>
      {hint && <div className="text-sm text-muted">{hint}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{(error as Error).message ?? 'خطا'}</div>;
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-muted">
      <span>
        صفحه {fmtNum(page)} از {fmtNum(pages)}، {fmtNum(total)} مورد
      </span>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronRight className="size-4" /> قبلی
        </Button>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          بعدی <ChevronLeft className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex gap-1 rounded-xl bg-surface-2 p-1">
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={clsx(
            'rounded-lg px-3.5 py-1.5 text-sm transition',
            value === it.value ? 'bg-surface-3 text-ink shadow' : 'text-muted hover:text-ink',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className={clsx('card max-h-[90vh] w-full overflow-y-auto bg-surface shadow-2xl', wide ? 'max-w-3xl' : 'max-w-lg')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-white/5 hover:text-ink">
            <X className="size-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center gap-3 text-sm">
      <span className={clsx('relative h-6 w-11 rounded-full transition', checked ? 'brand-gradient' : 'bg-surface-3')}>
        <span className={clsx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'right-0.5' : 'right-[1.375rem]')} />
      </span>
      {label}
    </button>
  );
}

export function Avatar({ src, name, size = 40 }: { src?: string | null; name?: string | null; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <div className="grid shrink-0 place-items-center rounded-full bg-surface-3 text-sm text-muted" style={{ width: size, height: size }}>
      {name?.[0] ?? '؟'}
    </div>
  );
}
