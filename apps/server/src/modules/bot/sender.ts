import { Api, GrammyError, InlineKeyboard } from 'grammy';
import { env, miniAppLink } from '../../config.js';
import { sql } from '../../lib/db.js';
import type { BotButton, BotMessage } from '../../lib/queue.js';
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
    if (msg.photoUrl) {
      await bot.sendPhoto(msg.chatId, msg.photoUrl, { caption: msg.text, parse_mode: 'HTML', reply_markup });
    } else if (msg.announcementId) {
      await sendAnnouncementMedia(bot, msg.chatId, msg.announcementId, msg.text, { reply_markup });
    } else {
      // every bot message goes out as a picture with the text as its caption
      await sendWithMedia(bot, msg.chatId, msg.media ?? 'default', msg.text, { reply_markup });
    }
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
