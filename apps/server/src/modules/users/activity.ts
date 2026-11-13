import { sql } from '../../lib/db.js';
import { dayKey, redis } from '../../lib/redis.js';

/**
 * Marks a user active. The users row is written at most once per 5 minutes per user, so a busy
 * user does not turn every request into an UPDATE; DAU is a HyperLogLog (12 KB per day, any scale).
 */
export async function touchActivity(userId: string) {
  const day = dayKey();
  // separate commands are still sent in one round trip (enableAutoPipelining)
  const [fresh] = await Promise.all([redis.set(`act:${userId}`, '1', 'EX', 300, 'NX'), redis.pfadd(`dau:${day}`, userId)]);
  if (fresh === 'OK') {
    await Promise.all([redis.expire(`dau:${day}`, 3 * 86400), sql`UPDATE users SET last_active_at = now() WHERE id = ${userId}`]);
  }
}

/** Counters the worker folds into daily_stats. */
export type DailyCounter = 'signups' | 'activations' | 'referrals' | 'swipes' | 'likes' | 'matches' | 'messages' | 'wall_posts';

export async function bumpDailyCounter(name: DailyCounter, by = 1) {
  const key = `stats:${dayKey()}`;
  await redis.multi().hincrby(key, name, by).expire(key, 7 * 86400).exec();
}
