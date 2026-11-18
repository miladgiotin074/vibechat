import clsx from 'clsx';
import { Clock, Flag, Heart, MessageCircle, MoreHorizontal, PenLine, Send, ShieldBan, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { api, ApiError, errorMessage } from '@/api/client';
import { getMe, keys, patchWallPost, queryClient, useMeta } from '@/api/queries';
import type { WallPost } from '@/api/types';
import { ago, fa } from '@/lib/format';
import { nav } from '@/store/nav';
import { toast } from '@/store/ui';
import { haptic } from '@/telegram/tg';
import { confirmDialog } from '@/ui/Dialog';
import { Button, Img, Row } from '@/ui/kit';
import { Sheet } from '@/ui/Sheet';

export const lookingForLabel = (v: string) => (v === 'male' ? 'آقا' : v === 'female' ? 'خانم' : 'همه');
export const lookingForPlural = (v: string) => (v === 'male' ? 'آقایان' : v === 'female' ? 'خانم‌ها' : 'همه');

export function timeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'تمام شده';
  const h = Math.floor(ms / 3_600_000);
  if (h >= 1) return `${fa(h)} ساعت مونده`;
  return `${fa(Math.max(1, Math.floor(ms / 60_000)))} دقیقه مونده`;
}

export const isLive = (p: WallPost) => p.status === 'active' && new Date(p.expiresAt) > new Date();

/** Like with an optimistic count; the server answers with the real one. */
async function toggleLike(p: WallPost) {
  const on = !p.liked;
  if (on) haptic.medium();
  else haptic.light();
  patchWallPost(p.id, (x) => ({ ...x, liked: on, likeCount: Math.max(0, x.likeCount + (on ? 1 : -1)) }));
  try {
    const r = await (on ? api.post<{ likeCount: number }>(`/v1/wall/${p.id}/like`) : api.del<{ likeCount: number }>(`/v1/wall/${p.id}/like`));
    patchWallPost(p.id, (x) => ({ ...x, liked: on, likeCount: r.likeCount }));
  } catch (e) {
    patchWallPost(p.id, (x) => ({ ...x, liked: !on, likeCount: Math.max(0, x.likeCount + (on ? -1 : 1)) }));
    toast(errorMessage(e), '⚠️', 'error');
  }
}

export function PostCard({
  post,
  onMessage,
  onLikers,
  compact,
  preview,
}: {
  post: WallPost;
  /** «پیام» on someone else's request: write, and the conversation opens right away */
  onMessage: (p: WallPost) => void;
  /** my request: who liked it */
  onLikers?: (p: WallPost) => void;
  /** In the feed: long text is clamped and tapping it opens the request. */
  compact?: boolean;
  preview?: boolean;
}) {
  const me = getMe();
  const forMe = post.lookingFor === 'everyone' || post.lookingFor === me?.gender;
  const live = isLive(post);
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState(false);
  const [burst, setBurst] = useState(0);
  const a = post.author;

  const open = () => compact && !preview && nav.push({ name: 'wallPost', postId: post.id });

  const like = () => {
    if (!post.liked) setBurst((n) => n + 1);
    void toggleLike(post);
  };

  const remove = async () => {
    setMenu(false);
    if (!(await confirmDialog('این درخواست از دیوار (و گروه تلگرام) حذف شود؟', 'حذف', true))) return;
    try {
      await api.del(`/v1/wall/${post.id}`);
      void queryClient.invalidateQueries({ queryKey: keys.wall });
      toast('درخواستت حذف شد', '🗑️');
      haptic.success();
      if (!compact) nav.pop();
    } catch (e) {
      toast(errorMessage(e), '⚠️', 'error');
    }
  };

  const block = async () => {
    setMenu(false);
    if (!a || !(await confirmDialog(`${a.name} مسدود شود؟ دیگر درخواست‌ها و پروفایل همدیگر را نمی‌بینید.`, 'مسدود کن', true))) return;
    await api.post('/v1/blocks', { userId: a.id }).catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: keys.wall });
    toast('مسدود شد', '🚫');
    if (!compact) nav.pop();
  };

  return (
    <article className={clsx('relative overflow-hidden rounded-panel border border-line bg-surface-1', !live && !preview && 'opacity-60')}>
      <div className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.18), transparent 70%)' }} />
      <div className="relative p-4">
        {/* author */}
        <header className="flex items-center gap-3">
          <button
            className="relative shrink-0"
            onClick={() => a && !post.mine && !preview && nav.push({ name: 'profile', userId: a.id })}
            aria-label={a ? `پروفایل ${a.name}` : undefined}
          >
            <div className="size-14 overflow-hidden rounded-[18px] bg-surface-3">
              {a?.thumb ? (
                <Img src={a.thumb} color={a.color} className="size-full" />
              ) : (
                <div className="grid size-full place-items-center text-[22px] font-bold text-muted">{a?.name?.trim()[0] ?? '؟'}</div>
              )}
            </div>
            {a?.online ? <span className="absolute -bottom-0.5 -left-0.5 size-3.5 rounded-full bg-mint ring-[3px] ring-surface-1" /> : null}
            {!post.showPhoto ? (
              <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full bg-surface-2 text-[11px] ring-2 ring-surface-1">🙈</span>
            ) : null}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[16px] font-extrabold">
                {a?.name ?? 'کاربر'}
                {a?.age ? <span className="font-medium text-ink/80">، {fa(a.age)}</span> : null}
              </span>
              {post.mine ? (
                <span className="shrink-0 rounded-full bg-flame px-2 py-0.5 text-[10px] font-bold text-white">من</span>
              ) : a?.newcomer ? (
                <span className="shrink-0 text-[13px]" title="تازه‌وارد">
                  ✨
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[12px] text-muted">
              <span className="shrink-0">{preview ? 'همین الان' : ago(post.createdAt)}</span>
              {post.editedAt && !preview ? <span className="shrink-0 text-faint">· ویرایش‌شده</span> : null}
            </div>
          </div>
          {!preview ? (
            <button aria-label="گزینه‌ها" onClick={() => setMenu(true)} className="-ml-1 grid size-9 shrink-0 place-items-center self-start rounded-full text-faint active:bg-white/10">
              <MoreHorizontal className="size-5" />
            </button>
          ) : null}
        </header>

        {/* the request */}
        <button onClick={open} className={clsx('mt-3.5 block w-full text-right', !compact && 'cursor-text')}>
          <p className={clsx('whitespace-pre-wrap text-[16px] leading-8 font-medium', compact && 'line-clamp-4')}>{post.text}</p>
        </button>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2.5 py-1 text-[12px] text-ink/80">
            {post.lookingFor === 'female' ? '👩' : post.lookingFor === 'male' ? '👨' : '💫'} دنبال {lookingForLabel(post.lookingFor)}
          </span>
          <span className="inline-flex items-center gap-1 px-1 text-[11.5px] text-faint">
            <Clock className="size-3.5" />
            {live || preview ? timeLeft(post.expiresAt) : post.status === 'removed' ? 'برداشته شد' : 'تمام شده'}
          </span>
        </div>

        {post.mine && post.status === 'removed' && post.removedReason ? (
          <p className="mt-3 rounded-2xl bg-danger/10 px-3 py-2 text-[12.5px] text-danger">دلیل برداشتن: {post.removedReason}</p>
        ) : null}

        {/* actions */}
        <footer className="mt-4 flex items-center gap-2">
          {post.mine ? (
            <>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => !preview && onLikers?.(post)}
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-white/[0.06] text-[13.5px] font-semibold"
              >
                <Heart className="size-[18px] fill-rose text-rose" /> {fa(post.likeCount)} لایک
              </motion.button>
              <span className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-white/[0.06] text-[13.5px] font-semibold">
                <MessageCircle className="size-[18px] text-violet" /> {fa(post.chatCount ?? 0)} گفتگو
              </span>
            </>
          ) : (
            <>
              <motion.button
                whileTap={{ scale: 0.88 }}
                disabled={!live}
                onClick={like}
                aria-label={post.liked ? 'برداشتن لایک' : 'لایک'}
                className={clsx(
                  'relative flex h-11 min-w-[72px] items-center justify-center gap-1.5 rounded-2xl px-3 text-[14px] font-bold transition-colors',
                  post.liked ? 'bg-rose/15 text-rose' : 'bg-white/[0.06] text-ink',
                )}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span key={String(post.liked)} initial={{ scale: 0.3 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 14 }}>
                    <Heart className={clsx('size-5', post.liked ? 'fill-rose text-rose' : 'text-muted')} />
                  </motion.span>
                </AnimatePresence>
                {post.likeCount > 0 ? <span className="tabular">{fa(post.likeCount)}</span> : null}
                <AnimatePresence>
                  {burst > 0 ? (
                    <motion.span
                      key={burst}
                      className="pointer-events-none absolute left-1/2 top-0 text-[18px]"
                      initial={{ y: 0, opacity: 1, scale: 0.6 }}
                      animate={{ y: -34, opacity: 0, scale: 1.3 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.7 }}
                    >
                      ❤️
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </motion.button>
              {post.matchId ? (
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => nav.push({ name: 'chat', matchId: post.matchId! })}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-violet/40 bg-violet/15 text-[14px] font-bold text-violet"
                >
                  <MessageCircle className="size-[18px]" /> ادامه‌ی گفتگو
                </motion.button>
              ) : forMe ? (
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  disabled={!live}
                  onClick={() => onMessage(post)}
                  className={clsx(
                    'flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl text-[14px] font-bold',
                    live ? 'bg-flame text-white shadow-[0_10px_24px_-10px_rgba(255,45,111,0.9)]' : 'bg-white/[0.06] text-faint',
                  )}
                >
                  <Send className="size-4 -scale-x-100" /> پیام بده
                </motion.button>
              ) : (
                <span className="flex h-11 flex-1 items-center justify-center rounded-2xl bg-white/[0.04] px-3 text-center text-[12.5px] text-faint">
                  فقط برای {lookingForPlural(post.lookingFor)}
                </span>
              )}
            </>
          )}
        </footer>
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)}>
        <div className="-mx-5 divide-y divide-line">
          {post.mine ? (
            <>
              {live ? (
                <Row
                  icon={<PenLine />}
                  tint="violet"
                  title="ویرایش درخواست"
                  subtitle="متن و مخاطب رو عوض کن؛ لایک‌ها می‌مونن"
                  onClick={() => {
                    setMenu(false);
                    nav.push({ name: 'wallCompose', editId: post.id });
                  }}
                  chevron={false}
                />
              ) : null}
              <Row icon={<Trash2 />} tint="danger" title="حذف درخواست" subtitle="از دیوار و گروه تلگرام برداشته می‌شود" onClick={remove} chevron={false} />
            </>
          ) : (
            <>
              <Row icon={<Flag />} tint="danger" title="گزارش این درخواست" onClick={() => (setMenu(false), setReport(true))} chevron={false} />
              <Row icon={<ShieldBan />} tint="danger" title={`مسدود کردن ${a?.name ?? ''}`} onClick={block} chevron={false} />
            </>
          )}
        </div>
      </Sheet>
      <WallReportSheet open={report} onClose={() => setReport(false)} post={post} />
    </article>
  );
}

function WallReportSheet({ open, onClose, post }: { open: boolean; onClose: () => void; post: WallPost }) {
  const meta = useMeta();
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!reason) return;
    setBusy(true);
    try {
      await api.post(`/v1/wall/${post.id}/report`, { reason });
      toast('گزارشت ثبت شد. ممنون که کمک می‌کنی دیوار تمیز بمونه 💜', '🛡️', 'success');
      onClose();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : errorMessage(e), '⚠️', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="گزارش درخواست">
      <div className="space-y-2">
        {meta.data?.reportReasons.map((r) => (
          <button
            key={r.id}
            onClick={() => setReason(r.id)}
            className={clsx('flex w-full rounded-2xl px-4 py-3.5 text-right text-[14.5px]', reason === r.id ? 'border-2 border-danger bg-danger/10' : 'border border-line bg-surface-2')}
          >
            {r.label}
          </button>
        ))}
      </div>
      <Button variant="danger" className="mt-4 w-full" disabled={!reason} loading={busy} onClick={send}>
        ثبت گزارش
      </Button>
    </Sheet>
  );
}
