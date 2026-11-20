import type { BigInteger } from 'big-integer';
import { Api, TelegramClient } from 'teleproto';
import { sql } from '../../lib/db.js';
import { uuidv7 } from '../../lib/ids.js';
import { enqueueGroupInvite, enqueueGroupInvites } from '../../lib/queue.js';
import { redis } from '../../lib/redis.js';
import { createClient, loadMutualUsers, rpcCode, telegramCredentials } from './telegram.js';

const STALE_AFTER = sql`interval '3 minutes'`;
const LOCK_KEY = 'tg-invite:one-session';
const LOCK_TTL_MS = 90_000;

const STOP = new Set([
  'CHAT_ADMIN_REQUIRED',
  'CHAT_ADMIN_INVITE_REQUIRED',
  'CHANNEL_PRIVATE',
  'CHAT_WRITE_FORBIDDEN',
  'PEER_FLOOD',
  'INVITE_HASH_EXPIRED',
  'INVITE_HASH_INVALID',
  'INVITE_REQUEST_SENT',
  'CHANNELS_TOO_MUCH',
  'TARGET_NOT_GROUP',
  'CHANNEL_INVALID',
  'AUTH_KEY_UNREGISTERED',
]);

const SKIP = new Set([
  'USER_PRIVACY_RESTRICTED',
  'USER_NOT_MUTUAL_CONTACT',
  'USER_CHANNELS_TOO_MUCH',
  'USER_KICKED',
  'USER_BOT',
  'INPUT_USER_DEACTIVATED',
  'USER_DEACTIVATED',
  'USER_BLOCKED',
  'USER_ID_INVALID',
  'USER_BANNED_IN_CHANNEL',
  'CHAT_MEMBER_ADD_FAILED',
  'USER_ALREADY_PARTICIPANT',
  'USER_ALREADY_INVITED',
]);

const FA: Record<string, string> = {
  CHAT_ADMIN_REQUIRED: 'این اکانت در گروه ادمین نیست یا اجازهٔ افزودن عضو ندارد',
  CHAT_ADMIN_INVITE_REQUIRED: 'این اکانت اجازهٔ دعوت به گروه را ندارد',
  CHANNEL_PRIVATE: 'این اکانت به گروه دسترسی ندارد',
  CHAT_WRITE_FORBIDDEN: 'اکانت عضو گروه شد، ولی تلگرام هنوز اجازهٔ افزودن عضو نمی‌دهد',
  PEER_FLOOD: 'تلگرام دعوت از این اکانت را موقتاً محدود کرده است',
  INVITE_HASH_EXPIRED: 'لینک دعوت منقضی شده است',
  INVITE_HASH_INVALID: 'لینک دعوت معتبر نیست',
  INVITE_REQUEST_SENT: 'گروه تأیید عضویت می‌خواهد و این اکانت هنوز عضو نشده',
  CHANNELS_TOO_MUCH: 'این اکانت به سقف عضویت در کانال‌ها رسیده است',
  TARGET_NOT_GROUP: 'مقصد گروه یا کانال نیست',
  CHANNEL_INVALID: 'گروه پیدا نشد',
  AUTH_KEY_UNREGISTERED: 'نشست تلگرام دیگر معتبر نیست',
};

type Outcome = 'invited' | 'skipped' | 'failed';
type Row = { tgId: string; outcome: Outcome; detail?: string };
type Halt = { kind: 'flood'; seconds: number } | { kind: 'stop'; code: string };
type Target = { kind: 'channel'; channel: Api.InputChannel } | { kind: 'chat'; chatId: BigInteger };

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function floodWaitSeconds(error: unknown): number | null {
  if (error && typeof error === 'object' && 'seconds' in error) {
    const seconds = (error as { seconds?: unknown }).seconds;
    if (typeof seconds === 'number' && seconds > 0) return Math.min(Math.ceil(seconds), 3600);
  }
  const code = rpcCode(error) ?? '';
  const match = /FLOOD_WAIT[_ ](\d+)/i.exec(code) ?? /wait of (\d+) seconds/i.exec(code);
  return match ? Math.min(parseInt(match[1]!, 10), 3600) : null;
}

function isSessionDead(error: unknown) {
  return /AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|AUTH_KEY_UNREGISTERED/i.test(rpcCode(error) ?? '');
}

function explainRpc(code: string) {
  const key = code.split(':')[0]?.trim() || code;
  return (FA[key] ?? key).slice(0, 500);
}

function joinFailure(code: string) {
  const key = code.split(':')[0]?.trim() || code;
  if (key === 'CHAT_WRITE_FORBIDDEN') return 'تلگرام اجازهٔ عضو شدن این اکانت در گروه را نداد';
  return explainRpc(code);
}

function haltOf(error: unknown): Halt | null {
  const wait = floodWaitSeconds(error);
  if (wait != null) return { kind: 'flood', seconds: wait };
  if (isSessionDead(error)) return { kind: 'stop', code: 'AUTH_KEY_UNREGISTERED' };
  const code = (rpcCode(error) ?? '').trim();
  const key = code.replace(/\(.*\)/, '').trim();
  if (STOP.has(key) || STOP.has(code)) return { kind: 'stop', code: key || code };
  return null;
}

function inviteHash(target: string): string | null {
  const match = target.trim().match(/(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)([A-Za-z0-9_-]+)/i);
  return match?.[1] ?? null;
}

function normalizeRef(target: string) {
  const t = target.trim();
  if (/^https?:\/\//i.test(t) || t.includes('t.me/') || t.includes('telegram.me/')) {
    return t.replace(/^https?:\/\/(www\.)?/i, '').replace(/^(?:telegram\.me|t\.me)\//i, 't.me/');
  }
  return t.startsWith('@') ? t.slice(1) : t;
}

function toTarget(entity: unknown): Target {
  if (entity instanceof Api.Channel) {
    if (entity.accessHash == null) throw new Error('CHANNEL_INVALID');
    return { kind: 'channel', channel: new Api.InputChannel({ channelId: entity.id, accessHash: entity.accessHash }) };
  }
  if (entity instanceof Api.Chat) return { kind: 'chat', chatId: entity.id };
  throw new Error('TARGET_NOT_GROUP');
}

async function joinByHash(client: TelegramClient, hash: string) {
  try {
    await client.invoke(new Api.messages.ImportChatInvite({ hash }));
  } catch (error) {
    const code = rpcCode(error) ?? '';
    if (!code.includes('USER_ALREADY_PARTICIPANT')) throw error;
  }
}

async function joinChannel(client: TelegramClient, channel: Api.InputChannel) {
  try {
    await client.invoke(new Api.channels.JoinChannel({ channel }));
  } catch (error) {
    const code = rpcCode(error) ?? '';
    if (!code.includes('USER_ALREADY_PARTICIPANT')) throw error;
  }
}

/** Join first. A public username can be resolved without the account being a member, and inviting then fails. */
async function ensureMember(client: TelegramClient, raw: string): Promise<Target> {
  const ref = normalizeRef(raw);
  const hash = inviteHash(raw);
  if (hash) await joinByHash(client, hash);

  let entity = await client.getEntity(ref);
  if ((entity instanceof Api.ChannelForbidden || entity instanceof Api.ChatForbidden) && hash) {
    entity = await client.getEntity(ref);
  }
  if (entity instanceof Api.Channel) {
    if (entity.accessHash == null) throw new Error('CHANNEL_INVALID');
    await joinChannel(client, new Api.InputChannel({ channelId: entity.id, accessHash: entity.accessHash }));
    await sleep(1500);
    entity = await client.getEntity(ref);
  }
  if (entity instanceof Api.ChannelForbidden || entity instanceof Api.ChatForbidden) throw new Error('CHANNEL_PRIVATE');
  return toTarget(entity);
}

async function acquireLock(token: string) {
  return (await redis.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX')) === 'OK';
}

async function renewLock(token: string) {
  const kept = await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
    1,
    LOCK_KEY,
    token,
    String(LOCK_TTL_MS),
  );
  return kept === 1;
}

async function releaseLock(token: string) {
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    LOCK_KEY,
    token,
  );
}

async function stillRunning(runId: string, token: string) {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM tg_group_order_runs
    WHERE id = ${runId} AND claim = ${token} AND status = 'running'`;
  return !!row;
}

/** Wakes up often so «اکانت بعدی» stops a flood wait without sitting through it. */
async function sleepWhileRunning(ms: number, runId: string, token: string) {
  let left = ms;
  while (left > 0) {
    const slice = Math.min(left, 2_000);
    await sleep(slice);
    left -= slice;
    if (!(await stillRunning(runId, token))) return false;
  }
  return true;
}

async function waitFlood(seconds: number, runId: string, token: string) {
  let left = (Math.min(seconds, 3600) + 1) * 1000;
  while (left > 0) {
    const slice = Math.min(left, 20_000);
    if (!(await sleepWhileRunning(slice, runId, token))) return false;
    left -= slice;
    if (!(await touch(runId, token))) return false;
    if (!(await renewLock(token))) return false;
  }
  return true;
}

async function inviteOne(client: TelegramClient, target: Target, tgId: string, input: Api.InputUser): Promise<{ row?: Row; halt?: Halt }> {
  try {
    if (target.kind === 'chat') {
      await client.invoke(new Api.messages.AddChatUser({ chatId: target.chatId, userId: input, fwdLimit: 0 }));
      return { row: { tgId, outcome: 'invited' } };
    }
    const result = await client.invoke(new Api.channels.InviteToChannel({ channel: target.channel, users: [input] }));
    const missing = result instanceof Api.messages.InvitedUsers ? (result.missingInvitees ?? []) : [];
    if (missing.some((m) => m.userId.toString() === tgId)) return { row: { tgId, outcome: 'skipped', detail: 'MISSING' } };
    return { row: { tgId, outcome: 'invited' } };
  } catch (error) {
    const halt = haltOf(error);
    if (halt) return { halt };
    const code = (rpcCode(error) ?? 'UNKNOWN').slice(0, 200);
    const key = code.replace(/\(.*\)/, '').trim();
    return { row: { tgId, outcome: SKIP.has(key) ? 'skipped' : 'failed', detail: code } };
  }
}

async function inviteUsers(
  client: TelegramClient,
  target: Target,
  users: Api.User[],
): Promise<{ rows: Row[]; halt?: Halt; left: Api.User[] }> {
  const rows: Row[] = [];
  const left: Api.User[] = [];
  const ready: { user: Api.User; tgId: string; input: Api.InputUser }[] = [];
  for (const user of users) {
    const tgId = user.id.toString();
    if (user.accessHash == null) {
      rows.push({ tgId, outcome: 'failed', detail: 'NO_ACCESS_HASH' });
      continue;
    }
    ready.push({ user, tgId, input: new Api.InputUser({ userId: user.id, accessHash: user.accessHash }) });
  }
  if (!ready.length) return { rows, left };

  const oneByOne = async (list: typeof ready) => {
    for (let i = 0; i < list.length; i++) {
      const one = list[i]!;
      const step = await inviteOne(client, target, one.tgId, one.input);
      if (step.halt) {
        left.push(...list.slice(i).map((item) => item.user));
        return step.halt;
      }
      if (step.row) rows.push(step.row);
    }
    return undefined;
  };

  if (target.kind === 'chat' || ready.length === 1) {
    const halt = await oneByOne(ready);
    return { rows, halt, left };
  }

  try {
    const result = await client.invoke(
      new Api.channels.InviteToChannel({ channel: target.channel, users: ready.map((r) => r.input) }),
    );
    const missing = new Set(
      (result instanceof Api.messages.InvitedUsers ? (result.missingInvitees ?? []) : []).map((m) => m.userId.toString()),
    );
    for (const one of ready) {
      rows.push(missing.has(one.tgId) ? { tgId: one.tgId, outcome: 'skipped', detail: 'MISSING' } : { tgId: one.tgId, outcome: 'invited' });
    }
    return { rows, left };
  } catch (error) {
    const halt = haltOf(error);
    if (halt) {
      left.push(...ready.map((item) => item.user));
      return { rows, halt, left };
    }
    const fallback = await oneByOne(ready);
    return { rows, halt: fallback, left };
  }
}

async function recordInvites(orderId: string, userId: string, rows: Row[]) {
  if (!rows.length) return;
  await sql`
    INSERT INTO tg_group_order_invites ${sql(
      rows.map((r) => ({
        order_id: orderId,
        user_id: userId,
        tg_id: r.tgId,
        outcome: r.outcome,
        detail: r.detail ?? null,
      })),
      'order_id',
      'user_id',
      'tg_id',
      'outcome',
      'detail',
    )}
    ON CONFLICT (order_id, user_id, tg_id) DO NOTHING`;
}

async function touch(runId: string, token: string, mutualTotal?: number) {
  const [row] = await sql<{ id: string }[]>`
    UPDATE tg_group_order_runs r
    SET heartbeat = now(),
        mutual_total = coalesce(${mutualTotal ?? null}, r.mutual_total),
        invited = (SELECT count(*)::int FROM tg_group_order_invites i WHERE i.order_id = r.order_id AND i.user_id = r.user_id AND i.outcome = 'invited'),
        skipped = (SELECT count(*)::int FROM tg_group_order_invites i WHERE i.order_id = r.order_id AND i.user_id = r.user_id AND i.outcome = 'skipped'),
        failed = (SELECT count(*)::int FROM tg_group_order_invites i WHERE i.order_id = r.order_id AND i.user_id = r.user_id AND i.outcome = 'failed')
    WHERE r.id = ${runId} AND r.claim = ${token}
    RETURNING r.id`;
  return !!row;
}

async function settle(runId: string, token: string, status: 'done' | 'failed' | 'skipped', error: string | null) {
  await sql`
    UPDATE tg_group_order_runs
    SET status = ${status}, error = ${error}, finished_at = now(), claim = null, heartbeat = now()
    WHERE id = ${runId} AND claim = ${token}`;
}

async function saveSession(client: TelegramClient, userId: string, previous: string) {
  try {
    const saved = String(client.session.save() ?? '');
    if (saved && saved !== previous) {
      await sql`UPDATE users SET telegram_mtproto_session = ${saved} WHERE id = ${userId}`;
    }
  } catch {
    /* Session string is an optimization; the run result is already stored. */
  }
}

/** One account, start to finish. The next session connects only after this one disconnects. */
export async function processGroupInviteRun(runId: string): Promise<void> {
  const token = uuidv7();
  if (!(await acquireLock(token))) {
    const [row] = await sql<{ status: string }[]>`SELECT status FROM tg_group_order_runs WHERE id = ${runId}`;
    if (row && (row.status === 'queued' || row.status === 'running')) await enqueueGroupInvite(runId, 15_000);
    return;
  }
  try {
    await runOneAccount(runId, token);
  } finally {
    await releaseLock(token);
  }
}

async function runOneAccount(runId: string, token: string): Promise<void> {
  try {
    const [run] = await sql<{ id: string; order_id: string; user_id: string }[]>`
      UPDATE tg_group_order_runs
      SET status = 'running', claim = ${token}, heartbeat = now(),
          started_at = coalesce(started_at, now()), error = null
      WHERE id = ${runId}
        AND (
          status = 'queued'
          OR (status = 'running' AND (heartbeat IS NULL OR heartbeat < now() - ${STALE_AFTER}))
        )
      RETURNING id, order_id, user_id`;
    if (!run) return;

    const [order] = await sql<{ group_target: string; status: string }[]>`
      SELECT group_target, status FROM tg_group_orders WHERE id = ${run.order_id}`;
    if (!order || order.status !== 'active') {
      await sql`
        UPDATE tg_group_order_runs
        SET status = 'queued', claim = null, error = ${order ? 'سفارش متوقف است' : 'سفارش پیدا نشد'}
        WHERE id = ${runId} AND claim = ${token}`;
      return;
    }

    const [user] = await sql<{ telegram_mtproto_session: string | null }[]>`
      SELECT telegram_mtproto_session FROM users
      WHERE id = ${run.user_id} AND deleted_at IS NULL AND status NOT IN ('deleted', 'banned')`;
    const session = user?.telegram_mtproto_session?.trim() ?? '';
    if (!session) {
      await settle(runId, token, 'skipped', 'نشست تلگرام ندارد');
      return;
    }
    const creds = telegramCredentials();
    if (!creds) {
      await settle(runId, token, 'failed', 'TELEGRAM_API_ID و TELEGRAM_API_HASH روی سرور تنظیم نشده');
      return;
    }

    const client = createClient(session, creds.apiId, creds.apiHash, 'fa');
    try {
      await client.connect();
      for (let pass = 0; pass < 3; pass++) {
      try {
      const me = await client.getMe();
      const book = await loadMutualUsers(client);
      if (!(await touch(runId, token, book.mutualUsers.length))) return;

      const done = await sql<{ tg_id: string }[]>`
        SELECT tg_id::text AS tg_id FROM tg_group_order_invites
        WHERE order_id = ${run.order_id} AND user_id = ${run.user_id}`;
      const seen = new Set(done.map((row) => row.tg_id));
      const meId = me.id.toString();
      const pending = book.mutualUsers.filter((u) => {
        const id = u.id.toString();
        return id !== meId && !seen.has(id);
      });

      let target: Target;
      try {
        target = await ensureMember(client, order.group_target);
      } catch (error) {
        const halt = haltOf(error);
        if (halt?.kind === 'flood') {
          if (!(await waitFlood(halt.seconds, runId, token))) return;
          try {
            target = await ensureMember(client, order.group_target);
          } catch (again) {
            const code = rpcCode(again) ?? (again instanceof Error ? again.message : 'UNKNOWN');
            await settle(runId, token, 'failed', joinFailure(code));
            return;
          }
        } else {
          const code = halt?.kind === 'stop' ? halt.code : (rpcCode(error) ?? (error instanceof Error ? error.message : 'UNKNOWN'));
          await settle(runId, token, 'failed', joinFailure(code));
          return;
        }
      }

      if (!pending.length) {
        await settle(runId, token, 'done', null);
        return;
      }

      while (pending.length) {
        const [live] = await sql<{ status: string; delay_ms: number; batch_size: number }[]>`
          SELECT status, delay_ms, batch_size FROM tg_group_orders WHERE id = ${run.order_id}`;
        if (!live || live.status !== 'active') {
          await sql`
            UPDATE tg_group_order_runs
            SET status = 'queued', claim = null, heartbeat = now(), error = 'سفارش متوقف است'
            WHERE id = ${runId} AND claim = ${token}`;
          return;
        }
        const batchSize = Math.min(Math.max(live.batch_size, 1), 50);
        const delayMs = Math.min(Math.max(live.delay_ms, 500), 120_000);
        const step = await inviteUsers(client, target, pending.splice(0, batchSize));
        await recordInvites(run.order_id, run.user_id, step.rows);
        if (!(await touch(runId, token)) || !(await renewLock(token))) return;
        if (step.halt?.kind === 'flood') {
          pending.unshift(...step.left);
          if (!(await waitFlood(step.halt.seconds, runId, token))) return;
          continue;
        }
        if (step.halt?.kind === 'stop') {
          await settle(runId, token, 'failed', explainRpc(step.halt.code));
          return;
        }
        if (!pending.length) {
          await settle(runId, token, 'done', null);
          return;
        }
        if (!(await sleepWhileRunning(delayMs, runId, token))) return;
      }
      } catch (error) {
        const halt = haltOf(error);
        if (halt?.kind === 'flood' && pass < 2) {
          if (!(await waitFlood(halt.seconds, runId, token))) return;
          continue;
        }
        if (halt?.kind === 'flood') {
          await settle(runId, token, 'failed', 'محدودیت تلگرام تمام شد؛ این اکانت را دوباره در صف بگذارید');
          return;
        }
        if (halt?.kind === 'stop') {
          await settle(runId, token, 'failed', explainRpc(halt.code));
          return;
        }
        throw error;
      }
      }
    } finally {
      await saveSession(client, run.user_id, session);
      try {
        await client.disconnect();
      } catch {
        /* Dead socket. */
      }
    }
  } catch (error) {
    const code = rpcCode(error) ?? (error instanceof Error ? error.message : 'UNKNOWN');
    await sql`
      UPDATE tg_group_order_runs
      SET status = 'failed', error = ${explainRpc(code)}, finished_at = now(), claim = null
      WHERE id = ${runId} AND claim = ${token} AND status = 'running'`;
  }
}

const withSession = sql`
  telegram_mtproto_session IS NOT NULL
  AND length(trim(telegram_mtproto_session)) > 0
  AND deleted_at IS NULL
  AND status NOT IN ('deleted', 'banned')`;

export async function scheduleOrderRunsForUser(userId: string) {
  const orders = await sql<{ id: string }[]>`SELECT id FROM tg_group_orders WHERE status = 'active'`;
  const ids: string[] = [];
  for (const order of orders) {
    const id = uuidv7();
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO tg_group_order_runs (id, order_id, user_id, status)
      VALUES (${id}, ${order.id}, ${userId}, 'queued')
      ON CONFLICT (order_id, user_id) DO UPDATE
        SET status = 'queued', error = NULL, finished_at = NULL, claim = NULL, not_before = NULL, heartbeat = now()
        WHERE tg_group_order_runs.status IN ('failed', 'skipped')
      RETURNING id`;
    if (row) ids.push(row.id);
  }
  await enqueueGroupInvites(ids);
}

/** New sessions, plus failed/skipped runs. Finished runs stay finished so people are not invited again. */
export async function enqueueRunsForOrder(orderId: string) {
  await sql`
    UPDATE tg_group_order_runs
    SET status = 'queued', claim = null, not_before = null, heartbeat = now()
    WHERE order_id = ${orderId}
      AND status = 'running'
      AND (heartbeat IS NULL OR heartbeat < now() - ${STALE_AFTER})`;

  const users = await sql<{ id: string }[]>`SELECT id FROM users WHERE ${withSession}`;
  for (let i = 0; i < users.length; i += 400) {
    const chunk = users.slice(i, i + 400).map((user) => ({
      id: uuidv7(),
      order_id: orderId,
      user_id: user.id,
      status: 'queued',
    }));
    await sql`
      INSERT INTO tg_group_order_runs ${sql(chunk, 'id', 'order_id', 'user_id', 'status')}
      ON CONFLICT (order_id, user_id) DO UPDATE
        SET status = 'queued', error = NULL, finished_at = NULL, claim = NULL, not_before = NULL, heartbeat = now()
        WHERE tg_group_order_runs.status IN ('failed', 'skipped')`;
  }

  const queued = await sql<{ id: string }[]>`
    SELECT id FROM tg_group_order_runs
    WHERE order_id = ${orderId} AND status = 'queued'
      AND (not_before IS NULL OR not_before <= now())`;
  await enqueueGroupInvites(queued.map((row) => row.id));
  return queued.length;
}

export async function retryGroupInviteRun(runId: string) {
  const [run] = await sql<{ id: string; order_id: string; user_id: string; status: string }[]>`
    SELECT id, order_id, user_id, status FROM tg_group_order_runs WHERE id = ${runId}`;
  if (!run || run.status === 'running') return false;
  await sql`
    DELETE FROM tg_group_order_invites
    WHERE order_id = ${run.order_id} AND user_id = ${run.user_id} AND outcome = 'failed'`;
  const [row] = await sql<{ id: string }[]>`
    UPDATE tg_group_order_runs
    SET status = 'queued', error = NULL, finished_at = NULL, claim = NULL, not_before = NULL, heartbeat = now()
    WHERE id = ${runId} AND status <> 'running'
    RETURNING id`;
  if (!row) return false;
  await enqueueGroupInvite(runId);
  return true;
}

const PASSED_NOTE = 'به درخواست شما این اکانت رها شد تا نوبت به اکانت بعدی برسد';

/** Drop the account that is logged in now. Its invites stay saved. The next queued account is started. */
export async function passToNextAccount(orderId: string) {
  const passed = await sql<{ id: string }[]>`
    UPDATE tg_group_order_runs
    SET status = 'passed', error = ${PASSED_NOTE}, claim = null, finished_at = now(), heartbeat = now()
    WHERE order_id = ${orderId} AND status = 'running'
    RETURNING id`;
  const [next] = await sql<{ id: string }[]>`
    SELECT id FROM tg_group_order_runs
    WHERE order_id = ${orderId} AND status = 'queued'
      AND (not_before IS NULL OR not_before <= now())
    ORDER BY created_at
    LIMIT 1`;
  if (next) await enqueueGroupInvite(next.id, 1_000);
  return { passed: passed.length, nextId: next?.id ?? null };
}

/** A crashed slice leaves the run «running». After three quiet minutes, queue it again. */
export async function requeueStaleInviteRuns() {
  const rows = await sql<{ id: string }[]>`
    UPDATE tg_group_order_runs r
    SET status = 'queued', claim = null, not_before = null, heartbeat = now()
    FROM tg_group_orders o
    WHERE r.order_id = o.id
      AND o.status = 'active'
      AND r.status = 'running'
      AND (r.heartbeat IS NULL OR r.heartbeat < now() - ${STALE_AFTER})
    RETURNING r.id`;
  await enqueueGroupInvites(rows.map((row) => row.id));
  return rows.length;
}
