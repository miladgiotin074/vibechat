import type { Logger } from 'pino';
import { sql } from '../../lib/db.js';
import { notify } from '../notifications/service.js';
import { getSettings } from '../settings/settings.js';

/**
 * Worker: conversations where one person wrote and the other never answered.
 *  - After `nudgeHours` the silent side gets one reminder (a conversation that doesn't start soon
 *    goes cold).
 *  - After `archiveDays` it moves to the archive of both sides' lists; an answer, whenever it
 *    comes, brings it back. Nothing is deleted.
 */
export async function matchCare(log?: Logger) {
  const { matching } = await getSettings();

  /** Nobody has answered yet: every message in it came from the same person. */
  const unanswered = sql`
    m.last_sender_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.match_id = m.id AND x.sender_id <> m.last_sender_id)`;

  if (matching.nudgeHours > 0) {
    // only conversations that just crossed the line: a first deploy doesn't nudge every old one at once
    const rows = await sql<{ id: string; waiting: string; writer: string; writer_name: string | null }[]>`
      UPDATE matches mm SET nudged_at = now()
      FROM (
        SELECT m.id,
               CASE WHEN m.last_sender_id = m.user_a THEN m.user_b ELSE m.user_a END AS waiting,
               m.last_sender_id AS writer
        FROM matches m
        WHERE m.status = 'active' AND m.nudged_at IS NULL AND ${unanswered}
          AND m.created_at < now() - make_interval(hours => ${matching.nudgeHours})
          AND m.created_at > now() - make_interval(hours => ${matching.nudgeHours + 12})
        LIMIT 500) pick
      JOIN users w ON w.id = pick.writer
      JOIN users s ON s.id = pick.waiting
      WHERE mm.id = pick.id
        AND w.status = 'active' AND s.status = 'active' AND NOT w.shadow_banned AND NOT s.shadow_banned
      RETURNING pick.id, pick.waiting, pick.writer, w.name AS writer_name`;
    for (const r of rows) {
      await notify(r.waiting, {
        type: 'chat_nudge',
        title: `هنوز به ${r.writer_name ?? 'پیام تازه‌ات'} جواب ندادی 👋`,
        body: 'یه سلام ساده کافیه. گفتگوهایی که زود شروع نشن سرد می‌شن!',
        data: { matchId: r.id, userId: r.writer, peerName: r.writer_name },
      });
    }
    if (rows.length) log?.info({ chats: rows.length }, 'unanswered chats nudged');
  }

  if (matching.archiveDays > 0) {
    const res = await sql`
      UPDATE match_members SET archived = true
      WHERE NOT archived AND match_id IN (
        SELECT m.id FROM matches m
        WHERE m.status = 'active' AND ${unanswered} AND m.created_at < now() - make_interval(days => ${matching.archiveDays})
        LIMIT 2000)`;
    if (res.count) log?.info({ rows: res.count }, 'unanswered chats archived');
  }
}
