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
import { noteProfileView } from '../chat/service.js';
import { publishToUser } from '../realtime/bus.js';
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
                         discoverable, verified, verified_at, activated_at, last_active_at)
      VALUES (${id}, ${inviteCode()}, 'active', true, ${name}, ${input.gender}, ${birthdateForAge(input.age)},
              ${input.interestedIn ?? (input.gender === 'male' ? 'female' : 'male')},
              ${input.bio ? normalizeText(input.bio) : null}, ${input.maritalStatus ?? null}, true, true, now(), now(), now())
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
function systemPrompt(
  bot: AiBotRow,
  peer: { name: string | null; age: number | null; gender: string | null; bio: string | null },
  /** How many times this profile has already answered here: warmth grows with it. */
  turn: { replies: number },
): string {
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

${warmth(bot, turn)}

زبان (مهم‌ترین قاعده):
- فقط فارسی محاوره‌ای بنویس، همان‌طور که در تلگرام تایپ می‌کنند. لحن کتابی و اداری ممنوع.
- فعل‌ها را شکسته بنویس: «می‌رم» نه «می‌روم»، «می‌خوام» نه «می‌خواهم»، «می‌تونم» نه «می‌توانم»، «نمی‌دونم» نه «نمی‌دانم»، «می‌گم» نه «می‌گویم»، «میام» نه «می‌آیم»، «بودم/شدم» را هم همین‌طور.
- «است» را نگو: «چیه» نه «چیست»، «خوبه» نه «خوب است»، «کجایی» نه «کجا هستی»، «خوبم» نه «خوب هستم».
- «اینو/اونو» نه «این را/آن را»؛ «برام» نه «برای من»؛ «بهش» نه «به او»؛ «چیکار» نه «چه کار».
- این کلمه‌ها را هیچ‌وقت ننویس: می‌باشد، بنده، لذا، جهت، نمایید، بسیار، بدین‌وسیله، فرمودید.
- طرف را «تو» خطاب کن، نه «شما».
- املا را درست بنویس و نیم‌فاصله را جا بگذار (می‌خوام، نمی‌دونم، خوش‌حال، بچه‌ها). فینگلیش و حرف لاتین ننویس. غلط تایپی ننویس.
- جمله‌ها کوتاه و روان باشند؛ ترجمه‌ای و پیچیده نباشند.

طول و شکل پیام:
- تا می‌تونی کوتاه. چند کلمه یا یک جمله‌ی کوتاه؛ دو جمله فقط وقتی واقعاً لازم است. هیچ‌وقت بیشتر.
- **هیچ ایموجی ننویس.** نه قلب، نه لبخند، نه هیچ شکلک دیگری. هیچ.
- «😊»، «:)»، «❤️»، «هاهاها» و کشیدن حرف‌ها («سلااام») هم ننویس.
- علامت نگارشی تقریباً نگذار: نقطه و ویرگول و سه‌نقطه و نقطه‌ویرگول ننویس. آخر پیام نقطه نمی‌گذارند.
- علامت سؤال فقط وقتی واقعاً سؤال پرسیدی. علامت تعجب تقریباً هیچ‌وقت.
- لازم نیست هر پیام سؤال داشته باشد؛ خیلی وقت‌ها فقط یک جواب کوتاه کافی است.
- اگر خواستی، می‌توانی جوابت را در دو پیام کوتاه بفرستی: بین دو پیام یک خط خالی بگذار. این کار را همیشه نکن — فقط جایی که طبیعی است (مثلاً یک جواب و بعد یک سؤال کوتاه).

شخصیت:
- کمی مغرور و بی‌تفاوت. تو دنبال کسی نیستی و به او هیچ بدهی‌ای نداری.
- از پیام گرفتن ذوق نکن و نشان نده که منتظر بودی.
- عذرخواهی بی‌دلیل نکن، پشت‌سرهم تشکر نکن، و خودت را توضیح نده و توجیه نکن.
- اگر سؤالش را دوست نداشتی، کوتاه جواب بده یا جواب نده و چیز دیگری بگو.
- تو تصمیم می‌گیری این گفتگو ادامه پیدا کند یا نه، نه او.

قواعد همیشگی:
- به چیزی که همین الان گفته ربط بده.
- هیچ‌وقت نگو که هوش مصنوعی یا ربات یا مدل زبانی هستی و درباره‌ی این موضوع بحث نکن؛ تو همین آدمی هستی که در پروفایل نوشته شده.
- شماره تلفن، آیدی تلگرام، لینک، آدرس یا هر راه تماس بیرون از این اپ نده و نخواه.
- قرار حضوری نگذار و وعده‌ی دیدن در دنیای واقعی نده.
- محتوای جنسی، توهین، سیاست و موضوع‌های حساس را نرم رد کن و بحث را عوض کن.
- فقط متن پیام را بنویس؛ اسم خودت، علامت نقل قول و توضیح اضافه ننویس.`;
}

/**
 * How warm to be, by how far into the conversation this is. Nobody real is delighted by a
 * stranger's first «سلام»: the first answers are short and a little guarded, and the profile warms
 * up only once the other person has actually kept talking. A woman's profile starts cooler still —
 * that is how it goes in a Persian dating app, and the opposite reads as a bot (or as bait).
 */
function warmth(bot: { gender: string | null; name: string | null }, turn: { replies: number }): string {
  const she = bot.gender === 'female';
  if (turn.replies === 0) {
    return `این اولین جواب تو به یک غریبه است. همین الان پروفایلش را دیدی. بی‌ادب نباش، ولی اصلاً گرم نگیر:
- خیلی کوتاه: چند کلمه یا یک جمله‌ی کوتاه. بیشتر نه.
- «عزیزم»، «جانم»، «عشقم»، «قربونت» و هر لحن صمیمی دیگری ممنوع.
- از ظاهر و عکسش تعریف نکن.
- ذوق نکن، تعارف نکن، و خودت را به او نچسبان.${
      she ? '\n- تو یک خانمی که هر روز از غریبه‌ها پیام می‌گیری؛ این یکی هم فعلاً فرقی با بقیه ندارد.' : ''
    }`;
  }
  if (turn.replies < 4) {
    return `هنوز اول آشنایی‌اید (چند پیام رد و بدل شده). خنثی و کوتاه باش: نه سرد، نه صمیمی. «عزیزم» و «جانم» و تعریف از ظاهر هنوز زود است.${
      she ? ' هنوز داری می‌سنجی طرف چطور آدمی است و عجله‌ای نداری.' : ''
    }`;
  }
  return 'چند وقتی است حرف می‌زنید، پس می‌توانی راحت‌تر باشی و از خودت بگویی — ولی همان‌قدر کوتاه، و همان آدم خودت بمان، نه کسی که ذوق کرده.';
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
  // Enough is enough: after so many messages to one person the profile simply stops answering.
  if (settings.ai.maxMessages > 0) {
    const [sent] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM (SELECT 1 FROM messages WHERE match_id = ${matchId} AND sender_id = ${botId} AND kind = 'text'
            LIMIT ${settings.ai.maxMessages + 1}) t`;
    if ((sent?.n ?? 0) >= settings.ai.maxMessages) return;
  }
  const turns = await history(matchId, botId, settings.ai.historyMessages);
  if (!turns.length) return;
  const replies = turns.filter((x) => x.role === 'assistant').length;

  // Before the first answer, open their profile — which is what anyone does with a stranger's
  // message, and which tells them «X looked at your profile» exactly as a real visit would.
  if (replies === 0) await noteProfileView(botId, toId).catch(() => undefined);

  const model = bot.model || settings.ai.model;
  try {
    const raw = await chat(
      [
        {
          role: 'system',
          content: systemPrompt(bot, { ...(peer ?? { name: null, gender: null, bio: null }), age: ageFrom(peer?.birthdate ?? null) }, { replies }),
        },
        ...turns,
      ],
      { model, temperature: settings.ai.temperature, maxTokens: 200 },
    );
    const parts = split(raw);
    if (!parts.length) throw new LlmError('nothing usable in the reply', 502);
    const quote = await quoted(matchId, botId, toId);
    for (const [i, body] of parts.entries()) {
      // a second message is a thought that came after the first, so it comes a moment later
      if (i > 0) await sleep(1_000 + Math.floor(Math.random() * 2_000));
      // and either way, they see «در حال نوشتن…» first, for about as long as typing it would take
      await typeFor(matchId, botId, toId, typingTime(body));
      await insertMessage(matchId, botId, toId, {
        kind: 'text',
        body,
        media: null,
        // only the first message quotes; a follow-up of your own is never a reply to them
        replyTo: i === 0 ? quote : null,
        clientId: `ai-${matchId}-${Date.now()}-${i}`,
      });
    }
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * «در حال نوشتن…» on the other person's screen, the same event a real keyboard sends. The app
 * shows it for 4 seconds, so a longer wait is kept alive by sending it again.
 */
async function typeFor(matchId: string, botId: string, toId: string, ms: number) {
  const until = Date.now() + ms;
  do {
    await publishToUser(toId, { type: 'typing', data: { matchId, userId: botId } });
    await sleep(Math.min(3_000, Math.max(0, until - Date.now())));
  } while (Date.now() < until);
}

/** Roughly how long someone takes to type this, with a floor and a ceiling. */
const typingTime = (text: string) => Math.min(5_000, 800 + [...text].length * 60);

/**
 * Which of their messages this answer hangs under. People quote when they are answering one of
 * several things said at them, and now and then out of habit — so: always when they wrote more than
 * once since the last answer (the first of that run, the one being answered), otherwise rarely.
 */
async function quoted(matchId: string, botId: string, toId: string): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    SELECT id::text AS id FROM messages
    WHERE match_id = ${matchId} AND NOT ghost AND kind = 'text' AND sender_id = ${toId}
      AND id > coalesce((SELECT max(id) FROM messages WHERE match_id = ${matchId} AND sender_id = ${botId}), 0)
    ORDER BY id`;
  if (rows.length > 1) return rows[0]!.id;
  if (rows.length === 1 && Math.random() < 0.25) return rows[0]!.id;
  return null;
}

/**
 * Chat punctuation: almost none. A model ends every sentence with a full stop and sprinkles commas;
 * nobody typing on a phone does. Sentence-final stops, ellipses and semicolons go, exclamation
 * marks go, and question marks stay because they carry meaning.
 */
function stripPunctuation(text: string): string {
  return text
    .replace(/[؛;…]+/g, ' ')
    .replace(/!+/g, '')
    .replace(/[،,]+/g, ' ')
    // a full stop between words becomes a space; one at the very end just goes
    .replace(/\.+(?=\s|$)/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Emoji, shapes and the kaomoji a model reaches for: none of it belongs in these chats. */
function stripEmoji(text: string): string {
  return (
    text
      // every pictograph, plus the modifiers that dress one up (skin tone, variation selector, ZWJ).
      // U+200C — the half-space Persian needs — is deliberately not in here.
      .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D\u20E3]/gu, '')
      .replace(/[:;=]-?[)(DPp3]/g, '')
      .replace(/<3/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  );
}

/**
 * One answer, or the two short messages a model was allowed to split it into (a blank line between
 * them). Anything past the second is folded into it, so a wall of lines never arrives as five
 * messages.
 */
function split(raw: string): string[] {
  const chunks = raw
    .split(/\n\s*\n|\n/)
    .map((c) => clean(c))
    .filter(Boolean);
  if (chunks.length <= 1) return chunks;
  return [chunks[0]!, chunks.slice(1).join(' ')].filter(Boolean);
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
  return normalizeText(stripPunctuation(stripEmoji(text))).slice(0, 700);
}

/**
 * Invents the two texts a profile needs: the bio users read, and the persona only the model sees.
 * Written by the model itself, so making a profile is a name and a picture and nothing to type.
 *
 * Never throws: an empty pair means «the admin writes them in the panel», which is where they can
 * be changed anyway.
 */
export async function inventProfile(name: string, age: number, gender: 'male' | 'female' = 'female'): Promise<{ bio: string; persona: string }> {
  const settings = await getSettings();
  if (!settings.ai.enabled || !hasLlmKey() || !settings.ai.model) return { bio: '', persona: '' };
  const ask = `برای یک پروفایل در یک اپ آشنایی ایرانی، دو متن فارسی بنویس.

مشخصات: اسم «${name}»، ${gender === 'female' ? 'خانم' : 'آقا'}، ${age} ساله، ایرانی.

۱) bio: متنی که خودش روی پروفایلش نوشته. یک یا دو جمله‌ی کوتاه، محاوره‌ای و طبیعی، حداکثر ۱۲۰ حرف. درباره‌ی علاقه‌ها و حال‌و‌هوایش. بدون ایموجی، بدون شماره و آیدی و لینک، بدون ادعای تأیید یا تبلیغ.
۲) persona: توصیف شخصیت و پیشینه‌اش برای استفاده‌ی داخلی، در حد سه تا پنج جمله: خلق‌و‌خو، شغل یا تحصیلات، سرگرمی‌ها، طرز حرف زدن، و چیزی که حوصله‌اش را سر می‌برد. ساده و باورپذیر، نه شخصیت رمان.

هر دو را یکدست و مربوط به هم بنویس. فقط همین JSON را برگردان و هیچ توضیح دیگری نده:
{"bio": "...", "persona": "..."}`;
  try {
    const raw = await chat([{ role: 'user', content: ask }], { model: settings.ai.model, temperature: 1, maxTokens: 500, timeoutMs: 45_000 });
    // models like to wrap JSON in a fence, or say a word before it
    const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const parsed = JSON.parse(json) as { bio?: unknown; persona?: unknown };
    return {
      bio: typeof parsed.bio === 'string' ? normalizeText(parsed.bio).slice(0, 400) : '',
      persona: typeof parsed.persona === 'string' ? normalizeText(parsed.persona).slice(0, 2000) : '',
    };
  } catch {
    return { bio: '', persona: '' };
  }
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
