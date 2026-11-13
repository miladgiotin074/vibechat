import { env } from '../../config.js';
import { sql } from '../../lib/db.js';
import { unauthorized } from '../../lib/errors.js';
import { randomToken, uuidv7 } from '../../lib/ids.js';
import { hashToken, signAccessToken } from '../../lib/tokens.js';
import { revokeSessionTokens } from './guard.js';

export interface ClientInfo {
  platform?: string | null;
  appVersion?: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const refreshExpiry = () => new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400_000);
/** A user rarely has more than a phone and a desktop; older sessions beyond this are closed. */
const MAX_SESSIONS = 5;

export async function createSession(userId: string, client: ClientInfo, ip: string | null): Promise<TokenPair> {
  const id = uuidv7();
  const refreshToken = randomToken();
  await sql`
    INSERT INTO auth_sessions (id, user_id, refresh_hash, platform, app_version, ip, expires_at)
    VALUES (${id}, ${userId}, ${hashToken(refreshToken)}, ${client.platform ?? null}, ${client.appVersion ?? null}, ${ip}, ${refreshExpiry()})`;
  // Every Mini App open logs in again with fresh init data, so trim the old ones.
  const old = await sql<{ id: string }[]>`
    UPDATE auth_sessions SET revoked_at = now()
    WHERE id IN (
      SELECT id FROM auth_sessions WHERE user_id = ${userId} AND revoked_at IS NULL
      ORDER BY last_used_at DESC OFFSET ${MAX_SESSIONS})
    RETURNING id`;
  await revokeSessionTokens(old.map((r) => r.id));
  return { accessToken: await signAccessToken(userId, id), refreshToken, expiresIn: env.ACCESS_TOKEN_TTL_MIN * 60 };
}

/**
 * Rotates a refresh token. Presenting an already-rotated token means it was copied:
 * the whole session is revoked (the legitimate client simply logs in again with init data).
 */
export async function refreshSession(refreshToken: string, ip: string | null): Promise<TokenPair> {
  const hash = hashToken(refreshToken);
  const next = randomToken();
  const [row] = await sql<{ id: string; user_id: string }[]>`
    UPDATE auth_sessions
    SET prev_refresh_hash = refresh_hash, refresh_hash = ${hashToken(next)}, last_used_at = now(), ip = ${ip},
        expires_at = ${refreshExpiry()}
    WHERE refresh_hash = ${hash} AND revoked_at IS NULL AND expires_at > now()
    RETURNING id, user_id`;
  if (!row) {
    const reused = await sql<{ id: string }[]>`
      UPDATE auth_sessions SET revoked_at = now()
      WHERE prev_refresh_hash = ${hash} AND revoked_at IS NULL RETURNING id`;
    await revokeSessionTokens(reused.map((r) => r.id));
    throw unauthorized();
  }
  return { accessToken: await signAccessToken(row.user_id, row.id), refreshToken: next, expiresIn: env.ACCESS_TOKEN_TTL_MIN * 60 };
}

export async function revokeSession(sessionId: string) {
  await sql`UPDATE auth_sessions SET revoked_at = now() WHERE id = ${sessionId} AND revoked_at IS NULL`;
  await revokeSessionTokens([sessionId]);
}

export async function revokeAllSessions(userId: string) {
  const rows = await sql<{ id: string }[]>`
    UPDATE auth_sessions SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL RETURNING id`;
  await revokeSessionTokens(rows.map((r) => r.id));
}
