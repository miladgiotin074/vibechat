import clsx from 'clsx';
import { ChevronLeft, Crown, Eye, Gift, Pencil, UserRoundPen } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useMe, useReferrals } from '@/api/queries';
import type { Me } from '@/api/types';
import { fa, fullDate } from '@/lib/format';
import { nav } from '@/store/nav';
import { haptic } from '@/telegram/tg';
import { IconTile, Img, ProgressBar, ScreenHeader } from '@/ui/kit';
import { TAB_BAR_SPACE } from '../Shell';
import { SettingsSections } from './SettingsSections';
import { PullRefresh } from '@/ui/PullRefresh';

/** How complete the profile is; each missing piece is a tip. */
export function completion(me: Me): { value: number; tip: string | null } {
  const checks: [boolean, string][] = [
    [me.photos.filter((p) => p.status !== 'rejected').length >= 2, 'حداقل ۲ عکس بذار'],
    [!!me.bio && me.bio.length >= 20, 'یه بیوی کوتاه و جذاب بنویس'],
    [me.interests.length >= 3, 'حداقل ۳ علاقه‌مندی انتخاب کن'],
    [!!me.cityId, 'شهرت رو انتخاب کن'],
    [!!me.goal, 'بگو دنبال چی هستی'],
    [!!me.job || !!me.education, 'شغل یا تحصیلاتت رو اضافه کن'],
    [!!me.heightCm, 'قدت رو اضافه کن'],
  ];
  const done = checks.filter(([ok]) => ok).length;
  return { value: done / checks.length, tip: checks.find(([ok]) => !ok)?.[1] ?? null };
}

export function MeScreen() {
  const meQ = useMe();
  const me = meQ.data!;
  const refs = useReferrals();
  const photo = me.photos[0];
  const c = completion(me);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="پروفایل من" />
      <PullRefresh onRefresh={() => Promise.all([meQ.refetch(), refs.refetch()])} className="no-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pt-1" style={{ paddingBottom: TAB_BAR_SPACE }}>
        {/* hero */}
        <motion.div whileTap={{ scale: 0.985 }} className="relative aspect-[4/3.4] overflow-hidden rounded-panel border border-line" onClick={() => nav.push({ name: 'profile', userId: me.id })}>
          <Img src={photo?.md} color={photo?.color} className="absolute inset-0" />
          <div className="absolute inset-0 bg-gradient-to-t from-night via-night/30 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-[27px] font-extrabold">{me.name}</h2>
                {me.age ? <span className="text-[25px] font-light tabular">{fa(me.age)}</span> : null}
              </div>
              {me.city ? <p className="text-[14px] text-ink/80">{[me.city, me.province].filter(Boolean).join('، ')}</p> : null}
              <p className="mt-1.5 flex items-center gap-1 text-[13px] text-ink/85">
                <Eye className="size-4" /> مشاهده‌ی پروفایل از نگاه دیگران
              </p>
            </div>
            <button
              aria-label="ویرایش پروفایل"
              onClick={(e) => {
                e.stopPropagation();
                nav.push({ name: 'editProfile' });
              }}
              className="grid size-14 shrink-0 place-items-center rounded-full bg-flame-d shadow-[0_12px_30px_-8px_rgba(255,45,111,0.9)] active:scale-90 transition-transform"
            >
              <Pencil className="size-6" />
            </button>
          </div>
        </motion.div>

        {/* three cards, one shape: what to do next with the profile, premium, and invites */}
        {c.value < 1 ? (
          <ActionCard
            icon={<UserRoundPen />}
            tint="rose"
            title={`پروفایلت ${fa(Math.round(c.value * 100))}٪ کامله`}
            subtitle={c.tip ? `${c.tip}؛ پروفایل کامل یعنی مچ بیشتر` : 'پروفایل کامل یعنی مچ بیشتر'}
            action="تکمیل"
            onClick={() => nav.push({ name: 'editProfile' })}
          >
            <Progress value={c.value} label={`${fa(Math.round(c.value * 100))}٪`} />
          </ActionCard>
        ) : null}

        {!me.premium.offered ? null : me.premium.active ? (
          <ActionCard
            icon={<Crown className="fill-[#3a2400]/25" />}
            tint="gold"
            featured
            title="عضو ویژه هستی 💎"
            subtitle={me.premium.until ? `تا ${fullDate(me.premium.until)}` : 'همه‌ی امکانات ویژه فعاله'}
            action="تمدید"
            onClick={() => nav.push({ name: 'premium' })}
          />
        ) : (
          <ActionCard
            icon={<Crown className="fill-[#3a2400]/25" />}
            tint="gold"
            featured
            title="عضو ویژه شو 💎"
            subtitle="لایک و چت ناشناس هر روز، دیدن لایک‌کننده‌ها، بوست و…"
            action="مشاهده"
            onClick={() => nav.push({ name: 'premium' })}
          />
        )}

        {/* invites earn random chats: only for those who have a limit on them */}
        {refs.data?.enabled && !refs.data.random.unlimited ? (
          <ActionCard
            icon={<Gift />}
            tint="violet"
            title="دوستاتو اضافه کن، هدیه بگیر"
            subtitle={`هر ${fa(refs.data.minAdds)} نفر که به گروه اضافه کنی = ${fa(refs.data.rewardChats)} چت ناشناس${refs.data.rewardLikes ? ` + ${fa(refs.data.rewardLikes)} لایک` : ''}`}
            action="اضافه کردن"
            onClick={() => nav.push({ name: 'invite' })}
          >
            {refs.data.adds < refs.data.minAdds ? (
              <Progress value={refs.data.adds / refs.data.minAdds} label={`${fa(refs.data.adds)}/${fa(refs.data.minAdds)}`} />
            ) : null}
          </ActionCard>
        ) : null}

        {/* privacy, Telegram alerts, safety and the account itself */}
        <SettingsSections />
      </PullRefresh>
    </div>
  );
}

type Tint = 'rose' | 'violet' | 'gold';

const ACTION_TEXT: Record<Tint, string> = { rose: 'text-rose', violet: 'text-violet', gold: 'text-gold' };

/**
 * The profile tab's cards share one shape with the rest of the app's cards: the same surface and
 * border, a tinted icon tile on the right, a title and one line under it, and what tapping does
 * on the left. A progress line can sit underneath.
 */
function ActionCard({
  icon,
  tint,
  title,
  subtitle,
  action,
  onClick,
  children,
  featured,
}: {
  icon: ReactNode;
  tint: Tint;
  title: ReactNode;
  subtitle?: ReactNode;
  action: string;
  onClick: () => void;
  children?: ReactNode;
  /**
   * The one card meant to catch the eye (premium): same shape as the others, but with a gold
   * edge and glow, a light that sweeps across it now and then, and a filled button.
   */
  featured?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      onClick={() => {
        haptic.select();
        onClick();
      }}
      className={clsx(
        'relative block w-full overflow-hidden rounded-card border p-4 text-right',
        featured
          ? 'border-gold/45 bg-gradient-to-l from-gold/[0.16] via-surface-1/95 to-surface-1/95'
          : 'border-line bg-surface-1/90',
      )}
    >
      {featured ? (
        <>
          <span aria-hidden className="card-shine pointer-events-none absolute inset-0" />
        </>
      ) : null}
      <span className="relative flex items-center gap-3.5">
        {featured ? (
          <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-gold text-[#3a2400] [&>svg]:size-6">
            {icon}
          </span>
        ) : (
          <IconTile tint={tint}>{icon}</IconTile>
        )}
        <span className="min-w-0 flex-1">
          <span className={clsx('block font-semibold', featured ? 'text-[16px] font-bold text-gold' : 'text-[15px]')}>{title}</span>
          {subtitle ? <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-5 text-muted">{subtitle}</span> : null}
        </span>
        {featured ? (
          <span className="shrink-0 rounded-full bg-gold px-3.5 py-1.5 text-[13px] font-bold text-[#3a2400]">
            {action}
          </span>
        ) : (
          <span className={clsx('flex shrink-0 items-center gap-0.5 text-[13.5px] font-semibold', ACTION_TEXT[tint])}>
            {action}
            <ChevronLeft className="size-4" />
          </span>
        )}
      </span>
      {children ? <span className="relative mt-3.5 block">{children}</span> : null}
    </motion.button>
  );
}

function Progress({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <ProgressBar value={value} className="flex-1" />
      <span className="shrink-0 text-[12px] text-muted tabular">{label}</span>
    </span>
  );
}
