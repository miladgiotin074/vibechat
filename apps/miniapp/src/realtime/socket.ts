import { ensureFreshToken, wsUrl } from '@/api/client';
import { getMe, keys, patchConversation, patchWallPost, queryClient, upsertMessage } from '@/api/queries';
import type { Conversation, Message } from '@/api/types';
import { useUi } from '@/store/ui';
import { haptic } from '@/telegram/tg';

/**
 * One WebSocket per open app. Server events update the React Query cache directly, so lists and
 * chats change without refetching. Reconnects with backoff; a reconnect refetches what may be stale.
 */
let ws: WebSocket | null = null;
let retry = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let stopped = true;
let openChat: string | null = null;

/** The chat on screen: its messages are marked read and don't raise toasts. */
export function setOpenChat(matchId: string | null) {
  openChat = matchId;
}

type ServerEvent =
  | { type: 'hello'; data: { userId: string } }
  | { type: 'pong' }
  | { type: 'message.new'; data: Message }
  | { type: 'message.read'; data: { matchId: string; userId: string; upTo: string } }
  | { type: 'typing'; data: { matchId: string; userId: string } }
  | { type: 'match.new'; data: Conversation & { superLike?: boolean } }
  | { type: 'match.removed'; data: { matchId: string } }
  | { type: 'like.new'; data: { superLike: boolean; first?: boolean } }
  | { type: 'notification'; data: { type: string; title: string; body: string | null } }
  | { type: 'profile.updated'; data: unknown }
  | { type: 'session.revoked'; data: { reason: string } }
  | { type: 'referral.joined'; data: unknown }
  | { type: 'conversation.new'; data: { matchId: string } }
  | { type: 'wall.liked'; data: { postId: string; likeCount: number } }
  | { type: 'wall.request'; data: { postId: string } }
  | { type: 'payment.updated'; data: { paymentId: string; status: string } };

function handle(ev: ServerEvent) {
  const ui = useUi.getState();
  const me = getMe();
  switch (ev.type) {
    case 'message.new': {
      const m = ev.data;
      upsertMessage(m.matchId, m);
      // a system note («… looked at your profile») is addressed to me even though it carries my id
      const mine = m.senderId === me?.id && m.kind !== 'system';
      const visible = openChat === m.matchId;
      patchConversation(m.matchId, (c) => ({
        ...c,
        lastMessage: { id: m.id, kind: m.kind, preview: m.kind === 'image' ? '📷 عکس' : (m.body ?? ''), senderId: m.senderId, createdAt: m.createdAt },
        unread: mine || visible ? c.unread : c.unread + 1,
      }));
      if (!queryClient.getQueryData(keys.conversations)) void queryClient.invalidateQueries({ queryKey: keys.conversations });
      if (!mine && !visible) {
        haptic.light();
        ui.setBadges({ chats: ui.badges.chats + 1 });
      }
      break;
    }
    case 'message.read':
      patchConversation(ev.data.matchId, (c) => (ev.data.userId === me?.id ? c : { ...c, peerLastReadId: ev.data.upTo }));
      break;
    case 'typing':
      ui.setTyping(ev.data.matchId);
      break;
    case 'match.new':
      void queryClient.invalidateQueries({ queryKey: keys.conversations });
      void queryClient.invalidateQueries({ queryKey: keys.likes });
      haptic.success();
      ui.showMatch(ev.data);
      break;
    case 'match.removed':
      queryClient.setQueryData<{ items: Conversation[] }>(keys.conversations, (old) =>
        old ? { ...old, items: old.items.filter((c) => c.id !== ev.data.matchId) } : old,
      );
      break;
    case 'like.new':
      ui.setBadges({ likes: ui.badges.likes + 1 });
      void queryClient.invalidateQueries({ queryKey: keys.likes });
      if (ev.data.first) ui.toast({ text: 'اولین لایکت رسید! رایگان ببین کیه 👀', emoji: '🎉' });
      else if (ev.data.superLike) ui.toast({ text: 'یک نفر سوپرلایکت کرد!', emoji: '⭐' });
      break;
    case 'notification':
      ui.setBadges({ notifications: ui.badges.notifications + 1 });
      void queryClient.invalidateQueries({ queryKey: keys.notifications });
      if (ev.data.type !== 'match' && ev.data.type !== 'super_like') ui.toast({ text: ev.data.title, emoji: '🔔' });
      break;
    case 'profile.updated':
    case 'payment.updated':
      void queryClient.invalidateQueries({ queryKey: keys.me });
      void queryClient.invalidateQueries({ queryKey: keys.referrals });
      break;
    case 'conversation.new':
      void queryClient.invalidateQueries({ queryKey: keys.conversations });
      break;
    case 'wall.liked':
      patchWallPost(ev.data.postId, (p) => ({ ...p, likeCount: ev.data.likeCount }));
      break;
    case 'wall.request':
      // a request on my post arrived / was withdrawn, or mine was answered
      void queryClient.invalidateQueries({ queryKey: keys.wallMine });
      void queryClient.invalidateQueries({ queryKey: keys.wallPost(ev.data.postId) });
      void queryClient.invalidateQueries({ queryKey: keys.wallRequests(ev.data.postId) });
      void queryClient.invalidateQueries({ queryKey: ['wall', 'inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['wall', 'feed'] });
      break;
    case 'referral.joined':
      void queryClient.invalidateQueries({ queryKey: keys.referrals });
      break;
    case 'session.revoked':
      stop();
      location.reload();
      break;
  }
}

async function connect() {
  if (stopped || ws) return;
  // the socket authenticates once, at connect: make sure the token is not about to expire
  await ensureFreshToken().catch(() => undefined);
  if (stopped || ws) return;
  ws = new WebSocket(wsUrl());
  ws.onopen = () => {
    if (retry > 0) {
      // we may have missed events while offline
      void queryClient.invalidateQueries({ queryKey: keys.conversations });
      void queryClient.invalidateQueries({ queryKey: ['messages'] });
      void queryClient.invalidateQueries({ queryKey: keys.summary });
    }
    retry = 0;
    pingTimer = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}'), 25_000);
  };
  ws.onmessage = (e) => {
    try {
      handle(JSON.parse(String(e.data)) as ServerEvent);
    } catch {
      // ignore malformed frames
    }
  };
  ws.onclose = (e) => {
    if (pingTimer) clearInterval(pingTimer);
    ws = null;
    if (stopped || e.code === 4001) return;
    const delay = Math.min(15_000, 500 * 2 ** retry++) + Math.random() * 500;
    setTimeout(() => void connect(), delay);
  };
}

export function startSocket() {
  if (!stopped) return;
  stopped = false;
  void connect();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !ws && !stopped) void connect();
  });
}

export function stop() {
  stopped = true;
  ws?.close();
}

export function sendTyping(matchId: string) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'typing', matchId }));
}
