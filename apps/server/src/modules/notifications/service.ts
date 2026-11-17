import { sql } from '../../lib/db.js';
import { pushImportant, pushWallLike } from '../bot/push.js';
import { publishToUser } from '../realtime/bus.js';

export type NotificationType = 'chat' | 'chat_nudge' | 'message' | 'wall_like' | 'system';

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
      case 'wall_like':
        await pushWallLike(userId, String(n.data?.postId ?? ''), n.title);
        break;
      case 'chat_nudge':
        await pushImportant(userId, n.title, n.body, `chat_${String(n.data?.matchId ?? '')}`, 'message');
        break;
      case 'system':
        await pushImportant(userId, n.title, n.body);
        break;
      default:
        break;
    }
  } catch {
    // a failed Telegram push must never fail the action that caused it
  }
}
