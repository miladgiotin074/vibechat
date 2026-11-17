import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { uuidv7 } from '../../lib/ids.js';
import { enqueue } from '../../lib/queue.js';
import { parse, zUuid } from '../../lib/validate.js';
import { notify } from '../notifications/service.js';
import { recomputeTrust } from '../safety/service.js';
import { telegramHtml } from '../../lib/markdown.js';
import { deleteObjects, signedUrl } from '../../lib/storage.js';
import { CAPTION_MAX, saveAnnouncementImage, visibleLength } from '../bot/media.js';
import { escapeHtml } from '../bot/sender.js';
import { getSettings, saveSettings, SettingsSchema } from '../settings/settings.js';
import { banUser } from '../users/lifecycle.js';
import { allow, audit, paging, requireAdmin } from './guard.js';

export async function adminContentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  // ---- reports ---------------------------------------------------------------------------

  app.get('/admin/v1/reports', { preHandler: allow('moderator') }, async (req) => {
    const q = parse(
      z.object({ status: z.enum(['open', 'resolved', 'dismissed']).default('open'), page: z.coerce.number().int().optional() }),
      req.query,
    );
    const { limit, offset, page, pageSize } = paging({ page: q.page, pageSize: 25 });
    const rows = await sql`
      SELECT r.id, r.reason, r.details, r.status, r.action, r.created_at, r.resolved_at, r.match_id IS NOT NULL AS has_chat,
             r.reporter_id, rp.name AS reporter_name, r.reported_id, rd.name AS reported_name, rd.status AS reported_status,
             (SELECT count(*)::int FROM reports x WHERE x.reported_id = r.reported_id) AS reported_total
      FROM reports r JOIN users rp ON rp.id = r.reporter_id JOIN users rd ON rd.id = r.reported_id
      WHERE r.status = ${q.status}
      ORDER BY r.created_at ${q.status === 'open' ? sql`ASC` : sql`DESC`}
      LIMIT ${limit} OFFSET ${offset}`;
    const [{ total }] = (await sql`SELECT count(*)::int AS total FROM reports WHERE status = ${q.status}`) as unknown as [{ total: number }];
    return { items: rows, total, page, pageSize };
  });

  app.get('/admin/v1/reports/:id', { preHandler: allow('moderator') }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [r] = await sql`
      SELECT r.*, rp.name AS reporter_name, rd.name AS reported_name, rd.status AS reported_status
      FROM reports r JOIN users rp ON rp.id = r.reporter_id JOIN users rd ON rd.id = r.reported_id WHERE r.id = ${id}`;
    if (!r) throw notFound();
    await audit(req.admin.id, 'report.view', 'report', id);
    return r;
  });

  app.post('/admin/v1/reports/:id/resolve', { preHandler: allow('moderator') }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(
      z.object({ action: z.enum(['dismiss', 'warn', 'suspend', 'ban']), note: z.string().max(500).optional() }),
      req.body,
    );
    const [r] = await sql<{ reported_id: string }[]>`
      UPDATE reports SET status = ${body.action === 'dismiss' ? 'dismissed' : 'resolved'}, action = ${body.action},
        resolution_note = ${body.note ?? null}, resolved_by = ${req.admin.id}, resolved_at = now()
      WHERE id = ${id} RETURNING reported_id`;
    if (!r) throw notFound();
    // a dismissed report no longer counts against the person
    await recomputeTrust([r.reported_id]);
    if (body.action === 'warn') {
      await notify(r.reported_id, {
        type: 'system',
        title: 'اخطار ⚠️',
        body: body.note ?? 'رفتار شما توسط کاربران گزارش شده است. در صورت تکرار، حساب شما مسدود می‌شود.',
      });
    } else if (body.action === 'ban' || body.action === 'suspend') {
      await banUser(r.reported_id, body.note ?? 'گزارش کاربران', body.action === 'ban' ? 'banned' : 'suspended');
      // the same person's other open reports are settled by this decision
      await sql`UPDATE reports SET status = 'resolved', action = ${body.action}, resolved_by = ${req.admin.id}, resolved_at = now()
                WHERE reported_id = ${r.reported_id} AND status = 'open'`;
    }
    await audit(req.admin.id, `report.${body.action}`, 'user', r.reported_id, { reportId: id, note: body.note });
    return { ok: true };
  });

  // ---- settings ---------------------------------------------------------------------------

  app.get('/admin/v1/settings', { preHandler: allow() }, async () => getSettings());

  app.put('/admin/v1/settings', { preHandler: allow() }, async (req) => {
    const patch = parse(SettingsSchema.partial(), req.body);
    const saved = await saveSettings(patch, req.admin.id);
    await audit(req.admin.id, 'settings.update', null, null, Object.keys(patch));
    return saved;
  });

  // ---- announcements ----------------------------------------------------------------------

  app.get('/admin/v1/announcements', { preHandler: allow() }, async () => {
    const rows = await sql`
      SELECT id, title, body, segment, via_bot, bot_sent, created_at, expires_at, image_preview, button_text, button_url,
             markdown, pin_hours, app_button
      FROM announcements ORDER BY id DESC LIMIT 50`;
    return { items: rows };
  });

  /**
   * What the announcement will look like in Telegram. The panel shows it while the admin writes,
   * so a broken link or a caption that is too long for a picture is caught before it goes out.
   */
  app.post('/admin/v1/announcements/preview', { preHandler: allow() }, async (req) => {
    const b = parse(
      z.object({ title: z.string().max(80).default(''), body: z.string().max(3000).default(''), markdown: z.boolean().default(true) }),
      req.body,
    );
    const html = `📢 <b>${escapeHtml(b.title)}</b>\n\n${b.markdown ? telegramHtml(b.body) : escapeHtml(b.body)}`;
    return { html, length: visibleLength(html), captionMax: CAPTION_MAX };
  });

  /**
   * A new announcement. It may carry its own picture (a data URL, like the bot images: the panel's
   * proxy only passes JSON) and one glass button — any text with any link (support, a channel), or
   * no link, which opens the Mini App.
   */
  app.post('/admin/v1/announcements', { preHandler: allow(), bodyLimit: 12 * 1024 * 1024 }, async (req) => {
    const b = parse(
      z.object({
        title: z.string().min(2).max(80),
        body: z.string().min(2).max(3000),
        /** the body is written in Markdown (see lib/markdown.ts) */
        markdown: z.boolean().default(false),
        /** the bot keeps it pinned in the user's chat for this many hours (0 = don't pin) */
        pinHours: z.number().int().min(0).max(24 * 14).default(0),
        /** also put a «ورود به Vibe Chat» button under the admin's own one */
        appButton: z.boolean().default(true),
        segment: z.object({ gender: z.enum(['male', 'female']).optional(), premium: z.boolean().optional() }).default({}),
        expiresAt: z.string().datetime().nullable().optional(),
        /** Also send it as a Telegram message from the bot (rate-limited, in the background). */
        viaBot: z.boolean().default(false),
        /** data:image/png|jpeg|webp;base64,… — stands in for the «announcement» bot picture */
        image: z.string().max(12 * 1024 * 1024).nullable().optional(),
        button: z
          .object({
            text: z.string().min(1).max(64),
            /** http(s) or tg://; empty opens the Mini App */
            url: z.string().max(512).nullable().optional(),
          })
          .nullable()
          .optional(),
      }),
      req.body,
    );

    let image: { key: string; preview: string } | null = null;
    if (b.image) {
      const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(b.image);
      if (!m) throw badRequest('فقط تصویر PNG، JPG یا WebP');
      const bytes = Buffer.from(m[2]!, 'base64');
      if (bytes.length > 8 * 1024 * 1024) throw badRequest('حجم تصویر حداکثر ۸ مگابایت است');
      image = await saveAnnouncementImage(bytes);
    }
    // refuse now, with the line that is wrong, instead of letting Telegram drop every message
    if (b.markdown) telegramHtml(b.body);
    const buttonText = b.button?.text.trim() || null;
    const buttonUrl = b.button?.url?.trim() || null;
    // Telegram refuses a button with a bad link, and the whole message with it
    if (buttonUrl && !/^(https?|tg):\/\/\S+$/i.test(buttonUrl)) throw badRequest('لینک دکمه باید با https:// یا tg:// شروع شود');
    if (buttonUrl && !buttonText) throw badRequest('متن دکمه را بنویسید');

    const [row] = await sql`
      INSERT INTO announcements (title, body, segment, via_bot, created_by, expires_at, image_key, image_preview, button_text, button_url,
                                 markdown, pin_hours, app_button)
      VALUES (${b.title}, ${b.body}, ${sql.json(b.segment)}, ${b.viaBot}, ${req.admin.id}, ${b.expiresAt ?? null},
              ${image?.key ?? null}, ${image?.preview ?? null}, ${buttonText}, ${buttonUrl}, ${b.markdown}, ${b.pinHours}, ${b.appButton})
      RETURNING id`;
    if (b.viaBot) await enqueue({ name: 'announce', announcementId: String(row!.id) });
    await audit(req.admin.id, 'announcement.create', 'announcement', String(row!.id), {
      ...b,
      image: image ? 'attached' : undefined,
    });
    return { id: row!.id };
  });

  app.delete('/admin/v1/announcements/:id', { preHandler: allow() }, async (req) => {
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    const [gone] = await sql<{ image_key: string | null }[]>`DELETE FROM announcements WHERE id = ${id} RETURNING image_key`;
    if (gone?.image_key) await deleteObjects([gone.image_key]).catch(() => undefined);
    await audit(req.admin.id, 'announcement.delete', 'announcement', String(id));
    return { ok: true };
  });

  // ---- audit log --------------------------------------------------------------------------

  app.get('/admin/v1/audit-logs', { preHandler: allow() }, async (req) => {
    const q = parse(z.object({ page: z.coerce.number().int().optional() }), req.query);
    const { limit, offset, page, pageSize } = paging({ page: q.page, pageSize: 50 });
    const rows = await sql`
      SELECT l.*, a.username FROM audit_logs l LEFT JOIN admins a ON a.id = l.admin_id
      ORDER BY l.id DESC LIMIT ${limit} OFFSET ${offset}`;
    return { items: rows, page, pageSize };
  });
}
