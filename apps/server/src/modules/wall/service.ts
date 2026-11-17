import type { Logger } from 'pino';
import { sql } from '../../lib/db.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { randomToken, uuidv7 } from '../../lib/ids.js';
import { enqueueWall } from '../../lib/queue.js';
import { dayKey, redis } from '../../lib/redis.js';
import { containsBannedWord, containsContactInfo, maskBannedWords, normalizeText, preview } from '../../lib/text.js';
import type { UserState } from '../auth/guard.js';
import { insertMessage } from '../chat/routes.js';
import { openConversation } from '../chat/service.js';
import { notify } from '../notifications/service.js';
import { publishToUser } from '../realtime/bus.js';
import { afterReport } from '../safety/service.js';
import { getSettings, type AppSettings } from '../settings/settings.js';
import { bumpDailyCounter } from '../users/activity.js';
import { loadCards, viewerOf, type CardDto } from '../users/cards.js';

/** A request on the Wall: a few words, and anyone it is meant for can simply write to the author. */
export interface WallRow {
  /** joined per viewer: an open conversation with the author, if any */
  match_id?: string | null;
  removed_reason?: string | null;
  id: string;
  user_id: string;
  text: string;
  looking_for: 'male' | 'female' | 'everyone';
  author_gender: 'male' | 'female';
  show_photo: boolean;
  to_group: boolean;
  status: 'active' | 'expired' | 'deleted' | 'removed';
  like_count: number;
  chat_count: number;
  report_count: number;
  tg_chat_id: string | null;
  tg_message_id: string | null;
  tg_photo: boolean;
  created_at: Date;
  expires_at: Date;
  edited_at?: Date | null;
  /** the feed's order */
  sort_at: Date;
}

function postDto(p: WallRow, author: CardDto | undefined, viewerId: string, liked: boolean) {
  const mine = p.user_id === viewerId;
  const photo = p.show_photo ? author?.photos[0] : undefined;
  return {
    id: p.id,
    text: p.text,
    lookingFor: p.looking_for,
    status: p.status,
    likeCount: p.like_count,
    /** Author only: how many conversations started from this request. */
    chatCount: mine ? p.chat_count : undefined,
    liked,
    mine,
    /** Already talking to the author: «پیام» becomes «ادامه‌ی گفتگو». */
    matchId: mine ? null : (p.match_id ?? null),
    editedAt: p.edited_at ? p.edited_at.toISOString() : null,
    removedReason: mine ? (p.removed_reason ?? null) : null,
    showPhoto: p.show_photo,
    inGroup: !!p.tg_message_id,
    createdAt: p.created_at.toISOString(),
    expiresAt: p.expires_at.toISOString(),
    author: author
      ? {
          id: author.id,
          name: author.name,
          age: author.age,
          gender: author.gender,
          online: author.online,
          newcomer: author.newcomer,
          photo: photo?.md ?? null,
          thumb: photo?.thumb ?? null,
          color: photo?.color ?? null,
        }
      : null,
  };
}

export type WallPostDto = ReturnType<typeof postDto>;

async function withAuthors(rows: (WallRow & { liked?: boolean })[], viewerId: string): Promise<WallPostDto[]> {
  const cards = new Map((await loadCards([...new Set(rows.map((r) => r.user_id))], await viewerOf(viewerId))).map((c) => [c.id, c]));
  return rows.map((r) => postDto(r, cards.get(r.user_id), viewerId, !!r.liked));
}

const LIVE = sql`w.status = 'active' AND w.expires_at > now()`;

/** The viewer's open conversation with the request's author (one index lookup per row). */
const openMatch = (viewerId: string) => sql`(
  SELECT mm.match_id FROM match_members mm JOIN matches m ON m.id = mm.match_id AND m.status = 'active'
  WHERE mm.user_id = ${viewerId} AND mm.peer_id = w.user_id)`;

function notBlocked(viewerId: string) {
  return sql`NOT EXISTS (
    SELECT 1 FROM blocks b
    WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = w.user_id) OR (b.blocker_id = w.user_id AND b.blocked_id = ${viewerId}))`;
}

export interface FeedQuery {
  cursor?: string;
  /** Only requests the viewer can answer (looking for their gender, or anyone). */
  forMe?: boolean;
  gender?: 'male' | 'female';
  limit: number;
}

/** Newest (or freshly bumped) first; keyset pagination on (sort_at, id) so a busy wall pages without OFFSET. */
export async function listFeed(viewerId: string, q: FeedQuery) {
  let cursor: { t: string; id: string } | null = null;
  if (q.cursor) {
    const [t, id] = q.cursor.split('|');
    if (t && id && !Number.isNaN(Date.parse(t)) && /^[0-9a-f-]{36}$/.test(id)) cursor = { t, id };
  }
  const [me] = await sql<{ gender: string | null }[]>`SELECT gender FROM users WHERE id = ${viewerId}`;
  const columns = sql`
    w.*, EXISTS (SELECT 1 FROM wall_likes l WHERE l.post_id = w.id AND l.user_id = ${viewerId}) AS liked,
    ${openMatch(viewerId)} AS match_id`;
  const visible = sql`
    ${LIVE}
    AND w.user_id <> ${viewerId} -- mine live under «درخواست‌های من»
    AND u.status = 'active' AND NOT u.shadow_banned
    AND ${notBlocked(viewerId)}
    ${q.forMe && me?.gender ? sql`AND w.looking_for IN (${me.gender}, 'everyone')` : sql``}
    ${q.gender ? sql`AND w.author_gender = ${q.gender}` : sql``}`;
  const rows = await sql<(WallRow & { liked: boolean })[]>`
    SELECT ${columns}
    FROM wall_posts w
    JOIN users u ON u.id = w.user_id
    WHERE ${visible}
      ${cursor ? sql`AND (w.sort_at, w.id) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)` : sql``}
    ORDER BY w.sort_at DESC, w.id DESC
    LIMIT ${q.limit}`;
  const last = rows[rows.length - 1];
  return {
    items: await withAuthors(rows, viewerId),
    nextCursor: rows.length === q.limit && last ? `${last.sort_at.toISOString()}|${last.id}` : null,
  };
}

/** The author's own requests (live and the last week's), with numbers only they see. */
export async function listMine(userId: string) {
  const rows = await sql<WallRow[]>`
    SELECT w.* FROM wall_posts w
    WHERE w.user_id = ${userId} AND w.status IN ('active', 'expired', 'removed') AND w.created_at > now() - interval '7 days'
    ORDER BY w.created_at DESC LIMIT 20`;
  const settings = await getSettings();
  const posting = await postingState(userId, settings);
  // posts that ended are shown as such even before the expiry job runs
  for (const r of rows) if (r.status === 'active' && r.expires_at <= new Date()) r.status = 'expired';
  return {
    items: await withAuthors(rows, userId),
    /** How many requests may be live at once, whether a new one can be posted now, and if not, when. */
    activeLimit: posting.limit,
    canPost: posting.canPost,
    nextPostAt: posting.nextPostAt?.toISOString() ?? null,
    postsLeft: posting.canPost ? Math.max(0, posting.limit - posting.active) : 0,
    dailyPosts: posting.limit,
  };
}

export async function getPost(id: string, viewerId: string): Promise<WallPostDto> {
  const [p] = await sql<(WallRow & { liked: boolean })[]>`
    SELECT w.*, EXISTS (SELECT 1 FROM wall_likes l WHERE l.post_id = w.id AND l.user_id = ${viewerId}) AS liked,
           ${openMatch(viewerId)} AS match_id
    FROM wall_posts w JOIN users u ON u.id = w.user_id
    WHERE w.id = ${id} AND (w.user_id = ${viewerId} OR (w.status IN ('active', 'expired') AND u.status = 'active' AND ${notBlocked(viewerId)}))`;
  if (!p) throw notFound('این درخواست دیگر در دسترس نیست');
  if (p.status === 'active' && p.expires_at <= new Date()) p.status = 'expired';
  const [dto] = await withAuthors([p], viewerId);
  return dto!;
}

async function livePost(id: string): Promise<WallRow> {
  const [p] = await sql<WallRow[]>`SELECT * FROM wall_posts w WHERE w.id = ${id}`;
  if (!p || (p.status !== 'active' && p.status !== 'expired')) throw notFound('این درخواست دیگر در دسترس نیست');
  if (p.status === 'expired' || p.expires_at <= new Date()) throw new AppError(410, 'wall_expired', 'زمان این درخواست تمام شده است ⏳');
  return p;
}

// ---- creating -----------------------------------------------------------------------------

export interface NewPost {
  text: string;
  lookingFor: 'male' | 'female' | 'everyone';
  showPhoto: boolean;
  toGroup: boolean;
}

const fa = (n: number) => n.toLocaleString('fa-IR');

/** The text of a request, cleaned and checked (new requests and edits alike). */
function cleanPostText(raw: string, settings: AppSettings): string {
  const text = normalizeText(raw);
  if ([...text].length < 10) throw badRequest('درخواستت رو کمی کامل‌تر بنویس (حداقل ۱۰ حرف)');
  if ([...text].length > 300) throw badRequest('متن درخواست حداکثر ۳۰۰ حرف است');
  if (containsBannedWord(text, settings.bannedWords)) throw badRequest('متن شامل کلمات غیرمجاز است');
  if (containsContactInfo(text)) {
    throw new AppError(400, 'contact_info', 'برای امنیت خودت شماره، آیدی یا لینک نذار؛ بقیه می‌تونن همین‌جا بهت پیام بدن 🙂');
  }
  return text;
}

/**
 * The same for everyone, members included: a small number of requests on the Wall at a time (one)
 * that are edited instead of reposted, and a pause between one request and the next (a day),
 * counted from when the last one was posted — deleting a request doesn't shorten it.
 */
async function postingState(userId: string, settings: AppSettings) {
  const limit = settings.wall.freeDailyPosts;
  const [s] = await sql<{ active: number; last_at: Date | null }[]>`
    SELECT count(*) FILTER (WHERE status = 'active' AND expires_at > now())::int AS active, max(created_at) AS last_at
    FROM wall_posts WHERE user_id = ${userId} AND created_at > now() - interval '30 days'`;
  const active = s?.active ?? 0;
  const pauseHours = settings.wall.repostCooldownHours;
  const next = pauseHours > 0 && s?.last_at ? new Date(s.last_at.getTime() + pauseHours * 3600_000) : null;
  const nextPostAt = next && next.getTime() > Date.now() ? next : null;
  return { limit, active, nextPostAt, canPost: active < limit && !nextPostAt };
}

export async function createPost(user: { id: string } & UserState, input: NewPost): Promise<WallPostDto> {
  const settings = await getSettings();
  if (!settings.wall.enabled) throw forbidden('دیوار فعلاً غیرفعال است', 'wall_disabled');
  const text = cleanPostText(input.text, settings);

  const posting = await postingState(user.id, settings);
  if (posting.active >= posting.limit) {
    throw new AppError(
      409,
      'wall_active_limit',
      posting.limit <= 1
        ? 'یه درخواست فعال روی دیوار داری. می‌تونی ویرایشش کنی، یا صبر کنی تا وقتش تموم بشه.'
        : `حداکثر ${fa(posting.limit)} درخواست فعال هم‌زمان می‌تونی داشته باشی. یکی رو ویرایش یا حذف کن.`,
    );
  }
  if (posting.nextPostAt) {
    const minutes = Math.max(1, Math.ceil((posting.nextPostAt.getTime() - Date.now()) / 60_000));
    const wait = minutes >= 60 ? `${fa(Math.ceil(minutes / 60))} ساعت` : `${fa(minutes)} دقیقه`;
    throw new AppError(
      429,
      'wall_limit',
      `هر روز یک درخواست می‌تونی روی دیوار بذاری. درخواست بعدی‌ت رو ${wait} دیگه بذار ⏳`,
      { nextPostAt: posting.nextPostAt.toISOString() },
    );
  }
  const [me] = await sql<{ gender: 'male' | 'female'; photo_count: number; shadow_banned: boolean }[]>`
    SELECT gender, photo_count, shadow_banned FROM users WHERE id = ${user.id}`;
  if (!me?.gender) throw forbidden('ابتدا پروفایل خود را کامل کنید', 'onboarding_required');

  const id = uuidv7();
  const [row] = await sql<WallRow[]>`
    INSERT INTO wall_posts (id, user_id, text, looking_for, author_gender, show_photo, to_group, expires_at)
    VALUES (${id}, ${user.id}, ${text}, ${input.lookingFor}, ${me.gender},
            ${input.showPhoto && me.photo_count > 0}, ${input.toGroup},
            now() + make_interval(hours => ${settings.wall.ttlHours}))
    RETURNING *`;
  await bumpDailyCounter('wall_posts');
  const tg = settings.wall.telegram;
  if (input.toGroup && tg.enabled && tg.chatId && !me.shadow_banned) {
    await enqueueWall({ name: 'wall-publish', postId: id });
  }
  const [dto] = await withAuthors([row!], user.id);
  return dto!;
}

/** Changes a live request in place (the group copy follows); who liked or asked stays as it is. */
export async function editPost(
  id: string,
  user: { id: string } & UserState,
  input: Pick<NewPost, 'text' | 'lookingFor'>,
): Promise<WallPostDto> {
  const settings = await getSettings();
  const text = cleanPostText(input.text, settings);
  const [row] = await sql<{ tg_message_id: string | null }[]>`
    UPDATE wall_posts w SET text = ${text}, looking_for = ${input.lookingFor}, edited_at = now()
    WHERE w.id = ${id} AND w.user_id = ${user.id} AND ${LIVE}
    RETURNING w.tg_message_id`;
  if (!row) throw notFound('فقط درخواست فعال رو می‌شه ویرایش کرد');
  if (row.tg_message_id) await enqueueWall({ name: 'wall-sync', postId: id }, 2000);
  return getPost(id, user.id);
}

export async function deletePost(id: string, userId: string) {
  const [p] = await sql<{ tg_message_id: string | null }[]>`
    UPDATE wall_posts SET status = 'deleted' WHERE id = ${id} AND user_id = ${userId} AND status IN ('active', 'expired')
    RETURNING tg_message_id`;
  if (!p) throw notFound();
  if (p.tg_message_id) await enqueueWall({ name: 'wall-sync', postId: id });
}

/** Moderator take-down (also used automatically when enough people report a request). */
export async function removePost(id: string, reason: string, by: string | null) {
  const [p] = await sql<{ user_id: string; tg_message_id: string | null }[]>`
    UPDATE wall_posts SET status = 'removed', removed_by = ${by}, removed_reason = ${reason}
    WHERE id = ${id} AND status IN ('active', 'expired') RETURNING user_id, tg_message_id`;
  if (!p) return false;
  if (p.tg_message_id) await enqueueWall({ name: 'wall-sync', postId: id });
  await notify(p.user_id, {
    type: 'system',
    title: 'یکی از درخواست‌هات از دیوار برداشته شد',
    body: `دلیل: ${reason}. لطفاً قوانین را رعایت کن.`,
  });
  return true;
}

// ---- likes ---------------------------------------------------------------------------------

export async function setLike(id: string, userId: string, on: boolean, source: 'app' | 'group' = 'app') {
  const p = await livePost(id);
  if (p.user_id === userId) throw badRequest('نمی‌تونی درخواست خودت رو لایک کنی 🙂');
  const [blocked] = await sql`
    SELECT 1 FROM blocks WHERE (blocker_id = ${userId} AND blocked_id = ${p.user_id}) OR (blocker_id = ${p.user_id} AND blocked_id = ${userId})`;
  if (blocked) throw notFound('این درخواست دیگر در دسترس نیست');
  const [liker] = await sql<{ shadow_banned: boolean }[]>`SELECT shadow_banned FROM users WHERE id = ${userId}`;
  // shadow-banned: looks liked on their screen, nothing is stored and nobody is told
  if (liker?.shadow_banned) return { liked: on, likeCount: p.like_count + (on ? 1 : 0) };

  let changed = false;
  let likeCount = p.like_count;
  if (on) {
    const ins = await sql`INSERT INTO wall_likes (post_id, user_id, source) VALUES (${id}, ${userId}, ${source}) ON CONFLICT DO NOTHING RETURNING 1`;
    if (ins.length) {
      changed = true;
      const [r] = await sql<{ like_count: number }[]>`UPDATE wall_posts SET like_count = like_count + 1 WHERE id = ${id} RETURNING like_count`;
      likeCount = r!.like_count;
    }
  } else {
    const del = await sql`DELETE FROM wall_likes WHERE post_id = ${id} AND user_id = ${userId} RETURNING 1`;
    if (del.length) {
      changed = true;
      const [r] = await sql<{ like_count: number }[]>`
        UPDATE wall_posts SET like_count = greatest(like_count - 1, 0) WHERE id = ${id} RETURNING like_count`;
      likeCount = r!.like_count;
    }
  }
  if (changed) {
    if (p.tg_message_id) await enqueueWall({ name: 'wall-sync', postId: id }, 4000);
    await publishToUser(p.user_id, { type: 'wall.liked', data: { postId: id, likeCount } });
    if (on) {
      const [liker] = await sql<{ name: string | null }[]>`SELECT name FROM users WHERE id = ${userId}`;
      await notify(p.user_id, {
        type: 'wall_like',
        title: `${liker?.name ?? 'یک نفر'} درخواستت رو روی دیوار لایک کرد ❤️`,
        body: preview(p.text, 60),
        data: { postId: id, userId },
      });
    }
  }
  return { liked: on, likeCount };
}

export async function toggleLike(id: string, userId: string, source: 'app' | 'group') {
  const [has] = await sql`SELECT 1 FROM wall_likes WHERE post_id = ${id} AND user_id = ${userId}`;
  return setLike(id, userId, !has, source);
}

/** Who liked my request (only the author sees this). */
export async function likers(id: string, userId: string) {
  const [p] = await sql<{ user_id: string }[]>`SELECT user_id FROM wall_posts WHERE id = ${id}`;
  if (!p || p.user_id !== userId) throw notFound();
  const rows = await sql<{ user_id: string; created_at: Date }[]>`
    SELECT l.user_id, l.created_at FROM wall_likes l JOIN users u ON u.id = l.user_id AND u.status = 'active'
    WHERE l.post_id = ${id} ORDER BY l.created_at DESC LIMIT 200`;
  const cards = new Map((await loadCards(rows.map((r) => r.user_id), await viewerOf(userId), { onlyActive: true })).map((c) => [c.id, c]));
  return {
    items: rows
      .filter((r) => cards.has(r.user_id))
      .map((r) => {
        const c = cards.get(r.user_id)!;
        return { id: c.id, name: c.name, age: c.age, photo: c.photos[0]?.thumb ?? null, likedAt: r.created_at.toISOString() };
      }),
  };
}

// ---- writing to the author -----------------------------------------------------------------

const wants = (lookingFor: string, gender: string | null) => lookingFor === 'everyone' || lookingFor === gender;

async function blockedBetween(a: string, b: string) {
  const [row] = await sql`
    SELECT 1 FROM blocks WHERE (blocker_id = ${a} AND blocked_id = ${b}) OR (blocker_id = ${b} AND blocked_id = ${a})`;
  return !!row;
}

async function conversationWith(userId: string, peerId: string) {
  const [m] = await sql<{ match_id: string; status: string }[]>`
    SELECT mm.match_id, m.status FROM match_members mm JOIN matches m ON m.id = mm.match_id
    WHERE mm.user_id = ${userId} AND mm.peer_id = ${peerId}`;
  return m ?? null;
}

/**
 * «پیام»: anyone the request is meant for simply writes to its author and the conversation opens
 * with that message — the same as writing to someone from their card in discovery.
 */
export async function messageAuthor(id: string, user: { id: string } & UserState, rawText: string) {
  const p = await livePost(id);
  if (p.user_id === user.id) throw badRequest('این درخواست خودته 🙂');
  if (!wants(p.looking_for, user.gender)) {
    throw forbidden(p.looking_for === 'female' ? 'این درخواست فقط برای خانم‌هاست' : 'این درخواست فقط برای آقایان است', 'wall_not_for_you');
  }
  if (await blockedBetween(user.id, p.user_id)) throw notFound('این درخواست دیگر در دسترس نیست');
  const settings = await getSettings();
  const text = maskBannedWords(normalizeText(rawText), settings.bannedWords);
  if ([...text].length < 2) throw badRequest('یه پیام کوتاه بنویس');
  if (containsContactInfo(text)) {
    throw new AppError(400, 'contact_info', 'شماره، آیدی یا لینک نفرست؛ همین‌جا با هم گفتگو کنید 🙂');
  }

  // already talking to each other: the button just opens that conversation
  const existing = await conversationWith(user.id, p.user_id);
  if (existing) {
    if (existing.status === 'active') return { matchId: existing.match_id, existing: true };
    throw forbidden('گفتگوی شما با این کاربر بسته شده است', 'match_closed');
  }

  const limit = settings.matching.dailyNewChats;
  const key = `newchats:${user.id}:${dayKey()}`;
  if (limit > 0 && Number((await redis.get(key)) ?? 0) >= limit) {
    throw new AppError(429, 'chat_daily_limit', `امروز ${fa(limit)} گفتگوی تازه شروع کردی. فردا دوباره می‌تونی 🌙`);
  }

  // a shadow-banned sender writes into the void: the conversation is real only for them
  const matchId = await openConversation(
    user.id,
    p.user_id,
    'wall',
    { kind: 'wall', postId: p.id, author: p.user_id, requester: user.id, text: p.text.slice(0, 160) },
    { ghost: user.shadow },
  );
  if (!matchId) throw conflict('گفتگو باز نشد. دوباره تلاش کن.');
  if (limit > 0) await redis.multi().incr(key).expire(key, 2 * 86400).exec();
  await insertMessage(matchId, user.id, p.user_id, { kind: 'text', body: text, media: null, replyTo: null, clientId: randomToken(12) }, { ghost: user.shadow });
  if (!user.shadow) await sql`UPDATE wall_posts SET chat_count = chat_count + 1 WHERE id = ${id}`;
  return { matchId, existing: false };
}

// ---- reports -------------------------------------------------------------------------------

export async function reportPost(id: string, reporterId: string, reason: string, details?: string) {
  const [p] = await sql<WallRow[]>`SELECT * FROM wall_posts WHERE id = ${id}`;
  if (!p || p.user_id === reporterId) throw notFound();
  const inserted = await sql`
    INSERT INTO reports (id, reporter_id, reported_id, reason, details, context)
    VALUES (${uuidv7()}, ${reporterId}, ${p.user_id}, ${reason}, ${['[دیوار]', details].filter(Boolean).join(' ')},
            ${sql.json({ wallPost: { id: p.id, text: p.text, createdAt: p.created_at } } as never)})
    ON CONFLICT (reporter_id, reported_id) WHERE status = 'open' DO NOTHING RETURNING 1`;
  if (!inserted.length) return;
  await afterReport(p.user_id, reporterId, reason);
  const [r] = await sql<{ report_count: number }[]>`UPDATE wall_posts SET report_count = report_count + 1 WHERE id = ${id} RETURNING report_count`;
  const settings = await getSettings();
  if ((r?.report_count ?? 0) >= settings.wall.autoHideReports) {
    await removePost(id, 'گزارش چند کاربر (در انتظار بررسی ناظر)', null);
  }
}

// ---- housekeeping --------------------------------------------------------------------------

/**
 * The account was deleted or banned: its requests leave the Wall and the Telegram group (the group
 * copy carries their name and photo), and conversation requests to or from it are closed.
 */
export async function retractUserWall(userId: string, how: 'deleted' | 'banned') {
  const rows = await sql<{ id: string; tg_message_id: string | null }[]>`
    UPDATE wall_posts SET status = ${how === 'deleted' ? 'deleted' : 'removed'},
      removed_reason = ${how === 'banned' ? 'حساب کاربری مسدود شد' : null}
    WHERE user_id = ${userId} AND status IN ('active', 'expired')
    RETURNING id, tg_message_id`;
  for (const r of rows) if (r.tg_message_id) await enqueueWall({ name: 'wall-sync', postId: r.id });
}

/** Worker: requests past their time become «expired» and their group copy is updated. */
export async function expirePosts() {
  const rows = await sql<{ id: string; tg_message_id: string | null }[]>`
    UPDATE wall_posts SET status = 'expired'
    WHERE id IN (SELECT id FROM wall_posts WHERE status = 'active' AND expires_at <= now() LIMIT 500)
    RETURNING id, tg_message_id`;
  for (const r of rows) if (r.tg_message_id) await enqueueWall({ name: 'wall-sync', postId: r.id });
  return rows.length;
}
