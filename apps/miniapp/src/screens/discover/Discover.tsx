import clsx from 'clsx';
import { Bell, MessageCircle, SlidersHorizontal, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/api/client';
import { keys, queryClient } from '@/api/queries';
import type { Card } from '@/api/types';
import { markHomeTourDone, shouldShowHomeTour } from '@/lib/tour';
import { nav } from '@/store/nav';
import { toast, useUi } from '@/store/ui';
import { haptic } from '@/telegram/tg';
import { Button, EmptyState, IconButton, Spinner } from '@/ui/kit';
import { PullCircle, usePullRefresh } from '@/ui/PullRefresh';
import { Spotlight } from '@/ui/Spotlight';
import { TAB_BAR_SPACE } from '../Shell';
import { DeckEmpty, InfoStrip } from './DeckExtras';
import { useDeck } from './deck';
import { Filters } from './Filters';
import { MessageSheet } from './MessageSheet';
import { ProfileCard } from './ProfileCard';
import { HOME_TOUR } from './tour';

/**
 * The whole app in one screen: a profile, and the two answers there are — write to them, or skip
 * them. No liking, no waiting to be liked back.
 */
export function Discover({ active }: { active: boolean }) {
  const { cards, loading, exhausted, recycled, error, load, skip, reset, refresh } = useDeck();
  const notifications = useUi((s) => s.badges.notifications);
  const tour = useUi((s) => s.tour);
  const [filters, setFilters] = useState(false);
  const [writingTo, setWritingTo] = useState<Card | null>(null);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const current = cards[0];
  const ready = !!current || exhausted;

  // Pull to refresh from the top bar (and from anywhere above the card).
  const zone = useRef<HTMLDivElement>(null);
  const pull = usePullRefresh(zone, () => Promise.allSettled([refresh(), queryClient.refetchQueries({ queryKey: keys.me })]), {
    canStart: (e) => {
      const scroller = (e.target as HTMLElement).closest<HTMLElement>('.overflow-y-auto');
      return !scroller || scroller.scrollTop <= 0;
    },
  });

  // First visit: walk the user through the two buttons.
  useEffect(() => {
    if (!active || !ready || useUi.getState().tour) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    void shouldShowHomeTour().then((show) => {
      if (show && !cancelled) timer = setTimeout(() => useUi.getState().setTour(true), 800);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, ready]);

  const onSkip = async () => {
    if (!current) return;
    haptic.light();
    try {
      await skip(current);
    } catch (e) {
      toast(errorMessage(e), '⚠️', 'error');
    }
  };

  return (
    <div className="flex h-full flex-col" style={{ paddingBottom: TAB_BAR_SPACE }}>
      <div ref={zone} className="relative flex min-h-0 flex-1 flex-col">
        <PullCircle {...pull} />
        <header className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-2">
          <div className="flex-1" />
          <IconButton tour="bell" label="اعلان‌ها" badge={notifications > 0} onClick={() => nav.push({ name: 'notifications' })}>
            <Bell className="size-5" />
          </IconButton>
          <IconButton tour="filters" label="فیلترها" onClick={() => setFilters(true)}>
            <SlidersHorizontal className="size-5" />
          </IconButton>
        </header>

        <InfoStrip recycled={!!current && recycled} />

        <div data-tour={current ? 'card' : undefined} className="relative mx-3 mt-1 min-h-0 flex-1">
          {current ? (
            <AnimatePresence initial={false}>
              {cards
                .slice(0, 2)
                .reverse()
                .map((c) => (
                  <ProfileCard
                    key={c.id}
                    card={c}
                    top={c.id === current.id}
                    onOpen={() => nav.push({ name: 'profile', userId: c.id, card: c, actions: 'discover' })}
                  />
                ))}
            </AnimatePresence>
          ) : loading ? (
            <Searching />
          ) : error ? (
            <EmptyState
              emoji="📡"
              title="مشکلی پیش آمد"
              subtitle={error}
              action={
                <Button variant="soft" className="w-full" onClick={() => load(true)}>
                  تلاش دوباره
                </Button>
              }
            />
          ) : exhausted ? (
            <DeckEmpty onFilters={() => setFilters(true)} onRetry={() => void reset()} />
          ) : (
            <Searching />
          )}
        </div>
      </div>

      {/* the only two answers there are */}
      <div className={clsx('flex shrink-0 items-center justify-center gap-4 px-6 pt-4 pb-3 transition-opacity', !current && 'pointer-events-none opacity-40')}>
        <RoundAction tour="skip" size={64} ring="border-danger/50" onClick={onSkip} label="رد کردن">
          <X className="size-8 text-danger" strokeWidth={2.6} />
        </RoundAction>
        <button
          data-tour="message"
          aria-label="پیام"
          onClick={() => {
            if (!current) return;
            haptic.light();
            setWritingTo(current);
          }}
          className="flex h-16 flex-1 items-center justify-center gap-2.5 rounded-full bg-flame-d text-[17px] font-extrabold text-white shadow-[0_14px_36px_-10px_rgba(255,45,111,0.9)] transition-transform active:scale-95"
        >
          <MessageCircle className="size-6 fill-white/20" />
          پیام بده
        </button>
      </div>

      <Filters open={filters} onClose={() => setFilters(false)} />
      <MessageSheet card={writingTo} onClose={() => setWritingTo(null)} />
      <Spotlight
        steps={HOME_TOUR}
        open={tour && active}
        onClose={() => {
          markHomeTourDone();
          useUi.getState().setTour(false);
        }}
      />
    </div>
  );
}

function RoundAction({
  children,
  size,
  ring,
  onClick,
  label,
  tour,
}: {
  tour?: string;
  children: ReactNode;
  size: number;
  ring?: string;
  onClick: () => void;
  label: string;
}) {
  return (
    <motion.button
      aria-label={label}
      data-tour={tour}
      whileTap={{ scale: 0.86 }}
      transition={{ type: 'spring', stiffness: 600, damping: 20 }}
      onClick={onClick}
      className={clsx('relative grid shrink-0 place-items-center rounded-full border-2 bg-surface-1', ring)}
      style={{ width: size, height: size }}
    >
      {children}
    </motion.button>
  );
}

function Searching() {
  return (
    <div className="grid size-full place-items-center">
      <div className="relative grid size-40 place-items-center">
        <span className="absolute inset-0 rounded-full border border-rose/40 animate-ping-slow" />
        <span className="absolute inset-4 rounded-full border border-violet/40 animate-ping-slow [animation-delay:0.8s]" />
        <div className="grid size-20 place-items-center rounded-full bg-flame-d shadow-[0_0_60px_rgba(255,45,111,0.6)]">
          <Spinner className="text-white" />
        </div>
      </div>
    </div>
  );
}
