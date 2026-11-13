import { Redis } from 'ioredis';
import { env } from '../config.js';

/** Commands, caches, counters, rate limits. */
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, enableAutoPipelining: true });

/** Dedicated connection for SUBSCRIBE (a subscribed connection cannot run other commands). */
export const redisSub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

/** BullMQ needs its own connection with maxRetriesPerRequest = null. */
export function bullConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export async function closeRedis() {
  await Promise.allSettled([redis.quit(), redisSub.quit()]);
}

/** Calendar day in Tehran time (daily limits reset at local midnight). */
export function dayKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(date); // YYYY-MM-DD
}
