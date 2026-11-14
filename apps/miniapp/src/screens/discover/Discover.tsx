import clsx from 'clsx';
import { Bell, Heart, RotateCcw, SlidersHorizontal, Star, X, Zap } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '@/api/client';
import { keys, queryClient, useMe, useMeta } from '@/api/queries';
import { fa } from '@/lib/format';
import { nav } from '@/store/nav';
import { toast, useUi } from '@/store/ui';
import { haptic } from '@/telegram/tg';
import { Button, EmptyState, IconButton, Spinner } from '@/ui/kit';
import { Spotlight } from '@/ui/Spotlight';
import { markHomeTourDone, shouldShowHomeTour } from '@/lib/tour';
import { PullCircle, usePullRefresh } from '@/ui/PullRefresh';
import { Sheet } from '@/ui/Sheet';
import { TAB_BAR_SPACE } from '../Shell';
import { DeckEmpty, InfoStrip, useNightGift } from './DeckExtras';
import { type SwipeAction, useDeck } from './deck';
import { Filters } from './Filters';
import { SwipeCard, type SwipeCardHandle } from './SwipeCard';
import { HOME_TOUR } from './tour';

export function Discover({ active }: { active: boolean }) {
  const { cards, loading, exhausted, widened, error, load, swipe, rewind, reset, refresh, limit, clearLimit } = useDeck();
  const night = useNightGift(active);
  const me = useMe().data;
  const notifications = useUi((s) => s.badges.notifications);
  const newLikes = useUi((s) => s.badges.likes);
  const tour = useUi((s) => s.tour);
  // Each card hands its own handle in, keyed by its id. They must not share one ref: a card that
  // has just been swiped lingers a moment (AnimatePresence) and, when it finally goes, would clear a
  // shared ref that already points at the next card; the buttons then did nothing until something
  // else made this screen render again.
  const handles = useRef(new Map<string, SwipeCardHandle>());
  const [filters, setFilters] = useState(false);
  const [busy, setBusy] = useState(false);

  // Pull to refresh from the top bar (and from anywhere above the card). The card itself is
  // swiped in every direction, so a touch that starts on it never pulls.
  const zone = useRef<HTMLDivElement>(null);
  const pull = usePullRefresh(
    zone,
    () => Promise.allSettled([refresh(), queryClient.refetchQueries({ queryKey: keys.me }), queryClient.refetchQueries({ queryKey: keys.vibeNight })]),
    {
      canStart: (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('[data-no-pull]')) return false;
        // the «everyone seen» page scrolls: only from its top
        const scroller = t.closest<HTMLElement>('.overflow-y-auto');
        return !scroller || scroller.scrollTop <= 0;
      },
    },
  );

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const premium = !!me?.premium.active;
  const superLeft = (me?.limits.superLikesLeft ?? 0) + (me?.limits.bonusSuperLikes ?? 0);
  const boosting = !!me?.boostUntil && new Date(me.boostUntil) > new Date();
  const current = cards[0];
  // the page is ready for the tour once the first cards arrived (or there are none to show)
  const ready = !!current || exhausted;

  // First visit: walk the user through the buttons under the card.
  useEffect(() => {
    if (!active || !ready || useUi.getState().tour) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    void shouldShowHomeTour().then((show) => {
      if (show && !cancelled) timer = setTimeout(() => !useUi.getState().match && useUi.getState().setTour(true), 800);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, ready]);

  const onSwiped = async (action: SwipeAction) => {
    if (!current) return;
    try {
      await swipe(current, action);
    } catch (e) {
      toast(errorMessage(e), '⚠️', 'error');
    }
  };

  const press = (action: SwipeAction) => {
    if (!current || busy) return;
    if (action === 'superlike' && superLeft <= 0) {
      useDeck.setState({ limit: { kind: 'superlike' } });
      return;
    }
    const handle = handles.current.get(current.id);
    // never silently nothing: without a handle, record the answer straight away
    if (handle) handle.fling(action);
    else void onSwiped(action);
  };

  const doRewind = async () => {
    if (!premium) return nav.push({ name: 'premium', reason: 'rewind' });
    setBusy(true);
    try {
      await rewind();
      haptic.success();
    } catch (e) {
      toast(e instanceof ApiError && e.code === 'nothing_to_rewind' ? 'فقط آخرین «نه» قابل برگشته' : errorMessage(e), '↩️');
    } finally {
      setBusy(false);
    }
  };

  const boostCredits = me?.boost?.credits ?? 0;
  const doBoost = async () => {
    if (boosting) return toast('بوستت فعاله؛ الان اول از همه دیده می‌شی 🚀');
    // nothing to spend: the store (one-off boosts; members get a free one every day)
    if (!me?.boost?.freeAvailable && boostCredits <= 0) return nav.push({ name: 'premium', reason: 'boost' });
    try {
      const r = await api.post<{ usedCredit: boolean; boostCredits: number }>('/v1/boost');
      haptic.success();
      toast(
        r.usedCredit ? `بوست فعال شد! ${fa(r.boostCredits)} بوست دیگه داری 🚀` : 'بوست فعال شد! تا نیم ساعت اول از همه دیده می‌شی 🚀',
        '⚡',
        'success',
      );
      void queryClient.invalidateQueries({ queryKey: keys.me });
    } catch (e) {
      toast(errorMessage(e), '⚡');
      if (e instanceof ApiError && e.code === 'boost_required') nav.push({ name: 'premium', reason: 'boost' });
    }
  };

  return (
    <div className="flex h-full flex-col" style={{ paddingBottom: TAB_BAR_SPACE }}>
      <div ref={zone} className="relative flex min-h-0 flex-1 flex-col">
        <PullCircle {...pull} />
        <header className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-2">
          <div className="flex-1" />
          <IconButton label="لایک‌ها" badge={newLikes} onClick={() => nav.push({ name: 'likes' })}>
            <Heart className={clsx('size-5', newLikes > 0 && 'fill-rose text-rose')} />
          </IconButton>
          <IconButton tour="bell" label="اعلان‌ها" badge={notifications > 0} onClick={() => nav.push({ name: 'notifications' })}>
            <Bell className="size-5" />
          </IconButton>
          <IconButton tour="filters" label="فیلترها" onClick={() => setFilters(true)}>
            <SlidersHorizontal className="size-5" />
          </IconButton>
        </header>

        <InfoStrip night={night} widened={current ? widened : null} />

        <div data-tour={current ? 'card' : undefined} data-no-pull={current ? '' : undefined} className="relative mx-3 mt-1 min-h-0 flex-1">
          {current ? (
            <AnimatePresence initial={false}>
              {cards.slice(0, 2).reverse().map((c) => (
                <SwipeCard
                  key={c.id}
                  ref={(h) => {
                    if (h) handles.current.set(c.id, h);
                    else handles.current.delete(c.id);
                  }}
                  card={c}
                  top={c.id === current.id}
                  onSwiped={onSwiped}
                  onOpen={() => nav.push({ name: 'profile', userId: c.id, card: c, actions: 'swipe' })}
                />
              ))}
            </AnimatePresence>
          ) : loading ? (
            <Searching />
          ) : error ? (
            <EmptyState emoji="📡" title="مشکلی پیش آمد" subtitle={error} action={<Button variant="soft" className="w-full" onClick={() => load(true)}>تلاش دوباره</Button>} />
          ) : exhausted ? (
            <DeckEmpty night={night} onFilters={() => setFilters(true)} onRetry={() => void reset()} />
          ) : (
            <Searching />
          )}
        </div>
      </div>

      {/* left-to-right on purpose: «نه» on the left, «لایک» on the right, like the swipe directions */}
      <div dir="ltr" className={clsx('flex shrink-0 items-center justify-center gap-3.5 px-4 pt-4 pb-3 transition-opacity', !current && 'pointer-events-none opacity-40')}>
        <RoundAction tour="rewind" size={52} ring="border-gold/50" onClick={doRewind} label="برگشت">
          <RotateCcw className="size-6 text-gold" />
        </RoundAction>
        <RoundAction tour="pass" size={66} ring="border-danger/50" onClick={() => press('pass')} label="نه">
          <X className="size-8 text-danger" strokeWidth={2.6} />
        </RoundAction>
        <RoundAction tour="superlike" size={56} ring="border-sky/50" onClick={() => press('superlike')} label="سوپرلایک" badge={superLeft}>
          <Star className="size-6 fill-sky text-sky" />
        </RoundAction>
        <RoundAction tour="like" size={66} filled onClick={() => press('like')} label="لایک">
          <Heart className="size-8 fill-white text-white" />
        </RoundAction>
        <RoundAction
          tour="boost"
          size={52}
          ring={boosting ? 'border-violet shadow-[0_0_24px_rgba(139,92,246,0.7)]' : 'border-violet/50'}
          onClick={doBoost}
          label="بوست"
          badge={boosting ? undefined : boostCredits}
        >
          <Zap className={clsx('size-6 text-violet', boosting && 'fill-violet')} />
        </RoundAction>
      </div>

      <Filters open={filters} onClose={() => setFilters(false)} />
      <LimitSheet limit={limit} onClose={clearLimit} />
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
  filled,
  onClick,
  label,
  badge,
  tour,
}: {
  tour?: string;
  children: ReactNode;
  size: number;
  ring?: string;
  filled?: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
}) {
  return (
    <motion.button
      aria-label={label}
      data-tour={tour}
      whileTap={{ scale: 0.86 }}
      transition={{ type: 'spring', stiffness: 600, damping: 20 }}
      onClick={onClick}
      className={clsx(
        'relative grid shrink-0 place-items-center rounded-full',
        filled ? 'bg-flame-d shadow-[0_12px_32px_-8px_rgba(255,45,111,0.85)]' : clsx('border-2 bg-surface-1', ring),
      )}
      style={{ width: size, height: size }}
    >
      {children}
      {badge !== undefined && badge > 0 ? (
        <span className="absolute -top-1 -left-1 grid h-5 min-w-5 place-items-center rounded-full bg-sky px-1 text-[10.5px] font-bold text-night">{fa(badge)}</span>
      ) : null}
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

type Limit = { kind: 'like' | 'likeDaily' | 'superlike'; resetInSeconds?: number } | null;

/**
 * A like or super like was refused. A man whose free likes are used up has two ways forward (add
 * friends to the group, or go premium); for a daily cap, just «tomorrow».
 */
function LimitSheet({ limit, onClose }: { limit: Limit; onClose: () => void }) {
  const meta = useMeta().data;
  const me = useMe().data;
  const hours = limit?.resetInSeconds ? Math.max(1, Math.round(limit.resetInSeconds / 3600)) : null;
  const member = !!me?.premium.active;
  // a cap that refills by itself: nothing to sell, only when it comes back
  const waits = limit?.kind === 'likeDaily' || (limit?.kind === 'superlike' && member);
  const invite = limit?.kind === 'like' && !!meta?.referral.enabled;
  const go = (to: () => void) => {
    onClose();
    to();
  };
  const title =
    limit?.kind === 'superlike'
      ? member
        ? 'سوپرلایک‌های امروزت تموم شد'
        : 'سوپرلایک‌های رایگانت تموم شد'
      : limit?.kind === 'likeDaily'
        ? 'لایک‌های امروزت تموم شد'
        : 'لایک‌های رایگانت تموم شد';
  const text = waits
    ? `${hours ? `${fa(hours)} ساعت دیگه` : 'فردا'} دوباره می‌تونی. تا اون موقع کارت‌ها رو ببین و رد کن.`
    : limit?.kind === 'superlike'
      ? 'اعضای ویژه هر روز سوپرلایک دارن و جلوتر از بقیه دیده می‌شن.'
      : invite
        ? 'دوستاتو به گروه Vibe اضافه کن و لایک هدیه بگیر، یا با عضویت ویژه خیلی بیشتر لایک کن.'
        : 'با عضویت ویژه خیلی بیشتر لایک کن.';
  return (
    <Sheet open={!!limit} onClose={onClose}>
      <div className="flex flex-col items-center pt-2 text-center">
        <div className="grid size-20 place-items-center rounded-full bg-surface-2 text-[40px]">{limit?.kind === 'superlike' ? '⭐' : '💔'}</div>
        <h2 className="mt-4 text-[20px] font-extrabold">{title}</h2>
        <p className="mt-2 text-[14px] leading-7 text-muted">{text}</p>
        {waits ? (
          <Button variant="soft" className="mt-6 w-full" onClick={onClose}>
            باشه
          </Button>
        ) : (
          <>
            {invite ? (
              <Button variant="royal" className="mt-6 w-full" onClick={() => go(() => nav.push({ name: 'invite' }))}>
                🎁 دوستاتو اضافه کن = لایک رایگان
              </Button>
            ) : null}
            <Button variant="gold" className={invite ? 'mt-3 w-full' : 'mt-6 w-full'} onClick={() => go(() => nav.push({ name: 'premium', reason: limit?.kind }))}>
              {limit?.kind === 'superlike' ? '💎 سوپرلایک هر روز با عضویت ویژه' : '💎 لایک بیشتر با عضویت ویژه'}
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
