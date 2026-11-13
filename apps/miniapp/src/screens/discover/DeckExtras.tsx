import { ChevronLeft, Gift, Megaphone, RefreshCw, Shuffle, SlidersHorizontal } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { keys, queryClient, useMe, useMeta, useVibeNight } from '@/api/queries';
import type { VibeNight } from '@/api/types';
import { fa } from '@/lib/format';
import { nav } from '@/store/nav';
import { toast } from '@/store/ui';
import { haptic } from '@/telegram/tg';

/** «۱ ساعت و ۲۰ دقیقه» until `iso`. */
function untilText(iso: string): string {
  const min = Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${fa(m)} دقیقه`;
  return m ? `${fa(h)} ساعت و ${fa(m)} دقیقه` : `${fa(h)} ساعت`;
}

/** «۲۳:۰۰» (Tehran) of a time. */
function clockText(iso: string): string {
  return fa(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));
}

/** «ساعت ۲۱» (Tehran) of a start time. */
function startHourText(iso: string): string {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: 'numeric', hourCycle: 'h23' }).format(new Date(iso));
  return `ساعت ${fa(Number(hour))}`;
}

/**
 * «شب Vibe» on the home screen: tonight's state, and the gift for showing up (a toast, once).
 * Returns the night so the empty deck can talk about it too.
 */
export function useNightGift(active: boolean): VibeNight | undefined {
  const night = useVibeNight(active).data;
  const toasted = useRef<string | null>(null);
  useEffect(() => {
    if (!night?.granted || toasted.current === night.startsAt) return;
    toasted.current = night.startsAt;
    haptic.success();
    toast(`شب Vibe: ${fa(night.granted)} سوپرلایک هدیه گرفتی ⭐`, '🌙', 'success');
    void queryClient.invalidateQueries({ queryKey: keys.me });
  }, [night]);
  return night;
}

/**
 * A slim line under the header: «شب Vibe» while it's on, otherwise a note when the cards come from
 * further away than the user asked (their own area had nobody new).
 */
export function InfoStrip({ night, widened }: { night?: VibeNight; widened: 'province' | 'country' | 'recycled' | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!night?.active) return;
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [night?.active]);

  let content: ReactNode = null;
  if (night?.active) {
    content = (
      <div className="flex h-9 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border border-violet/30 bg-gradient-to-l from-violet/25 via-rose/15 to-violet/10 px-3.5 text-[12.5px]">
        <span className="shrink-0 text-[15px]">🌙</span>
        <b className="shrink-0 font-bold">شب Vibe</b>
        <span className="min-w-0 truncate text-muted">· الان شلوغ‌ترین وقته</span>
        <span className="ms-auto shrink-0 text-[11.5px] text-ink/70" title={`${untilText(night.endsAt)} مونده`}>
          تا {clockText(night.endsAt)}
        </span>
      </div>
    );
  } else if (widened) {
    content = (
      <div className="flex h-9 items-center gap-2 rounded-full border border-line bg-surface-1 px-3.5 text-[12.5px] text-muted">
        <span className="text-[14px]">{widened === 'recycled' ? '🔄' : widened === 'country' ? '🌍' : '📍'}</span>
        <span className="truncate">
          {widened === 'recycled'
            ? 'همه رو دیدی؛ کسایی که قبلاً رد کرده بودی دوباره میان'
            : `نزدیکت آدم جدیدی نبود؛ از ${widened === 'country' ? 'کل ایران' : 'کل استانت'} هم نشونت می‌دیم`}
        </span>
      </div>
    );
  }
  return (
    <AnimatePresence initial={false}>
      {content ? (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="shrink-0 px-4 pb-1.5">
          {content}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Option({ icon, title, subtitle, onClick, tone }: { icon: ReactNode; title: string; subtitle: string; onClick: () => void; tone: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
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

/**
 * Everyone has been seen: never a dead end. Something to do right now (random chat, the Wall,
 * invites), when it gets busier (Vibe Night), and a way to look again.
 */
export function DeckEmpty({ night, onFilters, onRetry }: { night?: VibeNight; onFilters: () => void; onRetry: () => void }) {
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

      {night?.enabled ? (
        <div className="mt-3 rounded-card border border-violet/30 bg-gradient-to-l from-violet/20 to-rose/10 px-4 py-3 text-[12.5px] leading-6">
          {night.active ? (
            <>
              🌙 <b>الان شب Vibe ـه!</b> بیشترین آدم‌ها همین الان آنلاینن؛ چت تصادفی بهترین انتخابه.
            </>
          ) : (
            <>
              🌙 <b>شب Vibe</b> امشب {startHourText(night.startsAt)}؛ شلوغ‌ترین وقت روز
              {night.bonus ? ` با ${fa(night.bonus)} سوپرلایک هدیه` : ''}. بهت خبر می‌دیم.
            </>
          )}
        </div>
      ) : null}

      <div className="mt-3 space-y-2.5">
        {meta?.randomChat !== false ? (
          <Option
            icon={<Shuffle className="size-5" />}
            tone="bg-royal text-white"
            title="چت تصادفی"
            subtitle="همین الان با یه نفر آنلاین گپ بزن"
            onClick={() => nav.push({ name: 'random' })}
          />
        ) : null}
        {meta?.wall?.enabled !== false ? (
          <Option
            icon={<Megaphone className="size-5" />}
            tone="bg-rose/15 text-rose"
            title="دیوار"
            subtitle="بنویس دنبال چی هستی تا خودشون بیان سراغت"
            onClick={() => nav.reset('wall')}
          />
        ) : null}
        {meta?.referral.enabled && !me?.premium.active ? (
          <Option
            icon={<Gift className="size-5" />}
            tone="bg-gold/15 text-gold"
            title="دعوت دوستان"
            subtitle="دوستاتو به گروه اضافه کن = چت ناشناس و لایک هدیه"
            onClick={() => nav.push({ name: 'invite' })}
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
