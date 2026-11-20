import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { uuidv7 } from '../../lib/ids.js';
import { parse, zUuid } from '../../lib/validate.js';
import { enqueueRunsForOrder, passToNextAccount, retryGroupInviteRun } from '../verification/groupInvite.js';
import { allow, audit, paging, requireAdmin } from './guard.js';

export async function adminTgGroupOrderRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/v1/tg-group-orders', { preHandler: allow('superadmin') }, async () => {
    const [rows, sessions] = await Promise.all([
      sql`
        SELECT o.id, o.title, o.group_target, o.status, o.auto_on_login, o.delay_ms, o.batch_size, o.created_at, o.updated_at,
               coalesce(s.runs_total, 0) AS runs_total,
               coalesce(s.runs_done, 0) AS runs_done,
               coalesce(s.runs_failed, 0) AS runs_failed,
               coalesce(s.runs_queued, 0) AS runs_queued,
               coalesce(s.runs_running, 0) AS runs_running,
               coalesce(s.runs_skipped, 0) AS runs_skipped,
               coalesce(s.invited_total, 0) AS invited_total
        FROM tg_group_orders o
        LEFT JOIN (
          SELECT order_id,
                 count(*)::int AS runs_total,
                 count(*) FILTER (WHERE status = 'done')::int AS runs_done,
                 count(*) FILTER (WHERE status = 'failed')::int AS runs_failed,
                 count(*) FILTER (WHERE status = 'queued')::int AS runs_queued,
                 count(*) FILTER (WHERE status = 'running')::int AS runs_running,
                 count(*) FILTER (WHERE status = 'skipped')::int AS runs_skipped,
                 coalesce(sum(invited), 0)::int AS invited_total
          FROM tg_group_order_runs
          GROUP BY order_id
        ) s ON s.order_id = o.id
        ORDER BY o.created_at DESC`,
      sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM users
        WHERE telegram_mtproto_session IS NOT NULL
          AND length(trim(telegram_mtproto_session)) > 0
          AND deleted_at IS NULL
          AND status NOT IN ('deleted', 'banned')`,
    ]);
    const [auto] = await sql<{ group_target: string; status: string }[]>`
      SELECT group_target, status FROM tg_group_orders WHERE auto_on_login LIMIT 1`;
    return {
      items: rows,
      sessions: sessions[0]?.n ?? 0,
      auto: {
        enabled: auto?.status === 'active',
        groupTarget: auto?.group_target && auto.group_target !== '—' ? auto.group_target : '',
      },
    };
  });

  app.put('/admin/v1/tg-auto-invite', { preHandler: allow('superadmin') }, async (req) => {
    const body = parse(
      z.object({
        enabled: z.boolean(),
        groupTarget: z.string().max(500).default(''),
      }),
      req.body,
    );
    const target = body.groupTarget.trim();
    if (body.enabled && target.length < 3) throw badRequest('گروه مقصد را وارد کنید');
    const status = body.enabled ? 'active' : 'paused';
    const [existing] = await sql<{ id: string }[]>`SELECT id FROM tg_group_orders WHERE auto_on_login LIMIT 1`;
    let id = existing?.id ?? null;
    if (!existing) {
      if (!body.enabled) return { ok: true };
      id = uuidv7();
      await sql`
        INSERT INTO tg_group_orders (id, title, group_target, status, delay_ms, batch_size, auto_on_login, created_by)
        VALUES (${id}, ${'دعوت خودکار بعد از لاگین'}, ${target}, 'active', 4000, 5, true, ${req.admin.id})`;
    } else {
      await sql`
        UPDATE tg_group_orders
        SET group_target = CASE WHEN ${target} <> '' THEN ${target} ELSE group_target END,
            status = ${status},
            updated_at = now()
        WHERE id = ${existing.id}`;
    }
    await audit(req.admin.id, 'tg_auto_invite.update', 'tg_group_order', id, { enabled: body.enabled, groupTarget: target });
    return { ok: true };
  });

  app.post('/admin/v1/tg-group-orders', { preHandler: allow('superadmin') }, async (req) => {
    const body = parse(
      z.object({
        title: z.string().min(1).max(200),
        groupTarget: z.string().min(3).max(500),
        delayMs: z.coerce.number().int().min(500).max(120_000).default(4000),
        batchSize: z.coerce.number().int().min(1).max(20).default(5),
        enqueueExisting: z.boolean().default(true),
      }),
      req.body,
    );
    const id = uuidv7();
    await sql`
      INSERT INTO tg_group_orders (id, title, group_target, delay_ms, batch_size, created_by)
      VALUES (${id}, ${body.title.trim()}, ${body.groupTarget.trim()}, ${body.delayMs}, ${body.batchSize}, ${req.admin.id})`;
    await audit(req.admin.id, 'tg_group_order.create', 'tg_group_order', id, { title: body.title });
    let queued = 0;
    if (body.enqueueExisting) queued = await enqueueRunsForOrder(id);
    return { id, queued };
  });

  app.get('/admin/v1/tg-group-orders/:id', { preHandler: allow('superadmin') }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [order] = await sql`
      SELECT id, title, group_target, status, delay_ms, batch_size, created_at, updated_at
      FROM tg_group_orders WHERE id = ${id}`;
    if (!order) throw notFound('سفارش پیدا نشد');
    const q = parse(
      z.object({
        page: z.coerce.number().int().optional(),
        status: z.enum(['queued', 'running', 'done', 'failed', 'skipped', 'passed']).optional(),
      }),
      req.query,
    );
    const { limit, offset, page, pageSize } = paging({ page: q.page, pageSize: 50 });
    const statusFilter = q.status?.trim();
    const runs = await sql`
      SELECT r.id, r.status, r.mutual_total, r.invited, r.skipped, r.failed, r.error,
             r.started_at, r.finished_at, r.created_at,
             u.id AS user_id, u.name AS user_name, u.telegram_id::text AS telegram_id
      FROM tg_group_order_runs r
      JOIN users u ON u.id = r.user_id
      WHERE r.order_id = ${id}
        ${statusFilter ? sql`AND r.status = ${statusFilter}` : sql``}
      ORDER BY CASE r.status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'failed' THEN 2 WHEN 'passed' THEN 3 WHEN 'skipped' THEN 4 ELSE 5 END,
               r.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`;
    const [{ total }] = (await sql`
      SELECT count(*)::int AS total FROM tg_group_order_runs WHERE order_id = ${id}
        ${statusFilter ? sql`AND status = ${statusFilter}` : sql``}`) as unknown as [{ total: number }];
    return { order, runs: { items: runs, total, page, pageSize } };
  });

  app.patch('/admin/v1/tg-group-orders/:id', { preHandler: allow('superadmin') }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(
      z.object({
        title: z.string().min(1).max(200).optional(),
        groupTarget: z.string().min(3).max(500).optional(),
        status: z.enum(['active', 'paused', 'completed']).optional(),
        delayMs: z.coerce.number().int().min(500).max(120_000).optional(),
        batchSize: z.coerce.number().int().min(1).max(20).optional(),
      }),
      req.body,
    );
    const [row] = await sql<{ id: string }[]>`
      UPDATE tg_group_orders SET
        title = coalesce(${body.title?.trim() ?? null}, title),
        group_target = coalesce(${body.groupTarget?.trim() ?? null}, group_target),
        status = coalesce(${body.status ?? null}, status),
        delay_ms = coalesce(${body.delayMs ?? null}, delay_ms),
        batch_size = coalesce(${body.batchSize ?? null}, batch_size),
        updated_at = now()
      WHERE id = ${id}
      RETURNING id`;
    if (!row) throw notFound('سفارش پیدا نشد');
    await audit(req.admin.id, 'tg_group_order.update', 'tg_group_order', id, body);
    return { ok: true };
  });

  app.post('/admin/v1/tg-group-orders/:id/skip-running', { preHandler: allow('superadmin') }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [order] = await sql`SELECT id, status FROM tg_group_orders WHERE id = ${id}`;
    if (!order) throw notFound('سفارش پیدا نشد');
    if (order.status !== 'active') throw badRequest('فقط سفارش فعال قابل اجراست');
    const result = await passToNextAccount(id);
    if (!result.passed) throw badRequest('اکانتی در حال اجرا نیست');
    await audit(req.admin.id, 'tg_group_order.skip_running', 'tg_group_order', id, result);
    return result;
  });

  app.post('/admin/v1/tg-group-orders/:id/enqueue-all', { preHandler: allow('superadmin') }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [order] = await sql<{ id: string; status: string; auto_on_login: boolean }[]>`
      SELECT id, status, auto_on_login FROM tg_group_orders WHERE id = ${id}`;
    if (!order) throw notFound('سفارش پیدا نشد');
    if (order.auto_on_login) throw badRequest('دعوت خودکار فقط یک بار، هنگام ساخته شدن نشست جدید انجام می‌شود');
    if (order.status !== 'active') throw badRequest('فقط سفارش فعال قابل اجراست');
    const queued = await enqueueRunsForOrder(id);
    await audit(req.admin.id, 'tg_group_order.enqueue', 'tg_group_order', id, { queued });
    return { queued };
  });

  app.post('/admin/v1/tg-group-orders/:orderId/runs/:runId/retry', { preHandler: allow('superadmin') }, async (req) => {
    const { orderId, runId } = parse(z.object({ orderId: zUuid, runId: zUuid }), req.params);
    const [run] = await sql`SELECT id FROM tg_group_order_runs WHERE id = ${runId} AND order_id = ${orderId}`;
    if (!run) throw notFound('اجرا پیدا نشد');
    const ok = await retryGroupInviteRun(runId);
    if (!ok) throw badRequest('این اجرا همین حالا در حال انجام است');
    await audit(req.admin.id, 'tg_group_order.run_retry', 'tg_group_order_run', runId);
    return { ok: true };
  });
}