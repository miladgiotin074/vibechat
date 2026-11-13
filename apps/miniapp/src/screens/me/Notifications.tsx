import clsx from 'clsx';
import { motion } from 'motion/react';
import { useEffect } from 'react';
import { api } from '@/api/client';
import { keys, queryClient, useNotifications } from '@/api/queries';
import type { NotificationItem } from '@/api/types';
import { ago } from '@/lib/format';
import { nav } from '@/store/nav';
import { useUi } from '@/store/ui';
import { EmptyState, ErrorState, Loading, ScreenHeader } from '@/ui/kit';

const ICON: Record<string, string> = {
  match: '🔥',
  like: '❤️',
  super_like: '⭐',
  message: '💬',
  photo: '📷',
  premium: '💎',
  referral: '🎁',
  wall_like: '💗',
  wall_chat: '💌',
  wall_request: '💌',
  match_nudge: '👋',
  wall_accept: '🎉',
  system: '📢',
};

function open(n: NotificationItem) {
  const d = n.data ?? {};
  if ((n.type === 'match' || n.type === 'match_nudge') && typeof d.matchId === 'string') return nav.push({ name: 'chat', matchId: d.matchId });
  if (n.type === 'super_like' || n.type === 'like') return nav.push({ name: 'likes' });
  if (n.type === 'referral') return nav.push({ name: 'invite' });
  if (n.type === 'wall_chat' && typeof d.matchId === 'string') return nav.push({ name: 'chat', matchId: d.matchId });
  if (n.type === 'wall_accept' && typeof d.matchId === 'string') return nav.push({ name: 'chat', matchId: d.matchId });
  if (n.type === 'wall_request') return nav.push({ name: 'wallInbox' });
  if (n.type === 'wall_like' && typeof d.postId === 'string') return nav.push({ name: 'wallPost', postId: d.postId });
  if (n.type === 'premium') return nav.push({ name: 'premium' });
  if (n.type === 'photo') return nav.push({ name: 'editProfile' });
}

export default function Notifications() {
  const q = useNotifications();
  const items = q.data?.items ?? [];

  useEffect(() => {
    const newest = q.data?.items[0];
    if (!newest || newest.read) return;
    useUi.getState().setBadges({ notifications: 0 });
    api
      .post('/v1/notifications/read', { upTo: newest.id })
      .then(() => queryClient.invalidateQueries({ queryKey: keys.summary }))
      .catch(() => undefined);
  }, [q.data]);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="اعلان‌ها" />
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {q.isLoading ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState message="اعلان‌ها دریافت نشد" onRetry={() => q.refetch()} />
        ) : !items.length ? (
          <EmptyState emoji="🔔" title="هنوز خبری نیست" subtitle="مچ‌ها، سوپرلایک‌ها و هدیه‌ها اینجا نشون داده می‌شن." />
        ) : (
          <ul className="space-y-2">
            {items.map((n, i) => (
              <motion.li key={n.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.025 }}>
                <button
                  onClick={() => open(n)}
                  className={clsx('flex w-full items-start gap-3 rounded-card border p-4 text-right', n.read ? 'border-line bg-surface-1' : 'border-rose/30 bg-rose/[0.07]')}
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-[22px]">{ICON[n.type] ?? '🔔'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-semibold">{n.title}</span>
                    {n.body ? <span className="mt-0.5 block text-[13px] leading-6 text-muted">{n.body}</span> : null}
                    <span className="mt-1 block text-[11.5px] text-faint">{ago(n.createdAt)}</span>
                  </span>
                  {!n.read ? <span className="mt-2 size-2 shrink-0 rounded-full bg-rose" /> : null}
                </button>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
