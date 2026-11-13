import clsx from 'clsx';
import { Briefcase, Cigarette, Flag, GraduationCap, Heart, MapPin, MoreHorizontal, Ruler, ShieldBan, Sparkles, Star, X } from 'lucide-react';
import { motion } from 'motion/react';
import { type MouseEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@/api/client';
import { useMe, useMeta, useUser } from '@/api/queries';
import type { Card } from '@/api/types';
import { fa, lastSeen } from '@/lib/format';
import { nav } from '@/store/nav';
import { toast } from '@/store/ui';
import { haptic } from '@/telegram/tg';
import { confirmDialog } from '@/ui/Dialog';
import { EmptyState, Img, Loading, Pill, PremiumBadge, Row, SectionTitle } from '@/ui/kit';
import { Sheet } from '@/ui/Sheet';
import { type SwipeAction, useDeck } from '../discover/deck';
import { ReportSheet } from './ReportSheet';
import { PullRefresh } from '@/ui/PullRefresh';

/** Someone's full profile: photos, about, basics, interests; like/pass from here too. */
export default function Profile({ userId, initial, actions }: { userId: string; initial?: Card; actions: 'swipe' | 'none' }) {
  const q = useUser(userId, initial);
  const me = useMe().data;
  const isMe = me?.id === userId;
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState(false);

  // opening someone's profile — not loading their card for a chat header — is «looking»:
  // the server tells a match the first time it happens
  useEffect(() => {
    if (!me || isMe) return;
    api.post(`/v1/users/${userId}/viewed`).catch(() => undefined);
  }, [userId, isMe, me]);

  if (q.isLoading && !q.data) return <Loading />;
  if (!q.data) return <EmptyState emoji="🙈" title="این پروفایل در دسترس نیست" subtitle="شاید حسابش رو حذف کرده یا مسدود شده." />;
  const c = q.data;

  const act = async (action: SwipeAction) => {
    haptic.medium();
    nav.pop();
    try {
      await useDeck.getState().swipe(c, action);
    } catch (e) {
      toast(errorMessage(e), '⚠️', 'error');
    }
  };

  const block = async () => {
    setMenu(false);
    if (!(await confirmDialog(`${c.name} مسدود شود؟`, 'مسدود کن', true))) return;
    await api.post('/v1/blocks', { userId: c.id }).catch(() => undefined);
    toast('مسدود شد', '🚫');
    nav.pop();
  };

  return (
    <div className="relative flex h-full flex-col">
      <PullRefresh onRefresh={() => q.refetch()} className="no-scrollbar min-h-0 flex-1 overflow-y-auto" style={{ paddingBottom: actions === 'swipe' && !isMe ? 120 : 24 }}>
        <Gallery card={c} />
        <div className="px-5 pt-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-[28px] font-extrabold">{c.name}</h1>
                {c.age ? <span className="text-[26px] font-light tabular">{fa(c.age)}</span> : null}
                {c.premium ? <PremiumBadge /> : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-muted">
                {c.city ? (
                  <span className="flex items-center gap-1">
                    <MapPin className="size-4" />
                    {[c.city, c.distanceKm != null ? `${fa(c.distanceKm)} کیلومتر` : null].filter(Boolean).join('، ')}
                  </span>
                ) : null}
                <span className={clsx('flex items-center gap-1.5', c.online && 'text-mint')}>
                  <span className={clsx('size-2 rounded-full', c.online ? 'bg-mint' : 'bg-faint')} />
                  {lastSeen(c.lastActiveAt, c.online)}
                </span>
              </div>
            </div>
            {!isMe ? (
              <button aria-label="گزینه‌ها" onClick={() => setMenu(true)} className="grid size-10 place-items-center rounded-full bg-surface-2">
                <MoreHorizontal className="size-5" />
              </button>
            ) : null}
          </div>
          <Details card={c} />
        </div>
      </PullRefresh>

      {actions === 'swipe' && !isMe ? (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-5 bg-gradient-to-t from-night via-night/90 to-transparent pt-10 pb-safe">
          <div className="mb-4 flex items-center gap-5">
            <motion.button whileTap={{ scale: 0.86 }} aria-label="نه" onClick={() => act('pass')} className="grid size-16 place-items-center rounded-full border-2 border-danger/50 bg-surface-1">
              <X className="size-8 text-danger" strokeWidth={2.6} />
            </motion.button>
            <motion.button whileTap={{ scale: 0.86 }} aria-label="سوپرلایک" onClick={() => act('superlike')} className="grid size-14 place-items-center rounded-full border-2 border-sky/50 bg-surface-1">
              <Star className="size-6 fill-sky text-sky" />
            </motion.button>
            <motion.button whileTap={{ scale: 0.86 }} aria-label="لایک" onClick={() => act('like')} className="grid size-16 place-items-center rounded-full bg-flame-d shadow-[0_12px_32px_-8px_rgba(255,45,111,0.85)]">
              <Heart className="size-8 fill-white text-white" />
            </motion.button>
          </div>
        </div>
      ) : null}

      <Sheet open={menu} onClose={() => setMenu(false)}>
        <div className="-mx-5 divide-y divide-line">
          <Row icon={<Flag />} tint="danger" title={`گزارش ${c.name}`} onClick={() => (setMenu(false), setReport(true))} chevron={false} />
          <Row icon={<ShieldBan />} tint="danger" title="مسدود کردن" onClick={block} chevron={false} />
        </div>
      </Sheet>
      <ReportSheet open={report} onClose={() => setReport(false)} userId={c.id} name={c.name} onDone={() => nav.pop()} />
    </div>
  );
}

/**
 * The profile's photos, read right to left like the rest of the app: the first photo sits on the
 * right, the next one comes from the left — swipe towards the right, or tap the left half.
 *
 * The swiping is the browser's own horizontal scrolling with snap points, not a gesture library:
 * inside Telegram's WebView that is the one thing that always follows the finger, keeps its
 * momentum, and never steals the page's vertical scroll. The strip itself is laid out left to
 * right with the photos reversed, because right-to-left scroll offsets differ between browsers.
 *
 * Nothing may sit on top of the strip and take the touch: a finger that lands on an overlay is not
 * inside the scroller, so it would not scroll it. Taps are therefore read from the strip itself.
 */
function Gallery({ card }: { card: Card }) {
  const [i, setI] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const photos = card.photos;
  const n = photos.length;
  /** The slide holding photo `index`, counted from the left edge of the strip. */
  const slideOf = (index: number) => n - 1 - index;

  // open on the first photo, which sits at the far right
  useLayoutEffect(() => {
    const el = strip.current;
    if (el && el.clientWidth) el.scrollLeft = slideOf(0) * el.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  const go = (to: number) => {
    const el = strip.current;
    if (to < 0 || to >= n) return haptic.warning();
    el?.scrollTo({ left: slideOf(to) * el.clientWidth, behavior: 'smooth' });
    if (!el) setI(to);
  };

  // the finger (or a tap's smooth scroll) decides which photo we are on
  const onScroll = () => {
    const el = strip.current;
    if (!el || !el.clientWidth) return;
    const at = Math.min(n - 1, Math.max(0, n - 1 - Math.round(el.scrollLeft / el.clientWidth)));
    if (at !== i) {
      setI(at);
      haptic.select();
    }
  };

  /** A tap (the browser sends no click after a swipe): left side = next photo, right side = previous. */
  const onTap = (e: MouseEvent<HTMLDivElement>) => {
    if (n < 2) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    if (x < 0.4) go(i + 1);
    else if (x > 0.6) go(i - 1);
  };

  if (!n) return <div className="aspect-[4/5] w-full bg-royal opacity-50" />;
  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden bg-surface-2">
      <div
        ref={strip}
        dir="ltr"
        onScroll={onScroll}
        onClick={onTap}
        style={n > 1 ? { touchAction: 'pan-x pan-y', WebkitOverflowScrolling: 'touch' } : undefined}
        className={clsx('no-scrollbar flex size-full', n > 1 && 'snap-x snap-mandatory overflow-x-auto overscroll-x-contain')}
      >
        {[...photos].reverse().map((p) => (
          <div key={p.id} className="size-full shrink-0 snap-center snap-always">
            <Img src={p.url} color={p.color} className="size-full" />
          </div>
        ))}
      </div>

      {n > 1 ? (
        <div className="pointer-events-none absolute inset-x-3 top-3 flex gap-1.5">
          {photos.map((_, k) => (
            <span key={k} className={clsx('h-[3px] flex-1 rounded-full transition-colors', k === i ? 'bg-white' : 'bg-white/35')} />
          ))}
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-night to-transparent" />
    </div>
  );
}

function Details({ card }: { card: Card }) {
  const meta = useMeta().data;
  const label = (list: { id: string; label: string; emoji?: string }[] | undefined, id: string | null) => list?.find((o) => o.id === id);
  const goal = label(meta?.goals, card.goal);
  const basics = ([
    card.heightCm ? { icon: <Ruler className="size-4" />, text: `${fa(card.heightCm)} سانتی‌متر` } : null,
    card.education ? { icon: <GraduationCap className="size-4" />, text: label(meta?.education, card.education)?.label } : null,
    card.job ? { icon: <Briefcase className="size-4" />, text: card.job } : null,
    card.smoking ? { icon: <Cigarette className="size-4" />, text: label(meta?.smoking, card.smoking)?.label } : null,
    card.maritalStatus ? { icon: <Sparkles className="size-4" />, text: label(meta?.marital, card.maritalStatus)?.label } : null,
  ] as ({ icon: ReactNode; text: string | undefined } | null)[]).filter((x): x is { icon: ReactNode; text: string } => !!x && !!x.text);

  return (
    <div className="space-y-5 pt-5">
      {goal ? (
        <section className="flex items-center gap-3 rounded-card border border-line bg-surface-1 p-4">
          <span className="text-[30px]">{goal.emoji}</span>
          <div>
            <div className="text-[12px] text-muted">دنبال چیه؟</div>
            <div className="text-[16px] font-bold">{goal.label}</div>
          </div>
        </section>
      ) : null}
      {card.bio ? (
        <section>
          <SectionTitle tight>درباره‌ی من</SectionTitle>
          <p className="whitespace-pre-wrap text-[15px] leading-8">{card.bio}</p>
        </section>
      ) : null}
      {basics.length ? (
        <section>
          <SectionTitle tight>اطلاعات پایه</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {basics.map((b, k) => (
              <span key={k} className="flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-2 text-[13.5px]">
                {b.icon}
                {b.text}
              </span>
            ))}
          </div>
        </section>
      ) : null}
      {card.interests.length ? (
        <section>
          <SectionTitle tight>علاقه‌مندی‌ها</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {card.interests.map((id) => {
              const it = label(meta?.interests, id);
              return it ? (
                <Pill key={id} emoji={it.emoji} className="bg-surface-2 border border-line">
                  {it.label}
                </Pill>
              ) : null;
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
