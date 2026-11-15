/**
 * Zero-install local stack for developing on Windows/macOS without Docker:
 *   - PostgreSQL: embedded-postgres, data kept in apps/server/.local/pg
 *   - Redis: in-memory (ioredis-mock) — decks, counters and presence reset on restart
 *   - S3: files in apps/server/.local/media, served at /media/*
 *   - Telegram: DEV_FAKE_TELEGRAM=true so the Mini App also works in a normal browser (mock user);
 *     with BOT_TOKEN in .env.local the bot runs with long polling and real Telegram logins work too
 *   - Jobs and bot messages run inline (no BullMQ)
 *   - demo profiles, premium plans and an admin (admin / admin12345) on first run
 *
 *   npm run dev:local        (API on http://localhost:4000)
 *
 * Not for production: use deploy/docker-compose.yml there.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mock } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import RedisMock from 'ioredis-mock';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../.local/', import.meta.url));
const mediaDir = join(root, 'media');
mkdirSync(mediaDir, { recursive: true });

const PG_PORT = Number(process.env.LOCAL_PG_PORT ?? 54329);
const API_PORT = Number(process.env.PORT ?? 4000);
const HOST_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${API_PORT}`;
// Media links are relative ("/media/...") unless PUBLIC_BASE_URL is set: the Mini App dev server
// proxies /media, so photos load on localhost and through any tunnel (ngrok…) without configuration.
const MEDIA_BASE = process.env.PUBLIC_BASE_URL ? HOST_URL : '';

process.env.DATABASE_URL = `postgres://postgres:postgres@localhost:${PG_PORT}/vibe`;
process.env.PUBLIC_BASE_URL = HOST_URL;
process.env.DEV_FAKE_TELEGRAM ??= 'true';
process.env.BOT_MODE ??= process.env.BOT_TOKEN ? 'polling' : 'off';
process.env.ADMIN_BOOTSTRAP_USERNAME ??= 'admin';
process.env.ADMIN_BOOTSTRAP_PASSWORD ??= 'admin12345';
process.env.CORS_ORIGINS ??= 'http://localhost:5173,http://localhost:3000';

// ---- in-memory Redis -------------------------------------------------------------------
const redis = new RedisMock();
const redisSub = new RedisMock();
Object.assign(redis, {
  pfadd: async (key: string, ...members: string[]) => redis.sadd(key, ...members),
  pfcount: async (...keys: string[]) => (await redis.sunion(...keys)).length,
});
mock.module('../src/lib/redis.js', {
  namedExports: {
    redis,
    redisSub,
    bullConnection: () => new RedisMock(),
    closeRedis: async () => {},
    dayKey: (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(date),
  },
});

// ---- files on disk ---------------------------------------------------------------------
const safePath = (key: string) => {
  const p = normalize(join(mediaDir, key));
  if (!p.startsWith(normalize(mediaDir))) throw new Error('bad key');
  return p;
};
mock.module('../src/lib/storage.js', {
  namedExports: {
    s3: {},
    putObject: async (key: string, body: Buffer) => {
      const p = safePath(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
    },
    deleteObjects: async (keys: string[]) => {
      await Promise.all(keys.map((k) => rm(safePath(k), { force: true })));
    },
    getObject: async (key: string) => readFile(safePath(key)),
    publicUrl: (key: string) => `${MEDIA_BASE}/media/${key}`,
    signedUrl: async (key: string) => `${MEDIA_BASE}/media/${key}`,
  },
});

// ---- jobs and bot messages run inline ---------------------------------------------------
type BotMessage = import('../src/lib/queue.js').BotMessage;
const pendingWall = new Set<string>();
const sendNow = async (msg: BotMessage) => {
  const { sendBotMessage } = await import('../src/modules/bot/sender.js');
  await sendBotMessage(msg).catch((e: Error) => console.warn('[bot] send failed:', e.message));
};
mock.module('../src/lib/queue.js', {
  namedExports: {
    QUEUE_NAME: 'jobs',
    BOT_QUEUE_NAME: 'bot',
    WALL_QUEUE_NAME: 'wall',
    closeQueue: async () => {},
    enqueueWall: async (job: { name: 'wall-publish' | 'wall-sync'; postId: string }, delayMs = 0) => {
      const key = job.name + job.postId;
      if (pendingWall.has(key)) return; // coalesce like the real queue
      pendingWall.add(key);
      setTimeout(async () => {
        pendingWall.delete(key);
        const tg = await import('../src/modules/wall/telegram.js');
        const run = job.name === 'wall-publish' ? tg.publishToGroup : tg.syncGroupMessage;
        await run(job.postId).catch((e: Error) => console.warn('[wall] group job failed:', e.message));
      }, delayMs);
    },
    enqueue: async (job: { name: string; keys?: string[]; userId?: string; announcementId?: string }) => {
      const storage = await import('../src/lib/storage.js');
      const jobs = await import('../src/jobs.js');
      if (job.name === 'delete-objects' && job.keys) await storage.deleteObjects(job.keys);
      if (job.name === 'account-deleted' && job.userId) await jobs.accountDeleted(job.userId);
      if (job.name === 'announce' && job.announcementId) void jobs.announce(job.announcementId);
    },
    enqueueBotMessage: async (msg: BotMessage) => void sendNow(msg),
    enqueueBotMessages: async (msgs: BotMessage[]) => {
      for (const m of msgs) await sendNow(m);
    },
    // pinned announcements: unpinned here by a plain timer instead of a delayed queue job
    enqueueBotUnpin: async (job: { chatId: string; messageId: number }, delayMs: number) => {
      const { unpinBotMessage } = await import('../src/modules/bot/sender.js');
      setTimeout(() => void unpinBotMessage(job).catch(() => undefined), Math.min(delayMs, 2_147_000_000)).unref();
    },
  },
});

// ---- PostgreSQL ------------------------------------------------------------------------
const pgDir = join(root, 'pg');
const pg = new EmbeddedPostgres({
  databaseDir: pgDir,
  user: 'postgres',
  password: 'postgres',
  port: PG_PORT,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});
const fresh = !existsSync(join(pgDir, 'PG_VERSION'));
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('vibe');

const { runMigrations } = await import('../src/lib/migrate.js');
await runMigrations((m) => console.log('[migrate]', m));
const { bootstrapAdmin } = await import('../src/modules/admin/auth.js');
await bootstrapAdmin((m) => console.log('[admin]', m));

await seed();

const { buildApp } = await import('../src/app.js');
const app = await buildApp();
app.get('/media/*', async (req, reply) => {
  const key = (req.params as { '*': string })['*'];
  try {
    const body = await readFile(safePath(key));
    return reply
      .type(key.endsWith('.jpg') ? 'image/jpeg' : 'image/webp')
      .header('cache-control', 'public, max-age=86400')
      .send(body);
  } catch {
    return reply.status(404).send();
  }
});
await app.listen({ host: '0.0.0.0', port: API_PORT });

const bot = await import('../src/modules/bot/bot.js');
await bot.configureBot((m) => console.log('[bot]', m));
await bot.startPolling((m) => console.log('[bot]', m));

const jobs = await import('../src/jobs.js');
setInterval(() => void jobs.flushCounters().catch(() => {}), 60_000);
setInterval(() => void jobs.dailyStats().catch(() => {}), 60_000);
const wall = await import('../src/modules/wall/service.js');
setInterval(() => void wall.expirePosts().catch(() => {}), 60_000);
// the rest of the worker's schedule, at a development pace
const chatJobs = await import('../src/modules/chat/jobs.js');
const safety = await import('../src/modules/safety/service.js');
setInterval(() => void jobs.expirePremiumPerks().catch(() => {}), 60_000);
setInterval(() => void chatJobs.matchCare().catch(() => {}), 5 * 60_000);
setInterval(() => void wall.wallRequestCare().catch(() => {}), 60_000);
setInterval(() => void safety.trustSweep().catch(() => {}), 10 * 60_000);

console.log(`
  ✅ API:        ${HOST_URL}
  📱 Mini App:   cd apps/miniapp && npm run dev   → http://localhost:5173 (mock Telegram user in the browser)
  🔐 Admin:      admin / admin12345   (cd apps/admin && npm run dev → http://localhost:3000)
  🤖 Bot:        ${process.env.BOT_MODE === 'polling' ? 'long polling with BOT_TOKEN' : 'off (set BOT_TOKEN in .env.local to run it)'}
`);
if (!process.env.BOT_TOKEN && process.env.DEV_FAKE_TELEGRAM === 'true') {
  console.warn('  ⚠️  No BOT_TOKEN: Telegram logins are accepted WITHOUT checking their signature (development only).\n');
}

async function shutdown() {
  await bot.stopBot().catch(() => {});
  await app.close();
  const { closeDb } = await import('../src/lib/db.js');
  await closeDb();
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

// ---- demo data -------------------------------------------------------------------------

async function seed() {
  const { sql } = await import('../src/lib/db.js');
  const marker = join(root, 'seeded');
  if (existsSync(marker)) return;
  const { uuidv7, randomToken, inviteCode } = await import('../src/lib/ids.js');
  const { processPhoto } = await import('../src/lib/images.js');
  const storage = await import('../src/lib/storage.js');

  const women = ['سارا', 'نیلوفر', 'مریم', 'پریا', 'الهام', 'شیدا', 'آیدا', 'ترانه', 'مهسا', 'یاسمن', 'ستاره', 'رها', 'نگار', 'هستی', 'بهار'];
  const men = ['علی', 'امیر', 'رضا', 'آرش', 'پویا', 'کیان', 'سینا', 'مهدی', 'بابک', 'نیما', 'سامان', 'فرهاد', 'آرمان', 'حمید', 'کاوه'];
  const bios = [
    'عاشق سفر و قهوه‌ی تلخ ☕ دنبال یه همراه برای کشف کافه‌های جدید',
    'کتاب، موسیقی و پیاده‌روی‌های شبانه 🌙',
    'زندگی کوتاه‌تر از اونه که جدی بگیریمش 😄',
    'اهل کوه و طبیعت ⛰️ آخر هفته‌ها دلم دشت می‌خواد',
    'برنامه‌نویسم و عاشق گیم 🎮 یه نفر که باهاش بخندم',
    'آشپزی می‌کنم، تو فقط بیا بخور 🍝',
  ];
  const goals = ['serious', 'dating', 'friendship', 'chat', 'marriage', 'unsure'];
  const interests = ['music', 'travel', 'coffee', 'movies', 'gym', 'books', 'nature', 'food', 'art', 'gaming', 'dance', 'photography'];
  const palettes = [
    ['#ff2d6f', '#7c3aed'],
    ['#ff7a45', '#db2777'],
    ['#8b5cf6', '#0ea5e9'],
    ['#f43f5e', '#f59e0b'],
    ['#ec4899', '#6366f1'],
    ['#14b8a6', '#8b5cf6'],
  ];

  async function demoPhoto(seedN: number): Promise<Buffer> {
    const [a, b] = palettes[seedN % palettes.length]!;
    const cx = 200 + ((seedN * 137) % 500);
    const cy = 300 + ((seedN * 211) % 600);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
      <radialGradient id="r"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
      <rect width="900" height="1200" fill="url(#g)"/>
      <circle cx="${cx}" cy="${cy}" r="320" fill="url(#r)"/>
      <circle cx="${900 - cx}" cy="${1200 - cy}" r="220" fill="#000" fill-opacity=".12"/>
      <circle cx="450" cy="470" r="150" fill="#fff" fill-opacity=".18"/>
      <ellipse cx="450" cy="950" rx="300" ry="200" fill="#fff" fill-opacity=".14"/></svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  console.log('[seed] creating demo profiles…');
  let n = 0;
  for (const [gender, names] of [
    ['female', women],
    ['male', men],
  ] as const) {
    for (const name of names) {
      n++;
      const id = uuidv7();
      const year = 1988 + (n % 14);
      const city = [101, 101, 101, 102, 301, 401][n % 6]!;
      const province = Math.floor(city / 100);
      await sql`
        INSERT INTO users (id, telegram_id, tg_first_name, ref_code, status, name, gender, birthdate, interested_in, goal, bio,
                           interests, province_id, city_id, last_active_at, activated_at, height_cm, education)
        VALUES (${id}, ${9_000_000_000 + n}, ${name}, ${inviteCode()}, 'active', ${name}, ${gender},
                ${`${year}-0${(n % 9) + 1}-1${n % 9}`}, ${gender === 'female' ? 'male' : 'female'}, ${goals[n % goals.length]!},
                ${bios[n % bios.length]!}, ${[interests[n % 12]!, interests[(n + 3) % 12]!, interests[(n + 7) % 12]!]},
                ${province}, ${city}, now() - make_interval(mins => ${n * 17}), now() - interval '10 days',
                ${gender === 'female' ? 158 + (n % 15) : 170 + (n % 18)}, ${['bachelor', 'master', 'diploma'][n % 3]!})`;
      for (let k = 0; k < 2; k++) {
        const image = await processPhoto(await demoPhoto(n * 3 + k));
        const pid = uuidv7();
        const key = `photos/${id}/${pid}`;
        const blurKey = `photos/x/${randomToken(16)}.webp`;
        for (const v of image.variants) await storage.putObject(`${key}/${v.name}.webp`, v.body, 'image/webp');
        await storage.putObject(blurKey, image.blur, 'image/webp');
        await sql`
          INSERT INTO photos (id, user_id, position, status, storage_key, blur_key, width, height, color)
          VALUES (${pid}, ${id}, ${k}, 'approved', ${key}, ${blurKey}, ${image.width}, ${image.height}, ${image.color})`;
      }
      await sql`UPDATE users SET photo_count = 2 WHERE id = ${id}`;
    }
  }
  // a few of them already like everybody, so a new user gets matches quickly
  await sql`
    INSERT INTO swipes (swiper_id, target_id, action)
    SELECT a.id, b.id, 1 FROM users a JOIN users b ON a.gender <> b.gender
    WHERE a.telegram_id IN (9000000001, 9000000002, 9000000016, 9000000017) ON CONFLICT DO NOTHING`;
  await sql`
    INSERT INTO plans (id, title, description, duration_days, price_toman, old_price_toman, badge, sort) VALUES
      (${uuidv7()}, 'یک ماهه', 'همه‌ی امکانات ویژه برای ۳۰ روز', 30, 99000, NULL, NULL, 1),
      (${uuidv7()}, 'سه ماهه', 'ماهی فقط ۷۹ هزار تومان', 90, 239000, 297000, 'محبوب‌ترین', 2),
      (${uuidv7()}, 'یک ساله', 'بیشترین تخفیف: ماهی ۵۰ هزار تومان', 365, 599000, 1188000, '۵۰٪ تخفیف', 3)`;
  writeFileSync(marker, new Date().toISOString());
  console.log(`[seed] ${n} demo profiles ready`);
}
