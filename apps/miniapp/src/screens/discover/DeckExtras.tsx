import { ChevronLeft, Megaphone, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useMe, useMeta } from '@/api/queries';
import { nav } from '@/store/nav';
import { haptic } from '@/telegram/tg';

/** A slim line under the header, only when the cards aren't all fresh. */
export function InfoStrip({ recycled }: { recycled: boolean }) {
  if (!recycled) return <div className="h-1 shrink-0" />;
  return (
    <div className="mx-3 mt-1 shrink-0 rounded-card border border-gold/25 bg-gold/[0.08] px-3.5 py-2 text-[12.5px] leading-6 text-ink/90">
      ↩️ همه رو دیده بودی؛ آدم‌هایی که قبلاً رد کرده بودی دوباره نشونت می‌دیم
    </div>
  );
}

function Option({ icon, title, subtitle, tone, onClick }: { icon: ReactNode; title: string; subtitle: string; tone: string; onClick: () => void }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={() => {
        haptic.light();
        onClick();
      }}
      className="flex w-full items-center gap-3 rounded-card border border-line bg-surface-1 p-3 text-right"
    >
      <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${tone}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-bold">{title}</span>
        <span className="block truncate text-[12px] text-muted">{subtitle}</span>
      </span>
      <ChevronLeft className="size-5 shrink-0 text-faint" />
    </motion.button>
  );
}

/** Everyone has been seen: never a dead end. */
export function DeckEmpty({ onFilters, onRetry }: { onFilters: () => void; onRetry: () => void }) {
  const meta = useMeta().data;
  const me = useMe().data;
  const narrow = !!me && me.preferences.ageSet && me.preferences.maxAge - me.preferences.minAge < 8;
  return (
    <div className="no-scrollbar flex size-full flex-col overflow-y-auto px-1 py-3">
      <div className="text-center">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-[46px] leading-none">
          ✨
        </motion.div>
        <h2 className="mt-2 text-[19px] font-extrabold">فعلاً همه رو دیدی!</h2>
        <p className="mt-1 text-[13px] leading-6 text-muted">آدم‌های جدید هر روز میان. تا اون موقع:</p>
      </div>

      <div className="mt-3 space-y-2.5">
        {meta?.wall?.enabled !== false ? (
          <Option
            icon={<Megaphone className="size-5" />}
            tone="bg-rose/15 text-rose"
            title="دیوار"
            subtitle="بنویس دنبال چی هستی تا خودشون بیان سراغت"
            onClick={() => nav.reset('wall')}
          />
        ) : null}
        {narrow ? (
          <Option
            icon={<SlidersHorizontal className="size-5" />}
            tone="bg-sky/15 text-sky"
            title="فیلترها رو بازتر کن"
            subtitle="بازه‌ی سنی بازتر یعنی آدم‌های بیشتر"
            onClick={onFilters}
          />
        ) : null}
      </div>

      <button onClick={onRetry} className="mx-auto mt-4 flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">
        <RefreshCw className="size-3.5" /> دوباره بگرد
      </button>
    </div>
  );
}
