import clsx from 'clsx';
import { Check, ChevronLeft, Hourglass, MapPin, MessageCircle, X } from 'lucide-react';
import { api, errorMessage } from '@/api/client';
import { keys, patchWallPost, queryClient } from '@/api/queries';
import type { WallChatRequest, WallRequestBox } from '@/api/types';
import { ago, fa } from '@/lib/format';
import { nav } from '@/store/nav';
import { toast } from '@/store/ui';
import { haptic } from '@/telegram/tg';
import { confirmDialog } from '@/ui/Dialog';
import { Avatar, Button } from '@/ui/kit';

type Box = { items: WallChatRequest[]; pending?: number };

/** Applies a change to one request in every cached list that shows it (per post, inbox, sent). */
function patchRequest(r: WallChatRequest, fn: (x: WallChatRequest) => WallChatRequest | null) {
  const apply = (old: Box | undefined): Box | undefined => {
    if (!old) return old;
    const items: WallChatRequest[] = [];
    for (const x of old.items) {
      const next = x.id === r.id ? fn(x) : x;
      if (next) items.push(next);
    }
    return { ...old, items, ...(old.pending !== undefined ? { pending: items.filter((i) => i.status === 'pending').length } : {}) };
  };
  queryClient.setQueryData<Box>(keys.wallRequests(r.post.id), apply);
  queryClient.setQueryData<WallRequestBox>(keys.wallInbox('in'), (old) => apply(old) as WallRequestBox | undefined);
  queryClient.setQueryData<WallRequestBox>(keys.wallInbox('out'), (old) => apply(old) as WallRequestBox | undefined);
}

/**
 * The author answers a request. Accepting opens the conversation (their intro is its first
 * message); declining asks first, since the sender can't ask again for this post.
 */
export async function answerRequest(r: WallChatRequest, accept: boolean): Promise<boolean> {
  if (!accept && !(await confirmDialog(`درخواست ${r.user.name} رد شود؟ دیگه نمی‌تونه برای این درخواست پیام بده.`, 'رد کن', true))) return false;
  try {
    const res = await api.post<{ status: 'accepted' | 'declined'; matchId: string | null }>(`/v1/wall/requests/${r.id}/${accept ? 'accept' : 'decline'}`);
    patchRequest(r, (x) => ({ ...x, status: res.status, matchId: res.matchId }));
    patchWallPost(r.post.id, (p) => ({
      ...p,
      pendingCount: Math.max(0, (p.pendingCount ?? 1) - 1),
      acceptedCount: (p.acceptedCount ?? 0) + (accept ? 1 : 0),
    }));
    void queryClient.invalidateQueries({ queryKey: keys.wallMine });
    if (accept) {
      haptic.success();
      void queryClient.invalidateQueries({ queryKey: keys.conversations });
      toast(`گفتگو با ${r.user.name} باز شد 💬`, '🎉', 'success');
    } else {
      haptic.light();
    }
    return true;
  } catch (e) {
    haptic.error();
    toast(errorMessage(e), '⚠️', 'error');
    void queryClient.invalidateQueries({ queryKey: keys.wallRequests(r.post.id) });
    void queryClient.invalidateQueries({ queryKey: ['wall', 'inbox'] });
    return false;
  }
}

/** The sender takes back a request that hasn't been answered yet. */
export async function cancelRequest(r: WallChatRequest): Promise<boolean> {
  if (!(await confirmDialog(`درخواست گفتگو با ${r.user.name} پس گرفته شود؟`, 'پس بگیر', true))) return false;
  try {
    await api.del(`/v1/wall/${r.post.id}/chat`);
    patchRequest(r, () => null);
    patchWallPost(r.post.id, (p) => ({ ...p, myRequest: null }));
    toast('درخواستت پس گرفته شد', '↩️');
    return true;
  } catch (e) {
    toast(errorMessage(e), '⚠️', 'error');
    void queryClient.invalidateQueries({ queryKey: ['wall', 'inbox'] });
    return false;
  }
}

function PersonRow({ r, onNavigate }: { r: WallChatRequest; onNavigate?: () => void }) {
  return (
    <button
      onClick={() => {
        onNavigate?.();
        nav.push({ name: 'profile', userId: r.user.id });
      }}
      className="flex w-full items-center gap-3 text-right"
    >
      <Avatar src={r.user.photo} name={r.user.name} size={48} online={r.user.online} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[15px] font-bold">
          <span className="truncate">
            {r.user.name}
            {r.user.age ? <span className="font-medium text-ink/80">، {fa(r.user.age)}</span> : null}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[12px] text-muted">
          {r.user.city ? (
            <>
              <MapPin className="size-3.5 shrink-0" />
              <span className="truncate">{r.user.city}</span>
              <span className="text-faint">·</span>
            </>
          ) : null}
          <span className="shrink-0">{ago(r.createdAt)}</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center text-[12px] font-semibold text-muted">
        پروفایل <ChevronLeft className="size-4" />
      </span>
    </button>
  );
}

/** Which Wall request this is about (tap to open it). */
function PostLine({ r, label, onNavigate }: { r: WallChatRequest; label: string; onNavigate?: () => void }) {
  return (
    <button
      disabled={!r.post.available}
      onClick={() => {
        onNavigate?.();
        nav.push({ name: 'wallPost', postId: r.post.id });
      }}
      className="mb-2.5 flex w-full items-center gap-1.5 rounded-xl bg-white/[0.04] px-2.5 py-1.5 text-right text-[12px] text-muted"
    >
      <span className="shrink-0">📌 {label}</span>
      <span className="min-w-0 flex-1 truncate text-ink/80">«{r.post.text}»</span>
      {!r.post.live ? <span className="shrink-0 text-faint">· تمام شده</span> : null}
      {r.post.available ? <ChevronLeft className="size-4 shrink-0" /> : null}
    </button>
  );
}

const goChat = (r: WallChatRequest, onNavigate?: () => void) => {
  if (!r.matchId) return;
  onNavigate?.();
  nav.push({ name: 'chat', matchId: r.matchId });
};

/** A request someone sent me: who, their intro, and «قبول» / «رد». */
export function ReceivedRequestCard({
  r,
  busy,
  locked,
  onDecide,
  showPost,
  onNavigate,
}: {
  r: WallChatRequest;
  busy: boolean;
  locked: boolean;
  onDecide: (accept: boolean) => void;
  showPost?: boolean;
  /** called before leaving for a profile/chat/post (e.g. to close a sheet) */
  onNavigate?: () => void;
}) {
  return (
    <div className={clsx('rounded-card border p-3', r.status === 'pending' ? 'border-rose/25 bg-rose/[0.06]' : 'border-line bg-surface-2', (r.status === 'declined' || r.status === 'expired') && 'opacity-55')}>
      {showPost ? <PostLine r={r} label="برای:" onNavigate={onNavigate} /> : null}
      <PersonRow r={r} onNavigate={onNavigate} />
      <p className="mt-2.5 whitespace-pre-wrap rounded-2xl rounded-tr-md bg-white/[0.06] px-3.5 py-2.5 text-[14px] leading-7">{r.text}</p>
      {r.status === 'pending' ? (
        <div className="mt-2.5 flex gap-2">
          <Button size="md" className="h-11 flex-1 rounded-2xl" loading={busy} disabled={locked} onClick={() => onDecide(true)}>
            <Check className="size-[18px]" /> قبول و شروع گفتگو
          </Button>
          <button
            disabled={locked}
            onClick={() => onDecide(false)}
            aria-label="رد درخواست"
            className="grid h-11 w-14 shrink-0 place-items-center rounded-2xl border border-line bg-white/[0.06] text-muted active:bg-white/10 disabled:opacity-50"
          >
            <X className="size-5" />
          </button>
        </div>
      ) : r.status === 'accepted' ? (
        <button
          onClick={() => goChat(r, onNavigate)}
          className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-violet/40 bg-violet/15 text-[14px] font-bold text-violet"
        >
          <MessageCircle className="size-[18px]" /> رفتن به گفتگو
        </button>
      ) : (
        <p className="mt-2 text-center text-[12px] text-faint">{r.status === 'expired' ? 'بی‌جواب موند و منقضی شد' : 'رد شد'}</p>
      )}
    </div>
  );
}

/** A request I sent: to whom, for which post, my intro, and where it stands. */
export function SentRequestCard({ r, busy, onCancel }: { r: WallChatRequest; busy: boolean; onCancel: () => void }) {
  return (
    <div className={clsx('rounded-card border border-line bg-surface-2 p-3', (r.status === 'declined' || r.status === 'expired') && 'opacity-60')}>
      <PostLine r={r} label="درخواستِ" />
      <PersonRow r={r} />
      <div className="mt-2.5 rounded-2xl rounded-tl-md bg-violet/10 px-3.5 py-2.5">
        <div className="text-[11px] font-semibold text-violet">پیام تو</div>
        <p className="mt-0.5 whitespace-pre-wrap text-[14px] leading-7">{r.text}</p>
      </div>
      {r.status === 'pending' ? (
        <div className="mt-2.5 flex items-center gap-2">
          <span className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-gold/35 bg-gold/10 text-[13px] font-bold text-gold">
            <Hourglass className="size-[16px]" /> منتظر جواب {r.user.name}
          </span>
          <Button size="md" variant="soft" className="h-11 rounded-2xl px-4" loading={busy} onClick={onCancel}>
            پس گرفتن
          </Button>
        </div>
      ) : r.status === 'accepted' ? (
        <button
          onClick={() => goChat(r)}
          className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-violet/40 bg-violet/15 text-[14px] font-bold text-violet"
        >
          <MessageCircle className="size-[18px]" /> قبول کرد؛ رفتن به گفتگو
        </button>
      ) : (
        <p className="mt-2 text-center text-[12px] text-faint">
          {r.status === 'expired' ? 'وقت درخواستش تموم شد و جوابی نداد؛ سهمیه‌ات برگشت' : 'این بار قبول نکرد'}
        </p>
      )}
    </div>
  );
}
