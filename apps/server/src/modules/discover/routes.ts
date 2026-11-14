import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { AppError, badRequest, conflict, notFound, premiumRequired } from '../../lib/errors.js';
import { dayKey, redis } from '../../lib/redis.js';
import { publicUrl } from '../../lib/storage.js';
import { parse, zLimit, zUuid } from '../../lib/validate.js';
import { getUserState, hasPerks, invalidateUser, requireActive } from '../auth/guard.js';
import { createMatch, noteProfileView } from '../chat/service.js';
import { pushFirstLike, pushLike } from '../bot/push.js';
import { notify } from '../notifications/service.js';
import { publishToUser } from '../realtime/bus.js';
import { likeAllowance } from '../referrals/service.js';
import { getSettings } from '../settings/settings.js';
import { bumpDailyCounter } from '../users/activity.js';
import { loadCards, viewerOf } from '../users/cards.js';
import { exposureKey, pushFront, resetDeck, takeFromDeck } from './deck.js';

const ACTION = { pass: 0, like: 1, superlike: 2 } as const;

/**
 * How much a like is worth to the profile that got it. Someone who likes nearly everyone tells us
 * little; once we have seen enough of their swipes, their likes count for less (down to 0.3).
 */
export function likeWeight(likes: number, passes: number): number {
  const total = likes + passes;
  if (total < 30) return 1;
  const ratio = likes / total;
  if (ratio <= 0.6) return 1;
  if (ratio >= 0.95) return 0.3;
  return Math.round((1 - ((ratio - 0.6) / 0.35) * 0.7) * 100) / 100;
}


function secondsToTehranMidnight(): number {
  const now = new Date();
  const tehran = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tehran' }));
  const midnight = new Date(tehran);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(60, Math.round((midnight.getTime() - tehran.getTime()) / 1000));
}

/** Counts one like/super like against today's quota; refunds and throws when over it. */
async function consumeQuota(key: string, max: number, code: string, message: string, status = 402) {
  const [[, used]] = (await redis.multi().incr(key).expire(key, 2 * 86400).exec()) as [[Error | null, number]];
  if (used > max) {
    await redis.decr(key);
    throw new AppError(status, code, message, { resetInSeconds: secondsToTehranMidnight() });
  }
}

export async function discoverRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireActive);

  app.get('/v1/discover', async (req) => {
    const q = parse(z.object({ limit: zLimit(30, 10) }), req.query);
    const { ids, exhausted, widened } = await takeFromDeck(req.user.id, q.limit);
    let fresh = ids;
    if (ids.length) {
      // drop anyone swiped from another device since they were queued (a pass old enough to come
      // back around doesn't count: the deck put them there on purpose)
      const recycleDays = (await getSettings()).growth.passRecycleDays;
      const swiped = await sql<{ target_id: string }[]>`
        SELECT target_id FROM swipes WHERE swiper_id = ${req.user.id} AND target_id = ANY(${ids}::uuid[])
          ${recycleDays > 0 ? sql`AND (action > 0 OR created_at > now() - make_interval(days => ${recycleDays}))` : sql``}`;
      const done = new Set(swiped.map((s) => s.target_id));
      fresh = ids.filter((id) => !done.has(id));
    }
    const viewer = await viewerOf(req.user.id);
    const cards = await loadCards(fresh, viewer, { onlyActive: true });
    // a super like is shown on the card (ordinary likes stay a secret until they match)
    const stars = new Set(
      fresh.length
        ? (await sql<{ swiper_id: string }[]>`
            SELECT swiper_id FROM swipes WHERE target_id = ${req.user.id} AND swiper_id = ANY(${fresh}::uuid[]) AND action = 2`).map((r) => r.swiper_id)
        : [],
    );
    // widened: the user's own area ran dry (province / whole country), or old passes came back
    return {
      items: cards.map((c) => (stars.has(c.id) ? { ...c, superLikedYou: true } : c)),
      exhausted: exhausted && cards.length === 0,
      widened,
    };
  });

  app.post('/v1/swipes', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(z.object({ targetId: zUuid, action: z.enum(['pass', 'like', 'superlike']) }), req.body);
    const me = req.user.id;
    if (body.targetId === me) throw badRequest();
    const target = await getUserState(body.targetId);
    if (!target || target.status !== 'active') throw notFound('این کاربر در دسترس نیست');

    const settings = await getSettings();
    const premium = hasPerks(req.user);
    const day = dayKey();
    // Women: no limit. A man without membership: a number of
    // likes in total, then locked until he adds friends to the Wall group or becomes a member.
    // A man with membership: a number a day. What was spent is remembered so a duplicate swipe
    // gives it back.
    let likeSpent: 'total' | 'daily' | null = null;
    if (body.action === 'like') {
      if (!premium) {
        const allowed = await likeAllowance(me, settings);
        const ok = await sql`UPDATE users SET likes_used = likes_used + 1 WHERE id = ${me} AND likes_used < ${allowed} RETURNING 1`;
        if (!ok.length) throw new AppError(402, 'like_limit', 'لایک‌های رایگانت تموم شد. دوستاتو به گروه اضافه کن یا عضو ویژه شو 💎');
        likeSpent = 'total';
      } else if (req.user.gender === 'male' && settings.premiumDailyLikes > 0) {
        await consumeQuota(
          `likes:${me}:${day}`,
          settings.premiumDailyLikes,
          'like_daily_limit',
          `امروز ${settings.premiumDailyLikes.toLocaleString('fa-IR')} نفر رو لایک کردی. فردا دوباره می‌تونی 🌙`,
          429,
        );
        likeSpent = 'daily';
      }
    }
    let superSpent: 'total' | 'daily' | 'bonus' | null = null;
    if (body.action === 'superlike') {
      if (premium) {
        try {
          await consumeQuota(`slikes:${me}:${day}`, settings.premiumDailySuperLikes, 'superlike_limit', 'سوپرلایک‌های امروزت تموم شد ⭐ فردا دوباره داری');
          superSpent = 'daily';
        } catch (e) {
          const spent = await sql`UPDATE users SET bonus_superlikes = bonus_superlikes - 1 WHERE id = ${me} AND bonus_superlikes > 0 RETURNING 1`;
          if (!spent.length) throw e;
          superSpent = 'bonus';
        }
      } else {
        const own = await sql`
          UPDATE users SET superlikes_used = superlikes_used + 1 WHERE id = ${me} AND superlikes_used < ${settings.freeSuperLikes} RETURNING 1`;
        if (own.length) superSpent = 'total';
        else {
          const spent = await sql`UPDATE users SET bonus_superlikes = bonus_superlikes - 1 WHERE id = ${me} AND bonus_superlikes > 0 RETURNING 1`;
          if (!spent.length) throw new AppError(402, 'superlike_limit', 'سوپرلایک‌های رایگانت تموم شد ⭐ اعضای ویژه هر روز سوپرلایک دارن 💎');
          superSpent = 'bonus';
        }
      }
    }

    // A shadow-banned account swipes as usual, but its likes are stored as passes: nobody is
    // told, nothing is counted and no match can come out of them.
    const ghost = req.user.shadow;
    const action = ghost ? 0 : ACTION[body.action];
    const recycleDays = settings.growth.passRecycleDays;
    const inserted = await sql`
      INSERT INTO swipes (swiper_id, target_id, action) VALUES (${me}, ${body.targetId}, ${action})
      ON CONFLICT (swiper_id, target_id) ${
        recycleDays > 0
          ? // someone passed long ago came back around: the new answer replaces the old pass
            sql`DO UPDATE SET action = EXCLUDED.action, created_at = now()
                WHERE swipes.action = 0 AND swipes.created_at < now() - make_interval(days => ${recycleDays})`
          : sql`DO NOTHING`
      } RETURNING 1`;
    if (!inserted.length) {
      if (likeSpent === 'total') await sql`UPDATE users SET likes_used = greatest(likes_used - 1, 0) WHERE id = ${me}`;
      if (likeSpent === 'daily') await redis.decr(`likes:${me}:${day}`);
      if (body.action === 'superlike') {
        if (superSpent === 'bonus') await sql`UPDATE users SET bonus_superlikes = bonus_superlikes + 1 WHERE id = ${me}`;
        else if (superSpent === 'total') await sql`UPDATE users SET superlikes_used = greatest(superlikes_used - 1, 0) WHERE id = ${me}`;
        else await redis.decr(`slikes:${me}:${day}`);
      }
      return { matched: false, duplicate: true };
    }

    await redis.set(`lastswipe:${me}`, JSON.stringify({ targetId: body.targetId, action }), 'EX', 600);
    if (!ghost) {
      // my own like/pass habit (last 30 days) decides how much my likes are worth
      const sent = (await redis
        .multi()
        .hincrby(`snt:${me}`, action > 0 ? 'like' : 'pass', 1)
        .expire(`snt:${me}`, 30 * 86400)
        .hgetall(`snt:${me}`)
        .exec()) as [unknown, unknown, [Error | null, Record<string, string>]];
      const habit = sent[2]?.[1] ?? {};
      const tx = redis.multi().hincrby(`rcv:${body.targetId}`, action > 0 ? 'like' : 'pass', 1).sadd('rcv:dirty', body.targetId);
      if (action > 0) tx.hincrbyfloat(`rcv:${body.targetId}`, 'wlike', likeWeight(Number(habit.like ?? 0), Number(habit.pass ?? 0)));
      await tx.exec();
    }
    await bumpDailyCounter('swipes');

    let matchId: string | null = null;
    if (action > 0) {
      await bumpDailyCounter('likes');
      // Checked after our own insert committed, so two simultaneous likes can't both miss each other.
      const [mutual] = await sql`
        SELECT 1 FROM swipes WHERE swiper_id = ${body.targetId} AND target_id = ${me} AND action > 0`;
      if (mutual && !target.shadow) {
        matchId = await createMatch(me, body.targetId, action === 2);
      } else if (!mutual) {
        await redis.incr(`likes_unseen:${body.targetId}`);
        // likes received in the last day (fair exposure in discovery)
        if ((await redis.incr(exposureKey(body.targetId))) === 1) await redis.expire(exposureKey(body.targetId), 86400);
        // a super like goes to the front of their cards, with a star on it
        if (action === 2) await pushFront(body.targetId, me);
        // the very first like a person ever gets is the moment they decide the app works for them
        const [{ n }] = (await sql`
          SELECT count(*)::int AS n FROM (SELECT 1 FROM swipes WHERE target_id = ${body.targetId} AND action > 0 LIMIT 2) x`) as unknown as [{ n: number }];
        const first = n === 1;
        await publishToUser(body.targetId, { type: 'like.new', data: { superLike: action === 2, first } });
        if (action === 2) {
          await notify(body.targetId, { type: 'super_like', title: 'یک نفر سوپرلایکت کرد ⭐', body: 'ببین کیه!' });
        } else if (first) {
          pushFirstLike(body.targetId).catch(() => undefined);
        } else {
          pushLike(body.targetId, false).catch(() => undefined);
        }
      }
    }
    const [after] =
      body.action === 'superlike' ? await sql<{ b: number; used: number }[]>`SELECT bonus_superlikes AS b, superlikes_used AS used FROM users WHERE id = ${me}` : [];
    const superUsedToday = premium ? Number((await redis.get(`slikes:${me}:${day}`)) ?? 0) : 0;
    return {
      bonusSuperLikes: after?.b,
      matched: matchId != null,
      matchId,
      // how many likes are left is never told
      likesLeft: null,
      superLikesLeft:
        body.action !== 'superlike'
          ? undefined
          : premium
            ? Math.max(0, settings.premiumDailySuperLikes - superUsedToday)
            : Math.max(0, settings.freeSuperLikes - (after?.used ?? 0)),
    };
  });

  /** Undo the last pass (premium). Likes can't be undone: they may already have matched. */
  app.post('/v1/swipes/rewind', async (req) => {
    if (!hasPerks(req.user)) throw premiumRequired('برگشت به نفر قبلی مخصوص اعضای ویژه است');
    const raw = await redis.get(`lastswipe:${req.user.id}`);
    if (!raw) throw conflict('چیزی برای برگشت نیست', 'nothing_to_rewind');
    const last = JSON.parse(raw) as { targetId: string; action: number };
    if (last.action !== 0) throw conflict('فقط ردکردن‌ها قابل برگشت است', 'nothing_to_rewind');
    await sql`DELETE FROM swipes WHERE swiper_id = ${req.user.id} AND target_id = ${last.targetId} AND action = 0`;
    await redis.del(`lastswipe:${req.user.id}`);
    await pushFront(req.user.id, last.targetId);
    const [card] = await loadCards([last.targetId], await viewerOf(req.user.id), { onlyActive: true });
    return { item: card ?? null };
  });

  /** People who liked me and whom I haven't swiped yet. Premium sees them; others get blurred teasers. */
  app.get('/v1/likes', async (req) => {
    const q = parse(z.object({ before: z.string().datetime().optional(), limit: zLimit(50, 30) }), req.query);
    const me = req.user.id;
    const rows = await sql<{ swiper_id: string; action: number; created_at: Date; blur_key: string | null }[]>`
      SELECT s.swiper_id, s.action, s.created_at,
             (SELECT p.blur_key FROM photos p WHERE p.user_id = s.swiper_id AND p.status = 'approved'
              ORDER BY p.position LIMIT 1) AS blur_key
      FROM swipes s
      JOIN users u ON u.id = s.swiper_id AND u.status = 'active' AND NOT u.shadow_banned
      WHERE s.target_id = ${me} AND s.action > 0
        ${q.before ? sql`AND s.created_at < ${q.before}::timestamptz` : sql``}
        AND NOT EXISTS (SELECT 1 FROM swipes m WHERE m.swiper_id = ${me} AND m.target_id = s.swiper_id)
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = ${me} AND b.blocked_id = s.swiper_id)
      ORDER BY s.created_at DESC
      LIMIT ${q.limit}`;
    const [{ total }] = (await sql`
      SELECT count(*)::int AS total FROM (
        SELECT 1 FROM swipes s JOIN users u ON u.id = s.swiper_id AND u.status = 'active' AND NOT u.shadow_banned
        WHERE s.target_id = ${me} AND s.action > 0
          AND NOT EXISTS (SELECT 1 FROM swipes m WHERE m.swiper_id = ${me} AND m.target_id = s.swiper_id)
          AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = ${me} AND b.blocked_id = s.swiper_id)
        LIMIT 1000
      ) t`) as unknown as [{ total: number }];
    await redis.del(`likes_unseen:${me}`);
    const nextBefore = rows.length === q.limit ? rows[rows.length - 1]!.created_at.toISOString() : null;

    if (!hasPerks(req.user)) {
      // the first few people who ever liked you are shown for free: a newcomer sees who's interested
      // right away instead of a wall of blurred photos
      const freeN = (await getSettings()).growth.freeRevealedLikes;
      const revealed = new Set(
        freeN > 0
          ? (await sql<{ swiper_id: string }[]>`
              SELECT swiper_id FROM swipes WHERE target_id = ${me} AND action > 0 ORDER BY created_at ASC LIMIT ${freeN}`).map((r) => r.swiper_id)
          : [],
      );
      const open = rows.filter((r) => revealed.has(r.swiper_id)).map((r) => r.swiper_id);
      const cards = new Map((open.length ? await loadCards(open, await viewerOf(me), { onlyActive: true }) : []).map((c) => [c.id, c]));
      const items = rows.map((r) => {
        const card = cards.get(r.swiper_id);
        return card
          ? { superLike: r.action === 2, blur: null, user: card, likedAt: r.created_at.toISOString(), free: true }
          : { superLike: r.action === 2, blur: r.blur_key ? publicUrl(r.blur_key) : null, user: null };
      });
      return { locked: items.some((i) => !i.user), total, items, nextBefore, freeRevealed: freeN };
    }
    const cards = new Map((await loadCards(rows.map((r) => r.swiper_id), await viewerOf(me), { onlyActive: true })).map((c) => [c.id, c]));
    return {
      locked: false,
      total,
      items: rows
        .filter((r) => cards.has(r.swiper_id))
        .map((r) => ({ superLike: r.action === 2, blur: null, user: cards.get(r.swiper_id)!, likedAt: r.created_at.toISOString() })),
      nextBefore,
    };
  });

  /**
   * Show me first in discovery for a while. Members get one free boost a day; anyone can use a
   * boost bought in the store (a member's bought boosts are kept for after the free one).
   */
  app.post('/v1/boost', async (req) => {
    const settings = await getSettings();
    const me = req.user.id;
    const [current] = await sql<{ active: boolean }[]>`SELECT (boost_until > now()) AS active FROM users WHERE id = ${me}`;
    if (current?.active) throw conflict('بوستت همین الان فعاله 🚀', 'boost_active');
    const free = hasPerks(req.user) && (await redis.set(`boost_used:${me}`, '1', 'EX', 86400, 'NX')) === 'OK';
    const until = sql`now() + make_interval(mins => ${settings.boostMinutes})`;
    const [row] = free
      ? await sql<{ boost_until: Date; boost_credits: number }[]>`
          UPDATE users SET boost_until = ${until} WHERE id = ${me} RETURNING boost_until, boost_credits`
      : await sql<{ boost_until: Date; boost_credits: number }[]>`
          UPDATE users SET boost_until = ${until}, boost_credits = boost_credits - 1
          WHERE id = ${me} AND boost_credits > 0 RETURNING boost_until, boost_credits`;
    if (!row) {
      if (hasPerks(req.user)) throw new AppError(402, 'boost_required', 'بوست رایگان امروزت رو استفاده کرده‌ای. فردا دوباره یکی داری 🚀');
      throw new AppError(402, 'boost_required', 'بوست مخصوص اعضای ویژه است: هر روز یک بوست رایگان 🚀');
    }
    await invalidateUser(me);
    return { boostUntil: row.boost_until.toISOString(), boostCredits: row.boost_credits, usedCredit: !free };
  });

  /** A single public profile (from a like, a chat, a notification). */
  app.get('/v1/users/:id', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [blocked] = await sql`
      SELECT 1 FROM blocks WHERE (blocker_id = ${req.user.id} AND blocked_id = ${id}) OR (blocker_id = ${id} AND blocked_id = ${req.user.id})`;
    if (blocked) throw notFound('این کاربر در دسترس نیست');
    const [match] = await sql`
      SELECT 1 FROM match_members mm JOIN matches m ON m.id = mm.match_id
      WHERE mm.user_id = ${req.user.id} AND mm.peer_id = ${id} AND m.status = 'active'`;
    // incognito profiles are only visible to people they liked (and to their matches)
    if (!match && id !== req.user.id) {
      const [hidden] = await sql`
        SELECT 1 FROM users u WHERE u.id = ${id} AND u.incognito
          AND NOT EXISTS (SELECT 1 FROM swipes s WHERE s.swiper_id = ${id} AND s.target_id = ${req.user.id} AND s.action > 0)`;
      if (hidden) throw notFound('این کاربر در دسترس نیست');
    }
    const [card] = await loadCards([id], await viewerOf(req.user.id), {
      onlyActive: true,
      matchedWith: match ? new Set([id]) : new Set(),
    });
    if (!card) throw notFound('این کاربر در دسترس نیست');
    return card;
  });

  /** The profile screen was opened (not just loaded for a card or a chat header). */
  app.post('/v1/users/:id/viewed', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    if (id === req.user.id) return { ok: true, noted: false };
    return { ok: true, noted: await noteProfileView(req.user.id, id) };
  });

  app.post('/v1/discover/reset', async (req) => {
    await resetDeck(req.user.id);
    return { ok: true };
  });
}
