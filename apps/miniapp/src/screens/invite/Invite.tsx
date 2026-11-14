import { MessagesSquare, UserPlus, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { useReferrals } from '@/api/queries';
import { fa } from '@/lib/format';
import { openTelegram } from '@/telegram/tg';
import { Button, ErrorState, GlowBackground, Loading, ProgressBar } from '@/ui/kit';
import { PullRefresh } from '@/ui/PullRefresh';

/**
 * Invites: add friends from your Telegram contacts to the Wall group, get likes. The bot
 * sees who added whom; each friend counts once.
 */
export default function Invite() {
  const q = useReferrals();
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState message="اطلاعات دعوت دریافت نشد" onRetry={() => q.refetch()} />;
  const r = q.data;
  // progress toward the next reward: every full minAdds friends are worth rewardLikes likes
  const firstStage = r.adds < r.minAdds;
  const stageDone = r.minAdds - r.untilNext;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <GlowBackground intensity={0.7} />
      <PullRefresh onRefresh={() => q.refetch()} className="no-scrollbar relative min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <div className="flex flex-col items-center pt-6 text-center">
          <motion.div
            className="text-[78px] leading-none"
            initial={{ scale: 0.4, rotate: -15 }}
            animate={{ scale: 1, rotate: [0, -8, 8, 0] }}
            transition={{ scale: { type: 'spring', stiffness: 200, damping: 10 }, rotate: { delay: 0.4, duration: 0.6 } }}
          >
            🎁
          </motion.div>
          <h1 className="mt-4 text-[24px] font-black leading-snug">دوستاتو اضافه کن، هدیه بگیر!</h1>
          <p className="mt-2 max-w-xs text-[14px] leading-7 text-muted">
            هر {fa(r.minAdds)} نفری که از مخاطبینت به گروه Vibe اضافه کنی ={' '}
            <b className="text-ink">{fa(r.rewardLikes)} لایک</b> 🎁
          </p>
        </div>

        <div className="mt-6 rounded-card border border-violet/35 bg-violet/10 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[14.5px] font-bold">{firstStage ? 'تا اولین هدیه' : 'تا هدیه‌ی بعدی'}</span>
            <span className="text-[13px] font-semibold tabular text-violet">
              {fa(stageDone)}/{fa(r.minAdds)}
            </span>
          </div>
          <ProgressBar value={stageDone / r.minAdds} className="mt-3" />
          <p className="mt-2 text-[12.5px] text-muted">
            {fa(r.untilNext)} نفر دیگه اضافه کن تا {firstStage ? `${fa(r.rewardLikes)} لایک` : `${fa(r.rewardLikes)} لایک دیگه`} بگیری
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5 text-center">
          <Stat value={r.adds} label="اضافه کردی" />
          <Stat value={r.earnedLikes} label="لایک هدیه" accent />
        </div>

        <section className="mt-6 rounded-card border border-line bg-surface-1/85 p-4">
          <h2 className="text-[15px] font-bold">چطوری اضافه کنم؟</h2>
          <ol className="mt-3 space-y-3">
            {[
              { icon: <Users className="size-4" />, text: 'دکمه‌ی پایین رو بزن تا گروه باز بشه' },
              { icon: <UserPlus className="size-4" />, text: 'روی اسم گروه بزن و «افزودن عضو» (Add Members) رو انتخاب کن' },
              { icon: <MessagesSquare className="size-4" />, text: 'دوستاتو انتخاب کن؛ هر کسی که اضافه بشه خودکار حساب می‌شه' },
            ].map((s, i) => (
              <li key={i} className="flex items-start gap-3 text-[13.5px] leading-6">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-violet/15 text-violet">{s.icon}</span>
                <span className="pt-0.5">{s.text}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[12px] leading-6 text-faint">هر نفر فقط یک بار حساب می‌شه؛ اگه کسی قبلاً عضو گروه بوده یا یکی دیگه اضافه‌اش کرده، حساب نمی‌شه.</p>
        </section>
      </PullRefresh>

      <div className="relative px-5 pb-safe pt-3">
        <Button variant="royal" className="w-full" icon={<Users className="size-5" />} disabled={!r.group} onClick={() => r.group && openTelegram(r.group.link)}>
          رفتن به گروه و اضافه کردن دوستان
        </Button>
      </div>
    </div>
  );
}

function Stat({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-surface-1/85 py-3">
      <div className={`text-[22px] font-black tabular ${accent ? 'text-sky' : 'text-ink'}`}>{fa(value)}</div>
      <div className="text-[11.5px] text-muted">{label}</div>
    </div>
  );
}
