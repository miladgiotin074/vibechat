/**
 * npm run bot:setup
 * Sets the bot's commands, menu button and (BOT_MODE=webhook) the webhook, and prints what Telegram
 * reports back. The API does the same on boot; this is for checking a deployment by hand.
 */
import { env, miniAppLink } from '../config.js';
import { redis, closeRedis } from '../lib/redis.js';
import { configureBot, getBot } from '../modules/bot/bot.js';

const bot = getBot();
if (!bot) {
  console.error('BOT_TOKEN is not set');
  process.exit(1);
}
await redis.del('bot:configured');
await configureBot(console.log);
const me = await bot.api.getMe();
console.log(`bot: @${me.username} (inline mode: ${me.supports_inline_queries ? 'on' : 'OFF — enable it in @BotFather /setinline'})`);
if (env.BOT_MODE === 'webhook') console.log('webhook:', await bot.api.getWebhookInfo());
console.log(`Mini App link: ${miniAppLink()}`);
await closeRedis();
process.exit(0);
