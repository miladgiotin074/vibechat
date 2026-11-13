import { buildApp } from './app.js';
import { env } from './config.js';
import { closeDb, waitForDatabase } from './lib/db.js';
import { runMigrations } from './lib/migrate.js';
import { closeQueue } from './lib/queue.js';
import { closeRedis } from './lib/redis.js';
import { bootstrapAdmin } from './modules/admin/auth.js';
import { configureBot, startPolling, stopBot } from './modules/bot/bot.js';
import { listenForSettingsChanges } from './modules/settings/settings.js';

const app = await buildApp();

// in Docker the database may still be starting
await waitForDatabase((m) => app.log.info(m));

if (process.env.MIGRATE_ON_BOOT !== 'false') {
  await runMigrations((m) => app.log.info(m));
}
await bootstrapAdmin((m) => app.log.info(m));
await listenForSettingsChanges();

await app.listen({ host: env.HOST, port: env.PORT });
await configureBot((m) => app.log.info(m));
await startPolling((m) => app.log.info(m));
if (env.DEV_FAKE_TELEGRAM) app.log.warn('DEV_FAKE_TELEGRAM is on: unsigned init data is accepted');

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info(`${signal}: shutting down`);
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  await stopBot();
  await app.close();
  await Promise.allSettled([closeQueue(), closeRedis(), closeDb()]);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
