import clsx from 'clsx';
import { ChevronUp, MapPin } from 'lucide-react';
import { animate, motion, type PanInfo, useMotionValue, useTransform } from 'motion/react';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { useMeta } from '@/api/queries';
import type { Card } from '@/api/types';
import { fa } from '@/lib/format';
import { haptic } from '@/telegram/tg';
import { Img, Pill, PremiumBadge } from '@/ui/kit';
import type { SwipeAction } from './deck';

export interface SwipeCardHandle {
  fling: (action: SwipeAction) => void;
}

const THRESHOLD = 110;

/**
 * The top card: drag right = like, left = pass, up = super like. Photos change by tapping the
 * card's sides; the stamps fade in as the card moves so the gesture always says what it will do.
 */
export const SwipeCard = forwardRef<SwipeCardHandle, { card: Card; onSwiped: (a: SwipeAction) => void; onOpen: () => void; top: boolean }>(
  function SwipeCard({ card, onSwiped, onOpen, top }, ref) {
    const x = useMotionValue(0);
    const y = useMotionValue(0);
    const rotate = useTransform(x, [-320, 320], [-16, 16]);
    const like = useTransform(x, [24, THRESHOLD], [0, 1]);
    const nope = useTransform(x, [-THRESHOLD, -24], [1, 0]);
    const sup = useTransform(y, [-THRESHOLD, -30], [1, 0]);
    const [photo, setPhoto] = useState(0);
    const [crossed, setCrossed] = useState(false);
    const meta = useMeta();
    const interests = new Map(meta.data?.interests.map((i) => [i.id, i]) ?? []);
    const goal = meta.data?.goals.find((g) => g.id === card.goal);

    const fling = (action: SwipeAction) => {
      const w = window.innerWidth;
      if (action === 'superlike') {
        void animate(y, -window.innerHeight, { duration: 0.38, ease: [0.4, 0, 0.6, 1] });
      } else {
        void animate(x, action === 'like' ? w * 1.4 : -w * 1.4, { duration: 0.34, ease: [0.4, 0, 0.6, 1] });
        void animate(y, y.get() + 40, { duration: 0.34 });
      }
      if (action === 'like') haptic.medium();
      else if (action === 'superlike') haptic.heavy();
      else haptic.light();
      setTimeout(() => onSwiped(action), 300);
    };
    useImperativeHandle(ref, () => ({ fling }));

    const onDrag = (_e: unknown, info: PanInfo) => {
      const over = Math.abs(info.offset.x) > THRESHOLD || info.offset.y < -THRESHOLD;
      if (over !== crossed) {
        setCrossed(over);
        if (over) haptic.select();
      }
    };

    const onDragEnd = (_e: unknown, info: PanInfo) => {
      const { offset, velocity } = info;
      if (offset.y < -THRESHOLD && Math.abs(offset.x) < THRESHOLD) return fling('superlike');
      if (offset.x > THRESHOLD || velocity.x > 700) return fling('like');
      if (offset.x < -THRESHOLD || velocity.x < -700) return fling('pass');
      void animate(x, 0, { type: 'spring', stiffness: 500, damping: 30 });
      void animate(y, 0, { type: 'spring', stiffness: 500, damping: 30 });
    };

    const photos = card.photos.length ? card.photos : [null];
    const current = photos[Math.min(photo, photos.length - 1)];
    const recentlyActive = !card.online && Date.now() - new Date(card.lastActiveAt).getTime() < 3 * 3600_000;

    return (
      <motion.div
        className="absolute inset-0 touch-none"
        style={{ x, y, rotate }}
        drag={top}
        dragElastic={0.9}
        dragMomentum={false}
        onDrag={onDrag}
        onDragEnd={onDragEnd}
        initial={{ scale: 0.94, y: 14, opacity: 0.6 }}
        animate={{ scale: top ? 1 : 0.94, y: top ? 0 : 14, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      >
        <div className="relative size-full overflow-hidden rounded-panel border border-line bg-surface-2 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)]">
          {current ? <Img src={current.md} color={current.color} className="absolute inset-0" /> : <div className="absolute inset-0 bg-royal opacity-60" />}

          {/* photo progress (RTL: first photo is the rightmost bar) */}
          {photos.length > 1 ? (
            <div className="absolute inset-x-3 top-3 flex gap-1.5">
              {photos.map((_, i) => (
                <span key={i} className={clsx('h-[3px] flex-1 rounded-full', i === photo ? 'bg-white' : 'bg-white/35')} />
              ))}
            </div>
          ) : null}

          {/* tap zones: left = next, right = previous */}
          <button
            aria-label="عکس بعدی"
            className="absolute inset-y-0 left-0 w-2/5"
            onClick={() => {
              if (photo < photos.length - 1) {
                setPhoto(photo + 1);
                haptic.select();
              } else haptic.warning();
            }}
          />
          <button
            aria-label="عکس قبلی"
            className="absolute inset-y-0 right-0 w-2/5"
            onClick={() => {
              if (photo > 0) {
                setPhoto(photo - 1);
                haptic.select();
              } else haptic.warning();
            }}
          />

          <div className="pointer-events-none absolute top-8 right-4 flex flex-col items-end gap-2">
            {card.online ? (
              <Pill className="bg-black/40">
                <span className="size-2 rounded-full bg-mint" /> آنلاین
              </Pill>
            ) : recentlyActive ? (
              <Pill className="bg-black/40">
                <span className="size-2 rounded-full bg-gold" /> اخیراً فعال
              </Pill>
            ) : null}
            {card.newcomer ? <Pill className="bg-violet/60">✨ تازه‌وارد</Pill> : null}
            {card.superLikedYou ? <Pill className="bg-sky/80 font-bold text-night shadow-[0_0_18px_rgba(56,189,248,0.7)]">⭐ سوپرلایکت کرده</Pill> : null}
          </div>

          {/* stamps */}
          <motion.div style={{ opacity: like }} className="pointer-events-none absolute top-10 left-6 -rotate-12 rounded-2xl border-4 border-mint px-4 py-1 text-[30px] font-black text-mint">
            لایک
          </motion.div>
          <motion.div style={{ opacity: nope }} className="pointer-events-none absolute top-10 right-6 rotate-12 rounded-2xl border-4 border-danger px-4 py-1 text-[30px] font-black text-danger">
            نه
          </motion.div>
          <motion.div style={{ opacity: sup }} className="pointer-events-none absolute bottom-44 left-1/2 -translate-x-1/2 -rotate-6 rounded-2xl border-4 border-sky px-4 py-1 text-[28px] font-black text-sky">
            سوپرلایک ⭐
          </motion.div>

          {/* info */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-night via-night/75 to-transparent px-5 pt-28 pb-5">
            <div className="flex items-end gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-[28px] font-extrabold leading-tight">{card.name}</h2>
                  {card.age ? <span className="text-[26px] font-light tabular">{fa(card.age)}</span> : null}
                  {card.premium ? <PremiumBadge /> : null}
                </div>
                {card.city || card.distanceKm != null ? (
                  <p className="mt-1 flex items-center gap-1 text-[13.5px] text-ink/85">
                    <MapPin className="size-4" />
                    {[card.city, card.distanceKm != null ? `${fa(card.distanceKm)} کیلومتر` : null].filter(Boolean).join('، ')}
                  </p>
                ) : null}
                {photo === 0 && card.bio ? <p className="mt-2 line-clamp-2 text-[14px] leading-6 text-ink/90">{card.bio}</p> : null}
                {photo > 0 || !card.bio ? (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {goal ? <Pill emoji={goal.emoji}>{goal.label}</Pill> : null}
                    {card.interests.slice(0, 3).map((id) => {
                      const it = interests.get(id);
                      return it ? (
                        <Pill key={id} emoji={it.emoji}>
                          {it.label}
                        </Pill>
                      ) : null;
                    })}
                  </div>
                ) : null}
              </div>
              <button
                aria-label="پروفایل کامل"
                onClick={onOpen}
                className="pointer-events-auto grid size-11 shrink-0 place-items-center rounded-full bg-white/20 backdrop-blur-md active:scale-90 transition-transform"
              >
                <ChevronUp className="size-6" />
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    );
  },
);
