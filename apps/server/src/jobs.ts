/** Background job bodies. Kept apart from worker.ts (which only wires BullMQ) so they can be tested. */
import type { Logger } from 'pino';
import { sql } from './lib/db.js';
import { telegramHtml } from './lib/markdown.js';
import { dayKey, redis } from './lib/redis.js';
import { enqueueBotMessages, type BotButton, type BotMessage } from './lib/queue.js';
import { todayCounters } from './modules/admin/stats.js';
import { invalidateUser } from './modules/auth/guard.js';
import { escapeHtml } from './modules/bot/sender.js';
import { resetDeck } from './modules/discover/deck.js';
import { publishToUser } from './modules/realtime/bus.js';
import { getSettings } from './modules/settings/settings.js';

export type Scheduled =
  | { name: 'daily-stats' }
  | { name: 'cleanup' }
  | { name: 'comeback' }
  | { name: 'wall-expire' }
  | { name: 'match-care' }
  | { name: 'trust-sweep' };

export async function dailyStats() {
  const now = new Date();
  for (const d of [new Date(now.getTime() - 86400_000), now]) {
    const day = dayKey(d);
    const c = await todayCounters(day);
    await sql`
      INSERT INTO daily_stats (day, signups, activations, active_users, swipes, matches, messages, wall_posts, updated_at)
      VALUES (${day}, ${c.signups}, ${c.activations}, ${c.activeUsers}, ${c.swipes}, ${c.matches}, ${c.messages}, ${c.wallPosts}, now())
      ON CONFLICT (day) DO UPDATE SET
        signups = greatest(daily_stats.signups, EXCLUDED.signups),
        activations = greatest(daily_stats.activations, EXCLUDED.activations),
        wall_posts = greatest(daily_stats.wall_posts, EXCLUDED.wall_posts),
        active_users = greatest(daily_stats.active_users, EXCLUDED.active_users),
        swipes = greatest(daily_stats.swipes, EXCLUDED.swipes),
        matches = greatest(daily_stats.matches, EXCLUDED.matches),
        messages = greatest(daily_stats.messages, EXCLUDED.messages),
        updated_at = now()`;
  }
}

export async function cleanup(log?: Logger) {
  const sessions = await sql`
    DELETE FROM auth_sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '30 days'`;
  let notifications = 0;
  for (;;) {
    const res = await sql`
      DELETE FROM notifications WHERE id IN (
        SELECT id FROM notifications WHERE created_at < now() - interval '90 days' LIMIT 5000)`;
    notifications += res.count;
    if (res.count < 5000) break;
  }
  log?.info({ sessions: sessions.count, notifications }, 'cleanup done');
}

/** An account was deleted: what is left of it elsewhere goes too. */
export async function accountDeleted(userId: string) {
  await sql`DELETE FROM notifications WHERE user_id = ${userId}`;
  await sql`DELETE FROM auth_sessions WHERE user_id = ${userId}`;
  await sql`DELETE FROM blocks WHERE blocker_id = ${userId}`;
  await sql`DELETE FROM skips WHERE user_id = ${userId}`;
}

/**
 * An admin broadcast marked "via bot": walks the matching users by id (keyset pagination, any
 * table size) and queues one Telegram message each. The bot queue's rate limiter paces delivery.
 */
export async function announce(announcementId: string, log?: Logger) {
  const [a] = await sql<
    {
      title: string;
      body: string;
      segment: { gender?: string };
      button_text: string | null;
      button_url: string | null;
      markdown: boolean;
      pin_hours: number;
      app_button: boolean;
    }[]
  >`SELECT title, body, segment, button_text, button_url, markdown, pin_hours, app_button FROM announcements WHERE id = ${announcementId}`;
  if (!a) return;
  const text = `📢 <b>${escapeHtml(a.title)}</b>\n\n${a.markdown ? telegramHtml(a.body) : escapeHtml(a.body)}`;
  const seg = (a.segment ?? {}) as { gender?: string };
  // The admin's own button, and under it one that opens the app — both in the same message. A
  // custom button with no link of its own already opens the app, so it is not doubled.
  const custom: BotButton | null = a.button_text ? { text: a.button_text, ...(a.button_url ? { url: a.button_url } : {}) } : null;
  const button: BotButton[] = [
    ...(custom ? [custom] : []),
    ...(!custom || (a.app_button && custom.url) ? [{ text: '🔥 ورود به Vibe Chat' }] : []),
  ];
  let after = '00000000-0000-0000-0000-000000000000';
  let sent = 0;
  for (;;) {
    const rows = await sql<{ id: string; telegram_id: string }[]>`
      SELECT id, telegram_id FROM users
      WHERE id > ${after} AND status = 'active' AND can_dm AND NOT bot_blocked AND telegram_id IS NOT NULL
        ${seg.gender ? sql`AND gender = ${seg.gender}` : sql``}
      ORDER BY id LIMIT 1000`;
    if (!rows.length) break;
    const batch: BotMessage[] = rows.map((r) => ({
      userId: r.id,
      chatId: r.telegram_id,
      text,
      button,
      media: 'announcement' as const,
      announcementId,
      ...(a.pin_hours > 0 ? { pinHours: a.pin_hours } : {}),
    }));
    await enqueueBotMessages(batch);
    sent += rows.length;
    after = rows[rows.length - 1]!.id;
    await sql`UPDATE announcements SET bot_sent = ${sent} WHERE id = ${announcementId}`;
  }
  log?.info({ announcementId, sent }, 'announcement queued for the bot');
}

/**
 * Re-engagement: people who have been away for a few days get one friendly nudge with something
 * real to come back to (likes waiting, new people). At most one nudge per user per week.
 */
export async function comeback(log?: Logger) {
  const settings = await getSettings();
  const days = settings.bot.comebackAfterDays;
  if (days <= 0) return;
  const rows = await sql<{ id: string; telegram_id: string; name: string | null; waiting: number }[]>`
    SELECT u.id, u.telegram_id, u.name,
           (SELECT coalesce(sum(mm.unread_count), 0)::int FROM match_members mm WHERE mm.user_id = u.id AND NOT mm.hidden) AS waiting
    FROM users u
    WHERE u.status = 'active' AND u.can_dm AND NOT u.bot_blocked AND u.telegram_id IS NOT NULL
      AND u.last_active_at < now() - make_interval(days => ${days})
      AND u.last_active_at > now() - interval '45 days'
    ORDER BY u.last_active_at DESC
    LIMIT 3000`;
  const batch: BotMessage[] = [];
  for (const r of rows) {
    const fresh = await redis.set(`cmb:${r.id}`, '1', 'EX', 7 * 86400, 'NX');
    if (fresh !== 'OK') continue;
    const name = escapeHtml(r.name ?? '');
    const text =
      r.waiting > 0
        ? `${name} جان، دلمون برات تنگ شده 💜\n<b>${r.waiting} پیام</b> خونده‌نشده داری! یه سر بزن 👀`
        : `${name} جان، کلی آدم جدید تو Vibe منتظرتن ✨\nیه سر بزن، شاید امروز همونی رو پیدا کنی که دنبالشی 😉`;
    batch.push({
      userId: r.id,
      chatId: r.telegram_id,
      text,
      button: { text: r.waiting > 0 ? '💬 خوندن پیام‌ها' : '🔥 بزن بریم', startParam: r.waiting > 0 ? 's_chats' : undefined },
      media: 'comeback',
    });
  }
  await enqueueBotMessages(batch);
  if (batch.length) log?.info({ users: batch.length }, 'comeback nudges queued');
}

