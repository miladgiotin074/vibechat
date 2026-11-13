import { motion } from 'motion/react';
import { useState } from 'react';
import { useMe, useMeta } from '@/api/queries';
import { fa } from '@/lib/format';
import { openExternal } from '@/telegram/tg';
import { Button, GlowBackground } from '@/ui/kit';

/** The small round picture on top. Drop the designed image at public/img/welcome.webp. */
const HERO = '/img/welcome.webp';

interface Feature {
  emoji: string;
  title: string;
  text: string;
  /** soft colour behind the emoji */
  tint: string;
}

/**
 * The first screen a newcomer sees: one page, everything the app does at a glance, one button.
 * Features the admin switched off (random chat, the Wall) are not promised.
 */
export function Welcome({ onStart }: { onStart: () => void }) {
  const me = useMe();
  const meta = useMeta().data;
  const gift = me.data?.limits.bonusSuperLikes ?? 0;
  const [heroFailed, setHeroFailed] = useState(false);

  const features: Feature[] = [
    { emoji: '🔥', title: 'آدم‌های جدید رو کشف کن', text: 'پروفایل‌ها رو ببین؛ بپسند یا رد کن', tint: 'bg-rose/15' },
    { emoji: '💬', title: 'مچ شو و گپ بزن', text: 'وقتی همدیگه رو بپسندید، چت باز می‌شه', tint: 'bg-violet/15' },
    ...(meta?.randomChat !== false
      ? [{ emoji: '🎲', title: 'چت تصادفی', text: 'همین الان با یه نفر ناشناس حرف بزن', tint: 'bg-sky/15' }]
      : []),
    ...(meta?.wall?.enabled !== false
      ? [{ emoji: '📣', title: 'دیوار', text: 'بنویس دنبال چی هستی تا بقیه بهت پیام بدن', tint: 'bg-gold/15' }]
      : []),
  ];

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-night">
      <GlowBackground />

      <div className="no-scrollbar relative min-h-0 flex-1 overflow-y-auto px-6">
        {/* the round picture, shown as it is (it carries its own ring) */}
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 16 }}
          className="mx-auto mt-8 size-[150px] overflow-hidden rounded-full"
        >
          {heroFailed ? (
            <span className="grid size-full place-items-center bg-surface-2 text-[56px]">💜</span>
          ) : (
            <img src={HERO} alt="" draggable={false} onError={() => setHeroFailed(true)} className="size-full object-cover" />
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mt-5 text-center">
          <h1 className="text-[25px] font-extrabold leading-snug">به Vibe خوش اومدی 💜</h1>
          <p className="mx-auto mt-1.5 max-w-xs text-[14px] leading-7 text-muted">جایی برای آشنایی با آدم‌های واقعی، همین نزدیکی</p>
          {/* came through an invite: the gift is waiting */}
          {gift > 0 ? (
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="mt-3 inline-block rounded-full border border-gold/40 bg-gold/15 px-3 py-1.5 text-[12px] font-semibold text-gold"
            >
              🎁 {fa(gift)} سوپرلایک هدیه
            </motion.span>
          ) : null}
        </motion.div>

        <ul className="mx-auto mt-6 max-w-sm space-y-2.5 pb-4">
          {features.map((f, k) => (
            <motion.li
              key={f.title}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.18 + k * 0.06 }}
              className="flex items-center gap-3 rounded-card border border-line bg-surface-1/70 px-3.5 py-3"
            >
              <span className={`grid size-11 shrink-0 place-items-center rounded-2xl text-[22px] ${f.tint}`}>{f.emoji}</span>
              <span className="min-w-0 flex-1 text-right">
                <span className="block text-[14.5px] font-bold">{f.title}</span>
                <span className="mt-0.5 block text-[12.5px] leading-5 text-muted">{f.text}</span>
              </span>
            </motion.li>
          ))}
        </ul>
      </div>

      <div className="relative px-5 pt-3 pb-safe">
        <Button className="w-full" onClick={onStart}>
          شروع کن 🔥
        </Button>
        <p className="mt-3 mb-3 text-center text-[11.5px] leading-6 text-faint">
          با ورود،{' '}
          <button
            className="underline decoration-faint/50 underline-offset-4"
            onClick={() => meta?.support.termsUrl && openExternal(meta.support.termsUrl)}
          >
            قوانین Vibe
          </button>{' '}
          را می‌پذیری و تأیید می‌کنی که بالای ۱۸ سال سن داری.
        </p>
      </div>
    </div>
  );
}
