import sharp, { type Metadata, type Sharp } from 'sharp';
import { type Api, GrammyError, InputFile, type InlineKeyboard } from 'grammy';
import type { Message } from 'grammy/types';
import { env } from '../../config.js';
import { sql } from '../../lib/db.js';
import { badRequest } from '../../lib/errors.js';
import { randomToken } from '../../lib/ids.js';
import { redis } from '../../lib/redis.js';
import { deleteObjects, getObject, putObject } from '../../lib/storage.js';

/**
 * Pictures on bot messages. Every message the bot sends is a photo with the text as its caption,
 * so the chat looks like one designed product. Admins upload one image per kind of message (a
 * «slot»); a slot without its own image uses «default»; with no image at all the text goes alone.
 *
 * Telegram gives each uploaded photo a file_id: the first send uploads the bytes, every later one
 * just names that id (no upload, instant). Ids belong to the bot that uploaded them, so a new bot
 * token re-uploads once.
 */
export const BOT_MEDIA_SLOTS = [
  { id: 'default', title: 'پیش‌فرض', when: 'هر پیامی که تصویر مخصوص خودش را ندارد' },
  { id: 'start', title: 'خوش‌آمد (شروع ربات)', when: 'وقتی کاربر ربات را شروع می‌کند (دستور start)' },
  { id: 'help', title: 'راهنما', when: 'جواب به پیام‌های متنی کاربر در ربات' },
  { id: 'invite', title: 'دعوت دوستان', when: 'دستور invite و دکمه‌ی «دعوت دوستان»' },
  { id: 'message', title: 'پیام جدید', when: 'وقتی کاربر آفلاین است و کسی برایش پیام می‌فرستد' },
  { id: 'like', title: 'لایک', when: 'وقتی کسی کاربر را لایک می‌کند' },
  { id: 'super_like', title: 'سوپرلایک', when: 'وقتی کسی کاربر را سوپرلایک می‌کند' },
  { id: 'match', title: 'مچ', when: 'وقتی دو نفر همدیگر را می‌پسندند' },
  { id: 'wall_like', title: 'لایک روی دیوار', when: 'وقتی کسی درخواست کاربر روی دیوار را لایک می‌کند' },
  { id: 'wall_request', title: 'درخواست گفتگو از دیوار', when: 'وقتی کسی برای درخواست دیوار کاربر درخواست گفتگو می‌فرستد' },
  { id: 'wall_accept', title: 'قبول درخواست گفتگو', when: 'وقتی صاحب درخواست، درخواست گفتگوی کاربر را قبول می‌کند' },
  { id: 'wall_post', title: 'درخواست بدون عکس در گروه دیوار', when: 'وقتی نویسنده‌ی درخواست عکسش را نشان نمی‌دهد (گروه تلگرام)' },
  { id: 'premium', title: 'عضویت ویژه', when: 'رسید پرداخت و فعال شدن عضویت ویژه' },
  { id: 'referral', title: 'هدیه‌ی دعوت', when: 'وقتی دوستِ دعوت‌شده عضو می‌شود و هدیه می‌رسد' },
  { id: 'system', title: 'اطلاع سیستمی', when: 'پیام‌های سیستمی (مثلاً برداشته شدن درخواست از دیوار)' },
  { id: 'announcement', title: 'اطلاعیه‌ی همگانی', when: 'اطلاعیه‌هایی که از پنل برای همه ارسال می‌شود' },
  { id: 'comeback', title: 'دلتنگی (بازگشت)', when: 'یادآوری به کاربرانی که چند روز سر نزده‌اند' },
  { id: 'vibe_night', title: 'شب Vibe', when: 'یادآوری شروع «شب Vibe» (ساعت شلوغ هر شب)' },
] as const;

export type BotMediaSlot = (typeof BOT_MEDIA_SLOTS)[number]['id'];
export const BOT_MEDIA_SLOT_IDS = BOT_MEDIA_SLOTS.map((s) => s.id) as [BotMediaSlot, ...BotMediaSlot[]];

interface MediaRow {
  slot: string;
  storage_key: string;
  file_id: string | null;
  file_bot: string | null;
}

/** Telegram photo captions are limited to 1024 visible characters (HTML tags don't count). */
export const CAPTION_MAX = 1024;
export const visibleLength = (html: string) =>
  [...html.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#\d+);/g, 'x')].length;

const botId = () => env.BOT_TOKEN.split(':')[0] ?? '';

// a few seconds of per-process cache: a burst (broadcast) doesn't hit the database per message
const cache = new Map<string, { at: number; row: MediaRow | null }>();
const CACHE_MS = 30_000;

async function loadSlot(slot: string, fresh = false): Promise<MediaRow | null> {
  const hit = cache.get(slot);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.row;
  const [row] = await sql<MediaRow[]>`SELECT slot, storage_key, file_id, file_bot FROM bot_media WHERE slot = ${slot}`;
  cache.set(slot, { at: Date.now(), row: row ?? null });
  return row ?? null;
}

/** The slot's own image, else the default one. */
async function resolve(slot: BotMediaSlot): Promise<MediaRow | null> {
  return (await loadSlot(slot)) ?? (slot === 'default' ? null : await loadSlot('default'));
}

export function forgetBotMediaCache() {
  cache.clear();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SendOptions {
  reply_markup?: InlineKeyboard;
}

/**
 * One stored picture that Telegram may already know. The first message uploads the bytes and keeps
 * the file_id Telegram gives back; every later message just names that id.
 */
interface PhotoRef {
  /** identifies the picture while one sender uploads it and the others wait */
  id: string;
  storageKey: string;
  fileId: string | null;
  /** the bot the file_id belongs to (an id never works for another token) */
  fileBot: string | null;
  /** Telegram accepted the upload and gave this id */
  remember: (fileId: string) => Promise<void>;
  /** the stored id stopped working */
  forget: (fileId: string) => Promise<void>;
  /** the id another sender may have stored while we waited */
  reload: () => Promise<{ fileId: string | null; fileBot: string | null }>;
  /** one more message went out with this picture */
  onSent?: () => void;
}

function slotRef(media: MediaRow): PhotoRef {
  return {
    id: `slot:${media.slot}`,
    storageKey: media.storage_key,
    fileId: media.file_id,
    fileBot: media.file_bot,
    remember: async (fileId) => {
      // only if the admin hasn't replaced the image meanwhile
      await sql`
        UPDATE bot_media SET file_id = ${fileId}, file_bot = ${botId()}, sent_count = sent_count + 1
        WHERE slot = ${media.slot} AND storage_key = ${media.storage_key}`;
      cache.delete(media.slot);
    },
    forget: async (fileId) => {
      await sql`UPDATE bot_media SET file_id = NULL, file_bot = NULL WHERE slot = ${media.slot} AND file_id = ${fileId}`;
      cache.delete(media.slot);
    },
    reload: async () => {
      const fresh = await loadSlot(media.slot, true);
      return { fileId: fresh?.file_id ?? null, fileBot: fresh?.file_bot ?? null };
    },
    onSent: () => void countSent(media.slot),
  };
}

/** The picture an admin attached to one announcement (it stands in for the «announcement» image). */
async function announcementRef(announcementId: string): Promise<PhotoRef | null> {
  const [a] = await sql<{ image_key: string | null; tg_file_id: string | null; tg_file_bot: string | null }[]>`
    SELECT image_key, tg_file_id, tg_file_bot FROM announcements WHERE id = ${announcementId}`;
  if (!a?.image_key) return null;
  const key = a.image_key;
  return {
    id: `announcement:${announcementId}`,
    storageKey: key,
    fileId: a.tg_file_id,
    fileBot: a.tg_file_bot,
    remember: async (fileId) => {
      await sql`UPDATE announcements SET tg_file_id = ${fileId}, tg_file_bot = ${botId()} WHERE id = ${announcementId} AND image_key = ${key}`;
    },
    forget: async (fileId) => {
      await sql`UPDATE announcements SET tg_file_id = NULL, tg_file_bot = NULL WHERE id = ${announcementId} AND tg_file_id = ${fileId}`;
    },
    reload: async () => {
      const [r] = await sql<{ tg_file_id: string | null; tg_file_bot: string | null }[]>`
        SELECT tg_file_id, tg_file_bot FROM announcements WHERE id = ${announcementId}`;
      return { fileId: r?.tg_file_id ?? null, fileBot: r?.tg_file_bot ?? null };
    },
  };
}

/**
 * Sends `text` (HTML) as the caption of `ref`'s picture. Falls back to a plain text message when
 * there is no picture, the text is too long for a caption, the file can't be read, or Telegram
 * refuses the photo — a notification is never lost because of a picture.
 */
async function sendCaption(api: Api, chatId: number | string, ref: PhotoRef | null, text: string, opts: SendOptions): Promise<Message> {
  const sendText = () =>
    api.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: opts.reply_markup, link_preview_options: { is_disabled: true } });

  if (!ref || visibleLength(text) > CAPTION_MAX) return sendText();
  const photoOpts = { caption: text, parse_mode: 'HTML' as const, reply_markup: opts.reply_markup };

  // already on Telegram's servers: just name it
  if (ref.fileId && ref.fileBot === botId()) {
    try {
      const msg = await api.sendPhoto(chatId, ref.fileId, photoOpts);
      ref.onSent?.();
      return msg;
    } catch (e) {
      if (!(e instanceof GrammyError) || e.error_code !== 400 || !/file|photo|identifier|reference/i.test(e.description)) throw e;
      // the id stopped working: forget it and upload again below
      await ref.forget(ref.fileId);
    }
  }

  // first send: one sender uploads, the others wait a moment for its file_id (a broadcast would
  // otherwise upload the same picture from every worker at once)
  const lock = await redis.set(`botmedia:upload:${ref.id}`, '1', 'EX', 30, 'NX');
  if (lock !== 'OK') {
    for (let i = 0; i < 12; i++) {
      await sleep(500);
      const fresh = await ref.reload();
      if (fresh.fileId && fresh.fileBot === botId()) {
        const msg = await api.sendPhoto(chatId, fresh.fileId, photoOpts);
        ref.onSent?.();
        return msg;
      }
    }
  }

  try {
    // a picture whose file is gone must not stop the message (or retry for every receiver)
    const bytes = await getObject(ref.storageKey).catch(() => null);
    if (!bytes) return sendText();
    const msg = await api.sendPhoto(chatId, new InputFile(bytes, 'vibe.jpg'), photoOpts);
    const fileId = msg.photo?.[msg.photo.length - 1]?.file_id;
    if (fileId) await ref.remember(fileId);
    return msg;
  } catch (e) {
    // blocked (403) and flood waits (429) are the sender's business; a refused photo is not
    if (e instanceof GrammyError && e.error_code === 400) return sendText();
    throw e;
  } finally {
    if (lock === 'OK') await redis.del(`botmedia:upload:${ref.id}`);
  }
}

/** Sends `text` (HTML) with the slot's picture (or the default one) as its caption. */
export async function sendWithMedia(api: Api, chatId: number | string, slot: BotMediaSlot, text: string, opts: SendOptions = {}): Promise<Message> {
  const media = await resolve(slot);
  return sendCaption(api, chatId, media ? slotRef(media) : null, text, opts);
}

/** An announcement: with the picture the admin attached to it, else with the «announcement» image. */
export async function sendAnnouncementMedia(
  api: Api,
  chatId: number | string,
  announcementId: string,
  text: string,
  opts: SendOptions = {},
): Promise<Message> {
  const own = await announcementRef(announcementId);
  return own ? sendCaption(api, chatId, own, text, opts) : sendWithMedia(api, chatId, 'announcement', text, opts);
}

async function countSent(slot: string) {
  await sql`UPDATE bot_media SET sent_count = sent_count + 1 WHERE slot = ${slot}`.catch(() => undefined);
}

// ---- admin ------------------------------------------------------------------------------------

/** Every slot with its image (if any), for the admin panel. */
export async function listBotMedia() {
  const rows = await sql<
    { slot: string; preview: string; width: number; height: number; bytes: number; file_id: string | null; file_bot: string | null; sent_count: string; updated_at: Date }[]
  >`SELECT slot, preview, width, height, bytes, file_id, file_bot, sent_count, updated_at FROM bot_media`;
  const bySlot = new Map(rows.map((r) => [r.slot, r]));
  return {
    items: BOT_MEDIA_SLOTS.map((s) => {
      const r = bySlot.get(s.id);
      return {
        id: s.id,
        title: s.title,
        when: s.when,
        image: r
          ? {
              preview: r.preview,
              width: r.width,
              height: r.height,
              bytes: r.bytes,
              /** uploaded to Telegram already (later sends reuse it) */
              onTelegram: !!r.file_id && r.file_bot === botId(),
              sent: Number(r.sent_count),
              updatedAt: r.updated_at.toISOString(),
            }
          : null,
      };
    }),
  };
}

export interface EncodedImage {
  /** what goes to Telegram */
  jpeg: Buffer;
  /** a small preview as a data URL, so the panel can show it without a public media URL */
  preview: string;
  width: number;
  height: number;
}

/**
 * Prepares an uploaded picture for Telegram: JPEG (its favourite), at most 1600 px, flattened onto
 * the app's dark background, plus a small preview for the panel.
 */
export async function encodeForTelegram(input: Buffer, previewWidth = 480): Promise<EncodedImage> {
  let img: Sharp;
  let meta: Metadata;
  try {
    img = sharp(input, { failOn: 'error' }).rotate();
    meta = await img.metadata();
  } catch {
    throw badRequest('فایل تصویر معتبر نیست');
  }
  if (!meta.width || !meta.height) throw badRequest('فایل تصویر معتبر نیست');
  const ratio = Math.max(meta.width, meta.height) / Math.min(meta.width, meta.height);
  if (ratio > 3) throw badRequest('نسبت طول به عرض تصویر بیش از حد کشیده است');

  const { data: jpeg, info } = await img
    .clone()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#0b0a10' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const preview = await img.clone().resize({ width: previewWidth, withoutEnlargement: true }).flatten({ background: '#0b0a10' }).webp({ quality: 72 }).toBuffer();
  return { jpeg, preview: `data:image/webp;base64,${preview.toString('base64')}`, width: info.width, height: info.height };
}

/**
 * Stores a new image for a slot: re-encoded as JPEG (Telegram's favourite), at most 1600 px wide,
 * plus a small preview for the panel. Replacing an image forgets the old file_id.
 */
export async function saveBotMedia(slot: BotMediaSlot, input: Buffer, adminId: string) {
  const { jpeg, preview, width, height } = await encodeForTelegram(input);
  const key = `bot/${slot}-${randomToken(8)}.jpg`;
  await putObject(key, jpeg, 'image/jpeg');
  const [old] = await sql<{ storage_key: string }[]>`SELECT storage_key FROM bot_media WHERE slot = ${slot}`;
  await sql`
    INSERT INTO bot_media (slot, storage_key, preview, width, height, bytes, updated_by)
    VALUES (${slot}, ${key}, ${preview}, ${width}, ${height}, ${jpeg.length}, ${adminId})
    ON CONFLICT (slot) DO UPDATE SET
      storage_key = excluded.storage_key, preview = excluded.preview, width = excluded.width, height = excluded.height,
      bytes = excluded.bytes, file_id = NULL, file_bot = NULL, sent_count = 0, updated_by = excluded.updated_by, updated_at = now()`;
  if (old && old.storage_key !== key) await deleteObjects([old.storage_key]).catch(() => undefined);
  cache.delete(slot);
}

export async function removeBotMedia(slot: BotMediaSlot) {
  const [old] = await sql<{ storage_key: string }[]>`DELETE FROM bot_media WHERE slot = ${slot} RETURNING storage_key`;
  if (old) await deleteObjects([old.storage_key]).catch(() => undefined);
  cache.delete(slot);
}

/** The picture of one announcement: stored like a slot image, but tied to that announcement. */
export async function saveAnnouncementImage(input: Buffer): Promise<{ key: string; preview: string }> {
  const { jpeg, preview } = await encodeForTelegram(input, 320);
  const key = `announce/${randomToken(12)}.jpg`;
  await putObject(key, jpeg, 'image/jpeg');
  return { key, preview };
}
