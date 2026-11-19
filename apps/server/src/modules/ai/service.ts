/**
 * Profiles the app runs itself. An AI profile is an ordinary user row (`is_ai`) with a persona in
 * `ai_bots`; when someone writes to one, the worker asks the model for an answer and posts it as
 * that profile, so from the other side it is simply someone replying.
 */
import type { Logger } from 'pino';
import { sql } from '../../lib/db.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { inviteCode, uuidv7 } from '../../lib/ids.js';
import { chat, hasLlmKey, LlmError } from '../../lib/llm.js';
import { enqueue } from '../../lib/queue.js';
import { ageFrom, birthdateForAge, normalizeText } from '../../lib/text.js';
import { invalidateUser } from '../auth/guard.js';
import { insertMessage } from '../chat/routes.js';
import { getSettings } from '../settings/settings.js';

export interface AiBotRow {
  user_id: string;
  persona: string;
  model: string;
  enabled: boolean;
  replies: number;
  last_reply_at: Date | null;
  last_error: string | null;
  name: string | null;
  gender: 'male' | 'female' | null;
  birthdate: string | null;
  bio: string | null;
  marital_status: string | null;
  interested_in: 'male' | 'female' | 'everyone' | null;
  status: string;
  discoverable: boolean;
  photo_count: number;
  last_active_at: Date;
  created_at: Date;
}

export interface NewAiBot {
  name: string;
  gender: 'male' | 'female';
  age: number;
  interestedIn?: 'male' | 'female' | 'everyone';
  bio?: string | null;
  maritalStatus?: string | null;
  persona?: string;
  model?: string;
  enabled?: boolean;
}

/**
 * Creates the user row and its persona. No telegram_id, so nobody can log in as it; `can_dm` stays
 * false, so the bot never tries to message it.
 */
export async function createBot(input: NewAiBot, adminId: string | null): Promise<string> {
  const name = normalizeText(input.name);
  if (name.length < 2) throw badRequest('نام کوتاه است');
  const id = uuidv7();
  for (let attempt = 0; attempt < 5; attempt++) {
    const inserted = await sql`
      INSERT INTO users (id, ref_code, status, is_ai, name, gender, birthdate, interested_in, bio, marital_status,
                         discoverable, activated_at, last_active_at)
      VALUES (${id}, ${inviteCode()}, 'active', true, ${name}, ${input.gender}, ${birthdateForAge(input.age)},
              ${input.interestedIn ?? (input.gender === 'male' ? 'female' : 'male')},
              ${input.bio ? normalizeText(input.bio) : null}, ${input.maritalStatus ?? null}, true, now(), now())
      ON CONFLICT (ref_code) DO NOTHING
      RETURNING id`;
    if (!inserted.length) continue; // invite-code collision: try another
    await sql`
      INSERT INTO ai_bots (user_id, persona, model, enabled, created_by)
      VALUES (${id}, ${input.persona ? normalizeText(input.persona) : ''}, ${input.model ?? ''}, ${input.enabled ?? true}, ${adminId})`;
    await invalidateUser(id);
    return id;
  }
  throw conflict('could not allocate a code for the profile');
}

export async function listBots(): Promise<AiBotRow[]> {
  return sql<AiBotRow[]>`
    SELECT b.*, u.name, u.gender, u.birthdate::text AS birthdate, u.bio, u.marital_status, u.interested_in,
           u.status, u.discoverable, u.photo_count, u.last_active_at, u.created_at
    FROM ai_bots b JOIN users u ON u.id = b.user_id
    ORDER BY b.created_at DESC`;
}

export async function getBot(userId: string): Promise<AiBotRow> {
  const [row] = await sql<AiBotRow[]>`
    SELECT b.*, u.name, u.gender, u.birthdate::text AS birthdate, u.bio, u.marital_status, u.interested_in,
           u.status, u.discoverable, u.photo_count, u.last_active_at, u.created_at
    FROM ai_bots b JOIN users u ON u.id = b.user_id WHERE b.user_id = ${userId}`;
  if (!row) throw notFound('این پروفایل پیدا نشد');
  return row;
}

export interface BotPatch {
  name?: string;
  gender?: 'male' | 'female';
  age?: number;
  interestedIn?: 'male' | 'female' | 'everyone';
  bio?: string | null;
  maritalStatus?: string | null;
  persona?: string;
  model?: string;
  enabled?: boolean;
  discoverable?: boolean;
}

export async function updateBot(userId: string, patch: BotPatch): Promise<AiBotRow> {
  await getBot(userId);
  const user: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = normalizeText(patch.name);
    if (name.length < 2) throw badRequest('نام کوتاه است');
    user.name = name;
  }
  if (patch.gender !== undefined) user.gender = patch.gender;
  if (patch.age !== undefined) user.birthdate = birthdateForAge(patch.age);
  if (patch.interestedIn !== undefined) user.interested_in = patch.interestedIn;
  if (patch.bio !== undefined) user.bio = patch.bio ? normalizeText(patch.bio) : null;
  if (patch.maritalStatus !== undefined) user.marital_status = patch.maritalStatus;
  if (patch.discoverable !== undefined) user.discoverable = patch.discoverable;
  // switched off: it also stops being shown to anyone
  if (patch.enabled === false) user.discoverable = false;
  if (Object.keys(user).length) await sql`UPDATE users SET ${sql(user)}, updated_at = now() WHERE id = ${userId}`;

  const bot: Record<string, unknown> = {};
  if (patch.persona !== undefined) bot.persona = normalizeText(patch.persona);
  if (patch.model !== undefined) bot.model = patch.model;
  if (patch.enabled !== undefined) bot.enabled = patch.enabled;
  if (Object.keys(bot).length) await sql`UPDATE ai_bots SET ${sql(bot)}, updated_at = now() WHERE user_id = ${userId}`;

  await invalidateUser(userId);
  return getBot(userId);
}

/** Deletes the profile the way a user deletion works: conversations close, photos go. */
export async function deleteBot(userId: string) {
  await getBot(userId);
  const { deleteAccount } = await import('../users/lifecycle.js');
  await deleteAccount(userId);
  await sql`DELETE FROM ai_bots WHERE user_id = ${userId}`;
}

// ---- answering --------------------------------------------------------------------------------

/** How the model is told who it is. Everything here is the admin's own text plus profile facts. */
function systemPrompt(bot: AiBotRow, peer: { name: string | null; age: number | null; gender: string | null; bio: string | null }): string {
  const age = ageFrom(bot.birthdate);
  const who = [
    `تو «${bot.name ?? 'یک کاربر'}» هستی، ${bot.gender === 'female' ? 'یک خانم' : 'یک آقا'}${age ? ` ${age} ساله` : ''} و کاربر یک اپ آشنایی و گفتگوی ایرانی به اسم Vibe Chat.`,
    bot.bio ? `در پروفایلت نوشته‌ای: «${bot.bio}»` : '',
    bot.persona ? `شخصیت و پیشینه‌ات: ${bot.persona}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const them = [
    `داری با «${peer.name ?? 'یک نفر'}» چت می‌کنی`,
    peer.age ? `${peer.age} ساله` : '',
    peer.gender === 'female' ? 'خانم' : peer.gender === 'male' ? 'آقا' : '',
  ]
    .filter(Boolean)
    .join('، ');
  return `${who}

${them}.

چطور جواب بده:
- فارسی محاوره‌ای و خودمانی بنویس، مثل چت واقعی در تلگرام. کوتاه: یک یا دو جمله، حداکثر سه جمله.
- طبیعی باش: سؤال بپرس، به حرف قبلی‌اش ربط بده، گاهی یک ایموجی.
- هیچ‌وقت نگو که هوش مصنوعی یا ربات یا مدل زبانی هستی و درباره‌ی این موضوع بحث نکن؛ تو همین آدمی هستی که در پروفایل نوشته شده.
- شماره تلفن، آیدی تلگرام، لینک، آدرس یا هر راه تماس بیرون از این اپ نده و نخواه.
- قرار حضوری نگذار و وعده‌ی دیدن در دنیای واقعی نده.
- محتوای جنسی، توهین، سیاست و موضوع‌های حساس را نرم رد کن و بحث را عوض کن.
- فقط متن پیام را بنویس؛ اسم خودت، علامت نقل قول و توضیح اضافه ننویس.`;
}

/** The recent turns of this conversation, oldest first, as the model expects them. */
async function history(matchId: string, botId: string, limit: number) {
  const rows = await sql<{ sender_id: string; kind: string; body: string | null }[]>`
    SELECT sender_id, kind, body FROM messages
    WHERE match_id = ${matchId} AND NOT ghost AND kind IN ('text', 'image')
    ORDER BY id DESC LIMIT ${limit}`;
  return rows
    .reverse()
    .map((m) => ({
      role: (m.sender_id === botId ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.kind === 'image' ? '[یک عکس فرستاد]' : (m.body ?? '').slice(0, 1000),
    }))
    .filter((m) => m.content);
}

/**
 * The peer of this conversation is an AI profile and someone just wrote to it: book a reply.
 * Called from the message path, so it must never throw into the sender's request.
 */
export async function maybeScheduleReply(matchId: string, senderId: string, peerId: string) {
  const [bot] = await sql<{ user_id: string }[]>`
    SELECT b.user_id FROM ai_bots b JOIN users u ON u.id = b.user_id
    WHERE b.user_id = ${peerId} AND b.enabled AND u.status = 'active' AND u.is_ai`;
  if (!bot) return;
  const { ai } = await getSettings();
  if (!ai.enabled || !hasLlmKey()) return;
  // a human pause, so the answer doesn't land in the same instant as the question
  const delay = (ai.replyDelayS + Math.floor(Math.random() * Math.max(1, ai.replyDelayS))) * 1000;
  await enqueue({ name: 'ai-reply', matchId, botId: peerId, toId: senderId }, delay);
}

/**
 * Worker side: ask the model and post the answer. Does nothing when the person has meanwhile left
 * the conversation, blocked the profile, or the profile already answered last.
 */
export async function replyAsBot(matchId: string, botId: string, toId: string, log?: Logger) {
  const [bot] = await sql<AiBotRow[]>`
    SELECT b.*, u.name, u.gender, u.birthdate::text AS birthdate, u.bio, u.marital_status, u.interested_in,
           u.status, u.discoverable, u.photo_count, u.last_active_at, u.created_at
    FROM ai_bots b JOIN users u ON u.id = b.user_id
    WHERE b.user_id = ${botId} AND b.enabled AND u.status = 'active' AND u.is_ai`;
  if (!bot) return;
  const [m] = await sql<{ status: string; last_sender_id: string | null }[]>`
    SELECT m.status, m.last_sender_id FROM matches m
    JOIN match_members mm ON mm.match_id = m.id AND mm.user_id = ${botId} AND mm.peer_id = ${toId}
    WHERE m.id = ${matchId}`;
  if (!m || m.status !== 'active') return;
  if (m.last_sender_id === botId) return; // already answered; nothing new to answer
  const [blocked] = await sql`
    SELECT 1 FROM blocks WHERE (blocker_id = ${toId} AND blocked_id = ${botId}) OR (blocker_id = ${botId} AND blocked_id = ${toId})`;
  if (blocked) return;

  const settings = await getSettings();
  const [peer] = await sql<{ name: string | null; birthdate: string | null; gender: string | null; bio: string | null }[]>`
    SELECT name, birthdate::text AS birthdate, gender, bio FROM users WHERE id = ${toId}`;
  const turns = await history(matchId, botId, settings.ai.historyMessages);
  if (!turns.length) return;

  const model = bot.model || settings.ai.model;
  try {
    const raw = await chat(
      [
        { role: 'system', content: systemPrompt(bot, { ...(peer ?? { name: null, gender: null, bio: null }), age: ageFrom(peer?.birthdate ?? null) }) },
        ...turns,
      ],
      { model, temperature: settings.ai.temperature, maxTokens: 200 },
    );
    const text = clean(raw);
    if (!text) throw new LlmError('nothing usable in the reply', 502);
    await insertMessage(matchId, botId, toId, { kind: 'text', body: text, media: null, replyTo: null, clientId: `ai-${matchId}-${Date.now()}` });
    await sql`
      UPDATE ai_bots SET replies = replies + 1, last_reply_at = now(), last_error = NULL, updated_at = now()
      WHERE user_id = ${botId}`;
    // it was «around» just now, which is what discovery and the chat header show
    await sql`UPDATE users SET last_active_at = now() WHERE id = ${botId}`;
    await invalidateUser(botId);
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : 'reply failed';
    await sql`UPDATE ai_bots SET last_error = ${msg}, updated_at = now() WHERE user_id = ${botId}`;
    log?.warn({ botId, matchId, err: msg }, 'ai reply failed');
    throw e; // let the queue retry it
  }
}

/**
 * Models like to add a name prefix, wrapping quotes or a stage direction; the chat wants just the
 * message. Stripping one layer exposes the next («اسم: *می‌خندد* «متن»»), so this runs until stable.
 */
function clean(raw: string): string {
  let text = raw.trim();
  for (let pass = 0; pass < 4; pass++) {
    const before = text;
    text = text
      // «اسم: متن» at the very start
      .replace(/^[^\n:]{1,20}:\s*/u, '')
      // a leading or trailing *action*
      .replace(/^\*[^*]{1,80}\*\s*/u, '')
      .replace(/\s*\*[^*]{1,80}\*$/u, '')
      // wrapping quotes of every flavour
      .replace(/^["'«“](.*)["'»”]$/su, '$1')
      .trim();
    if (text === before) break;
  }
  return normalizeText(text).slice(0, 700);
}

/** A quick end-to-end check for the panel: does the key work, does this model answer? */
export async function testModel(model: string): Promise<string> {
  return chat(
    [
      { role: 'system', content: 'فارسی و کوتاه جواب بده.' },
      { role: 'user', content: 'سلام! یک جمله‌ی کوتاه بگو تا بدونم کار می‌کنی.' },
    ],
    { model, maxTokens: 80, timeoutMs: 30_000 },
  );
}
