import clsx from 'clsx';
import { Check, ChevronLeft, Megaphone, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { fetchGate, keys, queryClient } from '@/api/queries';
import type { GateStatus } from '@/api/types';
import { toast } from '@/store/ui';
import { haptic, openTelegram } from '@/telegram/tg';
import { Button, GlowBackground } from '@/ui/kit';

/**
 * Before the app: the channels and groups everyone joins first. Each row opens Telegram; coming
 * back to the app checks again on its own, and the button checks on demand.
 */
export function JoinGate({ status }: { status: GateStatus }) {
  const [checking, setChecking] = useState(false);
  const left = status.chats.filter((c) => !c.joined).length;

  const check = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const next = await fetchGate();
      queryClient.setQueryData(keys.gate, next);
      if (next.ok) haptic.success();
      else {
        haptic.error();
        toast('هنوز عضو همه نشدی 🙂', '👀');
      }
    } catch {
      toast('بررسی نشد؛ دوباره امتحان کن', '📡');
    } finally {
      setChecking(false);
    }
  };

  // back from Telegram (after joining) the check runs on its own: App re-checks on every resume

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-night">
      <GlowBackground intensity={0.6} />
      <div className="no-scrollbar relative min-h-0 flex-1 overflow-y-auto px-5">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center pt-12 text-center">
          <div className="grid size-24 place-items-center rounded-full bg-violet/15 text-[44px]">📣</div>
          <h1 className="mt-5 text-[23px] font-extrabold leading-snug">یه قدم تا Vibe</h1>
          <p className="mx-auto mt-2 max-w-xs text-[14px] leading-7 text-muted">
            برای استفاده از اپ، عضو {status.chats.length > 1 ? 'این کانال‌ها و گروه‌ها' : status.chats[0]?.kind === 'group' ? 'این گروه' : 'این کانال'} شو. خبرها و
            آدم‌های جدید اول اینجا میان 💜
          </p>
        </motion.div>

        <ul className="mx-auto mt-7 max-w-sm space-y-2.5 pb-4">
          {status.chats.map((c, i) => (
            <motion.li key={c.id} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.06 }}>
              <button
                onClick={() => {
                  haptic.light();
                  openTelegram(c.link);
                }}
                className={clsx(
                  'flex w-full items-center gap-3 rounded-card border px-3.5 py-3 text-right transition-colors active:scale-[0.99]',
                  c.joined ? 'border-mint/35 bg-mint/10' : 'border-line bg-surface-1/80',
                )}
              >
                <span className={clsx('grid size-11 shrink-0 place-items-center rounded-2xl', c.joined ? 'bg-mint/20 text-mint' : 'bg-violet/15 text-violet')}>
                  {c.kind === 'group' ? <Users className="size-5" /> : <Megaphone className="size-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-bold">{c.title}</span>
                  <span className="mt-0.5 block text-[12.5px] text-muted">{c.kind === 'group' ? 'گروه' : 'کانال'}</span>
                </span>
                {c.joined ? (
                  <span className="flex items-center gap-1 text-[12.5px] font-semibold text-mint">
                    <Check className="size-4" /> عضوی
                  </span>
                ) : (
                  <span className="flex items-center gap-0.5 rounded-full bg-violet px-3 py-1.5 text-[12.5px] font-bold text-white">
                    عضو شو <ChevronLeft className="size-4" />
                  </span>
                )}
              </button>
            </motion.li>
          ))}
        </ul>
      </div>

      <div className="relative px-5 pt-3 pb-safe">
        <Button className="mb-3 w-full" loading={checking} onClick={() => void check()}>
          {left > 0 ? 'عضو شدم، بزن بریم ✓' : 'ورود به Vibe 🔥'}
        </Button>
      </div>
    </div>
  );
}
