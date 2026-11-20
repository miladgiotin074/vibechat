import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { publicUrl } from '../../lib/storage.js';
import { ageFrom } from '../../lib/text.js';
import { parse, zUuid } from '../../lib/validate.js';
import { botApi } from '../bot/sender.js';
import { getSettings } from '../settings/settings.js';
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
        lookingFor: r.looking_for,
        status: r.status,
        likeCount: r.like_count,
        chatCount: r.chat_count,
        reportCount: r.report_count,
        inGroup: !!r.tg_message_id,
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

  /**
   * Everything that has to be true for a request to show up in the Telegram group, checked against
   * Telegram itself and reported in one go: the switch, the chat id, the bot's membership, its right
   * to delete (which is what clears the «X joined» notices), and a real silent test message.
   *
   * Silence here is the point: when nothing arrives in the group, this says which link in the chain
   * is broken instead of leaving the admin to guess.
   */
  app.post('/admin/v1/wall/group-check', { preHandler: allow(), config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async () => {
    const { wall } = await getSettings();
    const tg = wall.telegram;
    const out = {
      enabled: tg.enabled,
      chatId: tg.chatId,
      title: null as string | null,
      botAdmin: false,
      canDelete: false,
      sent: false,
      error: null as string | null,
    };
    if (!tg.enabled) return { ...out, error: 'انتشار در گروه در تنظیمات خاموش است' };
    if (!tg.chatId) return { ...out, error: 'شناسه‌ی گروه خالی است' };
    const api = botApi();
    if (!api) return { ...out, error: 'توکن ربات روی سرور تنظیم نشده است' };
    try {
      const chat = await api.getChat(tg.chatId);
      out.title = 'title' in chat ? (chat.title ?? null) : null;
      const me = await api.getMe();
      const member = await api.getChatMember(tg.chatId, me.id);
      out.botAdmin = member.status === 'administrator' || member.status === 'creator';
      out.canDelete = member.status === 'creator' || (member.status === 'administrator' && !!member.can_delete_messages);
      if (!out.botAdmin) return { ...out, error: 'ربات در این گروه ادمین نیست؛ ادمینش کنید' };
      const msg = await api.sendMessage(tg.chatId, '✅ <i>اتصال Vibe Chat به این گروه درست کار می‌کند</i>', {
        parse_mode: 'HTML',
        disable_notification: true,
      });
      out.sent = true;
      // the test message is noise: take it away again
      await api.deleteMessage(tg.chatId, msg.message_id).catch(() => undefined);
      return {
        ...out,
        error: out.canDelete ? null : 'پیام تست رفت، ولی ربات اجازه‌ی «حذف پیام» ندارد؛ پیام‌های سیستمی گروه پاک نمی‌شوند',
      };
    } catch (e) {
      return { ...out, error: e instanceof Error ? e.message.slice(0, 300) : 'تلگرام جواب نداد' };
    }
  });

  app.post('/admin/v1/wall/:id/remove', { preHandler: allow('moderator') }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { reason } = parse(z.object({ reason: z.string().min(2).max(200) }), req.body);
    if (!(await removePost(id, reason, req.admin.id))) throw notFound('این درخواست قبلاً حذف شده است');
    await audit(req.admin.id, 'wall.remove', 'wall_post', id, { reason });
    return { ok: true };
  });
}
