/**
 * Background worker: Telegram messages (rate limited), storage cleanup, folding Redis counters into
 * Postgres, dashboard stats, payment reconciliation, re-engagement and housekeeping.
 * Run one or more instances next to the API (`npm run start:worker`); BullMQ shares the work.
 */
import { Queue, Worker, type Job } from 'bullmq';
import { pino } from 'pino';
import { env, isProd } from './config.js';
import {
  accountDeleted,
  announce,
  cleanup,
  comeback,
  dailyStats,
  expirePremiumPerks,
  flushCounters,
  reconcilePendingPayments,
  type Scheduled,
} from './jobs.js';
import { closeDb, waitForDatabase } from './lib/db.js';
import { BOT_QUEUE_NAME, type BotMessage, type JobData, QUEUE_NAME, WALL_QUEUE_NAME, type WallJob } from './lib/queue.js';
import { matchCare } from './modules/chat/jobs.js';
import { vibeNightReminder } from './modules/growth/vibeNight.js';
import { trustSweep } from './modules/safety/service.js';
import { expirePosts, wallRequestCare } from './modules/wall/service.js';
import { publishToGroup, syncGroupMessage } from './modules/wall/telegram.js';
import { bullConnection, closeRedis } from './lib/redis.js';
import { deleteObjects } from './lib/storage.js';
import { RetryLater, sendBotMessage } from './modules/bot/sender.js';

const log = pino({
  level: env.LOG_LEVEL,
  ...(isProd ? {} : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
});

// in Docker the database may still be starting
await waitForDatabase((m) => log.info(m));

async function handle(job: Job<JobData | Scheduled>) {
  const data = job.data;
  switch (data.name) {
    case 'delete-objects':
      return deleteObjects(data.keys);
    case 'account-deleted':
      return accountDeleted(data.userId);
    case 'announce':
      return announce(data.announcementId, log);
    case 'flush-counters':
      return flushCounters(log);
    case 'daily-stats':
      return dailyStats();
    case 'cleanup':
      return cleanup(log);
    case 'reconcile-payments':
      return reconcilePendingPayments();
    case 'comeback':
      return comeback(log);
    case 'wall-expire':
      return expirePosts();
    case 'vibe-night':
      return vibeNightReminder(log);
    case 'premium-perks':
      return expirePremiumPerks(log);
    case 'match-care':
      return matchCare(log);
    case 'wall-requests':
      return wallRequestCare(log);
    case 'trust-sweep':
      return trustSweep();
  }
}

const queue = new Queue(QUEUE_NAME, { connection: bullConnection() });
await queue.upsertJobScheduler('flush-counters', { every: 2 * 60_000 }, { name: 'flush-counters', data: { name: 'flush-counters' } });
await queue.upsertJobScheduler('daily-stats', { every: 10 * 60_000 }, { name: 'daily-stats', data: { name: 'daily-stats' } });
await queue.upsertJobScheduler('cleanup', { every: 60 * 60_000 }, { name: 'cleanup', data: { name: 'cleanup' } });
await queue.upsertJobScheduler('reconcile-payments', { every: 3 * 60_000 }, { name: 'reconcile-payments', data: { name: 'reconcile-payments' } });
await queue.upsertJobScheduler('wall-expire', { every: 5 * 60_000 }, { name: 'wall-expire', data: { name: 'wall-expire' } });
// checks every 5 minutes; reminds once, in the first quarter hour of the night
await queue.upsertJobScheduler('vibe-night', { every: 5 * 60_000 }, { name: 'vibe-night', data: { name: 'vibe-night' } });
await queue.upsertJobScheduler('premium-perks', { every: 10 * 60_000 }, { name: 'premium-perks', data: { name: 'premium-perks' } });
await queue.upsertJobScheduler('match-care', { every: 15 * 60_000 }, { name: 'match-care', data: { name: 'match-care' } });
await queue.upsertJobScheduler('wall-requests', { every: 10 * 60_000 }, { name: 'wall-requests', data: { name: 'wall-requests' } });
await queue.upsertJobScheduler('trust-sweep', { every: 60 * 60_000 }, { name: 'trust-sweep', data: { name: 'trust-sweep' } });
// 18:00 Tehran time: the evening is when people open dating apps
await queue.upsertJobScheduler('comeback', { pattern: '0 18 * * *', tz: 'Asia/Tehran' }, { name: 'comeback', data: { name: 'comeback' } });

const worker = new Worker(QUEUE_NAME, handle, { connection: bullConnection(), concurrency: 4 });
worker.on('failed', (job, err) => log.error({ job: job?.name, err }, 'job failed'));

/**
 * Telegram allows ~30 messages/second per bot. The limiter is global across every worker instance
 * (it lives in Redis), so adding workers never exceeds it. A 429 pauses the whole queue.
 */
const botWorker = new Worker<BotMessage>(
  BOT_QUEUE_NAME,
  async (job) => {
    try {
      return await sendBotMessage(job.data);
    } catch (e) {
      if (e instanceof RetryLater) {
        await botWorker.rateLimit(e.seconds * 1000);
        throw Worker.RateLimitError();
      }
      throw e;
    }
  },
  { connection: bullConnection(), concurrency: 10, limiter: { max: 25, duration: 1000 } },
);
botWorker.on('failed', (job, err) => log.warn({ chat: job?.data.chatId, err: err.message }, 'bot message failed'));

/** Telegram lets a bot post ~20 messages a minute in one group; posts and edits share that budget. */
const wallWorker = new Worker<WallJob>(
  WALL_QUEUE_NAME,
  async (job) => (job.data.name === 'wall-publish' ? publishToGroup(job.data.postId) : syncGroupMessage(job.data.postId)),
  { connection: bullConnection(), concurrency: 1, limiter: { max: 18, duration: 60_000 } },
);
wallWorker.on('failed', (job, err) => log.warn({ post: job?.data.postId, err: err.message }, 'wall group job failed'));

log.info('worker started');

async function shutdown() {
  await Promise.allSettled([worker.close(), botWorker.close(), wallWorker.close()]);
  await queue.close();
  await Promise.allSettled([closeRedis(), closeDb()]);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
