import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '@/api/client';
import { keys, patchWallPost, queryClient, useWallRequests } from '@/api/queries';
import type { WallChatRequest, WallPost } from '@/api/types';
import { ago, fa } from '@/lib/format';
import { nav } from '@/store/nav';
import { toast } from '@/store/ui';
import { haptic } from '@/telegram/tg';
import { confirmDialog } from '@/ui/Dialog';
import { Avatar, Button, EmptyNote, Loading } from '@/ui/kit';
import { Sheet } from '@/ui/Sheet';
import { answerRequest, ReceivedRequestCard } from './RequestCards';

const MAX_INTRO = 500;

/**
 * «درخواست گفتگو»: nobody can message a request's author directly. You introduce yourself in a
 * line; the author sees it with your profile and accepts (the conversation opens with your line)
 * or declines.
 */
export function ChatRequestSheet({ post, onClose }: { post: WallPost | null; onClose: () => void }) {
  const name = post?.author?.name ?? '';
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (post) setText(`سلام ${name}! درخواستت رو روی دیوار دیدم 😊 `);
  }, [post, name]);

  const suggestions = ['منم دنبال همین بودم!', 'خوشحال می‌شم آشنا بشیم 🙂', 'از کجایی؟'];

  const send = async () => {
    if (!post || !text.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ status: 'pending' | 'accepted'; matchId?: string }>(`/v1/wall/${post.id}/chat`, { text: text.trim() });
      haptic.success();
      onClose();
      if (r.status === 'accepted' && r.matchId) {
        // already talking to each other
        patchWallPost(post.id, (p) => ({ ...p, matchId: r.matchId! }));
        nav.push({ name: 'chat', matchId: r.matchId });
        return;
      }
      patchWallPost(post.id, (p) => ({ ...p, myRequest: 'pending' }));
      toast(`درخواستت برای ${name} رفت. اگه قبول کنه خبرت می‌کنیم 💌`, '📨', 'success');
    } catch (e) {
      haptic.error();
      const code = e instanceof ApiError ? e.code : undefined;
      if (code === 'wall_request_pending') patchWallPost(post.id, (p) => ({ ...p, myRequest: 'pending' }));
      if (code === 'wall_request_declined') patchWallPost(post.id, (p) => ({ ...p, myRequest: 'declined' }));
      toast(errorMessage(e), '⚠️', 'error');
      if (code === 'wall_chat_limit') {
        onClose();
        nav.push({ name: 'premium', reason: 'wall' });
      } else if (code === 'wall_request_pending' || code === 'wall_request_declined' || code === 'wall_expired') {
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!post} onClose={onClose}>
      {post ? (
        <div>
          <div className="flex items-center gap-3">
            <Avatar src={post.author?.thumb} name={name} size={52} online={post.author?.online} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[16px] font-bold">
                درخواست گفتگو با {name}
              </div>
              <p className="line-clamp-1 text-[12.5px] text-muted">«{post.text}»</p>
            </div>
          </div>
          <div className="mt-4 flex gap-2.5 rounded-2xl border border-violet/25 bg-violet/[0.08] px-3.5 py-3 text-[12.5px] leading-6 text-ink/85">
            <span className="text-[16px]">🔐</span>
            <span>
              {name} اول پروفایل و پیامت رو می‌بینه؛ اگه قبول کنه گفتگوتون با همین پیام شروع می‌شه. شماره و آیدی نفرست.
            </span>
          </div>
          <div className="relative mt-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_INTRO))}
              rows={3}
              autoFocus
              placeholder="خودت رو معرفی کن…"
              className="w-full resize-none rounded-2xl border border-line bg-surface-2 px-4 py-3 pb-6 text-[15px] leading-7 outline-none focus:border-rose/60"
            />
            <span className="pointer-events-none absolute bottom-2.5 left-3 text-[11px] text-faint tabular">
              {fa([...text].length)}/{fa(MAX_INTRO)}
            </span>
          </div>
          <div className="no-scrollbar -mx-5 mt-2 flex gap-2 overflow-x-auto px-5">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => {
                  haptic.select();
                  setText((t) => `${t.trim()} ${s}`.trim().slice(0, MAX_INTRO));
                }}
                className="shrink-0 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-[12.5px]"
              >
                {s}
              </button>
            ))}
          </div>
          <Button className="mt-4 w-full" loading={busy} disabled={[...text.trim()].length < 2} onClick={send}>
            💌 فرستادن درخواست
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}

/** My request is waiting for an answer: show it, and let me take it back. */
export function PendingRequestSheet({ post, onClose }: { post: WallPost | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const name = post?.author?.name ?? '';
  const cancel = async () => {
    if (!post) return;
    if (!(await confirmDialog(`درخواست گفتگو با ${name} پس گرفته شود؟`, 'پس بگیر', true))) return;
    setBusy(true);
    try {
      await api.del(`/v1/wall/${post.id}/chat`);
      patchWallPost(post.id, (p) => ({ ...p, myRequest: null }));
      toast('درخواستت پس گرفته شد', '↩️');
      onClose();
    } catch (e) {
      toast(errorMessage(e), '⚠️', 'error');
      void queryClient.invalidateQueries({ queryKey: keys.wall });
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={!!post} onClose={onClose}>
      {post ? (
        <div className="text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-full bg-gold/15 text-[30px]">⏳</div>
          <h3 className="mt-3 text-[17px] font-bold">منتظر جواب {name}</h3>
          <p className="mx-auto mt-1.5 max-w-[300px] text-[13px] leading-6 text-muted">
            درخواستت رسیده. به محض اینکه قبول کنه، از تلگرام و داخل اپ خبرت می‌کنیم و گفتگوتون باز می‌شه.
          </p>
          <Button variant="soft" className="mt-5 w-full" loading={busy} onClick={cancel}>
            پس گرفتن درخواست
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}

/** Conversation requests on one of my posts, as a sheet (from the card's «درخواست‌ها» button). */
export function RequestsSheet({ post, onClose }: { post: WallPost | null; onClose: () => void }) {
  return (
    <Sheet open={!!post} onClose={onClose} title="درخواست‌های گفتگو 💌">
      {post ? <RequestsList post={post} onOpen={onClose} /> : null}
    </Sheet>
  );
}

/**
 * The author's inbox for one request: waiting ones first, each with the sender's photo, name and
 * intro, and «قبول» / «رد». Accepting opens the conversation with their intro as its first message.
 */
export function RequestsList({ post, onOpen, inline }: { post: WallPost; onOpen?: () => void; inline?: boolean }) {
  const q = useWallRequests(post.id);
  const [busy, setBusy] = useState<string | null>(null);
  const items = q.data?.items;

  const decide = async (r: WallChatRequest, accept: boolean) => {
    setBusy(r.id);
    await answerRequest(r, accept);
    setBusy(null);
  };

  if (q.isLoading) return <Loading className="py-10" />;
  if (!items?.length) {
    return (
      <EmptyNote
        emoji="📭"
        title="هنوز درخواستی نیومده"
        subtitle="هر کس بخواد باهات گفتگو کنه، اینجا میاد و تو تصمیم می‌گیری."
        className={inline ? 'py-6' : undefined}
      />
    );
  }

  return (
    <ul className="space-y-2.5">
      <AnimatePresence initial={false}>
        {items.map((r) => (
          <motion.li key={r.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <ReceivedRequestCard r={r} busy={busy === r.id} locked={!!busy} onDecide={(a) => decide(r, a)} onNavigate={onOpen} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/** Who liked my request — tap someone to see their profile. */
export function LikersSheet({ post, onClose }: { post: WallPost | null; onClose: () => void }) {
  const [items, setItems] = useState<{ id: string; name: string; age: number | null; photo: string | null; likedAt: string }[] | null>(null);
  useEffect(() => {
    if (!post) return;
    setItems(null);
    api
      .get<{ items: NonNullable<typeof items> }>(`/v1/wall/${post.id}/likers`)
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [post]);
  return (
    <Sheet open={!!post} onClose={onClose} title={`لایک‌های درخواستت ❤️ ${post ? fa(post.likeCount) : ''}`}>
      {!items ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyNote emoji="💔" title="هنوز کسی لایک نکرده" subtitle="کمی صبر کن؛ درخواستت تازه منتشر شده." />
      ) : (
        <ul className="-mx-2">
          {items.map((u, i) => (
            <motion.li key={u.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.03 }}>
              <button
                onClick={() => {
                  onClose();
                  nav.push({ name: 'profile', userId: u.id, actions: 'swipe' });
                }}
                className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-right active:bg-white/5"
              >
                <Avatar src={u.photo} name={u.name} size={46} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                    {u.name}
                    {u.age ? `، ${fa(u.age)}` : ''}
                  </span>
                  <span className="text-[12px] text-faint">{ago(u.likedAt)}</span>
                </span>
              </button>
            </motion.li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
