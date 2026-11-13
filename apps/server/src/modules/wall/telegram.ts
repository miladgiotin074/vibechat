import { GrammyError, InlineKeyboard, InputFile } from 'grammy';
import sharp from 'sharp';
import { miniAppLink } from '../../config.js';
import { WALL_CATEGORIES } from '../../data/catalog.js';
import { cityName } from '../../data/locations.js';
import { sql } from '../../lib/db.js';
import { getObject } from '../../lib/storage.js';
import { ageFrom } from '../../lib/text.js';
import { sendWithMedia } from '../bot/media.js';
import { botApi, escapeHtml } from '../bot/sender.js';
import { getSettings } from '../settings/settings.js';
import type { WallRow } from './service.js';

/**
 * The Wall's copy in a Telegram group: one message per request (photo + caption when the author
 * shows their photo), with glass buttons: «❤️ n» likes right there (callback), «💌 درخواست گفتگو» opens
 * the request in the Mini App, and «✨ درخواست خودت رو بذار» brings new people in.
 */
const FA = '۰۱۲۳۴۵۶۷۸۹';
const fa = (v: number | string) => String(v).replace(/\d/g, (d) => FA[Number(d)]!);
const tag = (s: string) => '#' + s.replace(/[\s‌]+/g, '_').replace(/[^\p{L}\p{N}_]/gu, '');

interface Author {
  name: string | null;
  birthdate: string | null;
  hide_age: boolean;
  photo_key: string | null;
}

async function loadPost(postId: string) {
  const [p] = await sql<(WallRow & Author)[]>`
    SELECT w.*, u.name, u.birthdate::text AS birthdate, u.hide_age,
           (u.activated_at > now() - interval '72 hours'
            AND NOT EXISTS (SELECT 1 FROM wall_posts o WHERE o.user_id = w.user_id AND o.created_at < w.created_at)) AS newcomer_first,
           (SELECT ph.storage_key FROM photos ph WHERE ph.user_id = w.user_id AND ph.status = 'approved' ORDER BY ph.position LIMIT 1) AS photo_key
    FROM wall_posts w JOIN users u ON u.id = w.user_id WHERE w.id = ${postId}`;
  return p;
}

function caption(p: WallRow & Author): string {
  const cat = WALL_CATEGORIES.find((c) => c.id === p.category);
  const age = p.hide_age ? null : ageFrom(p.birthdate);
  const city = cityName(p.city_id);
  const who = [escapeHtml(p.name ?? 'کاربر'), age ? fa(age) : null].filter(Boolean).join('، ');
  const target = p.looking_for === 'male' ? 'آقا' : p.looking_for === 'female' ? 'خانم' : 'فرقی نمی‌کنه';
  const lines = [
    ...(p.newcomer_first ? ['✨ <b>تازه‌وارد</b> · اولین درخواستش روی دیوار؛ خوش‌آمد بگید 💜', ''] : []),
    `${p.author_gender === 'female' ? '👩' : '👨'} <b>${who}</b>${city ? ` · 📍 ${escapeHtml(city)}` : ''}`,
    `${cat?.emoji ?? '💜'} ${escapeHtml(cat?.label ?? '')} · دنبال: ${target}`,
    '',
    `«${escapeHtml(p.text)}»`,
    '',
    [cat ? tag(cat.label) : null, city ? tag(city) : null, p.newcomer_first ? '#تازه_وارد' : null].filter(Boolean).join(' '),
  ];
  if (p.status === 'expired') lines.push('', '⏳ <i>زمان این درخواست تمام شده است</i>');
  return lines.join('\n');
}

function keyboard(p: WallRow & Author): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (p.status === 'active') {
    kb.text(`❤️ ${p.like_count > 0 ? fa(p.like_count) : 'لایک'}`, `wl:${p.id}`)
      .url(`💌 درخواست گفتگو با ${(p.name ?? 'او').slice(0, 16)}`, miniAppLink(`w_${p.id}`))
      .row();
  }
  kb.url('✨ درخواست خودت رو بذار', miniAppLink('s_wall'));
  return kb;
}

const notModified = (e: unknown) => e instanceof GrammyError && /message is not modified/i.test(e.description);
const gone = (e: unknown) => e instanceof GrammyError && /message to (edit|delete) not found|message can't be (edited|deleted)/i.test(e.description);

export async function publishToGroup(postId: string) {
  const api = botApi();
  const settings = await getSettings();
  const tg = settings.wall.telegram;
  if (!api || !tg.enabled || !tg.chatId) return;
  const p = await loadPost(postId);
  if (!p || p.status !== 'active' || p.tg_message_id) return;

  const opts = { parse_mode: 'HTML' as const, reply_markup: keyboard(p) };
  let messageId: number;
  let withPhoto = false;
  if (p.show_photo && p.photo_key) {
    // read the stored photo and upload it: works with private storage and local development alike
    const webp = await getObject(`${p.photo_key}/md.webp`);
    const jpeg = await sharp(webp).jpeg({ quality: 85 }).toBuffer();
    const msg = await api.sendPhoto(tg.chatId, new InputFile(jpeg, 'vibe.jpg'), { caption: caption(p), ...opts });
    messageId = msg.message_id;
    withPhoto = true;
  } else {
    // author hides their photo: the Wall's own picture keeps the group uniform (text alone if none)
    const msg = await sendWithMedia(api, tg.chatId, 'wall_post', caption(p), { reply_markup: opts.reply_markup });
    messageId = msg.message_id;
    withPhoto = !!msg.photo;
  }
  await sql`UPDATE wall_posts SET tg_chat_id = ${tg.chatId}::bigint, tg_message_id = ${messageId}, tg_photo = ${withPhoto} WHERE id = ${postId}`;
}

/** Brings the group copy up to date: like count, «expired», or gone when deleted/removed. */
export async function syncGroupMessage(postId: string) {
  const api = botApi();
  if (!api) return;
  const p = await loadPost(postId);
  if (!p?.tg_chat_id || !p.tg_message_id) return;
  const chat = p.tg_chat_id;
  const mid = Number(p.tg_message_id);
  try {
    if (p.status === 'deleted' || p.status === 'removed') {
      try {
        await api.deleteMessage(chat, mid);
      } catch {
        // too old to delete (or no rights): leave a tombstone instead
        const text = '🗑 <i>این درخواست حذف شده است</i>';
        if (p.tg_photo) await api.editMessageCaption(chat, mid, { caption: text, parse_mode: 'HTML', reply_markup: keyboard(p) });
        else await api.editMessageText(chat, mid, text, { parse_mode: 'HTML', reply_markup: keyboard(p) });
      }
      return;
    }
    // live or expired: one call brings the text (it may have been edited), the «expired» note and
    // the like count up to date
    if (p.tg_photo) await api.editMessageCaption(chat, mid, { caption: caption(p), parse_mode: 'HTML', reply_markup: keyboard(p) });
    else await api.editMessageText(chat, mid, caption(p), { parse_mode: 'HTML', reply_markup: keyboard(p), link_preview_options: { is_disabled: true } });
  } catch (e) {
    if (notModified(e) || gone(e)) return;
    throw e;
  }
}

/**
 * A bumped request is sent to the group again, so it's the newest message there too; the old copy
 * is deleted (or, when Telegram no longer allows that, shortened to a pointer without buttons).
 */
export async function bumpInGroup(postId: string) {
  const api = botApi();
  if (!api) return;
  const p = await loadPost(postId);
  if (!p || p.status !== 'active' || !p.tg_chat_id || !p.tg_message_id) return;
  const chat = p.tg_chat_id;
  const mid = Number(p.tg_message_id);
  try {
    await api.deleteMessage(chat, mid);
  } catch {
    const text = '⬆️ <i>این درخواست نردبان شد و پایین‌تر دوباره منتشر شده</i>';
    const done = p.tg_photo ? api.editMessageCaption(chat, mid, { caption: text, parse_mode: 'HTML' }) : api.editMessageText(chat, mid, text, { parse_mode: 'HTML' });
    await done.catch(() => undefined);
  }
  await sql`UPDATE wall_posts SET tg_message_id = NULL, tg_photo = false WHERE id = ${postId} AND tg_message_id = ${p.tg_message_id}`;
  await publishToGroup(postId);
}
