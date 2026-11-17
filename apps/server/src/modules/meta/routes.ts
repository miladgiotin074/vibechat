import type { FastifyInstance } from 'fastify';
import { MARITAL, REPORT_REASONS } from '../../data/catalog.js';
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
      marital: MARITAL,
      reportReasons: REPORT_REASONS,
      minAge: settings.minAge,
      maxPhotos: settings.maxPhotos,
      support: settings.support,
      maintenance: settings.maintenance,
      signupOpen: settings.signupOpen,
      bot: { username: env.BOT_USERNAME, appLink: miniAppLink() },
      wall: {
        enabled: settings.wall.enabled,
        ttlHours: settings.wall.ttlHours,
        freeDailyPosts: settings.wall.freeDailyPosts,
        group: settings.wall.telegram.enabled && settings.wall.telegram.chatId ? { link: settings.wall.telegram.link || null } : null,
      },
    };
  });

  app.get('/health', async () => {
    await sql`SELECT 1`;
    return { ok: true };
  });
}
