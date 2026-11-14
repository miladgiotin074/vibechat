import { redis } from '../../lib/redis.js';

/**
 * Server → app events. Every API instance subscribes to `u:<userId>` for the users connected to it
 * (see hub.ts), so publishing here reaches all of a user's devices on any instance.
 */
export type RealtimeEvent =
  | { type: 'message.new'; data: unknown }
  | { type: 'message.read'; data: { matchId: string; userId: string; upTo: string } }
  | { type: 'typing'; data: { matchId: string; userId: string } }
  | { type: 'match.new'; data: unknown }
  | { type: 'match.removed'; data: { matchId: string } }
  | { type: 'like.new'; data: { superLike: boolean; first?: boolean } }
  | { type: 'notification'; data: unknown }
  | { type: 'profile.updated'; data: unknown }
  | { type: 'session.revoked'; data: { reason: string } }
  | { type: 'referral.joined'; data: Record<string, never> }
  | { type: 'conversation.new'; data: { matchId: string } }
  | { type: 'wall.liked'; data: { postId: string; likeCount: number } }
  /** a conversation request on a Wall post was sent, cancelled or answered */
  | { type: 'wall.request'; data: { postId: string } }
  | { type: 'payment.updated'; data: { paymentId: string; status: string } };

export async function publishToUser(userId: string, event: RealtimeEvent) {
  await redis.publish(`u:${userId}`, JSON.stringify(event));
}

export async function isOnline(userId: string): Promise<boolean> {
  return (await redis.exists(`online:${userId}`)) === 1;
}

export async function onlineSet(userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const values = await redis.mget(userIds.map((id) => `online:${id}`));
  return new Set(userIds.filter((_, i) => values[i] != null));
}
