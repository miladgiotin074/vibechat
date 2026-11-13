import clsx from 'clsx';
import { Check, Crown, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/api/client';
import { useMe, usePlans } from '@/api/queries';
import { fa, fullDate, toman, tomanShort } from '@/lib/format';
import { nav } from '@/store/nav';
import { toast } from '@/store/ui';
import { haptic, openExternal } from '@/telegram/tg';
import { Button, GlowBackground, Loading } from '@/ui/kit';

const REASONS: Record<string, string> = {
  like: 'لایک‌های رایگانت تموم شده؛ با ویژه هر روز کلی لایک داری',
  superlike: 'هر روز سوپرلایک بیشتر بگیر',
  likes: 'ببین دقیقاً کیا لایکت کردن',
  rewind: 'برگرد سراغ نفری که اشتباهی ردش کردی',
  boost: 'نیم ساعت اول از همه دیده شو',
  random: 'هر روز کلی چت ناشناس',
  privacy: 'حالت مخفی و پنهان کردن سن',
  wall: 'گفتگوی بیشتر روی دیوار',
};

export default function Premium({ reason }: { reason?: string }) {
  const plans = usePlans();
  const me = useMe().data!;
  const [selected, setSelected] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!plans.data) return;
    if (!plans.data.items.some((p) => p.id === selected) && plans.data.items.length) {
      setSelected((plans.data.items.find((p) => p.badge) ?? plans.data.items[0]!).id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans.data]);

  const pay = async () => {
    if (!selected) return;
    setPaying(true);
    try {
      const r = await api.post<{ paymentId: string; payUrl: string }>('/v1/payments', { planId: selected });
      haptic.medium();
      openExternal(new URL(r.payUrl, location.origin).toString());
      // The payer finishes in the browser; this screen waits and checks the result.
      nav.replace({ name: 'payment', paymentId: r.paymentId });
    } catch (e) {
      haptic.error();
      toast(errorMessage(e), '⚠️', 'error');
    } finally {
      setPaying(false);
    }
  };

  const items = plans.data?.items ?? [];
  const plan = items.find((p) => p.id === selected);
  const perMonth = (days: number, price: number) => Math.round((price / days) * 30 / 1000) * 1000;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <GlowBackground intensity={0.6} />
      <div className="no-scrollbar relative min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <div className="flex flex-col items-center pt-6 text-center">
          <motion.div
            initial={{ scale: 0.5, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 220, damping: 12 }}
            className="grid size-24 place-items-center rounded-panel bg-gold shadow-[0_20px_60px_-12px_rgba(255,159,67,0.8)]"
          >
            <Crown className="size-12 fill-[#3a2400]/80 text-[#3a2400]" />
          </motion.div>
          <h1 className="mt-5 text-[26px] font-black">
            Vibe <span className="bg-gold bg-clip-text text-transparent">ویژه</span>
          </h1>
          <p className="mt-1.5 text-[14px] text-muted">{reason && REASONS[reason] ? REASONS[reason] : 'بیشتر دیده شو، زودتر مچ شو'}</p>
          {me.premium.active ? (
            <p className="mt-3 rounded-full border border-gold/40 bg-gold/10 px-4 py-1.5 text-[13px] text-gold">
              عضویت فعلیت تا {me.premium.until ? fullDate(me.premium.until) : ''} — خرید جدید به آن اضافه می‌شود
            </p>
          ) : null}
        </div>

        <ul className="mt-6 space-y-2.5">
          {(plans.data?.features ?? []).map((f, i) => (
            <motion.li
              key={f.title}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.05 * i }}
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface-1/80 px-4 py-3"
            >
              <span className="text-[20px]">{f.icon}</span>
              <span className="flex-1 text-[14.5px] font-medium">{f.title}</span>
              <Check className="size-5 text-mint" />
            </motion.li>
          ))}
        </ul>

        <h2 className="mt-7 mb-3 text-[15px] font-bold">انتخاب طرح</h2>
        {plans.isLoading ? (
          <Loading />
        ) : (
          <div className="space-y-3">
            {items.map((p) => {
              const on = p.id === selected;
              return (
                <motion.button
                  key={p.id}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    haptic.select();
                    setSelected(p.id);
                  }}
                  className={clsx(
                    'relative flex w-full items-center gap-3 rounded-card p-4 text-right transition-colors',
                    on ? 'border-2 border-gold bg-gold/10' : 'border border-line bg-surface-1',
                  )}
                >
                  {p.badge ? <span className="absolute -top-2.5 left-4 rounded-full bg-gold px-3 py-0.5 text-[11px] font-bold text-[#3a2400]">{p.badge}</span> : null}
                  <span className={clsx('grid size-6 shrink-0 place-items-center rounded-full', on ? 'bg-gold' : 'border-2 border-faint')}>
                    {on ? <Check className="size-4 text-[#3a2400]" strokeWidth={3} /> : null}
                  </span>
                  <span className="flex-1">
                    <span className="block text-[16px] font-bold">{p.title}</span>
                    <span className="block text-[12.5px] text-muted">{p.description ?? `${fa(p.durationDays)} روز`}</span>
                  </span>
                  <span className="text-left">
                    {p.oldPriceToman ? <span className="block text-[12px] text-faint line-through">{tomanShort(p.oldPriceToman)}</span> : null}
                    <span className="block text-[17px] font-extrabold">{tomanShort(p.priceToman)}</span>
                    <span className="block text-[11px] text-muted">
                      {p.durationDays > 31 ? `ماهی ${tomanShort(perMonth(p.durationDays, p.priceToman))}` : 'تومان'}
                    </span>
                  </span>
                </motion.button>
              );
            })}
          </div>
        )}
        <p className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-faint">
          <ShieldCheck className="size-4" /> پرداخت امن از درگاه بانکی · بدون تمدید خودکار
        </p>
      </div>
      <div className="relative shrink-0 border-t border-line px-5 pt-3 pb-safe glass">
        <Button variant="gold" className="mb-3 w-full" disabled={!plan || plans.data?.paymentsEnabled === false} loading={paying} onClick={pay}>
          {plans.data?.paymentsEnabled === false ? 'پرداخت موقتاً غیرفعال است' : plan ? `پرداخت ${toman(plan.priceToman)}` : 'یک طرح انتخاب کن'}
        </Button>
      </div>
    </div>
  );
}
