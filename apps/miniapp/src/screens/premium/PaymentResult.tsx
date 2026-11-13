import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { keys, queryClient } from '@/api/queries';
import { fa, toman } from '@/lib/format';
import { nav } from '@/store/nav';
import { haptic } from '@/telegram/tg';
import { Button, GlowBackground, Spinner } from '@/ui/kit';

type Status = 'pending' | 'paid' | 'failed' | 'canceled' | 'expired';

/**
 * Shown while the payer is in the bank's page and when they come back (or open the app from the
 * gateway's "return" link: startapp=pay_<id>). Polls; the server re-verifies with the gateway.
 */
export default function PaymentResult({ paymentId }: { paymentId: string }) {
  const [status, setStatus] = useState<Status>('pending');
  const [amount, setAmount] = useState<number | null>(null);
  /** what was bought: a membership, or a pack of boosts / super likes */
  const [bought, setBought] = useState<{ kind: 'premium' | 'boost' | 'superlikes'; quantity: number }>({ kind: 'premium', quantity: 0 });

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const r = await api.get<{ status: Status; amountToman: number; kind?: 'premium' | 'boost' | 'superlikes'; quantity?: number }>(`/v1/payments/${paymentId}`);
        if (stop) return;
        setAmount(r.amountToman);
        setBought({ kind: r.kind ?? 'premium', quantity: r.quantity ?? 0 });
        setStatus(r.status);
        if (r.status === 'paid') {
          haptic.success();
          void queryClient.invalidateQueries({ queryKey: keys.me });
          return;
        }
        if (r.status !== 'pending') return;
      } catch {
        // keep trying
      }
      timer = setTimeout(check, document.visibilityState === 'visible' ? 3000 : 8000);
    };
    void check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        void check();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [paymentId]);

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden px-8 text-center">
      <GlowBackground intensity={status === 'paid' ? 1 : 0.5} />
      <div className="relative">
        {status === 'pending' ? (
          <>
            <div className="relative mx-auto grid size-28 place-items-center">
              <span className="absolute inset-0 rounded-full border border-gold/50 animate-ping-slow" />
              <div className="grid size-20 place-items-center rounded-full bg-surface-2">
                <Spinner className="text-gold" />
              </div>
            </div>
            <h1 className="mt-6 text-[21px] font-bold">در انتظار پرداخت…</h1>
            <p className="mt-2 text-[14px] leading-7 text-muted">
              صفحه‌ی پرداخت در مرورگر باز شد. بعد از پرداخت به تلگرام برگرد؛ {bought.kind === 'premium' ? 'عضویتت خودکار فعال می‌شه' : 'خریدت خودکار به حسابت اضافه می‌شه'}.
              {amount ? <><br />مبلغ: {toman(amount)}</> : null}
            </p>
            <Button variant="soft" className="mt-8 w-full" onClick={() => nav.pop()}>
              بعداً
            </Button>
          </>
        ) : status === 'paid' ? (
          <>
            <motion.div
              initial={{ scale: 0.3, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 10 }}
              className="mx-auto grid size-28 place-items-center rounded-panel bg-gold text-[56px] shadow-[0_20px_60px_-12px_rgba(255,159,67,0.8)]"
            >
              {bought.kind === 'boost' ? '🚀' : bought.kind === 'superlikes' ? '⭐' : '💎'}
            </motion.div>
            {bought.kind === 'premium' ? (
              <>
                <h1 className="mt-6 text-[24px] font-black">عضویت ویژه فعال شد!</h1>
                <p className="mt-2 text-[14px] text-muted">لایک و چت ناشناس هر روز، دیدن لایک‌کننده‌ها و کلی امکانات دیگه منتظرته.</p>
                <Button
                  variant="gold"
                  className="mt-8 w-full"
                  onClick={() => {
                    nav.reset('discover');
                    nav.push({ name: 'likes' });
                  }}
                >
                  ببینم کیا لایکم کردن 👀
                </Button>
              </>
            ) : (
              <>
                <h1 className="mt-6 text-[24px] font-black">
                  {fa(bought.quantity)} {bought.kind === 'boost' ? 'بوست' : 'سوپرلایک'} به حسابت اضافه شد!
                </h1>
                <p className="mt-2 text-[14px] leading-7 text-muted">
                  {bought.kind === 'boost'
                    ? 'هر وقت خواستی دکمه‌ی بوست (⚡) رو تو صفحه‌ی اصلی بزن تا نیم ساعت اول از همه دیده بشی.'
                    : 'با دکمه‌ی ستاره (⭐) روی هر کارت، اول کارت‌های اون نفر میای.'}
                </p>
                <Button variant="gold" className="mt-8 w-full" onClick={() => nav.reset('discover')}>
                  بزن بریم 🔥
                </Button>
              </>
            )}
          </>
        ) : (
          <>
            <div className="mx-auto grid size-24 place-items-center rounded-full bg-surface-2 text-[44px]">😕</div>
            <h1 className="mt-6 text-[21px] font-bold">پرداخت انجام نشد</h1>
            <p className="mt-2 text-[14px] leading-7 text-muted">اگه مبلغی از حسابت کم شده، طبق قوانین بانکی برمی‌گرده. می‌تونی دوباره امتحان کنی.</p>
            <Button variant="gold" className="mt-8 w-full" onClick={() => nav.replace({ name: 'premium' })}>
              تلاش دوباره
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
