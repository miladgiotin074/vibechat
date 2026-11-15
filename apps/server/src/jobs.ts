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
import { reconcilePendingPayments } from './modules/payments/routes.js';
import { getSettings } from './modules/settings/settings.js';

export type Scheduled =
  | { name: 'flush-counters' }
  | { name: 'daily-stats' }
  | { name: 'cleanup' }
  | { name: 'reconcile-payments' }
  | { name: 'comeback' }
  | { name: 'wall-expire' }
  | { name: 'vibe-night' }
  | { name: 'premium-perks' }
  | { name: 'match-care' }
  | { name: 'wall-requests' }
  | { name: 'trust-sweep' };

export { reconcilePendingPayments };

/** Swipe counters per target → users.likes_received / passes_received / score, in batches. */
export async function flushCounters(log?: Logger) {
  let total = 0;
  for (;;) {
    const ids = (await redis.spop('rcv:dirty', 500)) as string[];
    if (!ids?.length) break;
    const m = redis.multi();
    for (const id of ids) m.hgetall(`rcv:${id}`).del(`rcv:${id}`);
    const res = (await m.exec()) ?? [];
    const likes: number[] = [];
    const passes: number[] = [];
    const weights: number[] = [];
    ids.forEach((_, i) => {
      const h = (res[i * 2]?.[1] ?? {}) as Record<string, string>;
      likes.push(Number(h.like ?? 0));
      passes.push(Number(h.pass ?? 0));
      // likes weighted by how selective each sender is (see likeWeight); older workers sent none
      weights.push(Number(h.wlike ?? h.like ?? 0));
    });
    // score: smoothed share of (weighted) likes among all swipes on the profile — a Bayesian
    // average toward 20%, so a handful of swipes can't make or break anyone
    await sql`
      UPDATE users u SET
        likes_received = u.likes_received + v.l,
        passes_received = u.passes_received + v.p,
        like_weight = u.like_weight + v.w,
        score = (u.like_weight + v.w + 2)::real / (u.like_weight + v.w + u.passes_received + v.p + 10)
      FROM unnest(${ids}::uuid[], ${likes}::int[], ${passes}::int[], ${weights}::real[]) AS v(id, l, p, w)
      WHERE u.id = v.id`;
    total += ids.length;
  }
  if (total) log?.info({ users: total }, 'flushed swipe counters');
}

export async function dailyStats() {
  const now = new Date();
  for (const d of [new Date(now.getTime() - 86400_000), now]) {
    const day = dayKey(d);
    const c = await todayCounters(day);
    const [rev] = await sql<{ total: string }[]>`
      SELECT coalesce(sum(amount_toman), 0)::bigint AS total FROM payments
      WHERE status = 'paid' AND (paid_at AT TIME ZONE 'Asia/Tehran')::date = ${day}::date`;
    await sql`
      INSERT INTO daily_stats (day, signups, activations, referrals, active_users, swipes, likes, matches, messages, wall_posts, revenue_toman, updated_at)
      VALUES (${day}, ${c.signups}, ${c.activations}, ${c.referrals}, ${c.activeUsers}, ${c.swipes}, ${c.likes}, ${c.matches}, ${c.messages}, ${c.wallPosts}, ${rev!.total}, now())
      ON CONFLICT (day) DO UPDATE SET
        signups = greatest(daily_stats.signups, EXCLUDED.signups),
        activations = greatest(daily_stats.activations, EXCLUDED.activations),
        referrals = greatest(daily_stats.referrals, EXCLUDED.referrals),
        wall_posts = greatest(daily_stats.wall_posts, EXCLUDED.wall_posts),
        active_users = greatest(daily_stats.active_users, EXCLUDED.active_users),
        swipes = greatest(daily_stats.swipes, EXCLUDED.swipes),
        likes = greatest(daily_stats.likes, EXCLUDED.likes),
        matches = greatest(daily_stats.matches, EXCLUDED.matches),
        messages = greatest(daily_stats.messages, EXCLUDED.messages),
        revenue_toman = EXCLUDED.revenue_toman,
        updated_at = now()`;
  }
}

/**
 * Premium ran out: the options that came with it switch off (incognito, hidden age).
 * Discovery already ignores them the moment premium ends; this tidies the settings so
 * the app shows what is true.
 */
export async function expirePremiumPerks(log?: Logger) {
  const rows = await sql<{ id: string }[]>`
    UPDATE users SET incognito = false, hide_age = false, updated_at = now()
    WHERE id IN (
      SELECT id FROM users
      WHERE (premium_until IS NULL OR premium_until <= now()) AND gender IS DISTINCT FROM 'female' AND (incognito OR hide_age)
      LIMIT 2000)
    RETURNING id`;
  for (const r of rows) {
    await invalidateUser(r.id);
    await resetDeck(r.id);
    await publishToUser(r.id, { type: 'profile.updated', data: {} });
  }
  if (rows.length) log?.info({ users: rows.length }, 'premium-only options switched off');
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
  await sql`UPDATE users SET boost_until = NULL WHERE boost_until < now() - interval '1 day'`;
  await sql`UPDATE payments SET status = 'expired' WHERE status = 'pending' AND created_at < now() - interval '1 day'`;
  log?.info({ sessions: sessions.count, notifications }, 'cleanup done');
}

export async function accountDeleted(userId: string) {
  await sql`DELETE FROM notifications WHERE user_id = ${userId}`;
  await sql`DELETE FROM auth_sessions WHERE user_id = ${userId}`;
  await sql`DELETE FROM blocks WHERE blocker_id = ${userId}`;
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
      segment: { gender?: string; premium?: boolean };
      button_text: string | null;
      button_url: string | null;
      markdown: boolean;
      pin_hours: number;
    }[]
  >`SELECT title, body, segment, button_text, button_url, markdown, pin_hours FROM announcements WHERE id = ${announcementId}`;
  if (!a) return;
  const text = `📢 <b>${escapeHtml(a.title)}</b>\n\n${a.markdown ? telegramHtml(a.body) : escapeHtml(a.body)}`;
  const seg = a.segment ?? {};
  // the admin's own button (a link, or the app when they gave no link), else «open the app»
  const button: BotButton = a.button_text ? { text: a.button_text, ...(a.button_url ? { url: a.button_url } : {}) } : { text: 'باز کردن Vibe 💜' };
  let after = '00000000-0000-0000-0000-000000000000';
  let sent = 0;
  for (;;) {
    const rows = await sql<{ id: string; telegram_id: string }[]>`
      SELECT id, telegram_id FROM users
      WHERE id > ${after} AND status = 'active' AND can_dm AND NOT bot_blocked AND telegram_id IS NOT NULL
        ${seg.gender ? sql`AND gender = ${seg.gender}` : sql``}
        ${seg.premium === true ? sql`AND premium_until > now()` : seg.premium === false ? sql`AND (premium_until IS NULL OR premium_until <= now())` : sql``}
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
  const rows = await sql<{ id: string; telegram_id: string; name: string | null; likes: number }[]>`
    SELECT u.id, u.telegram_id, u.name,
           (SELECT count(*)::int FROM (
              SELECT 1 FROM swipes s WHERE s.target_id = u.id AND s.action > 0 AND s.created_at > u.last_active_at LIMIT 50) x) AS likes
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
      r.likes > 0
        ? `${name} جان، دلمون برات تنگ شده 💜\n<b>${r.likes} نفر</b> از وقتی نبودی لایکت کردن! ببین کیا هستن 👀`
        : `${name} جان، کلی آدم جدید تو Vibe منتظرتن ✨\nیه سر بزن، شاید امروز همونی رو پیدا کنی که دنبالشی 😉`;
    batch.push({
      userId: r.id,
      chatId: r.telegram_id,
      text,
      button: { text: r.likes > 0 ? '👀 ببین کیا لایکم کردن' : '🔥 بزن بریم', startParam: r.likes > 0 ? 's_likes' : undefined },
      media: 'comeback',
    });
  }
  await enqueueBotMessages(batch);
  if (batch.length) log?.info({ users: batch.length }, 'comeback nudges queued');
}

