import type { FastifyReply, FastifyRequest } from 'fastify';
import { sql } from '../../lib/db.js';
import { forbidden, unauthorized } from '../../lib/errors.js';
import { verifyAdminToken, type AdminClaims } from '../../lib/tokens.js';

export type AdminRole = AdminClaims['role'];

declare module 'fastify' {
  interface FastifyRequest {
    admin: { id: string; role: AdminRole };
  }
}

export async function requireAdmin(req: FastifyRequest, _reply: FastifyReply) {
  const h = req.headers.authorization;
  const claims = h?.startsWith('Bearer ') ? await verifyAdminToken(h.slice(7)) : null;
  if (!claims) throw unauthorized('ورود مدیر لازم است');
  req.admin = { id: claims.sub, role: claims.role };
}

/** Use after requireAdmin. superadmin can do everything. */
export function allow(...roles: AdminRole[]) {
  return async (req: FastifyRequest) => {
    if (req.admin.role !== 'superadmin' && !roles.includes(req.admin.role)) {
      throw forbidden('این بخش برای نقش شما مجاز نیست');
    }
  };
}

export async function audit(adminId: string, action: string, targetType: string | null, targetId: string | null, meta?: unknown) {
  await sql`
    INSERT INTO audit_logs (admin_id, action, target_type, target_id, meta)
    VALUES (${adminId}, ${action}, ${targetType}, ${targetId}, ${meta ? sql.json(meta as never) : null})`;
}

export function paging(q: { page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(q.pageSize ?? 25, 1), 100);
  const page = Math.max(q.page ?? 1, 1);
  return { limit: pageSize, offset: (page - 1) * pageSize, page, pageSize };
}
