import { Lock, Star } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useLikes } from '@/api/queries';
import type { LikeItem } from '@/api/types';
import { fa } from '@/lib/format';
import { nav } from '@/store/nav';
import { Button, EmptyState, ErrorState, Img, Loading, ScreenHeader, Spinner } from '@/ui/kit';
import { useUi } from '@/store/ui';
import { PullRefresh } from '@/ui/PullRefresh';

/**
 * Everyone who ever liked me, newest first. A like never leaves the list: answering it (liking
 * back, passing) only puts a label on it. Members see them all; everyone else sees their first few
 * likes for free (a newcomer finds out who's interested right away), the people they matched or
 * liked back, and blurred teasers for the rest.
 */
export default function Likes() {
  const likes = useLikes();
  // opened from the home header: fresh list, and the «new likes» badge is now seen
  useEffect(() => {
    void likes.refetch();
    useUi.getState().setBadges({ likes: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = likes.data?.pages.flatMap((p) => p.items) ?? [];
  const total = likes.data?.pages[0]?.total ?? 0;
  const locked = items.some((i) => !i.user);

  // the next page comes by itself as the end of the list nears
  const end = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = likes;
  useEffect(() => {
    const el = end.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;
    const watcher = new IntersectionObserver((e) => e[0]?.isIntersecting && void fetchNextPage(), { rootMargin: '400px' });
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);

  const open = (it: LikeItem) => {
    if (it.state === 'matched' && it.matchId) return nav.push({ name: 'chat', matchId: it.matchId });
    if (!it.user) return nav.push({ name: 'premium', reason: 'likes' });
    // only a like I haven't answered can still be answered from the profile
    nav.push({ name: 'profile', userId: it.user.id, card: it.user, actions: it.state === 'new' ? 'swipe' : 'none' });
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="لایک‌ها" sub={total > 0 ? `${fa(total >= 1000 ? '۹۹۹+' : total)} نفر لایکت کردن` : undefined} />
      <PullRefresh onRefresh={() => likes.refetch()} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4" style={{ paddingBottom: 'calc(var(--safe-bottom) + 24px)' }}>
        {likes.isLoading ? (
          <Loading />
        ) : likes.isError ? (
          <ErrorState message="لایک‌ها دریافت نشد" onRetry={() => likes.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            emoji="💌"
            title="هنوز لایکی نداری"
            subtitle="عکس‌های بیشتر و بیوی جذاب یعنی لایک بیشتر. پروفایلت رو کامل کن!"
            action={
              <Button variant="soft" className="w-full" onClick={() => nav.push({ name: 'editProfile' })}>
                ✏️ تکمیل پروفایل
              </Button>
            }
          />
        ) : (
          <>
            {locked ? (
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => nav.push({ name: 'premium', reason: 'likes' })}
                className="relative mb-4 w-full overflow-hidden rounded-card bg-gold p-4 text-right text-[#3a2400]"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[34px]">👀</span>
                  <div className="flex-1">
                    <div className="text-[16px] font-extrabold">ببین کیا لایکت کردن</div>
                    <div className="text-[12.5px] opacity-80">
                      {items.some((i) => i.free) ? 'اولین لایک‌هات رایگان باز شد 🎁 بقیه رو با عضویت ویژه ببین' : 'با عضویت ویژه همه رو ببین و فوری مچ شو'}
                    </div>
                  </div>
                  <span className="rounded-full bg-black/15 px-3 py-1.5 text-[12px] font-bold">💎 ویژه</span>
                </div>
              </motion.button>
            ) : null}
            <div className="grid grid-cols-2 gap-3 pb-4">
              {items.map((it, i) => (
                <motion.button
                  key={it.user?.id ?? i}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 10) * 0.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => open(it)}
                  className="relative aspect-[3/4] overflow-hidden rounded-card border border-line bg-surface-2"
                >
                  {it.user ? (
                    <Img src={it.user.photos[0]?.md} color={it.user.photos[0]?.color} className={`absolute inset-0 ${it.state === 'passed' ? 'opacity-55' : ''}`} />
                  ) : (
                    <Img src={it.blur} className="absolute inset-0" blur />
                  )}
                  {it.state === 'matched' ? (
                    <span className="absolute top-2.5 left-2.5 rounded-full bg-mint px-2 py-0.5 text-[10.5px] font-bold text-night shadow-[0_0_14px_rgba(46,229,157,0.6)]">
                      💬 مچ شدید
                    </span>
                  ) : it.state === 'liked' ? (
                    <span className="absolute top-2.5 left-2.5 rounded-full bg-rose/90 px-2 py-0.5 text-[10.5px] font-bold text-white">❤️ لایکش کردی</span>
                  ) : it.state === 'passed' ? (
                    <span className="absolute top-2.5 left-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[10.5px] font-semibold text-ink/90">رد کرده بودی</span>
                  ) : it.free ? (
                    <span className="absolute top-2.5 left-2.5 rounded-full bg-mint px-2 py-0.5 text-[10.5px] font-bold text-night shadow-[0_0_14px_rgba(46,229,157,0.6)]">
                      🎁 رایگان
                    </span>
                  ) : null}
                  {it.superLike ? (
                    <span className="absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-full bg-sky shadow-[0_0_18px_rgba(56,189,248,0.7)]">
                      <Star className="size-4 fill-white text-white" />
                    </span>
                  ) : null}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-night/90 to-transparent px-3 pt-10 pb-3 text-right">
                    {it.user ? (
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[15px] font-bold">{it.user.name}</span>
                        {it.user.age ? <span className="text-[14px] tabular">{fa(it.user.age)}</span> : null}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-1.5 text-[13px] font-semibold text-ink/90">
                        <Lock className="size-4" /> قفل
                      </div>
                    )}
                  </div>
                </motion.button>
              ))}
            </div>
            <div ref={end} className="grid h-10 place-items-center pb-4">
              {isFetchingNextPage ? <Spinner /> : null}
            </div>
          </>
        )}
      </PullRefresh>
    </div>
  );
}
