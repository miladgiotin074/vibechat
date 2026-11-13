import clsx from 'clsx';
import { ChevronLeft, Crown, Heart, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { type ButtonHTMLAttributes, type ReactNode, useState } from 'react';
import { haptic } from '@/telegram/tg';

// ---- buttons -------------------------------------------------------------------------------

type BtnProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'> & {
  loading?: boolean;
  icon?: ReactNode;
  variant?: 'flame' | 'royal' | 'gold' | 'soft' | 'ghost' | 'danger';
  size?: 'lg' | 'md' | 'sm';
};

/** The main call to action: flame gradient, soft glow, springy press. */
export function Button({ loading, icon, variant = 'flame', size = 'lg', className, children, disabled, onClick, ...rest }: BtnProps) {
  const off = disabled || loading;
  const look = {
    flame: 'bg-flame text-white shadow-[0_10px_30px_-10px_rgba(255,45,111,0.7)]',
    royal: 'bg-royal text-white shadow-[0_10px_30px_-10px_rgba(139,92,246,0.7)]',
    gold: 'bg-gold text-[#3a2400] shadow-[0_10px_30px_-10px_rgba(255,159,67,0.6)]',
    soft: 'bg-surface-2 text-ink border border-line',
    ghost: 'bg-transparent text-muted',
    danger: 'bg-danger/15 text-danger border border-danger/30',
  }[variant];
  const h = { lg: 'h-14 rounded-[20px] text-[15px]', md: 'h-12 rounded-[18px] text-[14px]', sm: 'h-10 rounded-2xl text-[13px] px-4' }[size];
  return (
    <motion.button
      whileTap={off ? undefined : { scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      disabled={off}
      onClick={(e) => {
        if (variant === 'flame' || variant === 'royal' || variant === 'gold') haptic.light();
        onClick?.(e);
      }}
      className={clsx(
        'relative flex items-center justify-center gap-2 font-semibold select-none transition-[opacity,filter] px-5',
        h,
        // disabled gradient buttons turn into a calm surface (like the Android app); loading keeps its colour
        disabled && !loading && (variant === 'flame' || variant === 'royal' || variant === 'gold') ? 'bg-surface-3 text-faint' : look,
        disabled && !loading && (variant === 'soft' || variant === 'ghost' || variant === 'danger') && 'opacity-50',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-5 animate-spin" /> : icon}
      {!loading && children}
    </motion.button>
  );
}

/** Round icon button with a glassy fill (top bars, overlays). */
export function IconButton({
  children,
  onClick,
  className,
  label,
  badge,
  tour,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  label?: string;
  badge?: boolean | number;
  /** data-tour id for the spotlight tutorial */
  tour?: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      aria-label={label}
      data-tour={tour}
      onClick={() => {
        haptic.select();
        onClick?.();
      }}
      className={clsx('relative grid size-11 shrink-0 place-items-center rounded-full border border-line bg-white/[0.06] text-ink', className)}
    >
      {children}
      {badge ? (
        <span className="absolute -top-0.5 -left-0.5 grid min-w-[18px] h-[18px] place-items-center rounded-full bg-rose px-1 text-[10px] font-bold text-white ring-2 ring-night">
          {typeof badge === 'number' ? (badge > 99 ? '۹۹+' : badge.toLocaleString('fa-IR')) : ''}
        </span>
      ) : null}
    </motion.button>
  );
}

// ---- surfaces --------------------------------------------------------------------------------

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={clsx('rounded-card border border-line bg-surface-1/90', onClick && 'active:opacity-80 transition-opacity', className)}>
      {children}
    </div>
  );
}

/** Slowly drifting colour blobs behind welcome/onboarding/premium/random screens. */
export function GlowBackground({ intensity = 1, className }: { intensity?: number; className?: string }) {
  return (
    <div className={clsx('pointer-events-none absolute inset-0 overflow-hidden', className)} style={{ opacity: 0.8 * intensity }}>
      <div className="absolute -top-1/4 -right-1/4 size-[110vw] rounded-full bg-[radial-gradient(circle,rgba(255,45,111,0.42),transparent_62%)] blur-3xl animate-drift-a" />
      <div className="absolute -bottom-1/4 -left-1/3 size-[110vw] rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.38),transparent_62%)] blur-3xl animate-drift-b" />
      <div className="absolute top-1/3 left-1/4 size-[70vw] rounded-full bg-[radial-gradient(circle,rgba(255,122,69,0.22),transparent_65%)] blur-3xl animate-drift-a" />
    </div>
  );
}

/** Beating heart logo. */
export function HeartLogo({ size = 84, beating = true }: { size?: number; beating?: boolean }) {
  return (
    <div
      className={clsx('grid place-items-center bg-flame-d shadow-[0_18px_50px_-12px_rgba(255,45,111,0.8)]', beating && 'animate-beat')}
      style={{ width: size, height: size, borderRadius: size * 0.32 }}
    >
      <Heart className="fill-white text-white" style={{ width: size * 0.52, height: size * 0.52 }} />
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={clsx('flex items-center gap-1.5 font-black tracking-tight', className)} dir="ltr">
      <span className="text-flame text-[26px] leading-none">Vibe</span>
      <span className="grid size-2 place-items-center rounded-full bg-ember" />
    </div>
  );
}

// ---- images ----------------------------------------------------------------------------------

/** Image with its dominant colour as placeholder and a soft fade-in. */
export function Img({ src, color, className, alt = '', blur }: { src?: string | null; color?: string | null; className?: string; alt?: string; blur?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div
      className={clsx('overflow-hidden', !/\b(absolute|fixed)\b/.test(className ?? '') && 'relative', className)}
      style={{ backgroundColor: color ?? 'var(--color-surface-3)' }}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={clsx('absolute inset-0 size-full object-cover transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0', blur && 'scale-110 blur-xl')}
        />
      ) : null}
    </div>
  );
}

export function Avatar({
  src,
  name,
  size = 48,
  online,
  ring,
  className,
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  online?: boolean;
  ring?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx('relative shrink-0', className)} style={{ width: size, height: size }}>
      <div className={clsx('size-full rounded-full', ring && 'bg-flame-d p-[2.5px]')}>
        <div className={clsx('size-full overflow-hidden rounded-full bg-surface-3', ring && 'ring-2 ring-night')}>
          {src ? (
            <Img src={src} className="size-full" />
          ) : (
            <div className="grid size-full place-items-center text-muted font-bold" style={{ fontSize: size * 0.38 }}>
              {name?.trim()[0] ?? '؟'}
            </div>
          )}
        </div>
      </div>
      {online ? (
        <span
          className="absolute bottom-[4%] left-[4%] rounded-full bg-mint ring-[2.5px] ring-night"
          style={{ width: Math.max(10, size * 0.22), height: Math.max(10, size * 0.22) }}
        />
      ) : null}
    </div>
  );
}

// ---- small pieces ----------------------------------------------------------------------------

export const PremiumBadge = ({ size = 18 }: { size?: number }) => (
  <Crown className="shrink-0 fill-gold text-gold" style={{ width: size, height: size }} aria-label="ویژه" />
);

export function Pill({ children, className, emoji }: { children: ReactNode; className?: string; emoji?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-white/15 px-3 py-1.5 text-[12.5px] font-medium backdrop-blur-md', className)}>
      {emoji ? <span className="text-[13px]">{emoji}</span> : null}
      {children}
    </span>
  );
}

/** Toggleable chip for option lists (interests, goals). */
export function Chip({ label, emoji, selected, onClick, className }: { label: string; emoji?: string; selected: boolean; onClick: () => void; className?: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={() => {
        haptic.select();
        onClick();
      }}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2.5 text-[13.5px] font-medium transition-colors',
        selected ? 'bg-flame text-white shadow-[0_6px_20px_-8px_rgba(255,45,111,0.8)]' : 'border border-line bg-surface-2 text-ink',
        className,
      )}
    >
      {emoji ? <span className="text-[15px] leading-none">{emoji}</span> : null}
      {label}
    </motion.button>
  );
}

/** Big tappable card for single choices (gender, goal). */
export function ChoiceCard({ title, emoji, subtitle, selected, onClick }: { title: string; emoji?: string; subtitle?: string; selected: boolean; onClick: () => void }) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={() => {
        haptic.select();
        onClick();
      }}
      className={clsx(
        'flex w-full items-center gap-3.5 rounded-card px-4 py-4 text-right transition-colors',
        selected ? 'border-2 border-rose bg-rose/15' : 'border border-line bg-surface-1',
      )}
    >
      {emoji ? <span className="text-[28px] leading-none">{emoji}</span> : null}
      <span className="flex-1">
        <span className="block text-[16px] font-semibold">{title}</span>
        {subtitle ? <span className="block text-[12px] text-muted">{subtitle}</span> : null}
      </span>
      <span className={clsx('grid size-[22px] place-items-center rounded-full', selected ? 'bg-flame-d' : 'border-2 border-faint')}>
        {selected ? <span className="size-2 rounded-full bg-white" /> : null}
      </span>
    </motion.button>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        haptic.select();
        onChange(!checked);
      }}
      className={clsx('relative h-[30px] w-[52px] shrink-0 rounded-full transition-colors', checked ? 'bg-rose' : 'bg-surface-3', disabled && 'opacity-50')}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 600, damping: 35 }}
        className={clsx('absolute top-[3px] size-6 rounded-full shadow', checked ? 'left-[3px] bg-white' : 'right-[3px] bg-muted')}
      />
    </button>
  );
}

export function IconTile({ children, tint = 'rose' }: { children: ReactNode; tint?: 'rose' | 'violet' | 'sky' | 'gold' | 'mint' | 'ember' | 'danger' }) {
  const cls = {
    rose: 'bg-rose/15 text-rose',
    violet: 'bg-violet/15 text-violet',
    sky: 'bg-sky/15 text-sky',
    gold: 'bg-gold/15 text-gold',
    mint: 'bg-mint/15 text-mint',
    ember: 'bg-ember/15 text-ember',
    danger: 'bg-danger/15 text-danger',
  }[tint];
  return <span className={clsx('grid size-10 shrink-0 place-items-center rounded-[14px] [&>svg]:size-5', cls)}>{children}</span>;
}

export function Row({
  icon,
  tint,
  title,
  subtitle,
  onClick,
  trailing,
  chevron = true,
}: {
  icon?: ReactNode;
  tint?: Parameters<typeof IconTile>[0]['tint'];
  title: ReactNode;
  subtitle?: ReactNode;
  onClick?: () => void;
  trailing?: ReactNode;
  chevron?: boolean;
}) {
  return (
    <button
      onClick={() => {
        if (onClick) haptic.select();
        onClick?.();
      }}
      className="flex w-full items-center gap-3.5 px-4 py-3 text-right active:bg-white/[0.04] transition-colors"
    >
      {icon ? <IconTile tint={tint}>{icon}</IconTile> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{title}</span>
        {subtitle ? <span className="block truncate text-[12.5px] text-muted">{subtitle}</span> : null}
      </span>
      {trailing}
      {chevron && onClick ? <ChevronLeft className="size-5 shrink-0 text-faint" /> : null}
    </button>
  );
}

export function ToggleRow({
  icon,
  tint,
  title,
  subtitle,
  checked,
  onChange,
  disabled,
  badge,
}: {
  icon?: ReactNode;
  tint?: Parameters<typeof IconTile>[0]['tint'];
  title: string;
  subtitle?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  badge?: ReactNode;
}) {
  return (
    <div onClick={() => !disabled && onChange(!checked)} className="flex w-full items-center gap-3.5 px-4 py-3">
      {icon ? <IconTile tint={tint}>{icon}</IconTile> : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[15px] font-medium">
          {title}
          {badge}
        </span>
        {subtitle ? <span className="block text-[12.5px] text-muted">{subtitle}</span> : null}
      </span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export const Divider = ({ inset = true }: { inset?: boolean }) => <div className={clsx('h-px bg-line', inset && 'mr-[70px]')} />;

/**
 * The one heading that separates sections anywhere in the app. `trailing` holds a link or counter
 * on the opposite side; `tight` drops the top space for a heading that already follows a gap.
 */
export function SectionTitle({
  children,
  className,
  trailing,
  tight,
}: {
  children: ReactNode;
  className?: string;
  trailing?: ReactNode;
  tight?: boolean;
}) {
  return (
    <div className={clsx('flex items-center gap-2 px-1 pb-2', tight ? 'pt-0' : 'pt-5', className)}>
      <h3 className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-muted">{children}</h3>
      {trailing ? <span className="ms-auto shrink-0">{trailing}</span> : null}
    </div>
  );
}

/** Screen title bar. Telegram's action bar above shows Back/Close, so there is no back arrow here. */
export function ScreenHeader({ title, actions, sub, className }: { title: ReactNode; actions?: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <header className={clsx('flex shrink-0 items-center gap-2 px-4 pt-3 pb-2', className)}>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[22px] font-extrabold leading-tight">{title}</h1>
        {sub ? <p className="truncate text-[12.5px] text-muted">{sub}</p> : null}
      </div>
      {actions}
    </header>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-7 animate-spin text-rose', className)} />;
}

export function Loading({ className }: { className?: string }) {
  return (
    <div className={clsx('grid flex-1 place-items-center py-16', className)}>
      <Spinner />
    </div>
  );
}

/**
 * The small version of EmptyState, for an empty list inside a sheet or a section — where the full
 * one would be too loud.
 */
export function EmptyNote({ emoji, title, subtitle, className }: { emoji?: string; title: string; subtitle?: string; className?: string }) {
  return (
    <div className={clsx('px-4 py-10 text-center', className)}>
      {emoji ? <div className="text-[34px] leading-none">{emoji}</div> : null}
      <p className={clsx('text-[14px] font-semibold', emoji && 'mt-2')}>{title}</p>
      {subtitle ? <p className="mt-1 text-[12.5px] leading-6 text-muted">{subtitle}</p> : null}
    </div>
  );
}

export function EmptyState({ emoji, title, subtitle, action, className }: { emoji: string; title: string; subtitle?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-1 flex-col items-center justify-center px-8 py-12 text-center', className)}>
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        className="relative grid size-28 place-items-center rounded-full bg-surface-2 text-[46px]"
      >
        <span className="absolute inset-0 rounded-full border border-rose/30 animate-ping-slow" />
        {emoji}
      </motion.div>
      <h2 className="mt-6 text-[19px] font-bold">{title}</h2>
      {subtitle ? <p className="mt-2 text-[14px] leading-7 text-muted">{subtitle}</p> : null}
      {action ? <div className="mt-6 w-full max-w-xs">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <EmptyState
      emoji="📡"
      title="مشکلی پیش آمد"
      subtitle={message}
      action={
        <Button variant="soft" size="md" className="w-full" onClick={onRetry}>
          تلاش دوباره
        </Button>
      }
    />
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={clsx('h-2 overflow-hidden rounded-full bg-surface-3', className)}>
      <motion.div
        className="h-full rounded-full bg-flame"
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(4, Math.min(100, value * 100))}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
      />
    </div>
  );
}
