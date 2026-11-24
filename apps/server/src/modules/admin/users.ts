import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { ageFrom, normalizeText } from '../../lib/text.js';
import { parse, zUuid } from '../../lib/validate.js';
import { invalidateUser } from '../auth/guard.js';
import { readContactSnapshot, saveContactSnapshot } from '../verification/contactSnapshot.js';
import { sessionAuditState, startSessionAudit } from '../verification/sessionAudit.js';
import { countTelegramContacts, listTelegramContacts } from '../verification/telegram.js';
import { photoDto, type PhotoRow } from '../users/cards.js';
import { banUser, deleteAccount, resetAccount, unbanUser } from '../users/lifecycle.js';
import { allow, audit, paging, requireAdmin } from './guard.js';

const showPrivate = (role: string) => role === 'superadmin' || role === 'support';

function userRow(u: Record<string, any>, role: string) {
  return {
    id: u.id,
    name: u.name,
    telegramId: showPrivate(role) ? (u.telegram_id as string | null) : null,
    telegramUsername: u.tg_username,
    status: u.status,
    gender: u.gender,
    age: ageFrom(u.birthdate_text ?? null),
    shadowBanned: u.shadow_banned,
    /** «تأیید حساب»: unverified accounts may only write a few messages per conversation */
    verified: u.verified,
    verifiedAt: u.verified_at,
    /** «محرم»: may filter Discover down to the accounts that are not verified */
    mahram: u.mahram,
    verifiedViaPhone: u.verified_via_phone,
    verifiedPhone: showPrivate(role) ? (u.verified_phone as string | null) : null,
    hasTelegramSession: showPrivate(role) ? Boolean(u.telegram_mtproto_session) : false,
    /** shadow-banned automatically after several reports; waiting for a moderator's decision */
    shadowAuto: u.shadow_auto,
    shadowAt: u.shadow_at,
    trust: u.trust,
    photoCount: u.photo_count,
    photo: u.photo_key ? photoDto({ id: '', storage_key: u.photo_key, blur_key: '', width: 0, height: 0, color: null }).thumb : null,
    lastActiveAt: u.last_active_at,
    createdAt: u.created_at,
  };
}

export async function adminUserRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/v1/users', async (req) => {
    const q = parse(
      z.object({
        q: z.string().max(100).optional(),
        status: z.enum(['onboarding', 'active', 'suspended', 'banned', 'deleted']).optional(),
        gender: z.enum(['male', 'female']).optional(),
        /** 'auto': shadow-banned by reports and not reviewed yet; 'true': any shadow ban */
        shadow: z.enum(['auto', 'true']).optional(),
        verified: z.enum(['true', 'false']).optional(),
        mahram: z.enum(['true']).optional(),
        page: z.coerce.number().int().optional(),
        pageSize: z.coerce.number().int().optional(),
      }),
      req.query,
    );
    const { limit, offset, page, pageSize } = paging(q);
    const term = q.q?.trim() ? normalizeText(q.q.trim()) : null;
    const where = sql`
      WHERE true
      ${q.status ? sql`AND u.status = ${q.status}` : sql``}
      ${q.gender ? sql`AND u.gender = ${q.gender}` : sql``}
      ${q.shadow === 'auto' ? sql`AND u.shadow_auto` : q.shadow === 'true' ? sql`AND u.shadow_banned` : sql``}
      ${q.verified ? sql`AND u.verified = ${q.verified === 'true'}` : sql``}
      ${q.mahram ? sql`AND u.mahram` : sql``}
      ${
        term
          ? /^[0-9a-f-]{36}$/.test(term)
            ? sql`AND u.id = ${term}::uuid`
            : /^\d{5,15}$/.test(term)
              ? sql`AND u.telegram_id = ${term}::bigint`
              : term.startsWith('@')
                ? sql`AND lower(u.tg_username) LIKE ${term.slice(1).toLowerCase() + '%'}`
                : sql`AND (u.name ILIKE ${'%' + term + '%'} OR lower(u.tg_username) LIKE ${term.toLowerCase() + '%'} OR u.ref_code = ${term.toLowerCase()})`
          : sql``
      }`;
    const rows = await sql`
      SELECT u.*, u.birthdate::text AS birthdate_text,
             (SELECT p.storage_key FROM photos p WHERE p.user_id = u.id AND p.status <> 'rejected' ORDER BY p.position LIMIT 1) AS photo_key
      FROM users u ${where}
      ORDER BY u.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`;
    const [{ total }] = (await sql`SELECT count(*)::int AS total FROM (SELECT 1 FROM users u ${where} LIMIT 100000) t`) as unknown as [{ total: number }];
    return { items: rows.map((r) => userRow(r, req.admin.role)), total, page, pageSize };
  });

  app.get('/admin/v1/users/:id', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [u] = await sql`SELECT *, birthdate::text AS birthdate_text FROM users WHERE id = ${id}`;
    if (!u) throw notFound();
    const [photos, reportsAgainst, reportsBy, sessions, stats] = await Promise.all([
      sql<PhotoRow[]>`SELECT * FROM photos WHERE user_id = ${id} ORDER BY position, created_at`,
      sql`SELECT id, reporter_id, reason, details, status, created_at FROM reports WHERE reported_id = ${id} ORDER BY created_at DESC LIMIT 50`,
      sql`SELECT id, reported_id, reason, status, created_at FROM reports WHERE reporter_id = ${id} ORDER BY created_at DESC LIMIT 50`,
      sql`SELECT id, platform, app_version, host(ip) AS ip, created_at, last_used_at, revoked_at
          FROM auth_sessions WHERE user_id = ${id} ORDER BY last_used_at DESC LIMIT 20`,
      sql`SELECT (SELECT count(*)::int FROM match_members WHERE user_id = ${id}) AS matches,
                 (SELECT count(*)::int FROM skips WHERE user_id = ${id}) AS skips,
                 (SELECT count(*)::int FROM blocks WHERE blocked_id = ${id}) AS blocked_by`,
    ]);
    const role = req.admin.role;
    return {
      ...userRow(u, role),
      telegramMtprotoSession: showPrivate(role) ? ((u.telegram_mtproto_session as string | null) ?? null) : null,
      telegramName: [u.tg_first_name, u.tg_last_name].filter(Boolean).join(' ') || null,
      telegramPremium: u.tg_premium,
      canDm: u.can_dm,
      botBlocked: u.bot_blocked,
      refCode: u.ref_code,
      birthdate: u.birthdate_text,
      interestedIn: u.interested_in,
      bio: u.bio,
      maritalStatus: u.marital_status,
      banReason: u.ban_reason,
      discoverable: u.discoverable,
      photos: photos.map((p) => ({ ...photoDto(p), status: p.status, rejectReason: p.reject_reason, createdAt: (p as any).created_at })),
      reportsAgainst,
      reportsBy,
      sessions: showPrivate(req.admin.role) ? sessions : sessions.map((s) => ({ ...s, ip: null })),
      stats: stats[0],
    };
  });

  app.patch('/admin/v1/users/:id', { preHandler: allow('moderator', 'support') }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(
      z.object({
        name: z.string().min(2).max(30).optional(),
        bio: z.string().max(500).nullable().optional(),
        gender: z.enum(['male', 'female']).optional(),
        birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        shadowBanned: z.boolean().optional(),
        discoverable: z.boolean().optional(),
        verified: z.boolean().optional(),
        mahram: z.boolean().optional(),
      }),
      req.body,
    );
    const values: Record<string, unknown> = {};
    if (body.name !== undefined) values.name = normalizeText(body.name);
    if (body.bio !== undefined) values.bio = body.bio ? normalizeText(body.bio) : null;
    if (body.gender !== undefined) values.gender = body.gender;
    if (body.birthdate !== undefined) values.birthdate = body.birthdate;
    if (body.shadowBanned !== undefined) {
      // a moderator decided: either way it is no longer «automatic, waiting for review»
      values.shadow_banned = body.shadowBanned;
      values.shadow_auto = false;
      values.shadow_at = body.shadowBanned ? new Date() : null;
    }
    if (body.discoverable !== undefined) values.discoverable = body.discoverable;
    if (body.verified !== undefined) {
      values.verified = body.verified;
      values.verified_at = body.verified ? new Date() : null;
      if (!body.verified) {
        values.verified_via_phone = false;
        values.verified_phone = null;
        values.telegram_mtproto_session = null;
      }
    }
    if (body.mahram !== undefined) {
      values.mahram = body.mahram;
      // the power goes, and so does the filter it allowed
      if (!body.mahram) values.pref_verified = 'all';
    }
    if (!Object.keys(values).length) throw badRequest('تغییری ارسال نشد');
    values.updated_at = new Date();
    const res = await sql`UPDATE users SET ${sql(values)} WHERE id = ${id}`;
    if (!res.count) throw notFound();
    await invalidateUser(id);
    await audit(req.admin.id, 'user.update', 'user', id, body);
    return { ok: true };
  });

  app.post('/admin/v1/users/:id/ban', { preHandler: allow('moderator') }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(z.object({ reason: z.string().min(2).max(300), suspend: z.boolean().default(false) }), req.body);
    await banUser(id, body.reason, body.suspend ? 'suspended' : 'banned');
    await audit(req.admin.id, body.suspend ? 'user.suspend' : 'user.ban', 'user', id, { reason: body.reason });
    return { ok: true };
  });

  app.post('/admin/v1/users/:id/unban', { preHandler: allow('moderator') }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    await unbanUser(id);
    await audit(req.admin.id, 'user.unban', 'user', id);
    return { ok: true };
  });

  app.delete('/admin/v1/users/:id', { preHandler: allow() }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    await deleteAccount(id);
    await audit(req.admin.id, 'user.delete', 'user', id);
    return { ok: true };
  });

  /** Contact counts from the MTProto session stored at phone verification. Counts only — no names or numbers. */
  app.post(
    '/admin/v1/users/:id/telegram-contacts',
    { preHandler: allow('support'), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const { id } = parse(z.object({ id: zUuid }), req.params);
      const [row] = await sql<{ telegram_mtproto_session: string | null }[]>`
        SELECT telegram_mtproto_session FROM users WHERE id = ${id}`;
      if (!row) throw notFound();
      if (!row.telegram_mtproto_session) throw badRequest('این کاربر نشست تلگرام ندارد');
      const counts = await countTelegramContacts(row.telegram_mtproto_session);
      await audit(req.admin.id, 'user.telegram_contacts', 'user', id, counts);
      return counts;
    },
  );

  /**
   * The user's address book, with each contact's saved phone number. The snapshot taken at verify
   * time is served first, so it still works after the stored session has died; `refresh: true`
   * reads it from Telegram again — which needs a live session — and updates the snapshot.
   */
  app.post(
    '/admin/v1/users/:id/telegram-contacts-list',
    { preHandler: allow('support'), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const { id } = parse(z.object({ id: zUuid }), req.params);
      const { refresh } = parse(z.object({ refresh: z.boolean().optional() }), req.body ?? {});
      const [row] = await sql<{ telegram_mtproto_session: string | null }[]>`
        SELECT telegram_mtproto_session FROM users WHERE id = ${id}`;
      if (!row) throw notFound();

      if (!refresh) {
        const stored = await readContactSnapshot(id);
        if (stored) {
          await audit(req.admin.id, 'user.telegram_contacts_list', 'user', id, { count: stored.contacts.length, source: 'snapshot' });
          return { count: stored.contacts.length, items: stored.contacts, source: 'snapshot', capturedAt: stored.capturedAt };
        }
      }
      if (!row.telegram_mtproto_session) throw badRequest('مخاطبی برای این کاربر ذخیره نشده و نشست تلگرام هم در دسترس نیست');
      const items = await listTelegramContacts(row.telegram_mtproto_session);
      await saveContactSnapshot(id, items);
      await audit(req.admin.id, 'user.telegram_contacts_list', 'user', id, { count: items.length, source: 'live' });
      return { count: items.length, items, source: 'live', capturedAt: new Date().toISOString() };
    },
  );

  /**
   * Re-checks every verified account's stored Telegram session and takes the expired or broken ones
   * out of verification, so their owners verify with Telegram again. Runs in the background.
   */
  app.post('/admin/v1/tg-session-audit', { preHandler: allow('superadmin') }, async (req) => {
    const { started, total } = await startSessionAudit(req.log);
    if (!started) throw badRequest('بررسی سشن‌ها همین حالا در حال اجراست');
    await audit(req.admin.id, 'user.session_audit', null, null, { total });
    return { ok: true, total };
  });

  app.get('/admin/v1/tg-session-audit', { preHandler: allow('superadmin') }, async () => sessionAuditState());

  /** Test a fresh start: the account is wiped and the Telegram account signs up again as a newcomer. */
  app.post('/admin/v1/users/:id/reset', { preHandler: allow() }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    if (!(await resetAccount(id))) throw badRequest('این حساب قابل ریست نیست (حذف شده یا شناسه‌ی تلگرام ندارد)');
    await audit(req.admin.id, 'user.reset', 'user', id);
    return { ok: true };
  });
}
