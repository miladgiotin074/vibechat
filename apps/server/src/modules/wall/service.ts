import type { Logger } from 'pino';
import { WALL_CATEGORIES } from '../../data/catalog.js';
import { cityName } from '../../data/locations.js';
import { sql } from '../../lib/db.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { randomToken, uuidv7 } from '../../lib/ids.js';
import { enqueueWall } from '../../lib/queue.js';
import { dayKey, redis } from '../../lib/redis.js';
import { containsBannedWord, containsContactInfo, maskBannedWords, normalizeText, preview } from '../../lib/text.js';
import { hasPerks, type UserState } from '../auth/guard.js';
import { insertMessage } from '../chat/routes.js';
import { createMatch, forgetMembership } from '../chat/service.js';
import { notify } from '../notifications/service.js';
import { publishToUser } from '../realtime/bus.js';
import { afterReport } from '../safety/service.js';
import { getSettings, type AppSettings } from '../settings/settings.js';
import { bumpDailyCounter } from '../users/activity.js';
import { loadCards, viewerOf, type CardDto } from '../users/cards.js';

/**
 * 'expired': the post ended before its author answered; 'ghost': sent by a shadow-banned account
 * (its sender sees it as waiting, the author never sees it).
 */
export type ChatRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired' | 'ghost';

/** What the sender is shown for their own request. */
function senderView(status: ChatRequestStatus | null | undefined): 'pending' | 'accepted' | 'declined' | null {
  if (!status || status === 'cancelled' || status === 'expired') return null;
  return status === 'ghost' ? 'pending' : status;
}

export interface WallRow {
  /** joined per viewer: an open conversation with the author, if any */
  match_id?: string | null;
  /** joined per viewer: the conversation request they sent for this post, if any */
  my_request?: ChatRequestStatus | null;
  /** joined for the author: requests still waiting for their answer */
  pending_count?: number;
  /** joined: this is a newcomer's very first request (shown in the spotlight / tagged) */
  newcomer_first?: boolean;
  request_count?: number;
  removed_reason?: string | null;
  accepted_count: number;
  id: string;
  user_id: string;
  text: string;
  category: string;
  looking_for: 'male' | 'female' | 'everyone';
  author_gender: 'male' | 'female';
  province_id: number | null;
  city_id: number | null;
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
  /** The feed's order: the posting time, or the last bump. */
  sort_at: Date;
  bumped_at: Date | null;
}

const categoryOf = (id: string) => WALL_CATEGORIES.find((c) => c.id === id);

function postDto(p: WallRow, author: CardDto | undefined, viewerId: string, liked: boolean, bumpHours: number) {
  const mine = p.user_id === viewerId;
  const nextBump = new Date(p.sort_at.getTime() + bumpHours * 3600_000);
  const photo = p.show_photo ? author?.photos[0] : undefined;
  return {
    id: p.id,
    text: p.text,
    category: p.category,
    lookingFor: p.looking_for,
    status: p.status,
    likeCount: p.like_count,
    /** Author only: conversation requests received / still waiting / accepted. */
    requestCount: mine ? (p.request_count ?? 0) : undefined,
    pendingCount: mine ? (p.pending_count ?? 0) : undefined,
    acceptedCount: mine ? p.accepted_count : undefined,
    liked,
    mine,
    /** Already talking to the author: «درخواست گفتگو» becomes «ادامه‌ی گفتگو». */
    matchId: mine ? null : (p.match_id ?? null),
    /** The viewer's own conversation request for this post (a cancelled one counts as none). */
    myRequest: mine ? null : senderView(p.my_request),
    editedAt: p.edited_at ? p.edited_at.toISOString() : null,
    removedReason: mine ? (p.removed_reason ?? null) : null,
    showPhoto: p.show_photo,
    inGroup: !!p.tg_message_id,
    /** A newcomer's very first request: gets a spotlight on top of the Wall for a few hours. */
    firstRequest: !!p.newcomer_first,
    createdAt: p.created_at.toISOString(),
    /** Moved back to the top by its author (members): the feed shows this time instead. */
    bumpedAt: p.bumped_at ? p.bumped_at.toISOString() : null,
    /** Author only: when the next bump is allowed (null: now). */
    nextBumpAt: mine && nextBump.getTime() > Date.now() ? nextBump.toISOString() : null,
    expiresAt: p.expires_at.toISOString(),
    city: cityName(p.city_id),
    author: author
      ? {
          id: author.id,
          name: author.name,
          age: author.age,
          gender: author.gender,
          premium: author.premium,
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
  const bumpHours = (await getSettings()).wall.bumpCooldownHours;
  return rows.map((r) => postDto(r, cards.get(r.user_id), viewerId, !!r.liked, bumpHours));
}

const LIVE = sql`w.status = 'active' AND w.expires_at > now()`;

/** The viewer's open conversation with the request's author (one index lookup per row). */
const openMatch = (viewerId: string) => sql`(
  SELECT mm.match_id FROM match_members mm JOIN matches m ON m.id = mm.match_id AND m.status = 'active'
  WHERE mm.user_id = ${viewerId} AND mm.peer_id = w.user_id)`;

/** The viewer's conversation request for the row's post (unique per post and sender). */
const myRequest = (viewerId: string) => sql`(
  SELECT r.status FROM wall_chat_requests r WHERE r.post_id = w.id AND r.from_id = ${viewerId})`;

/** How long someone counts as a newcomer (the «تازه‌وارد» badge uses the same 3 days). */
export const NEWCOMER_HOURS = 72;

/** The row's post is its author's first ever, written while they were new. */
const newcomerFirst = sql`(
  u.activated_at > now() - make_interval(hours => ${NEWCOMER_HOURS})
  AND NOT EXISTS (SELECT 1 FROM wall_posts o WHERE o.user_id = w.user_id AND o.created_at < w.created_at))`;

const pendingCount = sql`(
  SELECT count(*)::int FROM wall_chat_requests r WHERE r.post_id = w.id AND r.status = 'pending')`;

/** Requests received and not taken back (the list the author sees). */
const requestCount = sql`(
  SELECT count(*)::int FROM wall_chat_requests r WHERE r.post_id = w.id AND r.status NOT IN ('cancelled', 'ghost'))`;

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
  category?: string;
  cityOnly?: boolean;
  limit: number;
}

/** Newest (or freshly bumped) first; keyset pagination on (sort_at, id) so a busy wall pages without OFFSET. */
export async function listFeed(viewerId: string, q: FeedQuery) {
  let cursor: { t: string; id: string } | null = null;
  if (q.cursor) {
    const [t, id] = q.cursor.split('|');
    if (t && id && !Number.isNaN(Date.parse(t)) && /^[0-9a-f-]{36}$/.test(id)) cursor = { t, id };
  }
  const [me] = await sql<{ city_id: number | null; gender: string | null }[]>`SELECT city_id, gender FROM users WHERE id = ${viewerId}`;
  const myCity = me?.city_id ?? null;
  const columns = sql`
    w.*, EXISTS (SELECT 1 FROM wall_likes l WHERE l.post_id = w.id AND l.user_id = ${viewerId}) AS liked,
    ${openMatch(viewerId)} AS match_id, ${myRequest(viewerId)} AS my_request, ${newcomerFirst} AS newcomer_first`;
  const visible = sql`
    ${LIVE}
    AND w.user_id <> ${viewerId} -- mine live under «درخواست‌های من»
    AND u.status = 'active' AND NOT u.shadow_banned
    AND ${notBlocked(viewerId)}
    ${q.forMe && me?.gender ? sql`AND w.looking_for IN (${me.gender}, 'everyone')` : sql``}
    ${q.gender ? sql`AND w.author_gender = ${q.gender}` : sql``}
    ${q.category ? sql`AND w.category = ${q.category}` : sql``}
    ${q.cityOnly ? (myCity ? sql`AND w.city_id = ${myCity}` : sql`AND false`) : sql``}`;
  const rows = await sql<(WallRow & { liked: boolean })[]>`
    SELECT ${columns}
    FROM wall_posts w
    JOIN users u ON u.id = w.user_id
    WHERE ${visible}
      ${cursor ? sql`AND (w.sort_at, w.id) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)` : sql``}
    ORDER BY w.sort_at DESC, w.id DESC
    LIMIT ${q.limit}`;
  const last = rows[rows.length - 1];

  // first page only: newcomers' first requests of the last few hours, pinned on top so the
  // people who just arrived get answers while they're still deciding whether to stay
  const hours = (await getSettings()).wall.newcomerSpotlightHours;
  const spotlight =
    !cursor && hours > 0
      ? await sql<(WallRow & { liked: boolean })[]>`
          SELECT ${columns}
          FROM wall_posts w
          JOIN users u ON u.id = w.user_id
          WHERE ${visible}
            AND w.created_at > now() - make_interval(hours => ${hours})
            AND ${newcomerFirst}
          ORDER BY w.created_at DESC
          LIMIT 3`
      : [];
  return {
    items: await withAuthors(rows, viewerId),
    spotlight: spotlight.length ? await withAuthors(spotlight, viewerId) : [],
    nextCursor: rows.length === q.limit && last ? `${last.sort_at.toISOString()}|${last.id}` : null,
  };
}

/** The author's own requests (live and the last week's), with numbers only they see. */
export async function listMine(userId: string) {
  const rows = await sql<WallRow[]>`
    SELECT w.*, ${pendingCount} AS pending_count, ${requestCount} AS request_count, ${newcomerFirst} AS newcomer_first
    FROM wall_posts w JOIN users u ON u.id = w.user_id
    WHERE w.user_id = ${userId} AND w.status IN ('active', 'expired', 'removed') AND w.created_at > now() - interval '7 days'
    ORDER BY w.created_at DESC LIMIT 20`;
  const settings = await getSettings();
  const posting = await postingState(userId, settings);
  // posts that ended are shown as such even before the expiry job runs
  for (const r of rows) if (r.status === 'active' && r.expires_at <= new Date()) r.status = 'expired';
  const [{ fresh }] = (await sql`
    SELECT (u.activated_at > now() - make_interval(hours => ${NEWCOMER_HOURS})
            AND NOT EXISTS (SELECT 1 FROM wall_posts o WHERE o.user_id = u.id)) AS fresh
    FROM users u WHERE u.id = ${userId}`) as unknown as [{ fresh: boolean }];
  return {
    items: await withAuthors(rows, userId),
    /** How many requests may be live at once, whether a new one can be posted now, and if not, when. */
    activeLimit: posting.limit,
    canPost: posting.canPost,
    nextPostAt: posting.nextPostAt?.toISOString() ?? null,
    postsLeft: posting.canPost ? Math.max(0, posting.limit - posting.active) : 0,
    dailyPosts: posting.limit,
    /** «n people want to talk to you» across all of my requests (badge on the Wall). */
    pendingRequests: await pendingInboxCount(userId),
    /** A newcomer who hasn't posted yet: their first request would get the spotlight. */
    spotlightFirst: !!fresh && settings.wall.newcomerSpotlightHours > 0,
  };
}

export async function getPost(id: string, viewerId: string): Promise<WallPostDto> {
  const [p] = await sql<(WallRow & { liked: boolean })[]>`
    SELECT w.*, EXISTS (SELECT 1 FROM wall_likes l WHERE l.post_id = w.id AND l.user_id = ${viewerId}) AS liked,
           ${openMatch(viewerId)} AS match_id, ${myRequest(viewerId)} AS my_request,
           ${pendingCount} AS pending_count, ${requestCount} AS request_count, ${newcomerFirst} AS newcomer_first
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
  category: string;
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
  if (!categoryOf(input.category)) throw badRequest('موضوع نامعتبر است');

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
  const [me] = await sql<{ gender: 'male' | 'female'; province_id: number | null; city_id: number | null; photo_count: number; shadow_banned: boolean }[]>`
    SELECT gender, province_id, city_id, photo_count, shadow_banned FROM users WHERE id = ${user.id}`;
  if (!me?.gender) throw forbidden('ابتدا پروفایل خود را کامل کنید', 'onboarding_required');

  const id = uuidv7();
  const [row] = await sql<WallRow[]>`
    INSERT INTO wall_posts (id, user_id, text, category, looking_for, author_gender, province_id, city_id, show_photo, to_group, expires_at)
    VALUES (${id}, ${user.id}, ${text}, ${input.category}, ${input.lookingFor}, ${me.gender}, ${me.province_id}, ${me.city_id},
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
  input: Pick<NewPost, 'text' | 'category' | 'lookingFor'>,
): Promise<WallPostDto> {
  const settings = await getSettings();
  const text = cleanPostText(input.text, settings);
  if (!categoryOf(input.category)) throw badRequest('موضوع نامعتبر است');
  const [row] = await sql<{ tg_message_id: string | null }[]>`
    UPDATE wall_posts w SET text = ${text}, category = ${input.category}, looking_for = ${input.lookingFor}, edited_at = now()
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
  // nobody is left to answer the requests still waiting on it
  await expireRequests([id]);
}

/** Moderator take-down (also used automatically when enough people report a request). */
export async function removePost(id: string, reason: string, by: string | null) {
  const [p] = await sql<{ user_id: string; tg_message_id: string | null }[]>`
    UPDATE wall_posts SET status = 'removed', removed_by = ${by}, removed_reason = ${reason}
    WHERE id = ${id} AND status IN ('active', 'expired') RETURNING user_id, tg_message_id`;
  if (!p) return false;
  if (p.tg_message_id) await enqueueWall({ name: 'wall-sync', postId: id });
  await expireRequests([id]);
  await notify(p.user_id, {
    type: 'system',
    title: 'یکی از درخواست‌هات از دیوار برداشته شد',
    body: `دلیل: ${reason}. لطفاً قوانین را رعایت کن.`,
  });
  return true;
}

// ---- bump ----------------------------------------------------------------------------------

/**
 * «نردبان»: a member moves their live request back to the top of the Wall (and of the group), at
 * most once every bumpCooldownHours. It doesn't add time: the request still ends when it would have.
 */
export async function bumpPost(id: string, user: { id: string } & UserState): Promise<WallPostDto> {
  if (!hasPerks(user)) throw new AppError(402, 'bump_premium', 'نردبان مخصوص اعضای ویژه است: درخواستت دوباره میره بالای دیوار ⬆️');
  const hours = (await getSettings()).wall.bumpCooldownHours;
  const [row] = await sql<{ tg_message_id: string | null }[]>`
    UPDATE wall_posts w SET bumped_at = now(), sort_at = now()
    WHERE w.id = ${id} AND w.user_id = ${user.id} AND ${LIVE} AND w.sort_at <= now() - make_interval(hours => ${hours})
    RETURNING w.tg_message_id`;
  if (!row) {
    const [p] = await sql<{ sort_at: Date }[]>`SELECT w.sort_at FROM wall_posts w WHERE w.id = ${id} AND w.user_id = ${user.id} AND ${LIVE}`;
    if (!p) throw notFound('فقط درخواست فعال رو می‌شه نردبان کرد');
    const next = new Date(p.sort_at.getTime() + hours * 3600_000);
    const minutes = Math.max(1, Math.ceil((next.getTime() - Date.now()) / 60_000));
    const wait = minutes >= 60 ? `${fa(Math.ceil(minutes / 60))} ساعت` : `${fa(minutes)} دقیقه`;
    throw new AppError(429, 'bump_wait', `این درخواست تازه رفته بالا. ${wait} دیگه دوباره می‌تونی نردبانش کنی ⏳`, { nextBumpAt: next.toISOString() });
  }
  // shadow-banned: it looks bumped to them; the group never had their request
  if (row.tg_message_id && !user.shadow) await enqueueWall({ name: 'wall-bump', postId: id });
  return getPost(id, user.id);
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

// ---- conversation requests ------------------------------------------------------------------

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
 * «درخواست گفتگو»: a reader can't message the author directly. They send a short intro; the
 * author sees it with the sender's profile and decides. Only people the request is meant for can
 * ask, once per request, within a daily quota; blocks and closed conversations are respected.
 */
export async function requestChat(id: string, user: { id: string } & UserState, rawText: string) {
  const p = await livePost(id);
  if (p.user_id === user.id) throw badRequest('این درخواست خودته 🙂');
  if (!wants(p.looking_for, user.gender)) {
    throw forbidden(p.looking_for === 'female' ? 'این درخواست فقط برای خانم‌هاست' : 'این درخواست فقط برای آقایان است', 'wall_not_for_you');
  }
  if (await blockedBetween(user.id, p.user_id)) throw notFound('این درخواست دیگر در دسترس نیست');
  const settings = await getSettings();
  const text = maskBannedWords(normalizeText(rawText), settings.bannedWords);
  if ([...text].length < 2) throw badRequest('یه پیام کوتاه برای معرفی خودت بنویس');
  if (containsContactInfo(text)) {
    throw new AppError(400, 'contact_info', 'شماره، آیدی یا لینک نفرست؛ اگه قبول کنه همین‌جا با هم گفتگو می‌کنید 🙂');
  }

  // already talking to each other: nothing to ask for
  const existing = await conversationWith(user.id, p.user_id);
  if (existing) {
    if (existing.status === 'active') return { status: 'accepted' as const, matchId: existing.match_id };
    throw forbidden('گفتگوی شما با این کاربر بسته شده است', 'match_closed');
  }

  const [prev] = await sql<{ status: ChatRequestStatus }[]>`
    SELECT status FROM wall_chat_requests WHERE post_id = ${id} AND from_id = ${user.id}`;
  if (prev?.status === 'pending' || prev?.status === 'ghost') throw conflict('درخواستت قبلاً فرستاده شده؛ منتظر جوابش باش ⏳', 'wall_request_pending');
  if (prev && prev.status !== 'cancelled') throw forbidden('صاحب این درخواست، گفتگو رو قبول نکرد', 'wall_request_declined');

  const quota = hasPerks(user) ? settings.wall.premiumDailyChats : settings.wall.freeDailyChats;
  const key = `wallreq:${user.id}:${dayKey()}`;
  if (Number((await redis.get(key)) ?? 0) >= quota) {
    throw new AppError(402, 'wall_chat_limit', `امروز ${quota} درخواست گفتگو از دیوار فرستاده‌ای. فردا دوباره امتحان کن یا عضو ویژه شو 💎`);
  }

  const requestId = uuidv7();
  // a request the sender cancelled can be sent again; anything else stays as decided
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO wall_chat_requests (id, post_id, from_id, to_id, text, status)
    VALUES (${requestId}, ${id}, ${user.id}, ${p.user_id}, ${text}, ${user.shadow ? 'ghost' : 'pending'})
    ON CONFLICT (post_id, from_id) DO UPDATE
      SET status = excluded.status, text = excluded.text, created_at = now(), decided_at = NULL, reminded_at = NULL
      WHERE wall_chat_requests.status = 'cancelled'
    RETURNING id`;
  if (!row) throw conflict('درخواستت قبلاً فرستاده شده؛ منتظر جوابش باش ⏳', 'wall_request_pending');
  await redis.multi().incr(key).expire(key, 2 * 86400).exec();
  // a shadow-banned sender sees «waiting»; the author is never shown or told
  if (user.shadow) return { status: 'pending' as const, requestId: row.id };
  await sql`UPDATE wall_posts SET chat_count = chat_count + 1 WHERE id = ${id}`;

  const [sender] = await sql<{ name: string | null }[]>`SELECT name FROM users WHERE id = ${user.id}`;
  await publishToUser(p.user_id, { type: 'wall.request', data: { postId: id } });
  await notify(p.user_id, {
    type: 'wall_request',
    title: `💌 ${sender?.name ?? 'یک نفر'} می‌خواد درباره‌ی درخواستت باهات گفتگو کنه`,
    body: preview(text, 80),
    data: { postId: id, requestId: row.id, userId: user.id },
  });
  return { status: 'pending' as const, requestId: row.id };
}

/** The sender takes back a request that hasn't been answered yet. */
export async function cancelRequest(postId: string, userId: string) {
  const [r] = await sql<{ to_id: string; was: ChatRequestStatus }[]>`
    UPDATE wall_chat_requests r SET status = 'cancelled', decided_at = now()
    FROM (SELECT id, status FROM wall_chat_requests
          WHERE post_id = ${postId} AND from_id = ${userId} AND status IN ('pending', 'ghost') FOR UPDATE) old
    WHERE r.id = old.id RETURNING r.to_id, old.status AS was`;
  if (!r) throw notFound('درخواستی برای لغو پیدا نشد');
  if (r.was === 'ghost') return;
  await sql`UPDATE wall_posts SET chat_count = greatest(chat_count - 1, 0) WHERE id = ${postId}`;
  await publishToUser(r.to_id as string, { type: 'wall.request', data: { postId } });
}

interface RequestRow {
  id: string;
  post_id: string;
  from_id: string;
  to_id: string;
  text: string;
  status: ChatRequestStatus;
  match_id: string | null;
  created_at: Date;
  post_text: string;
  post_category: string;
  post_status: WallRow['status'];
  post_expires_at: Date;
}

/** Neither side blocked the other (r = a wall_chat_requests row). */
const requestNotBlocked = sql`NOT EXISTS (
  SELECT 1 FROM blocks b
  WHERE (b.blocker_id = r.to_id AND b.blocked_id = r.from_id) OR (b.blocker_id = r.from_id AND b.blocked_id = r.to_id))`;

const REQUEST_COLUMNS = sql`
  r.id, r.post_id, r.from_id, r.to_id, r.text, r.status, r.match_id, r.created_at,
  w.text AS post_text, w.category AS post_category, w.status AS post_status, w.expires_at AS post_expires_at`;

/** Requests with the other person's card (sender for the author, author for the sender) and the post. */
async function requestDtos(rows: RequestRow[], viewerId: string, other: 'from_id' | 'to_id') {
  const cards = new Map((await loadCards([...new Set(rows.map((r) => r[other]))], await viewerOf(viewerId), { onlyActive: true })).map((c) => [c.id, c]));
  return rows
    .filter((r) => cards.has(r[other]))
    .map((r) => {
      const c = cards.get(r[other])!;
      return {
        id: r.id,
        status: r.status === 'ghost' ? ('pending' as const) : r.status,
        text: r.text,
        matchId: r.match_id,
        createdAt: r.created_at.toISOString(),
        user: {
          id: c.id,
          name: c.name,
          age: c.age,
          gender: c.gender,
          premium: c.premium,
          online: c.online,
          city: c.city ?? null,
          photo: c.photos[0]?.thumb ?? null,
          color: c.photos[0]?.color ?? null,
        },
        post: {
          id: r.post_id,
          text: r.post_text,
          category: r.post_category,
          live: r.post_status === 'active' && r.post_expires_at > new Date(),
          available: r.post_status === 'active' || r.post_status === 'expired',
        },
      };
    });
}

export type WallRequestDto = Awaited<ReturnType<typeof requestDtos>>[number];

/** The author's inbox for one request: who asked, with what message (waiting first). */
export async function listRequests(postId: string, authorId: string) {
  const [p] = await sql<{ user_id: string }[]>`SELECT user_id FROM wall_posts WHERE id = ${postId}`;
  if (!p || p.user_id !== authorId) throw notFound();
  const rows = await sql<RequestRow[]>`
    SELECT ${REQUEST_COLUMNS}
    FROM wall_chat_requests r JOIN wall_posts w ON w.id = r.post_id
    WHERE r.post_id = ${postId} AND r.status NOT IN ('cancelled', 'ghost') AND ${requestNotBlocked}
    ORDER BY (r.status = 'pending') DESC, r.created_at DESC
    LIMIT 200`;
  return { items: await requestDtos(rows, authorId, 'from_id') };
}

/**
 * «درخواست‌های گفتگو»: every conversation request that reached me through the Wall, across all my
 * requests — waiting ones first, then the last two weeks of answered ones — or the ones I sent.
 */
export async function listInbox(userId: string, box: 'in' | 'out') {
  const mineSide = box === 'in' ? sql`r.to_id = ${userId}` : sql`r.from_id = ${userId}`;
  const rows = await sql<RequestRow[]>`
    SELECT ${REQUEST_COLUMNS}
    FROM wall_chat_requests r JOIN wall_posts w ON w.id = r.post_id
    WHERE ${mineSide} AND r.status <> ALL(${box === 'in' ? ['cancelled', 'ghost'] : ['cancelled']}) AND ${requestNotBlocked}
      AND (r.status = 'pending' OR r.created_at > now() - interval '14 days')
    ORDER BY (r.status = 'pending') DESC, r.created_at DESC
    LIMIT 100`;
  const items = await requestDtos(rows, userId, box === 'in' ? 'from_id' : 'to_id');
  return { items, pending: items.filter((i) => i.status === 'pending').length };
}

/** Requests waiting for my answer (the Wall's badge). */
export async function pendingInboxCount(userId: string) {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM wall_chat_requests r JOIN users u ON u.id = r.from_id AND u.status = 'active'
    WHERE r.to_id = ${userId} AND r.status = 'pending' AND ${requestNotBlocked}`;
  return row?.n ?? 0;
}

/**
 * The author answers a request. Accepting opens the conversation (the sender's intro becomes its
 * first message) and tells the sender; declining is quiet — the sender only sees it on the post.
 */
export async function decideRequest(requestId: string, authorId: string, accept: boolean) {
  const [r] = await sql<{ id: string; post_id: string; from_id: string; text: string; status: ChatRequestStatus; match_id: string | null }[]>`
    SELECT id, post_id, from_id, text, status, match_id FROM wall_chat_requests WHERE id = ${requestId} AND to_id = ${authorId}`;
  if (!r) throw notFound('این درخواست دیگر در دسترس نیست');
  if (r.status !== 'pending') {
    if (r.status === 'accepted' && r.match_id) return { status: 'accepted' as const, matchId: r.match_id };
    if (r.status === 'declined' && !accept) return { status: 'declined' as const, matchId: null };
    throw conflict(r.status === 'cancelled' ? 'فرستنده این درخواست رو پس گرفت' : 'این درخواست قبلاً بررسی شده', 'wall_request_decided');
  }

  if (!accept) {
    await sql`UPDATE wall_chat_requests SET status = 'declined', decided_at = now() WHERE id = ${requestId} AND status = 'pending'`;
    await publishToUser(r.from_id, { type: 'wall.request', data: { postId: r.post_id } });
    return { status: 'declined' as const, matchId: null };
  }

  if (await blockedBetween(authorId, r.from_id)) throw notFound('این درخواست دیگر در دسترس نیست');
  const existing = await conversationWith(authorId, r.from_id);
  if (existing && existing.status !== 'active') throw forbidden('گفتگوی شما با این کاربر بسته شده است', 'match_closed');

  // claim it first so a double tap (or two devices) can't open two conversations
  const claimed = await sql`
    UPDATE wall_chat_requests SET status = 'accepted', decided_at = now() WHERE id = ${requestId} AND status = 'pending' RETURNING 1`;
  if (!claimed.length) throw conflict('این درخواست قبلاً بررسی شده', 'wall_request_decided');

  let matchId = existing?.match_id ?? null;
  const fresh = !matchId;
  if (!matchId) {
    // keep discovery consistent: people talking to each other don't show up in each other's deck
    await sql`
      INSERT INTO swipes (swiper_id, target_id, action) VALUES (${r.from_id}, ${authorId}, 1), (${authorId}, ${r.from_id}, 1)
      ON CONFLICT (swiper_id, target_id) DO NOTHING`;
    const [post] = await sql<{ text: string; category: string }[]>`SELECT text, category FROM wall_posts WHERE id = ${r.post_id}`;
    matchId = await createMatch(r.from_id, authorId, false, 'wall', {
      kind: 'wall',
      postId: r.post_id,
      author: authorId,
      requester: r.from_id,
      text: post?.text.slice(0, 160),
      category: post?.category,
    });
    if (!matchId) matchId = (await conversationWith(authorId, r.from_id))?.match_id ?? null;
    if (!matchId) {
      await sql`UPDATE wall_chat_requests SET status = 'pending', decided_at = NULL WHERE id = ${requestId}`;
      throw conflict('گفتگو ساخته نشد. دوباره تلاش کن.');
    }
    await forgetMembership(matchId, [authorId, r.from_id]);
  }
  await sql`UPDATE wall_chat_requests SET match_id = ${matchId} WHERE id = ${requestId}`;
  await sql`UPDATE wall_posts SET accepted_count = accepted_count + 1 WHERE id = ${r.post_id}`;
  if (fresh) {
    // the intro they sent with the request opens the conversation
    await insertMessage(matchId, r.from_id, authorId, { kind: 'text', body: r.text, media: null, replyTo: null, clientId: randomToken(12) });
  }
  const [author] = await sql<{ name: string | null }[]>`SELECT name FROM users WHERE id = ${authorId}`;
  await notify(r.from_id, {
    type: 'wall_accept',
    title: `🎉 ${author?.name ?? 'صاحب درخواست'} درخواست گفتگوت رو قبول کرد`,
    body: 'گفتگوتون باز شد؛ همین الان ادامه بده 👋',
    data: { matchId, postId: r.post_id, userId: authorId },
  });
  await publishToUser(r.from_id, { type: 'wall.request', data: { postId: r.post_id } });
  return { status: 'accepted' as const, matchId };
}

// ---- reports -------------------------------------------------------------------------------

export async function reportPost(id: string, reporterId: string, reason: string, details?: string) {
  const [p] = await sql<WallRow[]>`SELECT * FROM wall_posts WHERE id = ${id}`;
  if (!p || p.user_id === reporterId) throw notFound();
  const inserted = await sql`
    INSERT INTO reports (id, reporter_id, reported_id, reason, details, context)
    VALUES (${uuidv7()}, ${reporterId}, ${p.user_id}, ${reason}, ${['[دیوار]', details].filter(Boolean).join(' ')},
            ${sql.json({ wallPost: { id: p.id, text: p.text, category: p.category, createdAt: p.created_at } } as never)})
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
  await expireRequests(rows.map((r) => r.id));
  // what this account itself had asked for is withdrawn
  await sql`
    UPDATE wall_chat_requests SET status = 'cancelled', decided_at = now()
    WHERE from_id = ${userId} AND status IN ('pending', 'ghost')`;
}

/**
 * Requests nobody answered before their post ended (time ran out, deleted, taken down): closed as
 * «expired», and each sender gets that slot of today's quota back. Declined ones are not refunded.
 * Without `postIds`, sweeps every waiting request whose post is no longer live.
 */
async function expireRequests(postIds?: string[]): Promise<number> {
  if (postIds && !postIds.length) return 0;
  const rows = await sql<{ from_id: string; post_id: string }[]>`
    UPDATE wall_chat_requests r SET status = 'expired', decided_at = now()
    FROM wall_posts w
    WHERE w.id = r.post_id AND r.status = 'pending'
      ${postIds ? sql`AND r.post_id = ANY(${postIds}::uuid[])` : sql`AND (w.status <> 'active' OR w.expires_at <= now())`}
    RETURNING r.from_id, r.post_id`;
  const day = dayKey();
  for (const r of rows) {
    const key = `wallreq:${r.from_id}:${day}`;
    if (Number((await redis.get(key)) ?? 0) > 0) await redis.decr(key);
    await publishToUser(r.from_id, { type: 'wall.request', data: { postId: r.post_id } });
  }
  return rows.length;
}

/**
 * Worker: closes waiting requests on posts that ended, and reminds authors (once per request) of
 * the ones still waiting after a while — a request nobody answers is a bad first experience for
 * the person who sent it.
 */
export async function wallRequestCare(log?: Logger) {
  const expired = await expireRequests();
  const settings = await getSettings();
  const hours = settings.wall.requestReminderHours;
  let reminded = 0;
  if (hours > 0) {
    const rows = await sql<{ to_id: string }[]>`
      UPDATE wall_chat_requests SET reminded_at = now()
      WHERE id IN (
        SELECT r.id FROM wall_chat_requests r JOIN wall_posts w ON w.id = r.post_id
        WHERE r.status = 'pending' AND r.reminded_at IS NULL
          AND r.created_at < now() - make_interval(hours => ${hours})
          AND w.status = 'active' AND w.expires_at > now()
        LIMIT 1000)
      RETURNING to_id`;
    const perAuthor = new Map<string, number>();
    for (const r of rows) perAuthor.set(r.to_id, (perAuthor.get(r.to_id) ?? 0) + 1);
    for (const [authorId, n] of perAuthor) {
      await notify(authorId, {
        type: 'wall_request',
        title: n > 1 ? `${fa(n)} نفر هنوز منتظر جوابتن 💌` : 'یه نفر هنوز منتظر جوابته 💌',
        body: 'پروفایلشون رو ببین و قبول یا رد کن؛ با تموم شدن وقت درخواستت، این‌ها هم منقضی می‌شن.',
        data: { reminder: true },
      });
    }
    reminded = rows.length;
  }
  if (expired || reminded) log?.info({ expired, reminded }, 'wall requests looked after');
}

/** Worker: requests past their time become «expired» and their group copy is updated. */
export async function expirePosts() {
  const rows = await sql<{ id: string; tg_message_id: string | null }[]>`
    UPDATE wall_posts SET status = 'expired'
    WHERE id IN (SELECT id FROM wall_posts WHERE status = 'active' AND expires_at <= now() LIMIT 500)
    RETURNING id, tg_message_id`;
  for (const r of rows) if (r.tg_message_id) await enqueueWall({ name: 'wall-sync', postId: r.id });
  await expireRequests(rows.map((r) => r.id));
  return rows.length;
}
