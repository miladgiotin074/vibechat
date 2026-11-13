import { ChevronLeft, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useMeta, useMyWall } from '@/api/queries';
import type { WallPost } from '@/api/types';
import { fa } from '@/lib/format';
import { nav } from '@/store/nav';
import { Button, EmptyState, ErrorState, IconButton, ScreenHeader, SectionTitle } from '@/ui/kit';
import { postingBlock, startCompose } from './posting';
import { isLive, PostCard } from './PostCard';
import { LikersSheet, RequestsSheet } from './Sheets';
import { GroupCard } from './Wall';
import { PullRefresh } from '@/ui/PullRefresh';

/**
 * «درخواست‌های من»: my requests of the last week as full cards — live ones first, then the ones
 * that ended or were taken down (with the reason). From each card: who liked it, and the
 * conversation requests waiting for my answer.
 */
export default function MyRequests() {
  const q = useMyWall();
  const group = useMeta().data?.wall?.group;
  const [likersOf, setLikersOf] = useState<WallPost | null>(null);
  const [requestsOf, setRequestsOf] = useState<WallPost | null>(null);

  useEffect(() => {
    void q.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const compose = () => startCompose(q.data);
  const block = postingBlock(q.data);

  const items = q.data?.items ?? [];
  const live = items.filter(isLive);
  const ended = items.filter((p) => !isLive(p));
  const pending = q.data?.pendingRequests ?? 0;

  const card = (p: WallPost, i: number) => (
    <motion.div key={p.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 5) * 0.04 }}>
      <PostCard post={p} compact onMessage={() => undefined} onLikers={setLikersOf} onRequests={setRequestsOf} />
    </motion.div>
  );

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title="درخواست‌های من"
        sub={q.data ? (block ? block.text : 'می‌تونی یه درخواست تازه بذاری') : undefined}
        actions={
          <IconButton label="ثبت درخواست" onClick={compose}>
            <Plus className="size-5" />
          </IconButton>
        }
      />
      <PullRefresh onRefresh={() => q.refetch()} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4" style={{ paddingBottom: "calc(var(--safe-bottom) + 32px)" }}>
        {q.isLoading ? (
          <div className="space-y-3 pt-1">
            {[0, 1].map((i) => (
              <div key={i} className="h-56 rounded-panel skeleton" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState message="درخواست‌هات دریافت نشد" onRetry={() => q.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            emoji="✍️"
            title="هنوز درخواستی نذاشتی"
            subtitle="بنویس دنبال چی هستی؛ هر کس بخواد باهات گفتگو کنه، اول درخواستش میاد اینجا و تو تصمیم می‌گیری."
            action={
              <Button className="w-full" onClick={compose}>
                ✍️ ثبت اولین درخواست
              </Button>
            }
          />
        ) : (
          <>
            {pending > 0 ? (
              <button
                onClick={() => nav.push({ name: 'wallInbox' })}
                className="mb-3 flex w-full items-center gap-3 rounded-card border border-rose/30 bg-gradient-to-l from-rose/[0.16] to-violet/[0.08] p-3.5 text-right"
              >
                <span className="text-[26px]">💌</span>
                <span className="min-w-0 flex-1 text-[13.5px] leading-6">
                  <b>{fa(pending)} نفر</b> می‌خوان باهات گفتگو کنن. پروفایلشون رو ببین و قبول یا رد کن.
                </span>
                <ChevronLeft className="size-5 shrink-0 text-muted" />
              </button>
            ) : null}

            {live.length ? (
              <section className="space-y-3">
                <SectionTitle tight>فعال روی دیوار</SectionTitle>
                {live.map(card)}
              </section>
            ) : (
              <button onClick={compose} className="w-full rounded-card border border-dashed border-line px-4 py-4 text-right text-[13.5px] text-muted">
                {block?.kind === 'pause' ? `درخواست فعالی نداری. ${block.text} ⏳` : 'درخواست فعالی نداری. یه درخواست تازه بذار ✍️'}
              </button>
            )}

            {ended.length ? (
              <section className="mt-6 space-y-3">
                <SectionTitle tight>قبلی‌ها (۷ روز اخیر)</SectionTitle>
                {ended.map(card)}
              </section>
            ) : null}

            <GroupCard link={group?.link} />
          </>
        )}
      </PullRefresh>
      <LikersSheet post={likersOf} onClose={() => setLikersOf(null)} />
      <RequestsSheet post={requestsOf} onClose={() => setRequestsOf(null)} />
    </div>
  );
}
