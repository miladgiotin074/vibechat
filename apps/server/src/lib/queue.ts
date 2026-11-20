import { Queue } from 'bullmq';
import type { BotMediaSlot } from '../modules/bot/media.js';
import { bullConnection } from './redis.js';

/** General background work (storage cleanup, account deletion). */
export const QUEUE_NAME = 'jobs';
/** Outgoing Telegram messages. Its own queue so the worker can rate-limit it to Telegram's limits. */
export const BOT_QUEUE_NAME = 'bot';
/** Posts and edits in the Wall's Telegram group: Telegram allows ~20 messages a minute per group. */
export const WALL_QUEUE_NAME = 'wall';

export type WallJob = { name: 'wall-publish'; postId: string } | { name: 'wall-sync'; postId: string };

export type JobData =
  | { name: 'delete-objects'; keys: string[] }
  | { name: 'account-deleted'; userId: string }
  | { name: 'announce'; announcementId: string }
  /** Someone wrote to an AI profile: ask the model and post the answer as that profile. */
  | { name: 'ai-reply'; matchId: string; botId: string; toId: string };

export interface BotButton {
  text: string;
  /** Opens the Mini App at this start parameter (t.me/<bot>/<app>?startapp=…). */
  startParam?: string;
  url?: string;
}

export interface BotMessage {
  /** Our user id (to mark bot_blocked when Telegram says the user blocked the bot). */
  userId: string;
  chatId: string;
  /** HTML (parse_mode=HTML). Escape user-provided text with escapeHtml. */
  text: string;
  /** One button, or several stacked one under the other in the same message. */
  button?: BotButton | BotButton[];
  /** Which picture goes with it (see bot/media.ts); none given = the default picture. */
  media?: BotMediaSlot;
  /** A broadcast: the picture the admin attached to this announcement wins over the slot image. */
  announcementId?: string;
  /** Pin it in the user's chat with the bot for this many hours (0 / unset: don't pin). */
  pinHours?: number;
  /** legacy: an explicit photo URL instead of a media slot */
  photoUrl?: string;
}

/** Takes a pinned announcement down again, booked for when it was sent plus its pin time. */
export interface BotUnpin {
  chatId: string;
  messageId: number;
}

let queue: Queue | null = null;
let botQueue: Queue | null = null;
let wallQueue: Queue | null = null;

function getQueue(): Queue {
  queue ??= new Queue(QUEUE_NAME, {
    connection: bullConnection(),
    defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  });
  return queue;
}

function getBotQueue(): Queue {
  botQueue ??= new Queue(BOT_QUEUE_NAME, {
    connection: bullConnection(),
    defaultJobOptions: { attempts: 4, backoff: { type: 'exponential', delay: 3_000 }, removeOnComplete: 2000, removeOnFail: 5000 },
  });
  return botQueue;
}

function getWallQueue(): Queue {
  wallQueue ??= new Queue(WALL_QUEUE_NAME, {
    connection: bullConnection(),
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 1000, removeOnFail: 2000 },
  });
  return wallQueue;
}

/**
 * Wall group jobs. Syncs (like counts, expiry) are coalesced: while one is waiting for a post, adding
 * another is a no-op, so a burst of likes becomes a single message edit.
 */
export async function enqueueWall(job: WallJob, delayMs = 0) {
  const jobId = job.name === 'wall-sync' ? `sync-${job.postId}` : `publish-${job.postId}`;
  await getWallQueue().add(job.name, job, { jobId, delay: delayMs });
}

export async function enqueue(job: JobData, delayMs = 0) {
  await getQueue().add(job.name, job, delayMs ? { delay: delayMs } : undefined);
}

/** Bulk notifications (broadcasts) go with lower priority so personal ones (matches, messages) jump ahead. */
export async function enqueueBotMessage(msg: BotMessage, opts: { bulk?: boolean; dedupeId?: string } = {}) {
  await getBotQueue().add('send', msg, { priority: opts.bulk ? 10 : 1, jobId: opts.dedupeId });
}

/** The unpin is booked straight away, so it still happens if the server restarts meanwhile. */
export async function enqueueBotUnpin(job: BotUnpin, delayMs: number) {
  await getBotQueue().add('unpin', job, { delay: delayMs, priority: 20, jobId: `unpin-${job.chatId}-${job.messageId}` });
}

export async function enqueueBotMessages(msgs: BotMessage[]) {
  if (!msgs.length) return;
  await getBotQueue().addBulk(msgs.map((data) => ({ name: 'send', data, opts: { priority: 10 } })));
}

export async function closeQueue() {
  await Promise.allSettled([queue?.close(), botQueue?.close(), wallQueue?.close()]);
}
