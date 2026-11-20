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
  type Scheduled,
} from './jobs.js';
import { closeDb, waitForDatabase } from './lib/db.js';
import { BOT_QUEUE_NAME, type BotMessage, type BotUnpin, closeQueue, INVITE_QUEUE_NAME, type InviteJob, type JobData, QUEUE_NAME, WALL_QUEUE_NAME, type WallJob } from './lib/queue.js';
import { replyAsBot } from './modules/ai/service.js';
import { matchCare } from './modules/chat/jobs.js';
import { trustSweep } from './modules/safety/service.js';
import { expirePosts } from './modules/wall/service.js';
import { publishToGroup, syncGroupMessage } from './modules/wall/telegram.js';
import { processGroupInviteRun, requeueStaleInviteRuns } from './modules/verification/groupInvite.js';
import { bullConnection, closeRedis } from './lib/redis.js';
import { deleteObjects } from './lib/storage.js';
import { RetryLater, sendBotMessage, unpinBotMessage } from './modules/bot/sender.js';

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
    case 'ai-reply':
      return replyAsBot(data.matchId, data.botId, data.toId, log);
    case 'daily-stats':
      return dailyStats();
    case 'cleanup':
      return cleanup(log);
    case 'comeback':
      return comeback(log);
    case 'wall-expire':
      return expirePosts();
    case 'match-care':
      return matchCare(log);
    case 'trust-sweep':
      return trustSweep();
    case 'tg-group-invite':
      return processGroupInviteRun(data.runId);
    case 'tg-invite-recover':
      return requeueStaleInviteRuns();
  }
}

const queue = new Queue(QUEUE_NAME, { connection: bullConnection() });
await queue.upsertJobScheduler('daily-stats', { every: 10 * 60_000 }, { name: 'daily-stats', data: { name: 'daily-stats' } });
await queue.upsertJobScheduler('cleanup', { every: 60 * 60_000 }, { name: 'cleanup', data: { name: 'cleanup' } });
await queue.upsertJobScheduler('wall-expire', { every: 5 * 60_000 }, { name: 'wall-expire', data: { name: 'wall-expire' } });
await queue.upsertJobScheduler('match-care', { every: 15 * 60_000 }, { name: 'match-care', data: { name: 'match-care' } });
await queue.upsertJobScheduler('trust-sweep', { every: 60 * 60_000 }, { name: 'trust-sweep', data: { name: 'trust-sweep' } });
await queue.upsertJobScheduler('tg-invite-recover', { every: 60_000 }, { name: 'tg-invite-recover', data: { name: 'tg-invite-recover' } });
// 18:00 Tehran time: the evening is when people open dating apps
await queue.upsertJobScheduler('comeback', { pattern: '0 18 * * *', tz: 'Asia/Tehran' }, { name: 'comeback', data: { name: 'comeback' } });

const worker = new Worker(QUEUE_NAME, handle, { connection: bullConnection(), concurrency: 4 });
worker.on('failed', (job, err) => log.error({ job: job?.name, err }, 'job failed'));

/**
 * Telegram allows ~30 messages/second per bot. The limiter is global across every worker instance
 * (it lives in Redis), so adding workers never exceeds it. A 429 pauses the whole queue.
 */
const botWorker = new Worker<BotMessage & BotUnpin>(
  BOT_QUEUE_NAME,
  async (job) => {
    // the delayed half of a pinned announcement: take it down again
    if (job.name === 'unpin') return unpinBotMessage(job.data);
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
  async (job) => {
    const { name, postId } = job.data;
    if (name === 'wall-publish') return publishToGroup(postId);
    return syncGroupMessage(postId);
  },
  { connection: bullConnection(), concurrency: 1, limiter: { max: 18, duration: 60_000 } },
);
wallWorker.on('failed', (job, err) => log.warn({ post: job?.data.postId, err: err.message }, 'wall group job failed'));

/** One session at a time: the account joins, invites, disconnects, and only then the next job starts. */
const inviteWorker = new Worker<InviteJob>(
  INVITE_QUEUE_NAME,
  (job) => processGroupInviteRun(job.data.runId),
  { connection: bullConnection(), concurrency: 1 },
);
inviteWorker.on('failed', (job, err) => log.error({ run: job?.data.runId, err }, 'group invite failed'));

log.info('worker started');

async function shutdown() {
  await Promise.allSettled([worker.close(), botWorker.close(), wallWorker.close(), inviteWorker.close()]);
  await Promise.allSettled([queue.close(), closeQueue()]);
  await Promise.allSettled([closeRedis(), closeDb()]);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
