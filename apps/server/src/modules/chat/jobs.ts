import type { Logger } from 'pino';
import { sql } from '../../lib/db.js';
import { notify } from '../notifications/service.js';
import { getSettings } from '../settings/settings.js';

/**
 * Worker: matches where nobody has said hello.
 *  - After `nudgeHours` both sides get one reminder (a match that doesn't start soon goes cold).
 *  - After `archiveDays` it moves to the archive of each side's list; the first message, whenever
 *    it comes, brings it back. Nothing is deleted.
 */
export async function matchCare(log?: Logger) {
  const { matching } = await getSettings();

  if (matching.nudgeHours > 0) {
    // only matches that just crossed the line: a first deploy doesn't nudge every old match at once
    const rows = await sql<{ id: string; user_a: string; user_b: string; name_a: string | null; name_b: string | null }[]>`
      UPDATE matches m SET nudged_at = now()
      FROM users a, users b
      WHERE m.id IN (
          SELECT id FROM matches
          WHERE status = 'active' AND message_count = 0 AND nudged_at IS NULL
            AND created_at < now() - make_interval(hours => ${matching.nudgeHours})
            AND created_at > now() - make_interval(hours => ${matching.nudgeHours + 12})
          LIMIT 500)
        AND a.id = m.user_a AND b.id = m.user_b AND a.status = 'active' AND b.status = 'active'
        AND NOT a.shadow_banned AND NOT b.shadow_banned
      RETURNING m.id, m.user_a, m.user_b, a.name AS name_a, b.name AS name_b`;
    for (const m of rows) {
      for (const [me, peer, peerName] of [
        [m.user_a, m.user_b, m.name_b],
        [m.user_b, m.user_a, m.name_a],
      ] as const) {
        await notify(me, {
          type: 'chat_nudge',
          title: `هنوز به ${peerName ?? 'گفتگوی جدیدت'} جواب ندادی 👋`,
          body: 'یه سلام ساده کافیه. گفتگوهایی که زود شروع نشن سرد می‌شن!',
          data: { matchId: m.id, userId: peer, peerName },
        });
      }
    }
    if (rows.length) log?.info({ matches: rows.length }, 'silent matches nudged');
  }

  if (matching.archiveDays > 0) {
    const res = await sql`
      UPDATE match_members SET archived = true
      WHERE NOT archived AND match_id IN (
        SELECT id FROM matches
        WHERE status = 'active' AND message_count = 0 AND created_at < now() - make_interval(days => ${matching.archiveDays})
        LIMIT 2000)`;
    if (res.count) log?.info({ rows: res.count }, 'silent matches archived');
  }
}
