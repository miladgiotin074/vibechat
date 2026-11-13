import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config.js';
import { sql } from '../../lib/db.js';
import { badRequest, conflict, notFound, unauthorized } from '../../lib/errors.js';
import { uuidv7 } from '../../lib/ids.js';
import { hashPassword, signAdminToken, verifyPassword } from '../../lib/tokens.js';
import { parse, zUuid } from '../../lib/validate.js';
import { allow, audit, requireAdmin } from './guard.js';

/** Creates the first superadmin from ADMIN_BOOTSTRAP_* when the table is empty. */
export async function bootstrapAdmin(log: (msg: string) => void) {
  if (!env.ADMIN_BOOTSTRAP_USERNAME || !env.ADMIN_BOOTSTRAP_PASSWORD) return;
  const [{ count }] = (await sql`SELECT count(*)::int AS count FROM admins`) as unknown as [{ count: number }];
  if (count > 0) return;
  await sql`
    INSERT INTO admins (id, username, password_hash, display_name, role)
    VALUES (${uuidv7()}, ${env.ADMIN_BOOTSTRAP_USERNAME.trim().toLowerCase()}, ${await hashPassword(env.ADMIN_BOOTSTRAP_PASSWORD)}, 'مدیر کل', 'superadmin')`;
  log(`created bootstrap superadmin "${env.ADMIN_BOOTSTRAP_USERNAME}"`);
}

const adminDto = (a: { id: string; username: string; display_name: string | null; role: string; is_active: boolean; last_login_at: Date | null; created_at: Date }) => ({
  id: a.id,
  username: a.username,
  displayName: a.display_name,
  role: a.role,
  isActive: a.is_active,
  lastLoginAt: a.last_login_at,
  createdAt: a.created_at,
});

export async function adminAuthRoutes(app: FastifyInstance) {
  app.post('/admin/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req) => {
    const body = parse(z.object({ username: z.string().min(1).max(50), password: z.string().min(1).max(200) }), req.body);
    const [admin] = await sql`SELECT * FROM admins WHERE username = ${body.username.trim().toLowerCase()}`;
    // Same work whether or not the user exists, so timing does not reveal usernames.
    const ok = admin ? await verifyPassword(body.password, admin.password_hash) : (await hashPassword(body.password), false);
    if (!admin || !ok || !admin.is_active) throw unauthorized('نام کاربری یا رمز عبور اشتباه است');
    await sql`UPDATE admins SET last_login_at = now() WHERE id = ${admin.id}`;
    await audit(admin.id, 'login', null, null, { ip: req.ip });
    return { token: await signAdminToken(admin.id, admin.role), admin: adminDto(admin as never) };
  });

  app.get('/admin/v1/auth/me', { preHandler: requireAdmin }, async (req) => {
    const [admin] = await sql`SELECT * FROM admins WHERE id = ${req.admin.id} AND is_active`;
    if (!admin) throw unauthorized();
    return adminDto(admin as never);
  });

  app.post('/admin/v1/auth/password', { preHandler: requireAdmin }, async (req) => {
    const body = parse(z.object({ current: z.string().min(1), next: z.string().min(10).max(200) }), req.body);
    const [admin] = await sql`SELECT password_hash FROM admins WHERE id = ${req.admin.id}`;
    if (!admin || !(await verifyPassword(body.current, admin.password_hash))) throw badRequest('رمز فعلی اشتباه است');
    await sql`UPDATE admins SET password_hash = ${await hashPassword(body.next)} WHERE id = ${req.admin.id}`;
    await audit(req.admin.id, 'password.change', 'admin', req.admin.id);
    return { ok: true };
  });

  // ---- admin accounts (superadmin) -----------------------------------------------------

  app.register(async (scoped) => {
    scoped.addHook('preHandler', requireAdmin);
    scoped.addHook('preHandler', allow());

    scoped.get('/admin/v1/admins', async () => {
      const rows = await sql`SELECT * FROM admins ORDER BY created_at`;
      return { items: rows.map((r) => adminDto(r as never)) };
    });

    scoped.post('/admin/v1/admins', async (req) => {
      const body = parse(
        z.object({
          username: z.string().regex(/^[a-z0-9_.]{3,30}$/, 'فقط حروف کوچک انگلیسی، عدد، _ و .'),
          password: z.string().min(10).max(200),
          displayName: z.string().max(60).optional(),
          role: z.enum(['superadmin', 'moderator', 'support']),
        }),
        req.body,
      );
      const id = uuidv7();
      try {
        await sql`
          INSERT INTO admins (id, username, password_hash, display_name, role)
          VALUES (${id}, ${body.username}, ${await hashPassword(body.password)}, ${body.displayName ?? null}, ${body.role})`;
      } catch {
        throw conflict('این نام کاربری قبلاً ثبت شده است');
      }
      await audit(req.admin.id, 'admin.create', 'admin', id, { username: body.username, role: body.role });
      return { id };
    });

    scoped.patch('/admin/v1/admins/:id', async (req) => {
      const { id } = parse(z.object({ id: zUuid }), req.params);
      const body = parse(
        z.object({
          role: z.enum(['superadmin', 'moderator', 'support']).optional(),
          isActive: z.boolean().optional(),
          password: z.string().min(10).max(200).optional(),
          displayName: z.string().max(60).optional(),
        }),
        req.body,
      );
      if (id === req.admin.id && (body.isActive === false || (body.role && body.role !== 'superadmin'))) {
        throw badRequest('نمی‌توانید دسترسی خودتان را بگیرید');
      }
      const values: Record<string, unknown> = {};
      if (body.role) values.role = body.role;
      if (body.isActive !== undefined) values.is_active = body.isActive;
      if (body.displayName !== undefined) values.display_name = body.displayName;
      if (body.password) values.password_hash = await hashPassword(body.password);
      if (!Object.keys(values).length) return { ok: true };
      const res = await sql`UPDATE admins SET ${sql(values)} WHERE id = ${id}`;
      if (!res.count) throw notFound();
      await audit(req.admin.id, 'admin.update', 'admin', id, { ...body, password: body.password ? '***' : undefined });
      return { ok: true };
    });
  });
}
