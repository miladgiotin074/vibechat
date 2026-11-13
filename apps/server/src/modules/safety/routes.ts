import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REPORT_REASON_IDS } from '../../data/catalog.js';
import { sql } from '../../lib/db.js';
import { badRequest } from '../../lib/errors.js';
import { uuidv7 } from '../../lib/ids.js';
import { normalizeText } from '../../lib/text.js';
import { parse, zUuid } from '../../lib/validate.js';
import { requireUser } from '../auth/guard.js';
import { forgetMembership, messageDto, type MessageRow } from '../chat/service.js';
import { publishToUser } from '../realtime/bus.js';
import { loadCards, viewerOf } from '../users/cards.js';
import { afterReport } from './service.js';

/** Blocking also ends any match between the two. */
async function block(me: string, other: string) {
  await sql`INSERT INTO blocks (blocker_id, blocked_id) VALUES (${me}, ${other}) ON CONFLICT DO NOTHING`;
  const [match] = await sql<{ match_id: string }[]>`
    SELECT mm.match_id FROM match_members mm WHERE mm.user_id = ${me} AND mm.peer_id = ${other}`;
  if (match) {
    await sql.begin(async (tx) => {
      await tx`UPDATE matches SET status = 'unmatched', unmatched_by = ${me}, unmatched_at = now()
               WHERE id = ${match.match_id} AND status = 'active'`;
      await tx`UPDATE match_members SET hidden = true WHERE match_id = ${match.match_id}`;
    });
    await forgetMembership(match.match_id, [me, other]);
    await publishToUser(other, { type: 'match.removed', data: { matchId: match.match_id } });
    await publishToUser(me, { type: 'match.removed', data: { matchId: match.match_id } });
  }
}

export async function safetyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/v1/blocks', async (req) => {
    const rows = await sql<{ blocked_id: string; created_at: Date }[]>`
      SELECT blocked_id, created_at FROM blocks WHERE blocker_id = ${req.user.id} ORDER BY created_at DESC LIMIT 500`;
    const cards = await loadCards(rows.map((r) => r.blocked_id), await viewerOf(req.user.id));
    return {
      items: cards.map((c) => ({ id: c.id, name: c.name, photo: c.photos[0]?.thumb ?? null })),
    };
  });

  app.post('/v1/blocks', async (req) => {
    const { userId } = parse(z.object({ userId: zUuid }), req.body);
    if (userId === req.user.id) throw badRequest();
    await block(req.user.id, userId);
    return { ok: true };
  });

  app.delete('/v1/blocks/:userId', async (req) => {
    const { userId } = parse(z.object({ userId: zUuid }), req.params);
    await sql`DELETE FROM blocks WHERE blocker_id = ${req.user.id} AND blocked_id = ${userId}`;
    return { ok: true };
  });

  /**
   * A report blocks the person too. If it is about a conversation, the last messages are copied
   * into the report so moderators can judge it without access to anyone's other chats.
   */
  app.post('/v1/reports', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const body = parse(
      z.object({
        userId: zUuid,
        reason: z.enum(REPORT_REASON_IDS),
        details: z.string().max(1000).transform(normalizeText).optional(),
        matchId: zUuid.optional(),
      }),
      req.body,
    );
    if (body.userId === req.user.id) throw badRequest();
    let context: unknown = null;
    if (body.matchId) {
      const [member] = await sql`
        SELECT 1 FROM match_members WHERE match_id = ${body.matchId} AND user_id = ${req.user.id} AND peer_id = ${body.userId}`;
      if (member) {
        const messages = await sql<MessageRow[]>`
          SELECT * FROM messages WHERE match_id = ${body.matchId} ORDER BY id DESC LIMIT 50`;
        context = { messages: messages.reverse().map(messageDto) };
      }
    }
    await sql`
      INSERT INTO reports (id, reporter_id, reported_id, reason, details, match_id, context)
      VALUES (${uuidv7()}, ${req.user.id}, ${body.userId}, ${body.reason}, ${body.details ?? null},
              ${body.matchId ?? null}, ${context ? sql.json(context as never) : null})
      ON CONFLICT (reporter_id, reported_id) WHERE status = 'open' DO NOTHING`;
    await afterReport(body.userId, req.user.id, body.reason);
    await block(req.user.id, body.userId);
    return { ok: true };
  });
}
