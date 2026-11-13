import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { dayKey, redis } from '../../lib/redis.js';
import { parse } from '../../lib/validate.js';
import { requireAdmin } from './guard.js';

/** Live counters for today (Redis) — the worker copies them into daily_stats. */
export async function todayCounters(day = dayKey()) {
  const [hash, dau] = await Promise.all([redis.hgetall(`stats:${day}`), redis.pfcount(`dau:${day}`)]);
  return {
    signups: Number(hash.signups ?? 0),
    activations: Number(hash.activations ?? 0),
    referrals: Number(hash.referrals ?? 0),
    wallPosts: Number(hash.wall_posts ?? 0),
    swipes: Number(hash.swipes ?? 0),
    likes: Number(hash.likes ?? 0),
    matches: Number(hash.matches ?? 0),
    messages: Number(hash.messages ?? 0),
    activeUsers: dau,
  };
}

export async function onlineNow(): Promise<number> {
  const bucket = Math.floor(Date.now() / 120_000);
  return redis.pfcount(`onl:${bucket}`, `onl:${bucket - 1}`);
}

export async function adminStatsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/v1/stats/overview', async () => {
    const cached = await redis.get('admin:overview');
    if (cached) return JSON.parse(cached);
    const [users] = await sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'active')::int AS active,
             count(*) FILTER (WHERE status = 'onboarding')::int AS onboarding,
             count(*) FILTER (WHERE status IN ('banned', 'suspended'))::int AS banned,
             count(*) FILTER (WHERE status = 'deleted')::int AS deleted,
             count(*) FILTER (WHERE premium_until > now())::int AS premium,
             count(*) FILTER (WHERE gender = 'male' AND status = 'active')::int AS male,
             count(*) FILTER (WHERE gender = 'female' AND status = 'active')::int AS female
      FROM users`;
    const [pending] = await sql`
      SELECT (SELECT count(*)::int FROM reports WHERE status = 'open') AS reports,
             (SELECT count(*)::int FROM users WHERE shadow_auto) AS shadow`;
    const [revenue] = await sql`
      SELECT coalesce(sum(amount_toman) FILTER (WHERE paid_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'Asia/Tehran'), 0)::bigint AS today,
             coalesce(sum(amount_toman) FILTER (WHERE paid_at >= now() - interval '30 days'), 0)::bigint AS month
      FROM payments WHERE status = 'paid' AND paid_at >= now() - interval '30 days'`;
    const [totals] = await sql`
      SELECT (SELECT count(*)::int FROM matches) AS matches,
             (SELECT coalesce(sum(message_count), 0)::bigint FROM matches) AS messages`;
    const result = {
      users,
      pending,
      today: { ...(await todayCounters()), revenueToman: Number(revenue!.today) },
      monthRevenueToman: Number(revenue!.month),
      totals: { matches: totals!.matches, messages: Number(totals!.messages) },
      onlineNow: await onlineNow(),
      generatedAt: new Date().toISOString(),
    };
    // A few seconds of staleness keeps a busy panel from hammering the database.
    await redis.set('admin:overview', JSON.stringify(result), 'EX', 20);
    return result;
  });

  app.get('/admin/v1/stats/daily', async (req) => {
    const { days } = parse(z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }), req.query);
    const rows = await sql`
      SELECT day::text AS day, signups, active_users, swipes, likes, matches, messages, revenue_toman
      FROM daily_stats WHERE day > (now() AT TIME ZONE 'Asia/Tehran')::date - ${days}::int ORDER BY day`;
    const today = dayKey();
    const live = await todayCounters(today);
    const items = rows
      .filter((r) => r.day !== today)
      .map((r) => ({
        day: r.day as string,
        signups: r.signups as number,
        activeUsers: r.active_users as number,
        swipes: r.swipes as number,
        likes: r.likes as number,
        matches: r.matches as number,
        messages: r.messages as number,
        revenueToman: Number(r.revenue_toman),
      }));
    const [rev] = await sql`
      SELECT coalesce(sum(amount_toman), 0)::bigint AS total FROM payments
      WHERE status = 'paid' AND paid_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'Asia/Tehran'`;
    items.push({ day: today, ...live, revenueToman: Number(rev!.total) });
    return { items };
  });

  app.get('/admin/v1/stats/breakdown', async () => {
    const provinces = await sql`
      SELECT province_id, count(*)::int AS users FROM users WHERE status = 'active' AND province_id IS NOT NULL
      GROUP BY province_id ORDER BY users DESC LIMIT 10`;
    const goals = await sql`
      SELECT goal, count(*)::int AS users FROM users WHERE status = 'active' AND goal IS NOT NULL GROUP BY goal ORDER BY users DESC`;
    const ages = await sql`
      SELECT CASE WHEN a < 25 THEN '18-24' WHEN a < 30 THEN '25-29' WHEN a < 35 THEN '30-34'
                  WHEN a < 45 THEN '35-44' ELSE '45+' END AS bucket, count(*)::int AS users
      FROM (SELECT date_part('year', age(birthdate))::int AS a FROM users WHERE status = 'active' AND birthdate IS NOT NULL) t
      GROUP BY bucket ORDER BY bucket`;
    return { provinces, goals, ages };
  });
}
