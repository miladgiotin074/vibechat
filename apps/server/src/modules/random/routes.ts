import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REPORT_REASON_IDS } from '../../data/catalog.js';
import { sql } from '../../lib/db.js';
import { AppError, badRequest, conflict, forbidden } from '../../lib/errors.js';
import { randomToken, uuidv7 } from '../../lib/ids.js';
import { dayKey, redis } from '../../lib/redis.js';
import { publicUrl } from '../../lib/storage.js';
import { ageFrom, maskBannedWords, normalizeText } from '../../lib/text.js';
import { parse, zUuid } from '../../lib/validate.js';
import { getUserState, hasPerks, requireActive } from '../auth/guard.js';
import { createMatch } from '../chat/service.js';
import { publishToUser } from '../realtime/bus.js';
import { randomCredits } from '../referrals/service.js';
import { afterReport, recomputeTrust } from '../safety/service.js';
import { getSettings } from '../settings/settings.js';

/**
 * Random chat: a short conversation with a compatible stranger who is online now. Each sees the
 * other's photo and can open their full profile from the start; if both press "like", it becomes a
 * real match (the chat moves to «گفتگوها»). Everything lives in Redis and expires on its own.
 *
 *   rc:wait            ZSET  userId → join time (people looking for a partner; members get a head start)
 *   rc:wait:g          ZSET  the same for shadow-banned accounts, who only ever meet each other
 *   rc:prof:<uid>      HASH  gender / interestedIn / age / wanted age range (expires unless the waiting user keeps polling)
 *   rc:skips:<uid>     STR   quick exits in a row; rc:cool:<uid> = the pause that follows too many
 *   rc:user:<uid>      STR   current session id
 *   rc:s:<sid>         HASH  a, b, started, likeA, likeB, msgA, msgB, counted, ended, matchId
 *   rc:m:<sid>         LIST  messages (JSON, newest last, capped)
 *   rc:seen:<uid>      SET   recent partners (not paired again for a day)
 */
const SESSION_TTL_S = 2 * 3600;
const PROFILE_TTL_S = 45;
const MAX_MESSAGES = 300;
/** Members (and women) are treated as if they had been waiting this much longer. */
const PREMIUM_HEAD_START_MS = 2 * 60_000;
const QUEUE = 'rc:wait';
/** Today's random chats of a man with membership (his daily limit). */
const dailyKey = (userId: string) => `rc:day:${userId}:${dayKey()}`;
const GHOST_QUEUE = 'rc:wait:g';

/** What the queue knows about someone looking for a partner. */
interface Seeker {
  gender: string;
  interestedIn: string;
  age: number;
  minAge: number;
  maxAge: number;
}

interface Peer {
  /** to open their full profile */
  id: string;
  name: string;
  age: number | null;
  city: string | null;
  gender: string | null;
  photo: string | null;
  /** always true now (photos used to be blurred until a match); kept for older app builds */
  revealed: boolean;
}

/** `want`: the gender asked for on the lobby screen for this search (default: the profile's). */
async function seekerOf(userId: string, want?: string): Promise<Seeker | null> {
  const [u] = await sql<{ gender: string | null; interested_in: string | null; birthdate: string | null; pref_min_age: number; pref_max_age: number; pref_age_set: boolean }[]>`
    SELECT gender, interested_in, birthdate::text AS birthdate, pref_min_age, pref_max_age, pref_age_set FROM users WHERE id = ${userId}`;
  if (!u?.gender || !u.interested_in) return null;
  return {
    gender: u.gender,
    interestedIn: want ?? u.interested_in,
    age: ageFrom(u.birthdate) ?? 18,
    // an age range counts only when its owner chose it
    minAge: u.pref_age_set ? u.pref_min_age : 18,
    maxAge: u.pref_age_set ? u.pref_max_age : 99,
  };
}

async function peerCard(peerId: string): Promise<Peer> {
  const [u] = await sql<{ name: string | null; gender: string | null; birthdate: string | null; hide_age: boolean; city_id: number | null }[]>`
    SELECT name, gender, birthdate::text AS birthdate, hide_age, city_id FROM users WHERE id = ${peerId}`;
  const [photo] = await sql<{ storage_key: string }[]>`
    SELECT storage_key FROM photos WHERE user_id = ${peerId} AND status = 'approved' ORDER BY position LIMIT 1`;
  const { cityName } = await import('../../data/locations.js');
  return {
    id: peerId,
    name: u?.name ?? 'کاربر',
    age: u && !u.hide_age ? ageFrom(u.birthdate) : null,
    city: cityName(u?.city_id),
    gender: u?.gender ?? null,
    photo: photo ? publicUrl(`${photo.storage_key}/md.webp`) : null,
    revealed: true,
  };
}

async function sessionDto(sid: string, me: string) {
  const s = await redis.hgetall(`rc:s:${sid}`);
  if (!s.a) return null;
  const mine = s.a === me ? 'A' : 'B';
  const peerId = s.a === me ? s.b! : s.a!;
  return {
    id: sid,
    startedAt: s.started,
    ended: s.ended === '1',
    iLiked: s[`like${mine}`] === '1',
    peerLiked: s[`like${mine === 'A' ? 'B' : 'A'}`] === '1',
    matchId: s.matchId || null,
    peer: await peerCard(peerId),
  };
}

async function currentSession(me: string): Promise<{ sid: string; peer: string; mine: 'A' | 'B'; s: Record<string, string> } | null> {
  const sid = await redis.get(`rc:user:${me}`);
  if (!sid) return null;
  const s = await redis.hgetall(`rc:s:${sid}`);
  if (!s.a || s.ended === '1') {
    await redis.del(`rc:user:${me}`);
    return null;
  }
  return { sid, peer: s.a === me ? s.b! : s.a, mine: s.a === me ? 'A' : 'B', s };
}

function wants(interestedIn: string, gender: string) {
  return interestedIn === 'everyone' || interestedIn === gender;
}

/** Both want the other's gender, and each is inside the age range the other chose (if any). */
function compatible(a: Seeker, b: Seeker) {
  return (
    wants(a.interestedIn, b.gender) && wants(b.interestedIn, a.gender) && b.age >= a.minAge && b.age <= a.maxAge && a.age >= b.minAge && a.age <= b.maxAge
  );
}

/** Takes the first compatible waiting person off the queue (ZREM is the atomic claim). */
async function findPartner(me: string, seeker: Seeker, queue: string): Promise<string | null> {
  const waiting = (await redis.zrange(queue, 0, 99)).filter((id) => id !== me);
  if (!waiting.length) return null;
  const seen = new Set(await redis.smembers(`rc:seen:${me}`));
  const blocked = new Set(
    (
      await sql<{ id: string }[]>`
        SELECT blocked_id AS id FROM blocks WHERE blocker_id = ${me} AND blocked_id = ANY(${waiting}::uuid[])
        UNION SELECT blocker_id FROM blocks WHERE blocked_id = ${me} AND blocker_id = ANY(${waiting}::uuid[])`
    ).map((r) => r.id),
  );
  for (const id of waiting) {
    if (seen.has(id) || blocked.has(id)) continue;
    const prof = await redis.hgetall(`rc:prof:${id}`);
    if (!prof.gender) {
      await redis.zrem(queue, id); // stopped polling: gone
      continue;
    }
    const other: Seeker = {
      gender: prof.gender,
      interestedIn: prof.interestedIn ?? 'everyone',
      age: Number(prof.age ?? 18),
      minAge: Number(prof.minAge ?? 18),
      maxAge: Number(prof.maxAge ?? 99),
    };
    if (!compatible(seeker, other)) continue;
    if ((await redis.zrem(queue, id)) === 1) return id;
  }
  return null;
}

async function endSession(sid: string, by: string) {
  const s = await redis.hgetall(`rc:s:${sid}`);
  if (!s.a || s.ended === '1') return;
  await redis.hset(`rc:s:${sid}`, 'ended', '1');
  await redis.del(`rc:user:${s.a}`, `rc:user:${s.b}`);
  const other = s.a === by ? s.b! : s.a;
  await publishToUser(other, { type: 'random.ended', data: { sessionId: sid } });
}

export async function randomChatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireActive);

  /** Look for someone now; answers "chatting" right away or "waiting" (then a random.paired event follows). */
  app.post('/v1/random/join', async (req) => {
    const me = req.user.id;
    const settings = await getSettings();
    if (!settings.randomChat.enabled) throw forbidden('چت تصادفی فعلاً غیرفعال است', 'random_disabled');
    const existing = await currentSession(me);
    if (existing) return { status: 'chatting', session: await sessionDto(existing.sid, me) };

    const body = parse(z.object({ want: z.enum(['male', 'female', 'everyone']).optional() }), req.body ?? {});
    // men without membership have a number of chats (to start with, and earned by adding friends
    // to the Wall group); women and members have no limit
    const perks = hasPerks(req.user);
    if (!perks && (await randomCredits(me)).left! <= 0) {
      throw new AppError(402, 'random_limit', 'چت‌های ناشناس رایگانت تموم شد. دوستاتو به گروه اضافه کن یا عضو ویژه شو 💎');
    }
    // men with membership: a daily limit (set in the panel); women have none
    const daily = settings.randomChat.premiumDailySessions;
    if (perks && req.user.gender === 'male' && daily > 0 && Number((await redis.get(dailyKey(me))) ?? 0) >= daily) {
      throw new AppError(429, 'random_daily_limit', `امروز ${daily.toLocaleString('fa-IR')} چت ناشناس داشتی. فردا دوباره می‌تونی 🌙`);
    }
    // too many quick exits in a row: a short pause before the next search
    const pause = await redis.ttl(`rc:cool:${me}`);
    if (pause > 0) {
      throw new AppError(429, 'random_cooldown', `چند تا گفتگو رو خیلی زود رد کردی. ${pause.toLocaleString('fa-IR')} ثانیه‌ی دیگه دوباره امتحان کن 🙂`, { seconds: pause });
    }
    const seeker = await seekerOf(me, body.want);
    if (!seeker) throw badRequest();
    // shadow-banned accounts wait in their own queue and only ever meet each other
    const queue = req.user.shadow ? GHOST_QUEUE : QUEUE;
    await redis
      .multi()
      .hset(`rc:prof:${me}`, { ...seeker })
      .expire(`rc:prof:${me}`, PROFILE_TTL_S)
      .exec();

    const partner = await findPartner(me, seeker, queue);
    if (!partner) {
      await redis.zadd(queue, Date.now() - (perks ? PREMIUM_HEAD_START_MS : 0), me);
      return { status: 'waiting' };
    }
    await redis.zrem(queue, me);
    const sid = uuidv7();
    await redis
      .multi()
      .hset(`rc:s:${sid}`, { a: me, b: partner, started: new Date().toISOString(), likeA: '0', likeB: '0', ended: '0', ghost: req.user.shadow ? '1' : '0' })
      .expire(`rc:s:${sid}`, SESSION_TTL_S)
      .set(`rc:user:${me}`, sid, 'EX', SESSION_TTL_S)
      .set(`rc:user:${partner}`, sid, 'EX', SESSION_TTL_S)
      .sadd(`rc:seen:${me}`, partner)
      .sadd(`rc:seen:${partner}`, me)
      .expire(`rc:seen:${me}`, 86400)
      .expire(`rc:seen:${partner}`, 86400)
      .exec();
    await publishToUser(partner, { type: 'random.paired', data: await sessionDto(sid, partner) });
    return { status: 'chatting', session: await sessionDto(sid, me) };
  });

  /** Polled every few seconds while waiting (keeps the user in the queue) or as a resync. */
  app.get('/v1/random/state', async (req) => {
    const me = req.user.id;
    const credits = await randomCredits(me);
    const current = await currentSession(me);
    if (current) return { status: 'chatting', session: await sessionDto(current.sid, me), credits };
    if ((await redis.zscore(req.user.shadow ? GHOST_QUEUE : QUEUE, me)) != null) {
      await redis.expire(`rc:prof:${me}`, PROFILE_TTL_S);
      return { status: 'waiting', credits };
    }
    return { status: 'idle', credits };
  });

  /** Stop searching, or leave the conversation. */
  app.post('/v1/random/leave', async (req) => {
    const me = req.user.id;
    await redis.multi().zrem(QUEUE, me).zrem(GHOST_QUEUE, me).del(`rc:prof:${me}`).exec();
    const current = await currentSession(me);
    if (current) {
      // leaving within seconds, again and again, wastes the other person's turn
      const { randomChat } = await getSettings();
      const lasted = Date.now() - new Date(current.s.started ?? Date.now()).getTime();
      if (randomChat.skipLimit > 0 && lasted < randomChat.skipSeconds * 1000) {
        const skips = await redis.incr(`rc:skips:${me}`);
        await redis.expire(`rc:skips:${me}`, 600);
        if (skips >= randomChat.skipLimit) {
          await redis.multi().set(`rc:cool:${me}`, '1', 'EX', randomChat.cooldownSeconds).del(`rc:skips:${me}`).exec();
        }
      } else {
        await redis.del(`rc:skips:${me}`);
      }
      await endSession(current.sid, me);
    }
    return { ok: true, cooldownSeconds: Math.max(0, await redis.ttl(`rc:cool:${me}`)) };
  });

  app.get('/v1/random/messages', async (req) => {
    const current = await currentSession(req.user.id);
    if (!current) return { items: [] };
    const raw = await redis.lrange(`rc:m:${current.sid}`, 0, -1);
    return { items: raw.map((r) => JSON.parse(r)) };
  });

  app.post('/v1/random/messages', { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }, async (req) => {
    const me = req.user.id;
    const body = parse(z.object({ text: z.string().min(1).max(1000), clientId: z.string().min(8).max(64) }), req.body);
    const current = await currentSession(me);
    if (!current) throw conflict('این گفتگو تمام شده است', 'random_ended');
    const settings = await getSettings();
    const text = maskBannedWords(normalizeText(body.text), settings.bannedWords);
    if (!text) throw badRequest('پیام خالی است');
    const msg = { id: randomToken(9), senderId: me, text, clientId: body.clientId, createdAt: new Date().toISOString() };
    const key = `rc:m:${current.sid}`;
    await redis.multi().rpush(key, JSON.stringify(msg)).ltrim(key, -MAX_MESSAGES, -1).expire(key, SESSION_TTL_S).exec();
    if (current.s[`msg${current.mine}`] !== '1') {
      await redis.hset(`rc:s:${current.sid}`, `msg${current.mine}`, '1');
      const otherWrote = current.s[`msg${current.mine === 'A' ? 'B' : 'A'}`] === '1';
      // a chat is used once both have written something (an unanswered hello costs nothing)
      if (otherWrote && (await redis.hsetnx(`rc:s:${current.sid}`, 'counted', '1')) === 1) {
        const states = await Promise.all([me, current.peer].map(async (id) => ({ id, state: await getUserState(id) })));
        const limited = states.filter((x) => x.state && !hasPerks(x.state)).map((x) => x.id);
        if (limited.length) await sql`UPDATE users SET rc_used = rc_used + 1 WHERE id = ANY(${limited}::uuid[])`;
        for (const id of limited) await publishToUser(id, { type: 'random.credits', data: await randomCredits(id) });
        // men with membership count toward today's limit
        const members = states.filter((x) => x.state && x.state.gender === 'male' && hasPerks(x.state)).map((x) => x.id);
        if (members.length) {
          const tx = redis.multi();
          for (const id of members) tx.incr(dailyKey(id)).expire(dailyKey(id), 2 * 86400);
          await tx.exec();
        }
      }
    }
    await publishToUser(current.peer, { type: 'random.message', data: { sessionId: current.sid, message: msg } });
    return msg;
  });

  /** Both like → a real match. */
  app.post('/v1/random/like', async (req) => {
    const me = req.user.id;
    const current = await currentSession(me);
    if (!current) throw conflict('این گفتگو تمام شده است', 'random_ended');
    await redis.hset(`rc:s:${current.sid}`, `like${current.mine}`, '1');
    const s = await redis.hgetall(`rc:s:${current.sid}`);
    const other = current.mine === 'A' ? 'B' : 'A';
    if (s[`like${other}`] === '1' && !s.matchId) {
      await sql`
        INSERT INTO swipes (swiper_id, target_id, action) VALUES (${me}, ${current.peer}, 1), (${current.peer}, ${me}, 1)
        ON CONFLICT (swiper_id, target_id) DO UPDATE SET action = greatest(swipes.action, 1)`;
      let matchId = await createMatch(me, current.peer, false, 'random');
      if (!matchId) {
        const [m] = await sql<{ match_id: string }[]>`SELECT match_id FROM match_members WHERE user_id = ${me} AND peer_id = ${current.peer}`;
        matchId = m?.match_id ?? null;
      }
      if (matchId) await redis.hset(`rc:s:${current.sid}`, 'matchId', matchId);
      await publishToUser(current.peer, { type: 'random.update', data: await sessionDto(current.sid, current.peer) });
    } else {
      await publishToUser(current.peer, { type: 'random.update', data: await sessionDto(current.sid, current.peer) });
    }
    return sessionDto(current.sid, me);
  });

  /**
   * 👍 / 👎 for the stranger after (or during) a chat — once per chat, and only for chats where
   * both wrote something. It feeds the other person's trust score.
   */
  app.post('/v1/random/rate', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req) => {
    const me = req.user.id;
    const body = parse(z.object({ sessionId: zUuid, up: z.boolean() }), req.body);
    const s = await redis.hgetall(`rc:s:${body.sessionId}`);
    if (!s.a || (s.a !== me && s.b !== me)) throw conflict('این گفتگو دیگر در دسترس نیست', 'random_ended');
    if (s.msgA !== '1' || s.msgB !== '1') return { ok: true, counted: false };
    const first = await redis.set(`rc:rated:${body.sessionId}:${me}`, '1', 'EX', SESSION_TTL_S, 'NX');
    if (first !== 'OK' || req.user.shadow) return { ok: true, counted: false };
    const peer = s.a === me ? s.b! : s.a;
    if (body.up) await sql`UPDATE users SET rc_up = rc_up + 1 WHERE id = ${peer}`;
    else await sql`UPDATE users SET rc_down = rc_down + 1 WHERE id = ${peer}`;
    await recomputeTrust([peer]);
    return { ok: true, counted: true };
  });

  /** Report the stranger: the conversation is attached, they are blocked and the chat ends. */
  app.post('/v1/random/report', async (req) => {
    const me = req.user.id;
    const body = parse(z.object({ reason: z.enum(REPORT_REASON_IDS), details: z.string().max(1000).optional() }), req.body);
    const current = await currentSession(me);
    if (!current) throw conflict('این گفتگو تمام شده است', 'random_ended');
    const messages = (await redis.lrange(`rc:m:${current.sid}`, 0, -1)).map((r) => {
      const m = JSON.parse(r);
      return { id: m.id, senderId: m.senderId, kind: 'text', body: m.text, media: null, createdAt: m.createdAt };
    });
    await sql`
      INSERT INTO reports (id, reporter_id, reported_id, reason, details, context)
      VALUES (${uuidv7()}, ${me}, ${current.peer}, ${body.reason}, ${['[چت تصادفی]', body.details].filter(Boolean).join(' ')},
              ${sql.json({ messages } as never)})
      ON CONFLICT (reporter_id, reported_id) WHERE status = 'open' DO NOTHING`;
    await afterReport(current.peer, me, body.reason);
    await sql`INSERT INTO blocks (blocker_id, blocked_id) VALUES (${me}, ${current.peer}) ON CONFLICT DO NOTHING`;
    await endSession(current.sid, me);
    return { ok: true };
  });
}
