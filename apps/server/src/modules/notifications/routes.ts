import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { parse, zId, zLimit } from '../../lib/validate.js';
import { requireUser } from '../auth/guard.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/v1/notifications', async (req) => {
    const q = parse(z.object({ before: zId.optional(), limit: zLimit(50, 30) }), req.query);
    const rows = await sql`
      SELECT id, type, title, body, data, read_at, created_at FROM notifications
      WHERE user_id = ${req.user.id} AND type <> 'verification' ${q.before ? sql`AND id < ${q.before}` : sql``}
      ORDER BY id DESC LIMIT ${q.limit}`;
    return {
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        body: r.body,
        data: r.data,
        read: r.read_at != null,
        createdAt: (r.created_at as Date).toISOString(),
      })),
      hasMore: rows.length === q.limit,
    };
  });

  app.post('/v1/notifications/read', async (req) => {
    const { upTo } = parse(z.object({ upTo: zId.optional() }), req.body);
    await sql`
      UPDATE notifications SET read_at = now()
      WHERE user_id = ${req.user.id} AND read_at IS NULL ${upTo ? sql`AND id <= ${upTo}` : sql``}`;
    return { ok: true };
  });

  /**
   * Badge counts plus anything new since `since` (a notification id). The app's background worker
   * calls this every ~15 minutes and shows local notifications, which works on phones without
   * Google services. Respects the user's notification switches.
   */
  app.get('/v1/notifications/summary', async (req) => {
    const q = parse(z.object({ since: zId.optional() }), req.query);
    const me = req.user.id;
    const [prefs] = await sql<{ notify_matches: boolean; notify_messages: boolean; notify_likes: boolean }[]>`
      SELECT notify_matches, notify_messages, notify_likes FROM users WHERE id = ${me}`;
    const [counts] = await sql<{ unread_chats: number; unread_messages: number; unread_notifications: number }[]>`
      SELECT
        (SELECT count(*)::int FROM match_members WHERE user_id = ${me} AND NOT hidden AND unread_count > 0 AND NOT muted) AS unread_chats,
        (SELECT coalesce(sum(unread_count), 0)::int FROM match_members WHERE user_id = ${me} AND NOT hidden AND NOT muted) AS unread_messages,
        (SELECT count(*)::int FROM notifications WHERE user_id = ${me} AND read_at IS NULL AND type <> 'verification') AS unread_notifications`;
    const newLikes = Number((await redis.get(`likes_unseen:${me}`)) ?? 0);
    const allowed = [
      prefs?.notify_matches !== false && 'match',
      prefs?.notify_likes !== false && 'super_like',
      'photo',
      'premium',
      'system',
    ].filter(Boolean) as string[];
    const fresh = q.since
      ? await sql`
          SELECT id, type, title, body, data, created_at FROM notifications
          WHERE user_id = ${me} AND id > ${q.since} AND type = ANY(${allowed})
          ORDER BY id DESC LIMIT 10`
      : [];
    const [{ max_id }] = (await sql`
      SELECT coalesce(max(id), 0)::text AS max_id FROM notifications WHERE user_id = ${me}`) as unknown as [{ max_id: string }];
    return {
      unreadChats: counts?.unread_chats ?? 0,
      unreadMessages: prefs?.notify_messages === false ? 0 : counts?.unread_messages ?? 0,
      unreadNotifications: counts?.unread_notifications ?? 0,
      newLikes: prefs?.notify_likes === false ? 0 : newLikes,
      latestId: max_id,
      items: fresh.map((r) => ({ id: r.id, type: r.type, title: r.title, body: r.body, data: r.data, createdAt: r.created_at })),
    };
  });

  /** Admin broadcasts. One row per broadcast, filtered per user here — cheap at any user count. */
  app.get('/v1/announcements', async (req) => {
    const q = parse(z.object({ since: zId.optional() }), req.query);
    const rows = await sql`
      SELECT id, title, body, segment, created_at FROM announcements
      WHERE (expires_at IS NULL OR expires_at > now()) ${q.since ? sql`AND id > ${q.since}` : sql``}
      ORDER BY id DESC LIMIT 20`;
    const gender = req.user.gender;
    return {
      items: rows
        .filter((r) => {
          const s = (r.segment ?? {}) as { gender?: string };
          return !s.gender || s.gender === gender;
        })
        .map((r) => ({ id: r.id, title: r.title, body: r.body, createdAt: (r.created_at as Date).toISOString() })),
    };
  });
}
