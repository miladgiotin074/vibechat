import clsx from 'clsx';
import { Archive, BellOff, Check, CheckCheck, ChevronLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useArchivedConversations, useConversations, useMe } from '@/api/queries';
import type { Conversation } from '@/api/types';
import { fa, shortTime } from '@/lib/format';
import { nav } from '@/store/nav';
import { useUi } from '@/store/ui';
import { Avatar, Button, EmptyNote, EmptyState, ErrorState, Loading, ScreenHeader, SectionTitle } from '@/ui/kit';
import { Sheet } from '@/ui/Sheet';
import { TAB_BAR_SPACE } from '../Shell';
import { PullRefresh } from '@/ui/PullRefresh';

export function Chats() {
  const q = useConversations();
  const me = useMe().data;
  const typing = useUi((s) => s.typing);
  const items = q.data?.items ?? [];
  const fresh = items.filter((c) => !c.lastMessage && c.active);
  const talks = items.filter((c) => c.lastMessage);
  const archivedCount = q.data?.archivedCount ?? 0;
  const [archive, setArchive] = useState(false);
  const archiveRow = archivedCount ? (
    <button onClick={() => setArchive(true)} className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-center gap-3 rounded-2xl border border-line bg-surface-1 px-4 py-3 text-right">
      <Archive className="size-5 shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold">مچ‌های بایگانی‌شده · {fa(archivedCount)}</span>
        <span className="block truncate text-[12px] text-muted">مچ‌هایی که هنوز کسی توشون سلام نکرده</span>
      </span>
      <ChevronLeft className="size-5 shrink-0 text-faint" />
    </button>
  ) : null;

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="گفتگوها" />
      <PullRefresh onRefresh={() => q.refetch()} className="no-scrollbar min-h-0 flex-1 overflow-y-auto" style={{ paddingBottom: TAB_BAR_SPACE }}>
        {q.isLoading ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState message="گفتگوها دریافت نشد" onRetry={() => q.refetch()} />
        ) : items.length === 0 ? (
          <>
          <EmptyState
            emoji="💬"
            title="هنوز مچی نداری"
            subtitle="آدم‌ها رو لایک کن؛ وقتی اونا هم لایکت کنن، اینجا با هم گپ می‌زنید."
            action={
              <Button className="w-full" onClick={() => nav.setTab('discover')}>
                🔥 برو به کشف
              </Button>
            }
          />
          {archiveRow}
          </>
        ) : (
          <>
            {fresh.length ? (
              <section className="pt-1">
                <SectionTitle className="px-4" tight>
                  مچ‌های جدید
                </SectionTitle>
                <div className="no-scrollbar flex gap-3.5 overflow-x-auto px-4 pb-3">
                  {fresh.map((c) => (
                    <motion.button
                      key={c.id}
                      whileTap={{ scale: 0.93 }}
                      onClick={() => nav.push({ name: 'chat', matchId: c.id })}
                      className="flex w-[72px] shrink-0 flex-col items-center gap-1.5"
                    >
                      <Avatar src={c.peer?.photo} name={c.peer?.name} size={68} ring online={c.peer?.online} />
                      <span className="w-full truncate text-center text-[12.5px] font-medium">{c.peer?.name}</span>
                    </motion.button>
                  ))}
                </div>
              </section>
            ) : null}
            {talks.length ? <SectionTitle className="px-4 pt-2 pb-1">پیام‌ها</SectionTitle> : null}
            <ul>
              {talks.map((c) => (
                <ChatRow key={c.id} c={c} meId={me?.id} typing={Date.now() - (typing[c.id] ?? 0) < 4000} />
              ))}
            </ul>
            {archiveRow}
          </>
        )}
      </PullRefresh>
      <ArchiveSheet open={archive} onClose={() => setArchive(false)} />
    </div>
  );
}

/** Matches where nobody wrote for two weeks. Saying hello brings one back to the main list. */
function ArchiveSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useArchivedConversations(open);
  const items = q.data?.items ?? [];
  return (
    <Sheet open={open} onClose={onClose} title="مچ‌های بایگانی‌شده">
      <p className="-mt-1 mb-3 text-[12.5px] leading-6 text-muted">این مچ‌ها هنوز سر جاشونن؛ فقط چون کسی پیام نداده، از لیست اصلی کنار رفتن. با اولین پیام برمی‌گردن.</p>
      {q.isLoading ? (
        <Loading className="py-10" />
      ) : items.length === 0 ? (
        <EmptyNote emoji="🗂" title="بایگانی خالیه" subtitle="مچ‌هایی که دو هفته بی‌پیام بمونن، اینجا میان." />
      ) : (
        <ul className="-mx-2">
          {items.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => {
                  onClose();
                  nav.push({ name: 'chat', matchId: c.id });
                }}
                className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-right active:bg-white/5"
              >
                <Avatar src={c.peer?.photo} name={c.peer?.name} size={50} online={c.peer?.online} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                    <span className="truncate">{c.peer?.name ?? 'کاربر'}</span>
                  </span>
                  <span className="block text-[12px] text-muted">یه سلام بده 👋</span>
                </span>
                <ChevronLeft className="size-5 shrink-0 text-faint" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function ChatRow({ c, meId, typing }: { c: Conversation; meId?: string; typing: boolean }) {
  const mine = c.lastMessage?.senderId === meId;
  const seen = mine && c.lastMessage && BigInt(c.peerLastReadId || '0') >= BigInt(c.lastMessage.id);
  const unread = c.unread > 0;
  return (
    <li>
      <button onClick={() => nav.push({ name: 'chat', matchId: c.id })} className="flex w-full items-center gap-3 px-4 py-2.5 text-right active:bg-white/[0.04]">
        <Avatar src={c.peer?.photo} name={c.peer?.name} size={58} online={c.peer?.online} />
        <div className="min-w-0 flex-1 border-b border-line pb-2.5">
          <div className="flex items-center gap-1.5">
            <span className={clsx('truncate text-[15.5px]', unread ? 'font-bold' : 'font-semibold')}>{c.peer?.name ?? 'کاربر'}</span>
            {c.muted ? <BellOff className="size-3.5 text-faint" /> : null}
            <span className="flex-1" />
            <span className={clsx('shrink-0 text-[11.5px]', unread ? 'text-rose' : 'text-faint')}>{shortTime(c.lastMessage?.createdAt)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            {mine && !typing ? (
              seen ? <CheckCheck className="size-4 shrink-0 text-sky" /> : <Check className="size-4 shrink-0 text-faint" />
            ) : null}
            <span className={clsx('flex-1 truncate text-[13.5px]', typing ? 'text-mint' : unread ? 'text-ink' : 'text-muted')}>
              {typing ? 'در حال نوشتن…' : !c.active ? 'این گفتگو بسته شده' : c.lastMessage?.preview}
            </span>
            {unread ? (
              <span className={clsx('grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-bold', c.muted ? 'bg-surface-3 text-muted' : 'bg-rose text-white')}>
                {fa(c.unread > 99 ? '99+' : c.unread)}
              </span>
            ) : null}
          </div>
        </div>
      </button>
    </li>
  );
}
