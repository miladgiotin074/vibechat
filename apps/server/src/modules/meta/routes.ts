import type { FastifyInstance } from 'fastify';
import { EDUCATION, GOALS, INTERESTS, MARITAL, REPORT_REASONS, SMOKING, WALL_CATEGORIES } from '../../data/catalog.js';
import { PROVINCES } from '../../data/locations.js';
import { env, miniAppLink } from '../../config.js';
import { sql } from '../../lib/db.js';
import { getSettings } from '../settings/settings.js';

/** Static-ish data the app caches: option lists, locations, limits, version gate. */
export async function metaRoutes(app: FastifyInstance) {
  app.get('/v1/meta', async (_req, reply) => {
    const settings = await getSettings();
    // short: settings changed in the panel (and new fields after a deploy) reach the app within a minute
    reply.header('cache-control', 'public, max-age=60');
    return {
      goals: GOALS,
      interests: INTERESTS,
      education: EDUCATION,
      smoking: SMOKING,
      marital: MARITAL,
      reportReasons: REPORT_REASONS,
      provinces: PROVINCES,
      minAge: settings.minAge,
      maxPhotos: settings.maxPhotos,
      maxInterests: 10,
      support: settings.support,
      maintenance: settings.maintenance,
      signupOpen: settings.signupOpen,
      randomChat: settings.randomChat.enabled,
      referral: { enabled: settings.referral.enabled && !!settings.wall.telegram.chatId },
      bot: { username: env.BOT_USERNAME, appLink: miniAppLink() },
      wall: {
        enabled: settings.wall.enabled,
        categories: WALL_CATEGORIES,
        ttlHours: settings.wall.ttlHours,
        freeDailyPosts: settings.wall.freeDailyPosts,
        group: settings.wall.telegram.enabled && settings.wall.telegram.chatId ? { link: settings.wall.telegram.link || null } : null,
      },
    };
  });

  app.get('/v1/plans', async () => {
    const settings = await getSettings();
    const rows = await sql`
      SELECT id, title, description, duration_days, price_toman, old_price_toman, badge FROM plans
      WHERE is_active AND kind = 'premium' ORDER BY sort, price_toman`;
    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        durationDays: r.duration_days,
        priceToman: r.price_toman,
        oldPriceToman: r.old_price_toman,
        badge: r.badge,
      })),
      paymentsEnabled: settings.paymentsEnabled,
      features: [
        { icon: '❤️', title: settings.premiumDailyLikes > 0 ? `${settings.premiumDailyLikes.toLocaleString('fa-IR')} لایک در روز` : 'لایک نامحدود' },
        ...(settings.randomChat.enabled
          ? [
              {
                icon: '🎲',
                title:
                  settings.randomChat.premiumDailySessions > 0
                    ? `${settings.randomChat.premiumDailySessions.toLocaleString('fa-IR')} چت ناشناس در روز`
                    : 'چت ناشناس نامحدود',
              },
            ]
          : []),
        { icon: '👀', title: 'ببین چه کسانی لایکت کرده‌اند' },
        { icon: '⭐', title: 'سوپرلایک بیشتر هر روز' },
        { icon: '🚀', title: 'بوست روزانه: اول از همه دیده شو' },
        { icon: '↩️', title: 'برگشت به نفر قبلی' },
        { icon: '🕶️', title: 'حالت مخفی و پنهان کردن سن' },
        ...(settings.wall.enabled ? [{ icon: '⬆️', title: 'نردبان: درخواستت دوباره میره بالای دیوار' }] : []),
      ],
    };
  });

  app.get('/health', async () => {
    await sql`SELECT 1`;
    return { ok: true };
  });
}
