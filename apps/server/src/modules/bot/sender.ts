import { Api, GrammyError, InlineKeyboard } from 'grammy';
import type { Message } from 'grammy/types';
import { env, miniAppLink } from '../../config.js';
import { sql } from '../../lib/db.js';
import { enqueueBotUnpin, type BotButton, type BotMessage, type BotUnpin } from '../../lib/queue.js';
import { sendAnnouncementMedia, sendWithMedia } from './media.js';

let api: Api | null = null;
export function botApi(): Api | null {
  if (!env.BOT_TOKEN) return null;
  api ??= new Api(env.BOT_TOKEN);
  return api;
}

export const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function keyboardFor(button?: BotButton): InlineKeyboard | undefined {
  if (!button) return undefined;
  const url = button.url ?? miniAppLink(button.startParam);
  return new InlineKeyboard().url(button.text, url);
}

/** Thrown for Telegram 429 so BullMQ retries after the requested pause. */
export class RetryLater extends Error {
  constructor(readonly seconds: number) {
    super(`telegram asked to retry after ${seconds}s`);
  }
}

/**
 * Sends one message. Users who blocked the bot (403) are marked so nothing else is queued for them
 * until they /start again; other permanent errors (400: chat not found…) are dropped, not retried.
 */
export async function sendBotMessage(msg: BotMessage): Promise<'sent' | 'blocked' | 'dropped'> {
  const bot = botApi();
  if (!bot) return 'dropped';
  const reply_markup = keyboardFor(msg.button);
  try {
    let sent: Message;
    if (msg.photoUrl) {
      sent = await bot.sendPhoto(msg.chatId, msg.photoUrl, { caption: msg.text, parse_mode: 'HTML', reply_markup });
    } else if (msg.announcementId) {
      sent = await sendAnnouncementMedia(bot, msg.chatId, msg.announcementId, msg.text, { reply_markup });
    } else {
      // every bot message goes out as a picture with the text as its caption
      sent = await sendWithMedia(bot, msg.chatId, msg.media ?? 'default', msg.text, { reply_markup });
    }
    if (msg.pinHours && msg.pinHours > 0) await pin(bot, msg.chatId, sent.message_id, msg.pinHours);
    return 'sent';
  } catch (e) {
    if (e instanceof GrammyError) {
      if (e.error_code === 403) {
        await sql`UPDATE users SET bot_blocked = true WHERE id = ${msg.userId}`;
        return 'blocked';
      }
      if (e.error_code === 429) throw new RetryLater(e.parameters.retry_after ?? 5);
      if (e.error_code === 400) return 'dropped';
    }
    throw e;
  }
}

/**
 * Pins an announcement at the top of the user's chat with the bot and books its unpin. Pinning is
 * a bonus: a chat that refuses it (or a flood wait on this extra call) must not resend the message.
 */
async function pin(api: Api, chatId: string, messageId: number, hours: number) {
  try {
    await api.pinChatMessage(chatId, messageId, { disable_notification: true });
  } catch {
    return;
  }
  await enqueueBotUnpin({ chatId, messageId }, hours * 3_600_000).catch(() => undefined);
}

/** The pin time is over (a delayed job on the bot queue). An already unpinned message is fine. */
export async function unpinBotMessage(job: BotUnpin) {
  const bot = botApi();
  if (!bot) return;
  try {
    await bot.unpinChatMessage(job.chatId, job.messageId);
  } catch (e) {
    if (e instanceof GrammyError) return; // unpinned by the user, chat gone, bot blocked
    throw e;
  }
}
