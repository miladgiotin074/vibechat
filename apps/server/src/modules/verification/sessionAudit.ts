/**
 * Sweeps the stored MTProto sessions of verified accounts and takes the ones that can no longer log
 * in out of verification, so their owners verify with Telegram again. The run happens in the
 * background: the API keeps answering and the panel polls the progress below.
 */
import { sql } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { invalidateUser } from '../auth/guard.js';
import { probeTelegramSession } from './telegram.js';

/** Just enough of a logger, so both a pino logger and Fastify's request logger fit. */
export type AuditLog = {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
};

const STATE_KEY = 'tg:session-audit';
const LOCK_KEY = 'tg:session-audit:lock';
/** How long a run may hold the lock — a run whose process died releases it after this. */
const LOCK_TTL_SECONDS = 60 * 60;
/** Telegram is not in a hurry: pause between logins. */
const PROBE_PAUSE_MS = 300;

export type SessionAuditState = {
  running: boolean;
  total: number;
  checked: number;
  expired: number;
  unknown: number;
  startedAt: string | null;
  finishedAt: string | null;
};

const IDLE: SessionAuditState = { running: false, total: 0, checked: 0, expired: 0, unknown: 0, startedAt: null, finishedAt: null };

export async function sessionAuditState(): Promise<SessionAuditState> {
  const raw = await redis.get(STATE_KEY);
  if (!raw) return { ...IDLE };
  try {
    return JSON.parse(raw) as SessionAuditState;
  } catch {
    return { ...IDLE };
  }
}

async function save(state: SessionAuditState) {
  await redis.set(STATE_KEY, JSON.stringify(state), 'EX', 7 * 86400);
}

/** Starts a sweep in the background and returns how many accounts are queued. Refused while one runs. */
export async function startSessionAudit(log?: AuditLog): Promise<{ started: boolean; total: number }> {
  const lock = await redis.set(LOCK_KEY, '1', 'EX', LOCK_TTL_SECONDS, 'NX');
  if (!lock) {
    const state = await sessionAuditState();
    return { started: false, total: state.total };
  }
  const rows = await sql<{ id: string; session: string }[]>`
    SELECT id, telegram_mtproto_session AS session FROM users
    WHERE verified
      AND telegram_mtproto_session IS NOT NULL
      AND length(trim(telegram_mtproto_session)) > 0
      AND deleted_at IS NULL
      AND status NOT IN ('deleted', 'banned')
    ORDER BY created_at`;
  await save({ ...IDLE, running: true, total: rows.length, startedAt: new Date().toISOString() });
  void sweep(rows, log).catch(async (error) => {
    log?.error({ err: error }, 'session audit failed');
    await redis.del(LOCK_KEY);
    await save({ ...(await sessionAuditState()), running: false, finishedAt: new Date().toISOString() });
  });
  return { started: true, total: rows.length };
}

async function sweep(rows: { id: string; session: string }[], log?: AuditLog) {
  const state = await sessionAuditState();
  for (const row of rows) {
    const probe = await probeTelegramSession(row.session).catch((error) => {
      log?.warn({ userId: row.id, err: error }, 'session probe failed');
      return 'unknown' as const;
    });
    state.checked += 1;
    if (probe === 'expired') {
      state.expired += 1;
      // Exactly what un-verifying by hand does: the account verifies with Telegram again.
      await sql`
        UPDATE users
        SET verified = false, verified_at = null, verified_via_phone = false,
            verified_phone = null, telegram_mtproto_session = null, updated_at = now()
        WHERE id = ${row.id}`;
      await invalidateUser(row.id);
    } else if (probe === 'unknown') {
      state.unknown += 1;
    }
    await save(state);
    await new Promise((resolve) => setTimeout(resolve, PROBE_PAUSE_MS));
  }
  state.running = false;
  state.finishedAt = new Date().toISOString();
  await save(state);
  await redis.del(LOCK_KEY);
  log?.info({ total: state.total, expired: state.expired, unknown: state.unknown }, 'session audit finished');
}
