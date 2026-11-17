import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config.js';
import { sql } from '../../lib/db.js';
import { AppError, forbidden, unauthorized } from '../../lib/errors.js';
import { redis } from '../../lib/redis.js';
import { verifyAccessToken } from '../../lib/tokens.js';
import { touchActivity } from '../users/activity.js';

export interface UserState {
  status: 'onboarding' | 'active' | 'suspended' | 'banned' | 'deleted';
  gender: 'male' | 'female' | null;
  /** Shadow-banned: everything works for them, nothing they do reaches anyone else. */
  shadow: boolean;
}

export interface AuthUser extends UserState {
  id: string;
  sid: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}

const STATE_TTL_S = 60;

/** Tiny per-user record every authenticated request needs; cached so auth costs one Redis round trip. */
export async function getUserState(userId: string): Promise<UserState | null> {
  const cached = await redis.get(`ust:${userId}`);
  if (cached) return JSON.parse(cached) as UserState;
  return loadUserState(userId);
}

async function loadUserState(userId: string): Promise<UserState | null> {
  const [row] = await sql<{ status: UserState['status']; gender: UserState['gender']; shadow_banned: boolean }[]>`
    SELECT status, gender, shadow_banned FROM users WHERE id = ${userId}`;
  if (!row) return null;
  const state: UserState = {
    status: row.status,
    gender: row.gender,
    shadow: row.shadow_banned,
  };
  await redis.set(`ust:${userId}`, JSON.stringify(state), 'EX', STATE_TTL_S);
  return state;
}

/** Call after anything that changes status, premium or the public profile card. */
export async function invalidateUser(userId: string) {
  await redis.del(`ust:${userId}`, `card:${userId}`);
}

/** Makes a session's access tokens stop working now instead of at expiry. */
export async function revokeSessionTokens(sessionIds: string[]) {
  if (!sessionIds.length) return;
  const m = redis.multi();
  for (const sid of sessionIds) m.set(`rsid:${sid}`, '1', 'EX', env.ACCESS_TOKEN_TTL_MIN * 60 + 60);
  await m.exec();
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  const q = (req.query as Record<string, unknown> | undefined)?.access_token;
  return typeof q === 'string' ? q : null;
}

export async function authenticate(req: FastifyRequest): Promise<AuthUser> {
  const token = bearer(req);
  if (!token) throw unauthorized();
  const claims = await verifyAccessToken(token);
  if (!claims) throw new AppError(401, 'token_expired', 'نشست منقضی شده است');
  const [stateJson, revoked] = await redis.mget(`ust:${claims.sub}`, `rsid:${claims.sid}`);
  const state = stateJson ? (JSON.parse(stateJson) as UserState) : await loadUserState(claims.sub);
  if (!state || state.status === 'deleted') throw unauthorized();
  // checked before revocation (a ban also revokes sessions) so the app can show why
  if (state.status === 'banned' || state.status === 'suspended') {
    throw forbidden('حساب شما مسدود شده است. برای پیگیری با پشتیبانی در تماس باشید.', 'account_banned');
  }
  if (revoked) throw unauthorized();
  return { id: claims.sub, sid: claims.sid, ...state };
}

/** preHandler for every /v1 route that needs a logged-in user. */
export async function requireUser(req: FastifyRequest, _reply: FastifyReply) {
  req.user = await authenticate(req);
  touchActivity(req.user.id).catch((e) => req.log.warn(e, 'touchActivity failed'));
}

/** preHandler for routes that need a finished profile (discovery, swipes, chat). */
export async function requireActive(req: FastifyRequest, reply: FastifyReply) {
  await requireUser(req, reply);
  if (req.user.status !== 'active') throw forbidden('ابتدا پروفایل خود را کامل کنید', 'onboarding_required');
}
