/**
 * Making an AI profile by forwarding: an admin forwards any message from the person they want the
 * profile to look like, and the bot offers to register that sender as a new AI profile — their
 * name, their Telegram profile picture, nothing to type. One tap and it exists.
 *
 * It only answers admins listed in `ai.telegramAdmins` (their numeric Telegram ids; `/id` tells
 * someone their own). To everyone else a forwarded message is just another message, so the feature
 * is invisible: creating profiles the app passes off as people is not something to leave open.
 *
 * AI profiles are always women — that is the decision, so nothing asks about gender.
 */
import { InlineKeyboard, type Context } from 'grammy';
import { env } from '../../config.js';
import { randomToken } from '../../lib/ids.js';
import { redis } from '../../lib/redis.js';
import { ageFrom } from '../../lib/text.js';
import { botApi, escapeHtml } from '../bot/sender.js';
import { savePhotoFor } from '../profile/routes.js';
import { getSettings } from '../settings/settings.js';
import { createBot, getBot, inventProfile } from './service.js';

const PENDING_TTL_S = 3600;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** What a forward told us about its sender, waiting for the admin to confirm it. */
interface Candidate {
  name: string;
  /** The sender's Telegram id — absent when they forward with their account hidden. */
  tgId?: number;
  /** Their profile picture, or the picture of the forwarded message itself. */
  fileId?: string;
}

export async function isAiAdmin(telegramId: number | undefined): Promise<boolean> {
  if (!telegramId) return false;
  const { ai } = await getSettings();
  return ai.telegramAdmins.includes(String(telegramId));
}

/** Downloads a Telegram file by id, within a sane size. */
async function downloadFile(fileId: string): Promise<Buffer | null> {
  const api = botApi();
  if (!api || !env.BOT_TOKEN) return null;
  try {
    const file = await api.getFile(fileId);
    if (!file.file_path) return null;
    const res = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length && buf.length <= MAX_PHOTO_BYTES ? buf : null;
  } catch {
    return null;
  }
}

/** The biggest size of someone's current Telegram profile picture. */
async function profilePhotoFileId(tgId: number): Promise<string | undefined> {
  const api = botApi();
  if (!api) return undefined;
  try {
    const res = await api.getUserProfilePhotos(tgId, { limit: 1 });
    const sizes = res.photos[0];
    return sizes?.[sizes.length - 1]?.file_id;
  } catch {
    // the bot has never seen this account, or their photos are not public
    return undefined;
  }
}

/** Reads the sender out of a forwarded message. Returns null when it is not a forward. */
function senderOf(ctx: Context): Candidate | null {
  const msg = ctx.message;
  const origin = msg?.forward_origin;
  if (!msg || !origin) return null;
  // the picture of the forwarded message stands in when the sender's own is not available
  const photo = msg.photo?.[msg.photo.length - 1]?.file_id;
  if (origin.type === 'user') {
    return { name: origin.sender_user.first_name, tgId: origin.sender_user.id, fileId: photo };
  }
  if (origin.type === 'hidden_user') return { name: origin.sender_user_name, fileId: photo };
  // forwarded from a channel or a group: there is no person behind it
  return null;
}

/**
 * An admin forwarded something. Shows what the profile would look like and one button to make it.
 * Returns false when this isn't a forward we can use, so the bot can answer as it normally would.
 */
export async function offerFromForward(ctx: Context): Promise<boolean> {
  const found = senderOf(ctx);
  if (!found) return false;
  const name = found.name.replace(/[^\p{L}\p{M} ]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
  if (name.length < 2) {
    await ctx.reply('اسم فرستنده‌ی این پیام قابل استفاده نیست. یک پیام از کسی با اسم فارسی یا انگلیسی فوروارد کن.');
    return true;
  }
  const candidate: Candidate = { name, ...(found.tgId ? { tgId: found.tgId } : {}) };
  // their profile picture first; the forwarded picture only if there is none
  const fileId = (found.tgId ? await profilePhotoFileId(found.tgId) : undefined) ?? found.fileId;
  if (fileId) candidate.fileId = fileId;

  const token = randomToken(10);
  await redis.set(`aifwd:${token}`, JSON.stringify(candidate), 'EX', PENDING_TTL_S);
  const { ai } = await getSettings();
  const lines = [
    '🤖 <b>کاربر هوش مصنوعی جدید</b>',
    '',
    `نام: <b>${escapeHtml(name)}</b>`,
    'جنسیت: زن',
    `سن: ${ai.defaultAge} (در پنل قابل تغییر)`,
    candidate.fileId ? 'عکس: از پروفایل همین فرستنده' : 'عکس: ندارد (حرف اول اسمش نمایش داده می‌شود)',
    '',
    '<i>بیو و شخصیتش را خود مدل می‌نویسد.</i>',
  ];
  const kb = new InlineKeyboard().text('✅ ثبت کن', `ain:${token}`).text('✖️ بی‌خیال', `aix:${token}`);
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
  return true;
}

/** «ثبت کن»: creates the profile, with the picture if there is one. */
export async function createFromForward(ctx: Context, token: string) {
  if (!(await isAiAdmin(ctx.from?.id))) return ctx.answerCallbackQuery({ text: 'اجازه نداری' });
  const raw = await redis.get(`aifwd:${token}`);
  if (!raw) return ctx.answerCallbackQuery({ text: 'این درخواست منقضی شده؛ پیام را دوباره فوروارد کن', show_alert: true });
  await redis.del(`aifwd:${token}`);
  const candidate = JSON.parse(raw) as Candidate;
  const { ai } = await getSettings();

  try {
    // the model writes the bio and the persona, so there is nothing to type here
    const written = await inventProfile(candidate.name, ai.defaultAge);
    const id = await createBot(
      { name: candidate.name, gender: 'female', age: ai.defaultAge, bio: written.bio || null, persona: written.persona },
      null,
    );
    let photo = false;
    if (candidate.fileId) {
      const bytes = await downloadFile(candidate.fileId);
      if (bytes) {
        await savePhotoFor(id, bytes).catch(() => undefined);
        photo = true;
      }
    }
    const bot = await getBot(id);
    const age = ageFrom(bot.birthdate);
    await ctx.answerCallbackQuery({ text: '✅ ساخته شد' });
    await ctx.editMessageText(
      [
        '✅ <b>کاربر هوش مصنوعی ساخته شد</b>',
        '',
        `نام: <b>${escapeHtml(bot.name ?? candidate.name)}</b>${age ? ` · ${age} ساله` : ''}`,
        photo ? 'عکس پروفایل گذاشته شد' : '⚠️ عکسی پیدا نشد؛ از پنل یکی اضافه کن',
        bot.bio ? `بیو: <i>${escapeHtml(bot.bio)}</i>` : '⚠️ بیو نوشته نشد؛ از پنل بنویس',
        bot.persona ? '✍️ شخصیتش هم نوشته شد' : '⚠️ شخصیت نوشته نشد؛ از پنل بنویس',
        '',
        '<i>برای تغییر هر کدام، پنل ← کاربران هوش مصنوعی.</i>',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  } catch (e) {
    await ctx.answerCallbackQuery({ text: e instanceof Error ? e.message.slice(0, 180) : 'ساخته نشد', show_alert: true });
  }
}

/** «بی‌خیال»: forget the candidate. */
export async function discardForward(ctx: Context, token: string) {
  await redis.del(`aifwd:${token}`);
  await ctx.answerCallbackQuery({ text: 'بی‌خیال شدیم' });
  await ctx.editMessageText('✖️ <i>ساخته نشد</i>', { parse_mode: 'HTML' }).catch(() => undefined);
}
