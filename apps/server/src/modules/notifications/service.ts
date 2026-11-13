import { sql } from '../../lib/db.js';
import { pushImportant, pushLike, pushMatch, pushMatchNudge, pushWallAccept, pushWallLike, pushWallRequest } from '../bot/push.js';
import { publishToUser } from '../realtime/bus.js';

export type NotificationType =
  | 'match'
  | 'match_nudge'
  | 'like'
  | 'super_like'
  | 'message'
  | 'photo'
  | 'premium'
  | 'referral'
  | 'wall_like'
  | 'wall_chat'
  | 'wall_request'
  | 'wall_accept'
  | 'system';

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  data?: Record<string, unknown> | null;
}

/**
 * Stores an in-app notification, pushes it to the user's open app over the socket, and — when the
 * kind deserves it — sends it as a Telegram message from the bot (see bot/push.ts for the rules).
 */
export async function notify(userId: string, n: NotificationInput) {
  const [row] = await sql<{ id: string; created_at: Date }[]>`
    INSERT INTO notifications (user_id, type, title, body, data)
    VALUES (${userId}, ${n.type}, ${n.title}, ${n.body ?? null}, ${n.data ? sql.json(n.data as never) : null})
    RETURNING id, created_at`;
  await publishToUser(userId, {
    type: 'notification',
    data: { id: row!.id, type: n.type, title: n.title, body: n.body ?? null, data: n.data ?? null, createdAt: row!.created_at },
  });
  try {
    switch (n.type) {
      case 'match':
        await pushMatch(userId, String(n.data?.matchId ?? ''), String(n.data?.peerName ?? 'یک نفر'));
        break;
      case 'match_nudge':
        await pushMatchNudge(userId, String(n.data?.matchId ?? ''), n.title);
        break;
      case 'super_like':
        await pushLike(userId, true);
        break;
      case 'wall_like':
        await pushWallLike(userId, String(n.data?.postId ?? ''), n.title);
        break;
      case 'wall_request':
        await pushWallRequest(userId, String(n.data?.postId ?? ''), n.title, n.body ?? '');
        break;
      case 'wall_accept':
        await pushWallAccept(userId, String(n.data?.matchId ?? ''), n.title);
        break;
      case 'premium':
      case 'photo':
      case 'referral':
      case 'system':
        await pushImportant(
          userId,
          n.title,
          n.body,
          n.type === 'referral' ? 's_invite' : undefined,
          n.type === 'premium' || n.type === 'referral' ? n.type : 'system',
        );
        break;
      default:
        break;
    }
  } catch {
    // a failed Telegram push must never fail the action that caused it
  }
}
