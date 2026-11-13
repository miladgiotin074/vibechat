import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WALL_CATEGORIES } from '../../data/catalog.js';
import { cityName } from '../../data/locations.js';
import { sql } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { publicUrl } from '../../lib/storage.js';
import { ageFrom } from '../../lib/text.js';
import { parse, zUuid } from '../../lib/validate.js';
import { removePost } from '../wall/service.js';
import { allow, audit, paging, requireAdmin } from './guard.js';

/** Moderating the Wall: newest requests first, take one down (also deletes it from the Telegram group). */
export async function adminWallRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/v1/wall', { preHandler: allow('moderator') }, async (req) => {
    const q = parse(
      z.object({
        status: z.enum(['active', 'expired', 'deleted', 'removed', 'reported']).optional(),
        page: z.coerce.number().int().optional(),
      }),
      req.query,
    );
    const { limit, offset, page, pageSize } = paging({ page: q.page, pageSize: 30 });
    const where =
      q.status === 'reported'
        ? sql`WHERE w.report_count > 0 AND w.status IN ('active', 'removed')`
        : q.status
          ? sql`WHERE w.status = ${q.status}`
          : sql``;
    const rows = await sql`
      SELECT w.*, u.name, u.gender, u.birthdate::text AS birthdate, u.tg_username,
             (SELECT ph.storage_key FROM photos ph WHERE ph.user_id = w.user_id AND ph.status = 'approved' ORDER BY ph.position LIMIT 1) AS photo_key
      FROM wall_posts w JOIN users u ON u.id = w.user_id
      ${where}
      ORDER BY w.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    const [{ total }] = (await sql`SELECT count(*)::int AS total FROM wall_posts w ${where}`) as unknown as [{ total: number }];
    return {
      items: rows.map((r) => ({
        id: r.id,
        text: r.text,
        category: WALL_CATEGORIES.find((c) => c.id === r.category)?.label ?? r.category,
        lookingFor: r.looking_for,
        status: r.status,
        likeCount: r.like_count,
        chatCount: r.chat_count,
        reportCount: r.report_count,
        inGroup: !!r.tg_message_id,
        city: cityName(r.city_id),
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        removedReason: r.removed_reason,
        user: {
          id: r.user_id,
          name: r.name,
          gender: r.gender,
          age: ageFrom(r.birthdate),
          telegramUsername: r.tg_username,
          photo: r.photo_key && r.show_photo ? publicUrl(`${r.photo_key}/sm.webp`) : null,
        },
      })),
      total,
      page,
      pageSize,
    };
  });

  app.post('/admin/v1/wall/:id/remove', { preHandler: allow('moderator') }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { reason } = parse(z.object({ reason: z.string().min(2).max(200) }), req.body);
    if (!(await removePost(id, reason, req.admin.id))) throw notFound('این درخواست قبلاً حذف شده است');
    await audit(req.admin.id, 'wall.remove', 'wall_post', id, { reason });
    return { ok: true };
  });
}
