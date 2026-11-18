import clsx from 'clsx';
import { AlertCircle, ArrowDown, AtSign, Bell, BellOff, Check, CheckCheck, Clock, Copy, CornerUpLeft, Flag, MoreVertical, ShieldBan, User, UserX } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '@/api/client';
import { keys, patchConversation, queryClient, upsertMessage, useConversation, useMe, useMessages } from '@/api/queries';
import type { Message } from '@/api/types';
import { clientId, clock, dayLabel, fa } from '@/lib/format';
import { photoForm, pickImage, prepareImage } from '@/lib/image';
import { sendTyping, setOpenChat } from '@/realtime/socket';
import { nav, useBackHandler } from '@/store/nav';
import { toast, useUi } from '@/store/ui';
import { haptic, openTelegram } from '@/telegram/tg';
import { confirmDialog } from '@/ui/Dialog';
import { Avatar, Loading, Row, Spinner } from '@/ui/kit';
import { Sheet } from '@/ui/Sheet';
import { ReportSheet } from '../profile/ReportSheet';
import { ChatOriginCard } from './ChatOrigin';
import { Composer } from './Composer';

type Pages = { pages: { items: Message[]; hasMore: boolean }[]; pageParams: unknown[] };

export default function Chat({ matchId }: { matchId: string }) {
  const me = useMe().data!;
  const conv = useConversation(matchId);
  const msgs = useMessages(matchId);
  const peer = conv.data?.peer;
  const typingAt = useUi((s) => s.typing[matchId] ?? 0);
  const [now, setNow] = useState(Date.now());
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /** the message being answered, and the one whose actions sheet is open */
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [actions, setActions] = useState<Message | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const lastTyping = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  useBackHandler(!!viewer, () => setViewer(null));
  useBackHandler(!!replyTo && !viewer, () => setReplyTo(null));

  const items = useMemo(() => msgs.data?.pages.flatMap((p) => p.items) ?? [], [msgs.data]);
  const active = conv.data?.active !== false;
  const typing = now - typingAt < 4000;

  // This chat is on screen: its events don't raise toasts and its unread count resets.
  useEffect(() => {
    setOpenChat(matchId);
    return () => setOpenChat(null);
  }, [matchId]);

  useEffect(() => {
    if (!typingAt) return;
    const t = setTimeout(() => setNow(Date.now()), 4100);
    setNow(Date.now());
    return () => clearTimeout(t);
  }, [typingAt]);

  // mark as read up to the newest message from the peer
  const newestPeer = items.find((m) => m.senderId !== me.id && !m.pending);
  useEffect(() => {
    if (!newestPeer) return;
    patchConversation(matchId, (c) => ({ ...c, unread: 0 }));
    const t = setTimeout(() => {
      api.post(`/v1/conversations/${matchId}/read`, { upTo: newestPeer.id }).catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [newestPeer?.id, matchId]);

  const send = async (body: string, replyToId: string | null = null) => {
    const t = body.trim();
    if (!t || !active) return;
    const cid = clientId();
    // a message that hasn't left yet is only an id the server doesn't know
    const answering = replyToId && !replyToId.startsWith('tmp') ? replyToId : null;
    const optimistic: Message = {
      id: 'tmp-' + cid,
      matchId,
      senderId: me.id,
      kind: 'text',
      body: t,
      media: null,
      replyTo: answering,
      clientId: cid,
      deleted: false,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    upsertMessage(matchId, optimistic);
    setReplyTo(null);
    haptic.light();
    scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });
    try {
      const saved = await api.post<Message>(`/v1/conversations/${matchId}/messages`, { text: t, clientId: cid, replyTo: answering ?? undefined });
      upsertMessage(matchId, saved);
    } catch (e) {
      upsertMessage(matchId, { ...optimistic, pending: false, failed: true });
      toast(errorMessage(e), '⚠️', 'error');
    }
  };

  const retry = (m: Message) => {
    queryClient.setQueryData<Pages>(keys.messages(matchId), (old) =>
      old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.filter((x) => x.id !== m.id) })) } : old,
    );
    void send(m.body ?? '', m.replyTo);
  };

  const sendPhoto = async () => {
    const file = await pickImage();
    if (!file) return;
    setUploading(true);
    try {
      const blob = await prepareImage(file);
      const saved = await api.upload<Message>(`/v1/conversations/${matchId}/photos`, photoForm(blob, 'photo', { clientId: clientId() }));
      upsertMessage(matchId, saved);
    } catch (e) {
      toast(e instanceof ApiError && e.code === 'media_too_early' ? e.message : errorMessage(e), '📷', 'error');
    } finally {
      setUploading(false);
    }
  };

  const onType = (v: string) => {
    if (Date.now() - lastTyping.current > 2500 && v) {
      lastTyping.current = Date.now();
      sendTyping(matchId);
    }
  };

  /** Copying a message is the one action that needs no server. */
  const copy = async (m: Message) => {
    setActions(null);
    try {
      await navigator.clipboard.writeText(m.body ?? '');
      toast('پیام کپی شد', '📋');
    } catch {
      toast('کپی نشد', '⚠️', 'error');
    }
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    // column-reverse: scrollTop goes negative towards older messages
    if (el.scrollHeight - el.clientHeight + el.scrollTop < 300 && msgs.hasNextPage && !msgs.isFetchingNextPage) void msgs.fetchNextPage();
    setAtBottom(el.scrollTop > -200);
  };

  const toggleMute = async () => {
    const muted = !conv.data?.muted;
    await api.post(`/v1/conversations/${matchId}/mute`, { muted }).catch(() => undefined);
    patchConversation(matchId, (c) => ({ ...c, muted }));
    toast(muted ? 'اعلان‌های این گفتگو خاموش شد' : 'اعلان‌ها روشن شد', muted ? '🔕' : '🔔');
  };

  const unmatch = async () => {
    setMenu(false);
    if (!(await confirmDialog(`گفتگو با ${peer?.name ?? 'این کاربر'} حذف شود؟ برای هر دو نفر پاک می‌شود.`, 'حذف گفتگو', true))) return;
    await api.del(`/v1/conversations/${matchId}`).catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: keys.conversations });
    nav.pop();
  };

  const block = async () => {
    setMenu(false);
    if (!peer || !(await confirmDialog(`${peer.name} مسدود شود؟ دیگر همدیگر را نمی‌بینید.`, 'مسدود کن', true))) return;
    await api.post('/v1/blocks', { userId: peer.id }).catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: keys.conversations });
    toast('مسدود شد', '🚫');
    nav.pop();
  };

  // icebreakers: a few friendly openers for a conversation that hasn't started yet
  const icebreakers = [
    'سلام! 👋 چه پروفایل باحالی داری',
    'حالت چطوره؟ 😊',
    'اهل کجایی؟',
    'بیشتر اهل کافه‌ای یا طبیعت؟ ☕🌿',
    'بهترین سفری که رفتی کجا بوده؟ ✈️',
  ];

  const peerLastRead = BigInt(conv.data?.peerLastReadId || '0');
  const unread = conv.data?.unread ?? 0;
  // quoted replies are looked up among the messages already loaded
  const byId = useMemo(() => new Map(items.map((m) => [m.id, m])), [items]);

  return (
    <div className="relative flex h-full flex-col">
      {/* header (Telegram's Back button sits in the action bar above) */}
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5 glass">
        <button className="flex min-w-0 flex-1 items-center gap-3 text-right" onClick={() => peer && nav.push({ name: 'profile', userId: peer.id })}>
          <Avatar src={peer?.photo} name={peer?.name} size={44} online={peer?.online} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[16px] font-bold">{peer?.name ?? '…'}</span>
              {peer?.age ? <span className="text-[14px] text-muted tabular">{peer.age.toLocaleString('fa-IR')}</span> : null}
            </div>
            <div className={clsx('text-[12px]', typing ? 'text-mint' : peer?.online ? 'text-mint' : 'text-faint')}>
              {typing ? 'در حال نوشتن…' : peer?.online ? 'آنلاین' : 'برای دیدن پروفایل لمس کن'}
            </div>
          </div>
        </button>
        <button aria-label="گزینه‌ها" onClick={() => setMenu(true)} className="grid size-10 place-items-center rounded-full active:bg-white/10">
          <MoreVertical className="size-5" />
        </button>
      </header>

      {/* messages: column-reverse keeps the view pinned to the newest one */}
      <div ref={scroller} onScroll={onScroll} className="no-scrollbar flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-3 py-3">
        <AnimatePresence initial={false}>
          {typing ? (
            <motion.div key="typing" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex justify-end py-1">
              <div className="flex gap-1 rounded-[20px] rounded-bl-md bg-surface-2 px-4 py-3.5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-2 rounded-full bg-muted animate-typing" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {items.map((m, i) => {
          const older = items[i + 1];
          const showDay = !older || new Date(older.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const mine = m.senderId === me.id;
          const grouped = older && older.kind !== 'system' && older.senderId === m.senderId && !showDay;
          return (
            <div key={m.clientId ?? m.id}>
              {showDay ? (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-surface-2/80 px-3 py-1 text-[11.5px] text-muted">{dayLabel(m.createdAt)}</span>
                </div>
              ) : null}
              {m.kind === 'system' ? (
                <div className="my-2 flex justify-center">
                  <span className="max-w-[85%] rounded-full border border-violet/30 bg-violet/10 px-3.5 py-1.5 text-center text-[12.5px] text-ink/90">
                    {m.body} <span className="text-faint tabular">· {clock(m.createdAt)}</span>
                  </span>
                </div>
              ) : (
              <Bubble
                m={m}
                mine={mine}
                grouped={!!grouped}
                seen={mine && !m.pending && !m.id.startsWith('tmp') && BigInt(m.id) <= peerLastRead}
                replied={m.replyTo ? (byId.get(m.replyTo) ?? null) : null}
                repliedMine={m.replyTo ? byId.get(m.replyTo)?.senderId === me.id : false}
                peerName={peer?.name ?? ''}
                onRetry={() => retry(m)}
                onView={setViewer}
                onActions={() => active && setActions(m)}
              />
              )}
            </div>
          );
        })}

        {/* the very top of the conversation: how it started */}
        {conv.data && !msgs.isLoading && !msgs.hasNextPage && items.length > 0 ? (
          <ChatOriginCard origin={conv.data.origin} meId={me.id} name={peer?.name ?? ''} since={conv.data.createdAt} />
        ) : null}

        {msgs.isFetchingNextPage ? (
          <div className="flex justify-center py-3">
            <Spinner className="size-5" />
          </div>
        ) : null}

        {msgs.isLoading ? <Loading /> : null}
        {!msgs.isLoading && items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
            <Avatar src={peer?.photo} name={peer?.name} size={96} ring />
            <h2 className="mt-4 text-[18px] font-bold">با {peer?.name} مچ شدی 💘</h2>
            {conv.data ? <ChatOriginCard origin={conv.data.origin} meId={me.id} name={peer?.name ?? ''} since={conv.data.createdAt} /> : null}
            <p className="mt-1.5 text-[13.5px] text-muted">اولین پیام رو تو بفرست؛ شانس جواب گرفتن خیلی بیشتره!</p>
          </div>
        ) : null}
      </div>

      {items.length === 0 && active && !msgs.isLoading ? (
        <div className="no-scrollbar flex shrink-0 gap-2 overflow-x-auto px-3 pb-2">
          {icebreakers.map((t) => (
            <motion.button
              key={t}
              whileTap={{ scale: 0.95 }}
              onClick={() => void send(t)}
              className="shrink-0 rounded-full border border-rose/40 bg-rose/10 px-3.5 py-2 text-[13px] whitespace-nowrap"
            >
              {t}
            </motion.button>
          ))}
        </div>
      ) : null}

      {/* back to the newest message */}
      <AnimatePresence>
        {!atBottom ? (
          <motion.button
            initial={{ opacity: 0, scale: 0.8, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 8 }}
            onClick={() => scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label="جدیدترین پیام‌ها"
            className="absolute bottom-24 left-4 z-10 grid size-11 place-items-center rounded-full border border-line glass shadow-[0_10px_28px_-10px_rgba(0,0,0,0.9)]"
          >
            <ArrowDown className="size-5" />
            {unread > 0 ? (
              <span className="absolute -top-1 -left-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose px-1 text-[10px] font-bold text-white">
                {fa(unread > 99 ? '۹۹+' : unread)}
              </span>
            ) : null}
          </motion.button>
        ) : null}
      </AnimatePresence>

      {/* composer */}
      {active ? (
        <Composer
          matchId={matchId}
          replyTo={replyTo}
          replyName={replyTo?.senderId === me.id ? 'خودت' : (peer?.name ?? '')}
          onCancelReply={() => setReplyTo(null)}
          onSend={(t, r) => void send(t, r)}
          onPhoto={sendPhoto}
          uploading={uploading}
          onTyping={onType}
        />
      ) : (
        <div className="shrink-0 border-t border-line px-4 pt-3 pb-safe text-center text-[13px] text-muted">
          <p className="mb-3">این گفتگو بسته شده است.</p>
        </div>
      )}

      <Sheet open={menu} onClose={() => setMenu(false)}>
        <div className="-mx-5 divide-y divide-line">
          <Row icon={<User />} tint="violet" title="دیدن پروفایل" onClick={() => (setMenu(false), peer && nav.push({ name: 'profile', userId: peer.id }))} />
          {peer?.telegramUsername ? (
            <Row icon={<AtSign />} tint="sky" title="پیام در تلگرام" subtitle={'@' + peer.telegramUsername} onClick={() => openTelegram(`https://t.me/${peer.telegramUsername}`)} />
          ) : null}
          <Row
            icon={conv.data?.muted ? <Bell /> : <BellOff />}
            tint="gold"
            title={conv.data?.muted ? 'روشن کردن اعلان‌ها' : 'بی‌صدا کردن'}
            onClick={() => (setMenu(false), void toggleMute())}
            chevron={false}
          />
          <Row icon={<UserX />} tint="ember" title="حذف مچ" onClick={unmatch} chevron={false} />
          <Row icon={<Flag />} tint="danger" title="گزارش" onClick={() => (setMenu(false), setReport(true))} chevron={false} />
          <Row icon={<ShieldBan />} tint="danger" title="مسدود کردن" onClick={block} chevron={false} />
        </div>
      </Sheet>
      {peer ? <ReportSheet open={report} onClose={() => setReport(false)} userId={peer.id} name={peer.name} matchId={matchId} onDone={() => nav.pop()} /> : null}

      <Sheet open={!!actions} onClose={() => setActions(null)}>
        <div className="-mx-5 divide-y divide-line">
          <Row
            icon={<CornerUpLeft />}
            tint="violet"
            title="پاسخ به این پیام"
            onClick={() => {
              const m = actions;
              setActions(null);
              setReplyTo(m);
            }}
            chevron={false}
          />
          {actions?.kind === 'text' && !actions.deleted ? (
            <Row icon={<Copy />} tint="sky" title="کپی متن" onClick={() => void copy(actions)} chevron={false} />
          ) : null}
        </div>
      </Sheet>

      <AnimatePresence>
        {viewer ? (
          <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/95" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setViewer(null)}>
            <motion.img src={viewer} alt="" className="max-h-full max-w-full object-contain" initial={{ scale: 0.9 }} animate={{ scale: 1 }} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Bubble({
  m,
  mine,
  grouped,
  seen,
  replied,
  repliedMine,
  peerName,
  onRetry,
  onView,
  onActions,
}: {
  m: Message;
  mine: boolean;
  grouped: boolean;
  seen: boolean;
  /** the message this one answers, when it is among the ones loaded */
  replied: Message | null;
  repliedMine: boolean;
  peerName: string;
  onRetry: () => void;
  onView: (url: string) => void;
  onActions: () => void;
}) {
  const [revealed, setRevealed] = useState(mine);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  // press and hold opens the actions, the way every chat app does it
  const hold = {
    onPointerDown: () => {
      held.current = false;
      press.current = setTimeout(() => {
        held.current = true;
        haptic.medium();
        onActions();
      }, 420);
    },
    onPointerUp: () => {
      if (press.current) clearTimeout(press.current);
    },
    onPointerLeave: () => {
      if (press.current) clearTimeout(press.current);
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };

  // the tail sits on the last bubble of a run, so a burst reads as one block
  const tail = mine ? 'rounded-br-md' : 'rounded-bl-md';
  const radius = clsx('rounded-[20px]', grouped ? (mine ? 'rounded-tr-md' : 'rounded-tl-md') : '', tail);

  return (
    <motion.div
      initial={m.pending ? { opacity: 0, y: 10, scale: 0.98 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={clsx('flex', mine ? 'justify-start' : 'justify-end', grouped ? 'mt-1' : 'mt-2.5')}
    >
      <div className={clsx('max-w-[78%]', m.failed && 'opacity-70')} onClick={m.failed ? onRetry : undefined}>
        {m.kind === 'image' && m.media ? (
          <button
            {...hold}
            className={clsx('relative block overflow-hidden', radius)}
            style={{ width: 220, aspectRatio: `${m.media.width} / ${m.media.height}`, maxHeight: 320, backgroundColor: m.media.color ?? undefined }}
            onClick={() => {
              if (held.current) return;
              revealed ? onView(m.media!.url) : setRevealed(true);
            }}
          >
            <img src={revealed ? m.media.url : m.media.blur} alt="" className={clsx('size-full object-cover', !revealed && 'scale-110 blur-xl')} />
            {!revealed ? <span className="absolute inset-0 grid place-items-center text-[13px] font-semibold">👀 لمس برای دیدن</span> : null}
          </button>
        ) : (
          <div
            {...hold}
            className={clsx(
              'overflow-hidden px-4 py-2.5 text-[15px] leading-7',
              radius,
              mine ? 'bg-royal text-white' : 'bg-surface-2 text-ink',
            )}
          >
            {m.replyTo ? (
              <div
                className={clsx(
                  'mb-1.5 -mx-1 rounded-xl border-r-[3px] px-2.5 py-1.5 text-right',
                  mine ? 'border-white/70 bg-black/15' : 'border-rose bg-black/20',
                )}
              >
                <span className={clsx('block text-[11.5px] font-bold', mine ? 'text-white/85' : 'text-rose')}>
                  {replied ? (repliedMine ? 'خودت' : peerName) : 'پاسخ'}
                </span>
                <span className={clsx('block truncate text-[12.5px]', mine ? 'text-white/75' : 'text-muted')}>
                  {!replied ? 'پیام قدیمی‌تر' : replied.kind === 'image' ? '📷 عکس' : replied.deleted ? 'پیام حذف‌شده' : replied.body}
                </span>
              </div>
            ) : null}
            <span className="whitespace-pre-wrap break-words">{m.deleted ? <i className="opacity-60">این پیام حذف شده</i> : m.body}</span>
          </div>
        )}
        <div className={clsx('mt-0.5 flex items-center gap-1 px-1.5 text-[10.5px] text-faint', mine ? 'justify-start' : 'justify-end')}>
          <span className="tabular">{clock(m.createdAt)}</span>
          {mine ? (
            m.failed ? (
              <span className="flex items-center gap-0.5 text-danger">
                <AlertCircle className="size-3.5" /> ارسال نشد، لمس کن
              </span>
            ) : m.pending ? (
              <Clock className="size-3.5" />
            ) : seen ? (
              <CheckCheck className="size-4 text-sky" />
            ) : (
              <Check className="size-4" />
            )
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}
