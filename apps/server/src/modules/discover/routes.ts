import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { dayKey, redis } from '../../lib/redis.js';
import { containsContactInfo, maskBannedWords, normalizeText } from '../../lib/text.js';
import { randomToken } from '../../lib/ids.js';
import { parse, zLimit, zUuid } from '../../lib/validate.js';
import { getUserState, requireActive } from '../auth/guard.js';
import { insertMessage } from '../chat/routes.js';
import { openConversation, noteProfileView } from '../chat/service.js';
import { getSettings } from '../settings/settings.js';
import { bumpDailyCounter } from '../users/activity.js';
import { loadCards, viewerOf } from '../users/cards.js';
import { resetDeck, takeFromDeck } from './deck.js';

const MAX_FIRST_MESSAGE = 1000;

export async function discoverRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireActive);

  /** The next cards: people the viewer hasn't skipped or written to yet. */
  app.get('/v1/discover', async (req) => {
    const q = parse(z.object({ limit: zLimit(30, 10) }), req.query);
    const { ids, exhausted, widened } = await takeFromDeck(req.user.id, q.limit);
    let fresh = ids;
    if (ids.length) {
      // drop anyone answered from another device since they were queued
      const done = await sql<{ id: string }[]>`
        SELECT target_id AS id FROM skips WHERE user_id = ${req.user.id} AND target_id = ANY(${ids}::uuid[])
        UNION SELECT peer_id FROM match_members WHERE user_id = ${req.user.id} AND peer_id = ANY(${ids}::uuid[])`;
      const seen = new Set(done.map((d) => d.id));
      fresh = ids.filter((id) => !seen.has(id));
    }
    const cards = await loadCards(fresh, await viewerOf(req.user.id), { onlyActive: true });
    // nobody is left only when the deck itself ran dry; an empty batch just needs the next one
    return { items: cards, exhausted: exhausted && cards.length === 0, widened };
  });

  /** Not for me: don't show this person again (until skips are recycled). */
  app.post('/v1/discover/skip', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req) => {
    const { targetId } = parse(z.object({ targetId: zUuid }), req.body);
    if (targetId === req.user.id) throw badRequest();
    await sql`INSERT INTO skips (user_id, target_id) VALUES (${req.user.id}, ${targetId}) ON CONFLICT DO NOTHING`;
    await bumpDailyCounter('swipes');
    return { ok: true };
  });

  /**
   * Write to someone from their card: the conversation opens right away with this as its first
   * message. The only limit is how many conversations one account may start in a day, which is
   * the same for everyone — it is there so nobody can write to the whole app in an afternoon.
   */
  app.post('/v1/discover/chat', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req) => {
    const body = parse(z.object({ targetId: zUuid, text: z.string().min(1).max(MAX_FIRST_MESSAGE) }), req.body);
    const me = req.user.id;
    if (body.targetId === me) throw badRequest();
    const target = await getUserState(body.targetId);
    if (!target || target.status !== 'active') throw notFound('این کاربر در دسترس نیست');
    const [blocked] = await sql`
      SELECT 1 FROM blocks WHERE (blocker_id = ${me} AND blocked_id = ${body.targetId}) OR (blocker_id = ${body.targetId} AND blocked_id = ${me})`;
    if (blocked) throw notFound('این کاربر در دسترس نیست');

    const settings = await getSettings();
    const text = maskBannedWords(normalizeText(body.text), settings.bannedWords);
    if ([...text].length < 2) throw badRequest('یه پیام کوتاه بنویس');
    if (containsContactInfo(text)) {
      throw new AppError(400, 'contact_info', 'شماره، آیدی یا لینک نفرست؛ همین‌جا با هم گفتگو کنید 🙂');
    }

    // already talking: the card just takes them to that conversation
    const [existing] = await sql<{ match_id: string; status: string }[]>`
      SELECT mm.match_id, m.status FROM match_members mm JOIN matches m ON m.id = mm.match_id
      WHERE mm.user_id = ${me} AND mm.peer_id = ${body.targetId}`;
    if (existing) {
      if (existing.status !== 'active') throw new AppError(403, 'match_closed', 'این گفتگو بسته شده است');
      return { matchId: existing.match_id, existing: true };
    }

    const limit = settings.matching.dailyNewChats;
    const key = `newchats:${me}:${dayKey()}`;
    if (limit > 0) {
      const [[, used]] = (await redis.multi().incr(key).expire(key, 2 * 86400).exec()) as [[Error | null, number]];
      if (used > limit) {
        await redis.decr(key);
        throw new AppError(429, 'chat_daily_limit', `امروز ${limit.toLocaleString('fa-IR')} گفتگوی تازه شروع کردی. فردا دوباره می‌تونی 🌙`);
      }
    }

    // a shadow-banned account writes into the void: it sees its own chat, nobody else does
    const matchId = await openConversation(me, body.targetId, 'message', { kind: 'message', by: me }, { ghost: req.user.shadow });
    if (!matchId) {
      if (limit > 0) await redis.decr(key);
      throw new AppError(409, 'chat_not_opened', 'گفتگو باز نشد. دوباره تلاش کن.');
    }
    await insertMessage(matchId, me, body.targetId, { kind: 'text', body: text, media: null, replyTo: null, clientId: randomToken(12) }, { ghost: req.user.shadow });
    return { matchId, existing: false };
  });

  /** A single public profile (from a card, a chat, a notification). */
  app.get('/v1/users/:id', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [blocked] = await sql`
      SELECT 1 FROM blocks WHERE (blocker_id = ${req.user.id} AND blocked_id = ${id}) OR (blocker_id = ${id} AND blocked_id = ${req.user.id})`;
    if (blocked) throw notFound('این کاربر در دسترس نیست');
    const [match] = await sql`
      SELECT 1 FROM match_members mm JOIN matches m ON m.id = mm.match_id
      WHERE mm.user_id = ${req.user.id} AND mm.peer_id = ${id} AND m.status = 'active'`;
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
