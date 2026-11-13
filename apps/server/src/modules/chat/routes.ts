import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { badRequest, conflict, forbidden } from '../../lib/errors.js';
import { randomToken } from '../../lib/ids.js';
import { processPhoto } from '../../lib/images.js';
import { putObject } from '../../lib/storage.js';
import { maskBannedWords, normalizeText, preview } from '../../lib/text.js';
import { parse, zId, zLimit, zUuid } from '../../lib/validate.js';
import { requireActive } from '../auth/guard.js';
import { pushNewMessage } from '../bot/push.js';
import { isOnline, publishToUser } from '../realtime/bus.js';
import { getSettings } from '../settings/settings.js';
import { bumpDailyCounter } from '../users/activity.js';
import { forgetMembership, getConversation, listConversations, membership, messageDto, type MessageRow } from './service.js';

const MAX_TEXT = 2000;

export async function insertMessage(
  matchId: string,
  senderId: string,
  peerId: string,
  msg: { kind: 'text' | 'image'; body: string | null; media: MessageRow['media']; replyTo: string | null; clientId: string },
  /** ghost: the sender is shadow-banned — the message is kept for them and shown to nobody else */
  opts: { ghost?: boolean } = {},
) {
  const previewText = msg.kind === 'image' ? '📷 عکس' : preview(msg.body ?? '');
  if (opts.ghost) {
    const [inserted] = await sql<MessageRow[]>`
      INSERT INTO messages (match_id, sender_id, kind, body, media, reply_to, client_id, ghost)
      VALUES (${matchId}, ${senderId}, ${msg.kind}, ${msg.body}, ${msg.media ? sql.json(msg.media as never) : null},
              ${msg.replyTo}, ${msg.clientId}, true)
      ON CONFLICT (match_id, sender_id, client_id) WHERE client_id IS NOT NULL DO NOTHING
      RETURNING *`;
    const [row] = inserted
      ? [inserted]
      : await sql<MessageRow[]>`SELECT * FROM messages WHERE match_id = ${matchId} AND sender_id = ${senderId} AND client_id = ${msg.clientId}`;
    const ghostDto = messageDto(row!);
    await publishToUser(senderId, { type: 'message.new', data: ghostDto });
    return ghostDto;
  }
  let messageCount = 0;
  const row = await sql.begin(async (tx) => {
    const [inserted] = await tx<MessageRow[]>`
      INSERT INTO messages (match_id, sender_id, kind, body, media, reply_to, client_id)
      VALUES (${matchId}, ${senderId}, ${msg.kind}, ${msg.body}, ${msg.media ? tx.json(msg.media as never) : null},
              ${msg.replyTo}, ${msg.clientId})
      ON CONFLICT (match_id, sender_id, client_id) WHERE client_id IS NOT NULL DO NOTHING
      RETURNING *`;
    if (!inserted) return null; // a retry of a message we already have
    const [m] = await tx<{ message_count: number }[]>`
      UPDATE matches SET last_message_id = ${inserted.id}, last_message_at = ${inserted.created_at},
        last_message_preview = ${previewText}, last_message_kind = ${msg.kind}, last_sender_id = ${senderId},
        message_count = message_count + 1
      WHERE id = ${matchId} RETURNING message_count`;
    messageCount = m?.message_count ?? 0;
    await tx`
      UPDATE match_members SET
        sort_at = ${inserted.created_at},
        hidden = false,
        archived = false,
        unread_count = CASE WHEN user_id = ${peerId} THEN unread_count + 1 ELSE unread_count END,
        last_read_id = CASE WHEN user_id = ${senderId} THEN ${inserted.id}::bigint ELSE last_read_id END
      WHERE match_id = ${matchId}`;
    return inserted;
  });
  if (!row) {
    const [existing] = await sql<MessageRow[]>`
      SELECT * FROM messages WHERE match_id = ${matchId} AND sender_id = ${senderId} AND client_id = ${msg.clientId}`;
    return messageDto(existing!);
  }
  // Early in a conversation: note who opened it and who answered (how reliably someone replies
  // is part of how discovery ranks them).
  if (messageCount > 0 && messageCount <= 20) {
    const [c] = await sql<{ mine: number; theirs: number }[]>`
      SELECT count(*) FILTER (WHERE sender_id = ${senderId})::int AS mine,
             count(*) FILTER (WHERE sender_id = ${peerId})::int AS theirs
      FROM (SELECT sender_id FROM messages WHERE match_id = ${matchId} AND NOT ghost ORDER BY id LIMIT 25) t`;
    if (c?.mine === 1) {
      if (c.theirs > 0) await sql`UPDATE users SET replies_given = replies_given + 1 WHERE id = ${senderId}`;
      else await sql`UPDATE users SET openers_received = openers_received + 1 WHERE id = ${peerId}`;
    }
  }
  const dto = messageDto(row);
  await Promise.all([
    publishToUser(peerId, { type: 'message.new', data: dto }),
    publishToUser(senderId, { type: 'message.new', data: dto }),
    bumpDailyCounter('messages'),
  ]);
  // Telegram push for an offline receiver (throttled per conversation in pushNewMessage).
  if (!(await isOnline(peerId))) {
    const [sender] = await sql<{ name: string | null }[]>`SELECT name FROM users WHERE id = ${senderId}`;
    pushNewMessage(peerId, matchId, sender?.name ?? 'یک نفر', previewText).catch(() => undefined);
  }
  return dto;
}

/**
 * Until the other person has answered at least once, only a few messages in a row are allowed:
 * a match is an invitation to talk, not a licence to flood someone who hasn't replied.
 */
async function assertMaySend(matchId: string, me: string, peerId: string, max: number) {
  if (max <= 0) return;
  const [c] = await sql<{ mine: number; theirs: number }[]>`
    SELECT count(*) FILTER (WHERE sender_id = ${me})::int AS mine,
           count(*) FILTER (WHERE sender_id = ${peerId})::int AS theirs
    FROM (SELECT sender_id FROM messages WHERE match_id = ${matchId} AND NOT ghost ORDER BY id LIMIT ${max + 10}) t`;
  if (c && c.theirs === 0 && c.mine >= max) {
    throw conflict(`تا جواب نده، بیشتر از ${max.toLocaleString('fa-IR')} پیام نمی‌تونی بفرستی. کمی صبر کن 🙂`, 'wait_for_reply');
  }
}

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireActive);

  app.get('/v1/conversations', async (req) => {
    const q = parse(
      z.object({ before: z.string().datetime().optional(), limit: zLimit(50, 30), archived: z.enum(['1', 'true']).optional() }),
      req.query,
    );
    return listConversations(req.user.id, q.before ?? null, q.limit, !!q.archived);
  });

  app.get('/v1/conversations/:id', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return getConversation(req.user.id, id);
  });

  /** Newest first; pass the smallest id you have as `before` to page back. */
  app.get('/v1/conversations/:id/messages', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const q = parse(z.object({ before: zId.optional(), after: zId.optional(), limit: zLimit(100, 40) }), req.query);
    await membership(id, req.user.id);
    const rows = await sql<MessageRow[]>`
      SELECT * FROM messages
      WHERE match_id = ${id} AND (NOT ghost OR sender_id = ${req.user.id})
        ${q.before ? sql`AND id < ${q.before}` : sql``}
        ${q.after ? sql`AND id > ${q.after}` : sql``}
      ORDER BY id DESC
      LIMIT ${q.limit}`;
    return { items: rows.map(messageDto), hasMore: rows.length === q.limit };
  });

  app.post('/v1/conversations/:id/messages', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(
      z.object({
        text: z.string().min(1).max(MAX_TEXT),
        clientId: z.string().min(8).max(64),
        replyTo: zId.optional(),
      }),
      req.body,
    );
    const m = await membership(id, req.user.id);
    if (!m.active) throw forbidden('این گفتگو بسته شده است', 'match_closed');
    const settings = await getSettings();
    const text = maskBannedWords(normalizeText(body.text), settings.bannedWords);
    if (!text) throw badRequest('پیام خالی است');
    await assertMaySend(id, req.user.id, m.peerId, settings.matching.maxUnanswered);
    return insertMessage(
      id,
      req.user.id,
      m.peerId,
      { kind: 'text', body: text, media: null, replyTo: body.replyTo ?? null, clientId: body.clientId },
      { ghost: req.user.shadow },
    );
  });

  /** Photo message (multipart: `photo` file + `clientId` field). Receivers see it blurred until they tap. */
  app.post('/v1/conversations/:id/photos', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const m = await membership(id, req.user.id);
    if (!m.active) throw forbidden('این گفتگو بسته شده است', 'match_closed');
    const settings = await getSettings();
    if (!settings.chatMediaEnabled) throw forbidden('ارسال عکس در گفتگو فعلاً غیرفعال است', 'media_disabled');
    if (settings.chatMediaMinMessages > 0) {
      const counts = await sql<{ sender_id: string; n: number }[]>`
        SELECT sender_id, count(*)::int AS n FROM (
          SELECT sender_id FROM messages WHERE match_id = ${id} AND kind = 'text' AND NOT ghost LIMIT 200
        ) t GROUP BY sender_id`;
      const enough = [req.user.id, m.peerId].every(
        (u) => (counts.find((c) => c.sender_id === u)?.n ?? 0) >= settings.chatMediaMinMessages,
      );
      if (!enough) throw conflict('برای ارسال عکس، اول کمی با هم گفتگو کنید 🙂', 'media_too_early');
    }
    const file = await req.file();
    if (!file || file.fieldname !== 'photo') throw badRequest('فایل ارسال نشده است');
    const clientIdField = file.fields.clientId as { value?: unknown } | undefined;
    const clientId = typeof clientIdField?.value === 'string' ? clientIdField.value : randomToken(12);
    const image = await processPhoto(await file.toBuffer());
    const key = `chat/${id}/${randomToken(16)}`;
    const blurKey = `chat/x/${randomToken(16)}.webp`;
    await Promise.all([
      ...image.variants.filter((v) => v.name !== 'md').map((v) => putObject(`${key}/${v.name}.webp`, v.body, 'image/webp')),
      putObject(blurKey, image.blur, 'image/webp'),
    ]);
    return insertMessage(
      id,
      req.user.id,
      m.peerId,
      { kind: 'image', body: null, media: { key, blurKey, width: image.width, height: image.height, color: image.color }, replyTo: null, clientId },
      { ghost: req.user.shadow },
    );
  });

  app.post('/v1/conversations/:id/read', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { upTo } = parse(z.object({ upTo: zId }), req.body);
    const m = await membership(id, req.user.id);
    const [row] = await sql<{ last_read_id: string }[]>`
      UPDATE match_members
      SET last_read_id = GREATEST(last_read_id, ${upTo}::bigint),
          unread_count = (SELECT count(*) FROM messages
                          WHERE match_id = ${id} AND sender_id = ${m.peerId} AND NOT ghost AND id > GREATEST(last_read_id, ${upTo}::bigint))
      WHERE match_id = ${id} AND user_id = ${req.user.id}
      RETURNING last_read_id`;
    await publishToUser(m.peerId, { type: 'message.read', data: { matchId: id, userId: req.user.id, upTo: row!.last_read_id } });
    return { ok: true, lastReadId: row!.last_read_id };
  });

  app.post('/v1/conversations/:id/mute', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { muted } = parse(z.object({ muted: z.boolean() }), req.body);
    await sql`UPDATE match_members SET muted = ${muted} WHERE match_id = ${id} AND user_id = ${req.user.id}`;
    return { ok: true };
  });

  /** Unmatch: the conversation disappears for both; they never see each other in discovery again. */
  app.delete('/v1/conversations/:id', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const m = await membership(id, req.user.id);
    await sql.begin(async (tx) => {
      await tx`UPDATE matches SET status = 'unmatched', unmatched_by = ${req.user.id}, unmatched_at = now()
               WHERE id = ${id} AND status = 'active'`;
      await tx`UPDATE match_members SET hidden = true WHERE match_id = ${id}`;
    });
    await forgetMembership(id, [req.user.id, m.peerId]);
    await publishToUser(m.peerId, { type: 'match.removed', data: { matchId: id } });
    await publishToUser(req.user.id, { type: 'match.removed', data: { matchId: id } });
    return { ok: true };
  });
}
