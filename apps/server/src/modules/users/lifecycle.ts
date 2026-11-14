import { sql } from '../../lib/db.js';
import { enqueue } from '../../lib/queue.js';
import { invalidateUser } from '../auth/guard.js';
import { revokeAllSessions } from '../auth/sessions.js';
import { resetDeck } from '../discover/deck.js';
import { photoObjectKeys } from '../profile/service.js';
import { publishToUser } from '../realtime/bus.js';
import { retractUserWall } from '../wall/service.js';

/** Wipes personal data now; stored files are removed by the worker. Used by the user and by admins. */
export async function deleteAccount(userId: string) {
  const photos = await sql<{ storage_key: string; blur_key: string }[]>`
    SELECT storage_key, blur_key FROM photos WHERE user_id = ${userId}`;
  const peers = await sql.begin(async (tx) => {
    await tx`
      UPDATE users SET status = 'deleted', deleted_at = now(), telegram_id = NULL, tg_username = NULL, tg_first_name = NULL,
        tg_last_name = NULL, can_dm = false, name = NULL, bio = NULL, job = NULL, lat = NULL, lng = NULL, discoverable = false,
        interests = '{}', premium_until = NULL, boost_until = NULL, updated_at = now()
      WHERE id = ${userId}`;
    await tx`DELETE FROM photos WHERE user_id = ${userId}`;
    const rows = await tx<{ match_id: string; peer_id: string }[]>`
      SELECT match_id, peer_id FROM match_members WHERE user_id = ${userId}`;
    await tx`UPDATE matches SET status = 'unmatched', unmatched_by = ${userId}, unmatched_at = now()
             WHERE id IN (SELECT match_id FROM match_members WHERE user_id = ${userId}) AND status = 'active'`;
    await tx`UPDATE match_members SET hidden = true
             WHERE match_id IN (SELECT match_id FROM match_members WHERE user_id = ${userId})`;
    return rows;
  });
  await revokeAllSessions(userId);
  await invalidateUser(userId);
  await resetDeck(userId);
  await retractUserWall(userId, 'deleted');
  if (photos.length) await enqueue({ name: 'delete-objects', keys: photos.flatMap(photoObjectKeys) });
  await enqueue({ name: 'account-deleted', userId });
  await publishToUser(userId, { type: 'session.revoked', data: { reason: 'deleted' } });
  await Promise.all(peers.map((p) => publishToUser(p.peer_id, { type: 'match.removed', data: { matchId: p.match_id } })));
}

/**
 * Back to «just opened the bot», for testing: the account is deleted like any other, and what
 * hangs on the Telegram account instead of the user is cleared too (friends they added to the Wall
 * group, and being added by someone). The next time that Telegram account opens the app or sends
 * /start, a brand-new user is created: no profile, likes, matches or membership. Returns false when
 * there is nothing to reset (no such user, already deleted).
 */
export async function resetAccount(userId: string): Promise<boolean> {
  const [u] = await sql<{ telegram_id: string | null }[]>`
    SELECT telegram_id::text AS telegram_id FROM users WHERE id = ${userId} AND status <> 'deleted'`;
  if (!u?.telegram_id) return false;
  await deleteAccount(userId);
  await sql`DELETE FROM group_adds WHERE adder_tg_id = ${u.telegram_id} OR added_tg_id = ${u.telegram_id}`;
  return true;
}

/** Ban or suspend: sessions die immediately, sockets get closed, the profile leaves discovery. */
export async function banUser(userId: string, reason: string, status: 'banned' | 'suspended' = 'banned') {
  await sql`UPDATE users SET status = ${status}, ban_reason = ${reason}, updated_at = now() WHERE id = ${userId}`;
  await revokeAllSessions(userId);
  await invalidateUser(userId);
  await retractUserWall(userId, 'banned');
  await publishToUser(userId, { type: 'session.revoked', data: { reason: status } });
}

export async function unbanUser(userId: string) {
  // Back to active only if the profile had been completed (it has the fields discovery needs).
  await sql`
    UPDATE users SET status = CASE WHEN gender IS NOT NULL AND birthdate IS NOT NULL THEN 'active' ELSE 'onboarding' END,
      ban_reason = NULL, updated_at = now()
    WHERE id = ${userId} AND status IN ('banned', 'suspended')`;
  await invalidateUser(userId);
}
