import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useWallInbox } from '@/api/queries';
import type { WallChatRequest } from '@/api/types';
import { fa } from '@/lib/format';
import { nav } from '@/store/nav';
import { haptic } from '@/telegram/tg';
import { Button, EmptyState, ErrorState, ScreenHeader, SectionTitle } from '@/ui/kit';
import { answerRequest, cancelRequest, ReceivedRequestCard, SentRequestCard } from './RequestCards';
import { PullRefresh } from '@/ui/PullRefresh';

type Box = 'in' | 'out';

/**
 * «درخواست‌های گفتگو»: one place for every conversation request that came through the Wall.
 * «دریافتی»: people who want to talk about one of my requests — accept or decline them here.
 * «ارسالی»: the ones I sent — see where each stands, or take one back while it waits.
 */
export default function Inbox({ initialBox = 'in' }: { initialBox?: Box }) {
  const [box, setBox] = useState<Box>(initialBox);
  const received = useWallInbox('in');
  const sent = useWallInbox('out');
  const q = box === 'in' ? received : sent;
  const [busy, setBusy] = useState<string | null>(null);

  // fresh lists every time the screen opens
  useEffect(() => {
    void received.refetch();
    void sent.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = async (r: WallChatRequest, accept: boolean) => {
    setBusy(r.id);
    await answerRequest(r, accept);
    setBusy(null);
  };
  const cancel = async (r: WallChatRequest) => {
    setBusy(r.id);
    await cancelRequest(r);
    setBusy(null);
  };

  const items = q.data?.items ?? [];
  const waiting = items.filter((r) => r.status === 'pending');
  const answered = items.filter((r) => r.status !== 'pending');
  const pendingIn = received.data?.pending ?? 0;

  const list = (rows: WallChatRequest[]) => (
    <ul className="space-y-2.5">
      <AnimatePresence initial={false}>
        {rows.map((r, i) => (
          <motion.li key={r.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ delay: Math.min(i, 6) * 0.03 }}>
            {box === 'in' ? (
              <ReceivedRequestCard r={r} showPost busy={busy === r.id} locked={!!busy} onDecide={(a) => decide(r, a)} />
            ) : (
              <SentRequestCard r={r} busy={busy === r.id} onCancel={() => cancel(r)} />
            )}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="درخواست‌های گفتگو" sub="هیچ‌کس بدون قبول تو نمی‌تونه از دیوار بهت پیام بده" />

      {/* received / sent */}
      <div className="shrink-0 px-4 pb-3">
        <div className="relative flex rounded-2xl border border-line bg-surface-1 p-1">
          {(
            [
              ['in', 'دریافتی', pendingIn],
              ['out', 'ارسالی', 0],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              onClick={() => {
                if (box !== id) haptic.select();
                setBox(id);
              }}
              className={clsx('relative z-[1] flex h-10 flex-1 items-center justify-center gap-1.5 text-[14px] font-semibold transition-colors', box === id ? 'text-white' : 'text-muted')}
            >
              {box === id ? <motion.span layoutId="inbox-tab" className="absolute inset-0 -z-[1] rounded-xl bg-flame" transition={{ type: 'spring', stiffness: 500, damping: 38 }} /> : null}
              {label}
              {n > 0 ? (
                <span className={clsx('grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10.5px] font-bold', box === id ? 'bg-white text-rose' : 'bg-rose text-white')}>
                  {fa(n)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <PullRefresh onRefresh={() => Promise.all([received.refetch(), sent.refetch()])} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4" style={{ paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}>
        {q.isLoading ? (
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-44 rounded-card skeleton" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState message="درخواست‌ها دریافت نشد" onRetry={() => q.refetch()} />
        ) : items.length === 0 ? (
          box === 'in' ? (
            <EmptyState
              emoji="📭"
              title="هنوز درخواستی نیومده"
              subtitle="روی دیوار بنویس دنبال چی هستی. هر کس بخواد باهات گفتگو کنه، اول درخواستش با پروفایلش میاد اینجا و تو تصمیم می‌گیری."
              action={
                <Button className="w-full" onClick={() => nav.push({ name: 'wallCompose' })}>
                  ✍️ ثبت درخواست روی دیوار
                </Button>
              }
            />
          ) : (
            <EmptyState
              emoji="💌"
              title="هنوز درخواستی نفرستادی"
              subtitle="روی دیوار درخواست‌ها رو ببین و برای هر کدوم که دوست داشتی «درخواست گفتگو» بفرست."
              action={
                <Button variant="soft" className="w-full" onClick={() => nav.reset('wall')}>
                  🧱 رفتن به دیوار
                </Button>
              }
            />
          )
        ) : (
          <>
            {waiting.length ? (
              <section>
                <SectionTitle tight>{box === 'in' ? `منتظر جواب تو · ${fa(waiting.length)}` : 'منتظر جواب'}</SectionTitle>
                {list(waiting)}
              </section>
            ) : box === 'in' ? (
              <div className="mb-1 rounded-card border border-line bg-surface-1 px-4 py-3.5 text-center text-[13px] text-muted">همه‌ی درخواست‌ها رو جواب دادی ✨</div>
            ) : null}
            {answered.length ? (
              <section className={waiting.length || box === 'in' ? 'mt-6' : undefined}>
                <SectionTitle tight>قبلی‌ها (۲ هفته‌ی اخیر)</SectionTitle>
                {list(answered)}
              </section>
            ) : null}
          </>
        )}
      </PullRefresh>
    </div>
  );
}
