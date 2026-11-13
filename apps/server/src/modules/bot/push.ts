import { sql } from '../../lib/db.js';
import { enqueueBotMessage, type BotButton } from '../../lib/queue.js';
import { redis } from '../../lib/redis.js';
import { isOnline } from '../realtime/bus.js';
import { getSettings } from '../settings/settings.js';
import type { BotMediaSlot } from './media.js';
import { escapeHtml } from './sender.js';

/**
 * Telegram messages from the bot are the app's push notifications: they reach users with the Mini
 * App closed. Rules: only people the bot may message, honour their notification switches, skip
 * chatty kinds while the user is in the app, and throttle per kind so the bot never spams.
 */
export type PushKind = 'match' | 'message' | 'like' | 'super_like' | 'important';

interface Target {
  telegram_id: string | null;
  can_dm: boolean;
  bot_blocked: boolean;
  status: string;
  notify_matches: boolean;
  notify_messages: boolean;
  notify_likes: boolean;
}

export interface PushInput {
  text: string;
  button?: BotButton;
  /** the picture that goes with it */
  media: BotMediaSlot;
  /** Redis key; when set, only one push per key per cooldownS. */
  cooldownKey?: string;
  cooldownS?: number;
  /** Skip if the user has the app open right now (they already saw it in-app). */
  onlyIfOffline?: boolean;
}

export async function pushTelegram(userId: string, kind: PushKind, input: PushInput): Promise<boolean> {
  const [t] = await sql<Target[]>`
    SELECT telegram_id, can_dm, bot_blocked, status, notify_matches, notify_messages, notify_likes
    FROM users WHERE id = ${userId}`;
  if (!t?.telegram_id || !t.can_dm || t.bot_blocked) return false;
  if (t.status === 'deleted' || t.status === 'banned' || t.status === 'suspended') return false;
  if (kind === 'match' && !t.notify_matches) return false;
  if (kind === 'message' && !t.notify_messages) return false;
  if ((kind === 'like' || kind === 'super_like') && !t.notify_likes) return false;
  if (input.onlyIfOffline && (await isOnline(userId))) return false;
  if (input.cooldownKey) {
    const ok = await redis.set(input.cooldownKey, '1', 'EX', input.cooldownS ?? 600, 'NX');
    if (ok !== 'OK') return false;
  }
  await enqueueBotMessage({ userId, chatId: t.telegram_id, text: input.text, button: input.button, media: input.media });
  return true;
}

const OPEN = 'باز کردن Vibe 💜';

export async function pushNewMessage(peerId: string, matchId: string, senderName: string, previewText: string) {
  const settings = await getSettings();
  await pushTelegram(peerId, 'message', {
    text: `💌 <b>${escapeHtml(senderName)}</b> برات پیام فرستاد:\n<i>${escapeHtml(previewText)}</i>`,
    button: { text: '💬 جواب بده', startParam: `chat_${matchId}` },
    media: 'message',
    cooldownKey: `bpm:${peerId}:${matchId}`,
    cooldownS: settings.bot.messageCooldownMin * 60,
    onlyIfOffline: true,
  });
}

export async function pushLike(targetId: string, superLike: boolean) {
  const settings = await getSettings();
  await pushTelegram(targetId, superLike ? 'super_like' : 'like', {
    text: superLike
      ? '⭐ <b>یک نفر سوپرلایکت کرد!</b>\nحتماً خیلی ازت خوشش اومده… ببین کیه 👀'
      : '❤️ <b>یک نفر لایکت کرد!</b>\nبرو ببین کیه؛ شاید مچ بشید 😉',
    button: { text: '👀 ببین کیه', startParam: 's_likes' },
    media: superLike ? 'super_like' : 'like',
    cooldownKey: `bpl:${targetId}`,
    cooldownS: settings.bot.likeCooldownMin * 60,
    onlyIfOffline: true,
  });
}

/** The first like a person ever gets: always worth a message (no cooldown), and it's free to see. */
export async function pushFirstLike(targetId: string) {
  await pushTelegram(targetId, 'like', {
    text: '🎉 <b>اولین لایکت رسید!</b>\nیه نفر تو Vibe ازت خوشش اومده. اولین لایک‌ها رایگان دیده می‌شن؛ ببین کیه 👀',
    button: { text: '👀 ببین کیه', startParam: 's_likes' },
    media: 'like',
    onlyIfOffline: true,
  });
}

export async function pushMatch(userId: string, matchId: string, peerName: string) {
  await pushTelegram(userId, 'match', {
    text: `🔥 <b>مچ جدید!</b>\nتو و <b>${escapeHtml(peerName)}</b> همدیگه رو پسندیدید. همین الان سلام کن 👋`,
    button: { text: '💬 شروع گفتگو', startParam: `chat_${matchId}` },
    media: 'match',
    onlyIfOffline: true,
  });
}

/** A day after a match with no message: one reminder (at most one per match, by the job). */
export async function pushMatchNudge(userId: string, matchId: string, title: string) {
  await pushTelegram(userId, 'match', {
    text: `<b>${escapeHtml(title)}</b>\nیه سلام ساده کافیه؛ منتظرته 😉`,
    button: { text: '💬 سلام کن', startParam: `chat_${matchId}` },
    media: 'match',
    onlyIfOffline: true,
  });
}

/** Payment receipts, invite rewards, photo decisions: always worth a message. */
export async function pushImportant(userId: string, title: string, body?: string | null, startParam?: string, media: BotMediaSlot = 'system') {
  await pushTelegram(userId, 'important', {
    text: `<b>${escapeHtml(title)}</b>${body ? `\n${escapeHtml(body)}` : ''}`,
    button: { text: OPEN, startParam },
    media,
  });
}

/** Likes on a Wall request: at most one Telegram message per request per half hour. */
export async function pushWallLike(userId: string, postId: string, title: string) {
  await pushTelegram(userId, 'like', {
    text: `❤️ <b>${escapeHtml(title)}</b>\nببین کیه؛ شاید سر صحبت رو باز کنی 😉`,
    button: { text: '👀 ببین کیا لایک کردن', startParam: `w_${postId}` },
    media: 'wall_like',
    cooldownKey: `bpw:${postId}`,
    cooldownS: 30 * 60,
    onlyIfOffline: true,
  });
}

/** Someone asks to talk about a Wall request: the author has to answer, so it's worth a message. */
export async function pushWallRequest(userId: string, postId: string, title: string, body: string) {
  await pushTelegram(userId, 'message', {
    text: `<b>${escapeHtml(title)}</b>${body ? `\n<i>«${escapeHtml(body)}»</i>` : ''}\n\nپروفایلش رو ببین و قبول یا رد کن 👇`,
    button: { text: '👀 دیدن و جواب دادن', startParam: 's_requests' },
    media: 'wall_request',
    onlyIfOffline: true,
  });
}

/** The author accepted: the conversation is open. */
export async function pushWallAccept(userId: string, matchId: string, title: string) {
  await pushTelegram(userId, 'message', {
    text: `<b>${escapeHtml(title)}</b>\nگفتگوتون باز شد؛ همین الان ادامه بده 👋`,
    button: { text: '💬 رفتن به گفتگو', startParam: `chat_${matchId}` },
    media: 'wall_accept',
    onlyIfOffline: true,
  });
}
