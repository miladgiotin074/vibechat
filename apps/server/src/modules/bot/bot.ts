import type { FastifyInstance } from 'fastify';
import { Bot, InlineKeyboard, webhookCallback, type Context } from 'grammy';
import { botLink, env, miniAppLink } from '../../config.js';
import { sql } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { redis } from '../../lib/redis.js';
import { parseStartParam, type TelegramUser } from '../../lib/telegram.js';
import { recordGroupAdd, referralSummary } from '../referrals/service.js';
import { toggleLike } from '../wall/service.js';
import { getSettings } from '../settings/settings.js';
import { upsertTelegramUser } from '../users/telegram.js';
import { type BotMediaSlot, sendWithMedia } from './media.js';
import { escapeHtml } from './sender.js';

let instance: Bot | null = null;

/** chat_member isn't sent unless asked for: it's how adds to the Wall group are seen. */
const ALLOWED_UPDATES = ['message', 'callback_query', 'inline_query', 'my_chat_member', 'chat_member'] as const;

/** The Mini App opens straight from a web_app button (no "open this app?" prompt) when it is served over HTTPS. */
function openAppKeyboard(startParam?: string, text = '🔥 ورود به Vibe Chat'): InlineKeyboard {
  if (!startParam && env.MINIAPP_URL.startsWith('https://')) return new InlineKeyboard().webApp(text, env.MINIAPP_URL);
  return new InlineKeyboard().url(text, miniAppLink(startParam));
}

/** Every reply in the private chat is a picture with the text as its caption (see media.ts). */
async function replyWithMedia(ctx: Context, slot: BotMediaSlot, text: string, reply_markup?: InlineKeyboard) {
  const chatId = ctx.chat?.id ?? ctx.from?.id;
  if (chatId === undefined) return;
  await sendWithMedia(ctx.api, chatId, slot, text, { reply_markup });
}

const fa = (n: number) => n.toLocaleString('fa-IR');

/** /invite: add friends to the Wall group, get random chats. */
async function inviteMessage(ctx: Context) {
  if (!ctx.from) return;
  const [u] = await sql<{ id: string }[]>`SELECT id FROM users WHERE telegram_id = ${ctx.from.id}`;
  if (!u) return replyWithMedia(ctx, 'default', 'اول ربات را با /start شروع کن 🙂', openAppKeyboard());
  const r = await referralSummary(u.id);
  if (!r.enabled || !r.group) return replyWithMedia(ctx, 'default', 'دعوت دوستان فعلاً فعال نیست 🙂', openAppKeyboard());
  const text = [
    '🎁 <b>دوستاتو به گروه اضافه کن، هدیه بگیر!</b>',
    `هر ${fa(r.minAdds)} نفری که از مخاطبینت به گروه اضافه کنی = <b>${fa(r.rewardChats)} چت ناشناس</b>${r.rewardLikes ? ` + <b>${fa(r.rewardLikes)} لایک</b>` : ''} 💬`,
    `تا الان: <b>${fa(r.adds)}</b> نفر · هدیه گرفتی: <b>${fa(r.earnedChats)}</b> چت${r.rewardLikes ? ` و <b>${fa(r.earnedLikes)}</b> لایک` : ''}`,
    'توی گروه: روی اسم گروه بزن ← «افزودن عضو» ← دوستاتو انتخاب کن.',
  ].join('\n\n');
  await replyWithMedia(ctx, 'invite', text, new InlineKeyboard().url('👥 رفتن به گروه', r.group.link));
}

export function getBot(): Bot | null {
  if (!env.BOT_TOKEN) return null;
  if (instance) return instance;
  const bot = new Bot(env.BOT_TOKEN);

  bot.command('start', async (ctx) => {
    if (!ctx.from || ctx.chat.type !== 'private') return;
    const payload = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    const start = parseStartParam(payload);
    try {
      await upsertTelegramUser(ctx.from as TelegramUser, { startedBot: true, refCode: start?.kind === 'ref' ? start.code : null });
    } catch (e) {
      if (e instanceof AppError) return replyWithMedia(ctx, 'default', escapeHtml(e.message));
      throw e;
    }
    const settings = await getSettings();
    const text = settings.bot.welcomeText.replaceAll('{name}', escapeHtml(ctx.from.first_name));
    const passthrough = start && start.kind !== 'ref' ? payload : undefined;
    const kb = openAppKeyboard(passthrough).row().text('🎁 دعوت دوستان و هدیه', 'invite');
    await replyWithMedia(ctx, 'start', text, kb);
  });

  bot.command('invite', inviteMessage);
  bot.callbackQuery('invite', async (ctx) => {
    await ctx.answerCallbackQuery();
    await inviteMessage(ctx);
  });

  bot.command('help', async (ctx) => {
    const s = (await getSettings()).support;
    const lines = [
      '💜 <b>Vibe Chat</b> — آدم‌های جدید، چت و مچ',
      '',
      '• /start — ورود به اپ',
      '• /invite — دعوت دوستان و گرفتن هدیه',
      s.telegram ? `• پشتیبانی: @${escapeHtml(s.telegram)}` : '',
      s.channel ? `• کانال: @${escapeHtml(s.channel)}` : '',
    ].filter(Boolean);
    await replyWithMedia(ctx, 'help', lines.join('\n'), openAppKeyboard());
  });

  // «❤️» under a Wall request in the group. Only members can like; others are sent to the bot.
  bot.callbackQuery(/^wl:([0-9a-f-]{36})$/, async (ctx) => {
    const postId = ctx.match[1]!;
    const [u] = await sql<{ id: string; status: string }[]>`SELECT id, status FROM users WHERE telegram_id = ${ctx.from.id}`;
    if (!u || u.status !== 'active') {
      // opens our bot with /start w_<id>: sign-up takes a few seconds and lands on this request
      return ctx.answerCallbackQuery({ url: botLink(`w_${postId}`) });
    }
    try {
      const r = await toggleLike(postId, u.id, 'group');
      await ctx.answerCallbackQuery({ text: r.liked ? '❤️ لایک شد! اگه خواستی از دکمه‌ی «درخواست گفتگو» باهاش آشنا شو' : 'لایکت برداشته شد' });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: e instanceof AppError ? e.message : 'خطایی رخ داد', show_alert: e instanceof AppError });
    }
  });

  // In the Wall group: tells an admin the chat id to paste into the panel's settings.
  bot.command('chatid', async (ctx) => {
    if (ctx.chat.type === 'private') return ctx.reply(`شناسه‌ی شما: <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' });
    await ctx.reply(`شناسه‌ی این گروه: <code>${ctx.chat.id}</code>\nآن را در پنل مدیریت ← تنظیمات ← دیوار وارد کنید.`, { parse_mode: 'HTML' });
  });

  // Blocked / unblocked the bot: stop or resume Telegram notifications. In a group or channel:
  // remember where the bot is (an admin), so the panel can offer it as a required channel.
  bot.on('my_chat_member', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      const c = ctx.chat;
      await sql`
        INSERT INTO bot_chats (chat_id, title, kind, username, bot_status)
        VALUES (${c.id}, ${'title' in c ? c.title : null}, ${c.type === 'channel' ? 'channel' : 'group'},
                ${'username' in c ? (c.username ?? null) : null}, ${ctx.myChatMember.new_chat_member.status})
        ON CONFLICT (chat_id) DO UPDATE SET title = EXCLUDED.title, kind = EXCLUDED.kind, username = EXCLUDED.username,
          bot_status = EXCLUDED.bot_status, updated_at = now()`;
      return;
    }
    const status = ctx.myChatMember.new_chat_member.status;
    if (status === 'kicked') await sql`UPDATE users SET bot_blocked = true WHERE telegram_id = ${ctx.from.id}`;
    else if (status === 'member') await sql`UPDATE users SET bot_blocked = false, can_dm = true WHERE telegram_id = ${ctx.from.id}`;
  });

  // Someone added a friend to the Wall group: that's what invites are now (counted once per friend).
  bot.on('chat_member', async (ctx) => {
    const m = ctx.chatMember;
    const was = m.old_chat_member.status;
    const now = m.new_chat_member;
    const joined = (now.status === 'member' || (now.status === 'restricted' && now.is_member)) && (was === 'left' || was === 'kicked');
    if (!joined || m.from.is_bot || now.user.is_bot || m.from.id === now.user.id) return;
    await recordGroupAdd(m.from.id, now.user.id, ctx.chat.id);
  });
  // the same as a service message (also sent when chat_member updates aren't delivered)
  bot.on('message:new_chat_members', async (ctx) => {
    for (const added of ctx.message.new_chat_members) {
      if (added.is_bot || ctx.from.is_bot || added.id === ctx.from.id) continue;
      await recordGroupAdd(ctx.from.id, added.id, ctx.chat.id);
    }
  });

  // @Bot in any chat → a ready card that opens the app (spreads the app chat by chat).
  bot.on('inline_query', async (ctx) => {
    const link = miniAppLink();
    await ctx.answerInlineQuery(
      [
        {
          type: 'article',
          id: 'invite',
          title: '💜 دعوت به Vibe Chat',
          description: 'آدم‌های جدید، چت ناشناس و مچ 💜',
          input_message_content: {
            message_text: `بیا Vibe Chat 💜 آدم‌های جدید پیدا کن، چت ناشناس کن و مچ شو!\n\n${link}`,
            link_preview_options: { is_disabled: true },
          },
          reply_markup: new InlineKeyboard().url('🔥 ورود به Vibe Chat', link),
        },
      ],
      { cache_time: 300, is_personal: true },
    );
  });

  // Any other text in the private chat: point at the app.
  bot.on('message', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    await replyWithMedia(ctx, 'help', 'برای دیدن آدم‌ها و چت‌هات، اپ رو باز کن 👇', openAppKeyboard());
  });

  bot.catch((err) => {
    console.error('[bot]', err.error);
  });
  instance = bot;
  return bot;
}

/**
 * Commands, the chat menu button and (in webhook mode) the webhook. Idempotent; a Redis lock keeps
 * a fleet of API instances from all calling Telegram at boot.
 */
export async function configureBot(log: (m: string) => void) {
  const bot = getBot();
  if (!bot || env.BOT_MODE === 'off') return;
  const lock = await redis.set('bot:configured', '1', 'EX', 600, 'NX');
  if (lock !== 'OK') return;
  try {
    await bot.api.setMyCommands([
      { command: 'start', description: 'ورود به Vibe Chat' },
      { command: 'invite', description: 'دعوت دوستان و گرفتن هدیه 🎁' },
      { command: 'help', description: 'راهنما و پشتیبانی' },
    ]);
    if (env.MINIAPP_URL.startsWith('https://')) {
      await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Vibe 💜', web_app: { url: env.MINIAPP_URL } } });
    }
    if (env.BOT_MODE === 'webhook') {
      await bot.api.setWebhook(`${env.PUBLIC_BASE_URL}/bot/webhook`, {
        secret_token: env.BOT_WEBHOOK_SECRET,
        allowed_updates: [...ALLOWED_UPDATES],
        max_connections: 100,
      });
    }
    log(`bot configured (${env.BOT_MODE})`);
  } catch (e) {
    await redis.del('bot:configured');
    log(`bot configuration failed: ${(e as Error).message}`);
  }
}

/** Telegram → POST /bot/webhook. Any API instance can take it; the secret header proves it's Telegram. */
export async function botRoutes(app: FastifyInstance) {
  const bot = getBot();
  if (!bot || env.BOT_MODE !== 'webhook') return;
  await bot.init();
  const handle = webhookCallback(bot, 'fastify', {
    secretToken: env.BOT_WEBHOOK_SECRET,
    onTimeout: 'return',
    timeoutMilliseconds: 9_000,
  });
  app.post('/bot/webhook', { config: { rateLimit: false } }, handle);
}

/**
 * Local development: long polling instead of a webhook (one process only).
 * Telegram can be out of reach for a while (a filtered network, a VPN reconnecting): the API stays
 * up and the bot keeps trying in the background, instead of one failed request ending the server.
 */
export async function startPolling(log: (m: string) => void) {
  const bot = getBot();
  if (!bot || env.BOT_MODE !== 'polling') return;
  void (async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        await bot.api.deleteWebhook();
        await bot.start({ drop_pending_updates: true, allowed_updates: [...ALLOWED_UPDATES], onStart: (me) => log(`bot @${me.username} polling`) });
        return; // stopped on purpose (stopBot)
      } catch (e) {
        const wait = Math.min(60, 2 ** Math.min(attempt, 6));
        // never let the token reach a log line
        const why = String((e as Error)?.message ?? e).replace(/bot\d+:[\w-]+/g, 'bot<token>');
        log(`Telegram is out of reach (${why}); trying again in ${wait}s`);
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    }
  })();
}

export async function stopBot() {
  if (instance?.isRunning()) await instance.stop();
}
