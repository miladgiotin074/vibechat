import clsx from 'clsx';
import { ChevronUp, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useMeta } from '@/api/queries';
import type { Card } from '@/api/types';
import { fa } from '@/lib/format';
import { haptic } from '@/telegram/tg';
import { Img, NameArt, Pill } from '@/ui/kit';

/**
 * One profile, full screen: the photos, the name and age, and the few words they wrote. Tapping the
 * sides changes photo, tapping anywhere else opens the whole profile. Nothing is swiped: the two
 * buttons under the card are the whole choice — write to them, or skip them.
 */
export function ProfileCard({ card, onOpen, top }: { card: Card; onOpen: () => void; top: boolean }) {
  const [photo, setPhoto] = useState(0);
  const meta = useMeta();
  const marital = meta.data?.marital.find((m) => m.id === card.maritalStatus);

  const photos = card.photos.length ? card.photos : [null];
  const current = photos[Math.min(photo, photos.length - 1)];
  const open = () => {
    haptic.light();
    onOpen();
  };
  const step = (d: 1 | -1) => () => {
    if (photos.length < 2) return open();
    const next = photo + d;
    if (next >= 0 && next < photos.length) {
      setPhoto(next);
      haptic.select();
    } else haptic.warning();
  };
  const recentlyActive = !card.online && Date.now() - new Date(card.lastActiveAt).getTime() < 3 * 3600_000;

  return (
    <motion.div
      className="absolute inset-0"
      initial={{ scale: 0.94, y: 14, opacity: 0.6 }}
      animate={{ scale: top ? 1 : 0.94, y: top ? 0 : 14, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
    >
      <div className="relative size-full overflow-hidden rounded-panel border border-line bg-surface-2 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)]">
        {current ? <Img src={current.md} color={current.color} className="absolute inset-0" /> : <NameArt name={card.name} className="absolute inset-0" />}

        {/* photo progress (RTL: first photo is the rightmost bar) */}
        {photos.length > 1 ? (
          <div className="absolute inset-x-3 top-3 flex gap-1.5">
            {photos.map((_, i) => (
              <span key={i} className={clsx('h-[3px] flex-1 rounded-full', i === photo ? 'bg-white' : 'bg-white/35')} />
            ))}
          </div>
        ) : null}

        {/* tap zones: left = next photo, right = previous, the middle opens the profile */}
        <button aria-label="عکس بعدی" className="absolute inset-y-0 left-0 w-2/5" onClick={step(1)} />
        <button aria-label="پروفایل کامل" className="absolute inset-y-0 left-2/5 w-1/5" onClick={open} />
        <button aria-label="عکس قبلی" className="absolute inset-y-0 right-0 w-2/5" onClick={step(-1)} />

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
        </div>

        {/* name, age and the few words they wrote */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-night via-night/75 to-transparent px-5 pt-28 pb-5">
          <div className="pointer-events-auto flex cursor-pointer items-end gap-3" onClick={open}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-[28px] font-extrabold leading-tight">{card.name}</h2>
                {card.age ? <span className="text-[26px] font-light tabular">{fa(card.age)}</span> : null}
              </div>
              {marital ? (
                <p className="mt-1 flex items-center gap-1 text-[13.5px] text-ink/85">
                  <Sparkles className="size-4" />
                  {marital.label}
                </p>
              ) : null}
              {card.bio ? <p className="mt-2 line-clamp-2 text-[14px] leading-6 text-ink/90">{card.bio}</p> : null}
            </div>
            <button
              aria-label="پروفایل کامل"
              className="grid size-11 shrink-0 place-items-center rounded-full bg-white/20 backdrop-blur-md transition-transform active:scale-90"
            >
              <ChevronUp className="size-6" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
