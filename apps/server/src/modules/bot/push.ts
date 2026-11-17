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
export type PushKind = 'message' | 'important';

interface Target {
  telegram_id: string | null;
  can_dm: boolean;
  bot_blocked: boolean;
  status: string;
  notify_messages: boolean;
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
    SELECT telegram_id, can_dm, bot_blocked, status, notify_messages FROM users WHERE id = ${userId}`;
  if (!t?.telegram_id || !t.can_dm || t.bot_blocked) return false;
  if (t.status === 'deleted' || t.status === 'banned' || t.status === 'suspended') return false;
  if (kind === 'message' && !t.notify_messages) return false;
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

/** Someone wrote to you from their card or the Wall, and the conversation is now open. */
export async function pushNewChat(peerId: string, matchId: string, senderName: string, previewText: string) {
  await pushTelegram(peerId, 'message', {
    text: `💌 <b>${escapeHtml(senderName)}</b> بهت پیام داد:\n<i>${escapeHtml(previewText)}</i>`,
    button: { text: '💬 جواب بده', startParam: `chat_${matchId}` },
    media: 'message',
    onlyIfOffline: true,
  });
}

/** Anything the app must tell someone: always worth a message. */
export async function pushImportant(userId: string, title: string, body?: string | null, startParam?: string, media: BotMediaSlot = 'system') {
  await pushTelegram(userId, 'important', {
    text: `<b>${escapeHtml(title)}</b>${body ? `\n${escapeHtml(body)}` : ''}`,
    button: { text: OPEN, startParam },
    media,
  });
}

/** Likes on a Wall request: at most one Telegram message per request per half hour. */
export async function pushWallLike(userId: string, postId: string, title: string) {
  await pushTelegram(userId, 'important', {
    text: `❤️ <b>${escapeHtml(title)}</b>\nببین کیه؛ شاید سر صحبت رو باز کنی 😉`,
    button: { text: '👀 ببین کیا لایک کردن', startParam: `w_${postId}` },
    media: 'wall_like',
    cooldownKey: `bpw:${postId}`,
    cooldownS: 30 * 60,
    onlyIfOffline: true,
  });
}
