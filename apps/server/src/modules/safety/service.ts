import { sql } from '../../lib/db.js';
import { invalidateUser } from '../auth/guard.js';
import { notify } from '../notifications/service.js';
import { refreshPhotoCount } from '../profile/service.js';
import { getSettings } from '../settings/settings.js';

/**
 * Trust (0–100, starts at 50) says how much the app can rely on an account:
 *   + account age (up to 30 days), + 👍 from random-chat partners,
 *   − 👎 from random-chat partners (twice the weight), − reports from different people (30 days).
 * It moves people up or down in discovery; a moderator's decision (dismissing a report) counts.
 */
export async function recomputeTrust(ids: string[]) {
  if (!ids.length) return;
  await sql`
    UPDATE users u SET trust = greatest(0, least(100, round(
        50
      + least(extract(epoch FROM now() - coalesce(u.activated_at, u.created_at)) / 86400.0, 30) / 3.0
      + greatest(-15, least(10, u.rc_up - 2 * u.rc_down))
      - least(40, 8 * (
          SELECT count(DISTINCT r.reporter_id) FROM reports r
          WHERE r.reported_id = u.id AND r.status <> 'dismissed' AND r.created_at > now() - interval '30 days'))
    )))::smallint
    WHERE u.id = ANY(${ids}::uuid[])`;
}

/** Worker (hourly): keeps the age part of trust moving for people who are around. */
export async function trustSweep() {
  let after = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE id > ${after} AND status = 'active' AND last_active_at > now() - interval '3 hours'
      ORDER BY id LIMIT 1000`;
    if (!rows.length) break;
    after = rows[rows.length - 1]!.id;
    await recomputeTrust(rows.map((r) => r.id));
  }
}

/** Reports that are about how a profile looks (its photos), not how its owner behaves. */
const PHOTO_REASONS = ['fake_profile', 'inappropriate_photos'];

/**
 * Called after a report is stored. Reports from several different people in one day act before a
 * moderator gets to it: the photos are hidden (photo reports), or the account is shadow-banned —
 * it keeps working for its owner, but nothing it does reaches anyone — until a moderator decides.
 * Reports sent by shadow-banned accounts are kept but trigger nothing.
 */
export async function afterReport(reportedId: string, reporterId: string, reason: string) {
  const [reporter] = await sql<{ shadow_banned: boolean }[]>`SELECT shadow_banned FROM users WHERE id = ${reporterId}`;
  if (reporter?.shadow_banned) return;
  const settings = await getSettings();
  const [c] = await sql<{ people: number; photo_people: number }[]>`
    SELECT count(DISTINCT r.reporter_id)::int AS people,
           count(DISTINCT r.reporter_id) FILTER (WHERE r.reason = ANY(${PHOTO_REASONS}))::int AS photo_people
    FROM reports r JOIN users ru ON ru.id = r.reporter_id AND NOT ru.shadow_banned
    WHERE r.reported_id = ${reportedId} AND r.status <> 'dismissed' AND r.created_at > now() - interval '24 hours'`;

  if (PHOTO_REASONS.includes(reason)) {
    // straight to the top of the moderators' photo queue…
    await sql`UPDATE photos SET flagged = true WHERE user_id = ${reportedId} AND status = 'approved' AND reviewed_at IS NULL`;
    // …and out of sight when more than one person says so (photos a moderator already approved stay)
    const limit = settings.safety.photoReportsToHide;
    if (limit > 0 && (c?.photo_people ?? 0) >= limit) {
      const hidden = await sql`
        UPDATE photos SET status = 'pending' WHERE user_id = ${reportedId} AND status = 'approved' AND reviewed_at IS NULL RETURNING 1`;
      if (hidden.length) {
        await refreshPhotoCount(reportedId);
        await invalidateUser(reportedId);
        await notify(reportedId, {
          type: 'photo',
          title: 'عکس‌هایت موقتاً نمایش داده نمی‌شوند',
          body: 'چند کاربر عکس‌های پروفایلت را گزارش کرده‌اند. تا بررسی ناظر، پروفایلت در کشف دیده نمی‌شود.',
        });
      }
    }
  }

  const shadowAt = settings.safety.autoShadowReports;
  if (shadowAt > 0 && (c?.people ?? 0) >= shadowAt) {
    const banned = await sql`
      UPDATE users SET shadow_banned = true, shadow_auto = true, shadow_at = now()
      WHERE id = ${reportedId} AND NOT shadow_banned AND status = 'active' RETURNING 1`;
    if (banned.length) await invalidateUser(reportedId);
  }
  await recomputeTrust([reportedId]);
}
