import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '@/api/client';
import { patchWallPost } from '@/api/queries';
import type { WallPost } from '@/api/types';
import { ago, fa } from '@/lib/format';
import { nav } from '@/store/nav';
import { toast } from '@/store/ui';
import { haptic } from '@/telegram/tg';
import { Avatar, Button, EmptyNote, Loading } from '@/ui/kit';
import { Sheet } from '@/ui/Sheet';

const MAX_INTRO = 500;

/**
 * Writing to someone who posted on the Wall: the message goes straight through and the conversation
 * opens right away — no request to send and no waiting to be accepted.
 */
export function WallMessageSheet({ post, onClose }: { post: WallPost | null; onClose: () => void }) {
  const name = post?.author?.name ?? '';
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (post) setText(`سلام ${name}! درخواستت رو روی دیوار دیدم 😊 `);
  }, [post, name]);

  const suggestions = ['منم دنبال همین بودم!', 'خوشحال می‌شم آشنا بشیم 🙂', 'حالت چطوره؟'];

  const send = async () => {
    if (!post || !text.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ matchId: string; existing: boolean }>(`/v1/wall/${post.id}/chat`, { text: text.trim() });
      haptic.success();
      onClose();
      patchWallPost(post.id, (p) => ({ ...p, matchId: r.matchId }));
      nav.push({ name: 'chat', matchId: r.matchId });
    } catch (e) {
      haptic.error();
      const code = e instanceof ApiError ? e.code : undefined;
      toast(errorMessage(e), '⚠️', 'error');
      if (code === 'chat_daily_limit' || code === 'wall_expired' || code === 'match_closed') onClose();
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
              <div className="text-[16px] font-bold">پیام به {name}</div>
              <p className="line-clamp-1 text-[12.5px] text-muted">«{post.text}»</p>
            </div>
          </div>
          <div className="mt-4 flex gap-2.5 rounded-2xl border border-violet/25 bg-violet/[0.08] px-3.5 py-3 text-[12.5px] leading-6 text-ink/85">
            <span className="text-[16px]">💬</span>
            <span>پیامت همین الان برای {name} می‌ره و گفتگوتون باز می‌شه. شماره و آیدی نفرست.</span>
          </div>
          <div className="relative mt-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_INTRO))}
              rows={3}
              autoFocus
              placeholder="یه پیام کوتاه بنویس…"
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
            💬 فرستادن و شروع گفتگو
          </Button>
        </div>
      ) : null}
    </Sheet>
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
                  nav.push({ name: 'profile', userId: u.id, actions: 'discover' });
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
