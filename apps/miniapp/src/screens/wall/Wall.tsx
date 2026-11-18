import { useQuery } from '@tanstack/react-query';
import { ArrowUp, ChevronLeft, ClipboardList, Plus, Send, SlidersHorizontal, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/api/client';
import { keys, queryClient, useMe, useMeta, useMyWall, useWallFeed, wallParams } from '@/api/queries';
import type { WallFilters, WallPage, WallPost } from '@/api/types';
import { nav } from '@/store/nav';
import { haptic, openTelegram } from '@/telegram/tg';
import { Button, EmptyState, ErrorState, IconButton, ScreenHeader, Spinner } from '@/ui/kit';
import { PullRefresh } from '@/ui/PullRefresh';
import { TAB_BAR_SPACE } from '../Shell';
import { DEFAULT_WALL_FILTERS, restrictiveCount, WallFilterSheet } from './Filters';
import { lookingForPlural, PostCard } from './PostCard';
import { startCompose } from './posting';
import { LikersSheet, WallMessageSheet } from './Sheets';

/**
 * The Wall: public «looking for…» requests, newest first. By default it shows only requests the
 * user can answer. A reader can like a request or write to its author — the message goes straight
 * through and the conversation opens. «My requests» and the filters sit behind header buttons.
 */
export function Wall({ active }: { active: boolean }) {
  const meta = useMeta();
  const me = useMe().data;
  const [filters, setFilters] = useState<WallFilters>(DEFAULT_WALL_FILTERS);
  const feed = useWallFeed(filters);
  const mine = useMyWall();
  const [filterOpen, setFilterOpen] = useState(false);
  const [writeTo, setWriteTo] = useState<WallPost | null>(null);
  const [likersOf, setLikersOf] = useState<WallPost | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // fresh content whenever the tab is opened
  useEffect(() => {
    if (!active) return;
    void feed.refetch();
    void mine.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // «new requests» pill: a 1-item peek every 30 s while the tab is open
  const head = useQuery({
    queryKey: ['wall', 'head', filters],
    queryFn: () => api.get<WallPage>(`/v1/wall?${wallParams(filters, 1)}`),
    refetchInterval: active ? 30_000 : false,
    enabled: active && !!feed.data,
  });
  const newestShown = feed.data?.pages[0]?.items[0]?.id;
  const newestThere = head.data?.items[0];
  const hasNew = !!newestThere && !!newestShown && newestThere.id !== newestShown;

  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  const group = meta.data?.wall?.group;
  const narrowed = restrictiveCount(filters);

  const showNew = () => {
    haptic.light();
    scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });
    void queryClient.resetQueries({ queryKey: keys.wallFeed(filters) });
  };

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 700 && feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
  };

  const compose = () => startCompose(mine.data);

  if (meta.data?.wall && !meta.data.wall.enabled) {
    return <EmptyState emoji="🧱" title="دیوار فعلاً بسته است" subtitle="به‌زودی برمی‌گردیم 🙂" />;
  }

  // what the active narrowing filters are, as removable chips under the header
  const activeChips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.gender) {
    activeChips.push({ key: 'g', label: filters.gender === 'female' ? '👩 نوشته‌ی خانم‌ها' : '👨 نوشته‌ی آقایان', clear: () => setFilters((f) => ({ ...f, gender: undefined })) });
  }

  return (
    <div className="relative flex h-full flex-col">
      <ScreenHeader
        title="دیوار"
        actions={
          <>
            <IconButton label="درخواست‌های من" onClick={() => nav.push({ name: 'wallMine' })}>
              <ClipboardList className="size-5" />
            </IconButton>
            <IconButton label="فیلترها" badge={narrowed > 0} onClick={() => setFilterOpen(true)}>
              <SlidersHorizontal className="size-5" />
            </IconButton>
          </>
        }
      />

      <AnimatePresence initial={false}>
        {activeChips.length ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="no-scrollbar flex shrink-0 gap-2 overflow-x-auto px-4 pb-2"
          >
            {activeChips.map((c) => (
              <button
                key={c.key}
                onClick={() => {
                  haptic.select();
                  c.clear();
                }}
                className="flex shrink-0 items-center gap-1 rounded-full border border-rose/30 bg-rose/10 py-1.5 pr-3 pl-2 text-[12.5px] font-semibold"
              >
                {c.label}
                <X className="size-3.5 text-muted" />
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <PullRefresh
        onRefresh={() => Promise.all([feed.refetch(), mine.refetch(), head.refetch()])}
        ref={scroller}
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pt-1"
        style={{ paddingBottom: `calc(${TAB_BAR_SPACE} + 76px)` }}
        onScroll={onScroll}
      >
        {feed.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-52 rounded-panel skeleton" />
            ))}
          </div>
        ) : feed.isError ? (
          <ErrorState message="دیوار دریافت نشد" onRetry={() => feed.refetch()} />
        ) : items.length === 0 ? (
          <>
            <EmptyState
              emoji={narrowed || filters.forMe ? '🔍' : '🧱'}
              title={narrowed ? 'با این فیلترها درخواستی نیست' : filters.forMe ? 'فعلاً درخواستی برای تو نیست' : 'دیوار خالیه!'}
              subtitle={
                filters.forMe && me?.gender
                  ? `الان فقط درخواست‌هایی رو می‌بینی که برای ${lookingForPlural(me.gender)} نوشته شدن. خودت هم می‌تونی اولین نفر باشی!`
                  : 'اولین نفر باش؛ بنویس دنبال چی هستی تا بقیه باهات آشنا بشن.'
              }
              action={
                <div className="space-y-2.5">
                  <Button className="w-full" onClick={compose}>
                    ✍️ ثبت درخواست
                  </Button>
                  {filters.forMe || narrowed ? (
                    <Button variant="soft" className="w-full" onClick={() => setFilters({ forMe: false })}>
                      نمایش همه‌ی درخواست‌ها
                    </Button>
                  ) : null}
                </div>
              }
            />
            <GroupCard link={group?.link} />
          </>
        ) : (
          <div className="space-y-3">
            {items.map((p, i) => (
              <motion.div key={p.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 5) * 0.04 }}>
                <PostCard post={p} compact onMessage={setWriteTo} onLikers={setLikersOf} />
              </motion.div>
            ))}
            {feed.isFetchingNextPage ? (
              <div className="flex justify-center py-4">
                <Spinner className="size-6" />
              </div>
            ) : !feed.hasNextPage ? (
              <>
                <p className="pt-4 pb-1 text-center text-[12.5px] text-faint">به آخر دیوار رسیدی ✨</p>
                <GroupCard link={group?.link} />
              </>
            ) : null}
          </div>
        )}
      </PullRefresh>

      {/* new requests arrived while reading */}
      <AnimatePresence>
        {hasNew ? (
          <motion.button
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            onClick={showNew}
            className="absolute top-[66px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-flame px-4 py-2 text-[13px] font-bold shadow-[0_10px_30px_-8px_rgba(255,45,111,0.9)]"
          >
            <ArrowUp className="size-4" /> درخواست‌های تازه
          </motion.button>
        ) : null}
      </AnimatePresence>

      {/* compose */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={compose}
        aria-label="ثبت درخواست"
        className="absolute right-4 z-10 grid size-14 place-items-center rounded-full bg-flame-d text-white shadow-[0_14px_34px_-10px_rgba(255,45,111,0.95)]"
        style={{ bottom: `calc(${TAB_BAR_SPACE} + 10px)` }}
      >
        <Plus className="size-7" strokeWidth={2.4} />
      </motion.button>

      <WallFilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} value={filters} onApply={setFilters} />
      <WallMessageSheet post={writeTo} onClose={() => setWriteTo(null)} />
      <LikersSheet post={likersOf} onClose={() => setLikersOf(null)} />
    </div>
  );
}

/** The Wall's Telegram group, if the admin set one. */
export function GroupCard({ link }: { link?: string | null }) {
  if (!link) return null;
  return (
    <button onClick={() => openTelegram(link)} className="mt-3 flex w-full items-center gap-3 rounded-card border border-sky/25 bg-sky/[0.08] p-3 text-right">
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-sky/20 text-sky">
        <Send className="size-5 -scale-x-100" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold">گروه دیوار در تلگرام</span>
        <span className="block truncate text-[12px] text-muted">درخواست‌ها اونجا هم منتشر می‌شن؛ عضو شو</span>
      </span>
      <ChevronLeft className="size-5 text-faint" />
    </button>
  );
}
