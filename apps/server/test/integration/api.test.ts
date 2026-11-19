/**
 * End-to-end API tests against a real PostgreSQL (embedded) with Redis, storage and queues mocked.
 *   npm run test:integration
 */
import { after, before, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import RedisMock from 'ioredis-mock';
import sharp from 'sharp';

const BOT_TOKEN = '123456:TEST-token';
const PG_PORT = 54391;
process.env.NODE_ENV = 'test';
process.env.BOT_TOKEN = BOT_TOKEN;
process.env.BOT_MODE = 'off';
process.env.DEV_FAKE_TELEGRAM = 'false';
process.env.LLM_API_KEY = 'test-key';
process.env.LLM_BASE_URL = 'https://llm.test/v1';
process.env.LOG_LEVEL = 'fatal';
process.env.DATABASE_URL = `postgres://postgres:postgres@localhost:${PG_PORT}/vibe_test`;

// ---- mocks ---------------------------------------------------------------------------------
const redis = new RedisMock();
const redisSub = new RedisMock();
Object.assign(redis, {
  pfadd: async (key: string, ...members: string[]) => redis.sadd(key, ...members),
  pfcount: async (...keys: string[]) => (await redis.sunion(...keys)).length,
});
mock.module('../../src/lib/redis.js', {
  namedExports: {
    redis,
    redisSub,
    bullConnection: () => new RedisMock(),
    closeRedis: async () => {},
    dayKey: (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(date),
  },
});
const files = new Map<string, Buffer>();
mock.module('../../src/lib/storage.js', {
  namedExports: {
    s3: {},
    putObject: async (key: string, body: Buffer) => void files.set(key, body),
    getObject: async (key: string) => files.get(key) ?? Buffer.alloc(0),
    deleteObjects: async (keys: string[]) => keys.forEach((k) => files.delete(k)),
    publicUrl: (key: string) => `http://media.test/${key}`,
    signedUrl: async (key: string) => `http://media.test/${key}?signed`,
  },
});
const botMessages: { userId: string; chatId: string; text: string }[] = [];
const botUnpins: { chatId: string; messageId: number; delayMs: number }[] = [];
const wallJobs: { name: string; postId: string }[] = [];
const jobs: { name: string; matchId?: string; botId?: string; toId?: string }[] = [];
mock.module('../../src/lib/queue.js', {
  namedExports: {
    QUEUE_NAME: 'jobs',
    BOT_QUEUE_NAME: 'bot',
    WALL_QUEUE_NAME: 'wall',
    enqueueWall: async (job: { name: string; postId: string }) => void wallJobs.push(job),
    closeQueue: async () => {},
    enqueue: async (job: { name: string }) => void jobs.push(job),
    enqueueBotMessage: async (m: { userId: string; chatId: string; text: string }) => void botMessages.push(m),
    enqueueBotMessages: async (ms: { userId: string; chatId: string; text: string }[]) => void botMessages.push(...ms),
    enqueueBotUnpin: async (j: { chatId: string; messageId: number }, delayMs: number) => void botUnpins.push({ ...j, delayMs }),
  },
});

// ---- database ------------------------------------------------------------------------------
const pgDir = mkdtempSync(join(tmpdir(), 'vibe-pg-'));
const pg = new EmbeddedPostgres({ databaseDir: pgDir, user: 'postgres', password: 'postgres', port: PG_PORT, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });

type App = Awaited<ReturnType<typeof import('../../src/app.js').buildApp>>;
let app: App;
let signInitData: typeof import('../../src/lib/telegram.js').signInitData;
let sql: typeof import('../../src/lib/db.js').sql;

before(async () => {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('vibe_test');
  ({ sql } = await import('../../src/lib/db.js'));
  const { runMigrations } = await import('../../src/lib/migrate.js');
  await runMigrations(() => {});
  ({ signInitData } = await import('../../src/lib/telegram.js'));
  const { buildApp } = await import('../../src/app.js');
  app = await buildApp();
  await app.ready();
});

after(async () => {
  await app?.close();
  await sql?.end({ timeout: 2 });
  await pg.stop();
  rmSync(pgDir, { recursive: true, force: true });
});

// ---- helpers -------------------------------------------------------------------------------
let tgSeq = 500_000;
function initDataFor(user: Record<string, unknown>, extra: Record<string, string> = {}, authDate = Math.floor(Date.now() / 1000)) {
  return signInitData({ user: JSON.stringify(user), auth_date: String(authDate), ...extra }, BOT_TOKEN);
}

async function call<T = any>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, token?: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as T) : (null as T) };
}

async function login(opts: { name?: string; startParam?: string; dm?: boolean } = {}) {
  const id = ++tgSeq;
  // every test user logs in from 127.0.0.1: keep the per-IP login limit out of the way
  const limited = await redis.keys('rl:*');
  if (limited.length) await redis.del(...limited);
  const user = { id, first_name: opts.name ?? 'Tester', username: `u${id}`, allows_write_to_pm: opts.dm ?? true };
  const r = await call('POST', '/v1/auth/telegram', undefined, {
    initData: initDataFor(user, opts.startParam ? { start_param: opts.startParam } : {}),
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { token: r.body.accessToken as string, me: r.body.user, isNew: r.body.isNew as boolean, tgId: id, refresh: r.body.refreshToken as string };
}

let photo: Buffer;
async function uploadPhoto(token: string) {
  photo ??= await sharp({ create: { width: 600, height: 800, channels: 3, background: '#ff2d6f' } }).jpeg().toBuffer();
  const boundary = '----vibe' + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    photo,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/me/photos',
    headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  assert.equal(res.statusCode, 200, res.body);
}

async function onboard(token: string, gender: 'male' | 'female', age = 25, name = 'تست') {
  assert.equal((await call('PATCH', '/v1/me', token, { gender, age, name })).status, 200);
  await uploadPhoto(token);
  const r = await call('POST', '/v1/me/complete', token, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'active');
  return r.body;
}

// ---- tests ---------------------------------------------------------------------------------
describe('Telegram login', () => {
  test('valid init data creates the account once', async () => {
    const user = { id: 424242, first_name: 'Milad', username: 'milad' };
    const first = await call('POST', '/v1/auth/telegram', undefined, { initData: initDataFor(user) });
    assert.equal(first.status, 200);
    assert.equal(first.body.isNew, true);
    assert.equal(first.body.user.status, 'onboarding');
    assert.equal(first.body.user.name, 'Milad');
    const again = await call('POST', '/v1/auth/telegram', undefined, { initData: initDataFor(user) });
    assert.equal(again.body.isNew, false);
    assert.equal(again.body.user.id, first.body.user.id);
  });

  test('tampered, expired and unsigned init data are refused', async () => {
    const good = initDataFor({ id: 777, first_name: 'A' });
    const tampered = good.replace('%22A%22', '%22B%22');
    assert.equal((await call('POST', '/v1/auth/telegram', undefined, { initData: tampered })).status, 401);
    const old = initDataFor({ id: 777, first_name: 'A' }, {}, Math.floor(Date.now() / 1000) - 3 * 86400);
    const expired = await call('POST', '/v1/auth/telegram', undefined, { initData: old });
    assert.equal(expired.status, 401);
    assert.equal(expired.body.details.reason, 'expired');
    const dev = new URLSearchParams({ user: JSON.stringify({ id: 1, first_name: 'x' }), auth_date: String(Date.now() / 1000 | 0), hash: 'dev' }).toString();
    assert.equal((await call('POST', '/v1/auth/telegram', undefined, { initData: dev })).status, 401);
  });

  test('refresh tokens rotate and a reused one revokes the session', async () => {
    const a = await login();
    const r1 = await call('POST', '/v1/auth/refresh', undefined, { refreshToken: a.refresh });
    assert.equal(r1.status, 200);
    assert.equal((await call('POST', '/v1/auth/refresh', undefined, { refreshToken: a.refresh })).status, 401);
    assert.equal((await call('POST', '/v1/auth/refresh', undefined, { refreshToken: r1.body.refreshToken })).status, 401);
  });
});

describe('onboarding', () => {
  test('only gender and age are asked for; a profile with no photo is fine', async () => {
    const u = await login();
    // the name came from Telegram with the login, so only gender and age are missing
    const early = await call('POST', '/v1/me/complete', u.token, {});
    assert.equal(early.status, 400);
    assert.deepEqual(
      early.body.details.map((d: { path: string }) => d.path).sort(),
      ['birthdate', 'gender'],
      'a photo is not among the things sign-up needs',
    );
    assert.equal((await call('PATCH', '/v1/me', u.token, { gender: 'female', age: 24 })).body.interestedIn, 'male');
    const done = await call('POST', '/v1/me/complete', u.token, {});
    assert.equal(done.body.status, 'active');
    assert.ok(done.body.activatedAt);
    assert.deepEqual(done.body.photos, [], 'no picture at all, and the account is live');
    // gender and age are locked once live
    assert.equal((await call('PATCH', '/v1/me', u.token, { gender: 'male' })).status, 403);
    assert.equal((await call('PATCH', '/v1/me', u.token, { age: 30 })).status, 403);
  });

  test('someone with no photo is still shown, and can still be written to', async () => {
    const bare = await login({ name: 'Bare' });
    assert.equal((await call('PATCH', '/v1/me', bare.token, { gender: 'female', age: 26 })).status, 200);
    assert.equal((await call('POST', '/v1/me/complete', bare.token, {})).body.status, 'active');

    const him = await login();
    await onboard(him.token, 'male', 30);
    const deck = await call('GET', '/v1/discover?limit=30', him.token);
    const card = deck.body.items.find((c: { id: string }) => c.id === bare.me.id);
    assert.ok(card, 'a profile without a picture is in the deck like any other');
    assert.deepEqual(card.photos, []);
    assert.ok(card.name, 'their name is what there is to show');
    assert.equal((await call('POST', '/v1/discover/chat', him.token, { targetId: bare.me.id, text: 'سلام!' })).status, 200);
  });

  test('under-age is refused', async () => {
    const u = await login();
    const r = await call('PATCH', '/v1/me', u.token, { gender: 'male', age: 16 });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'underage');
  });
});

describe('admin: a user reset to a newcomer', () => {
  test('the account is wiped and the next login starts from zero', async () => {
    const { resetAccount } = await import('../../src/modules/users/lifecycle.js');
    const u = await login({ name: 'Reset' });
    await onboard(u.token, 'male', 28);

    assert.equal(await resetAccount(u.me.id), true);
    const [old] = await sql<{ status: string; telegram_id: string | null; name: string | null }[]>`
      SELECT status, telegram_id, name FROM users WHERE id = ${u.me.id}`;
    assert.deepEqual([old!.status, old!.telegram_id, old!.name], ['deleted', null, null]);
    const [photos] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM photos WHERE user_id = ${u.me.id}`;
    assert.equal(photos!.n, 0, 'his photos are gone');
    assert.equal((await call('GET', '/v1/me', u.token)).status, 401, 'the old session is dead');

    // the same Telegram account opens the app again: a brand-new, empty account
    const again = await call('POST', '/v1/auth/telegram', undefined, { initData: initDataFor({ id: u.tgId, first_name: 'Reset', username: `u${u.tgId}` }) });
    assert.equal(again.status, 200);
    assert.equal(again.body.isNew, true);
    assert.equal(again.body.user.status, 'onboarding');
    assert.notEqual(again.body.user.id, u.me.id);

    assert.equal(await resetAccount(u.me.id), false, 'an account that is already deleted has nothing to reset');
    assert.equal(await resetAccount('00000000-0000-7000-8000-000000000000'), false, 'no such user');
  });
});

describe('discovery: a card, a message, a chat', () => {
  test('writing to a card opens the conversation at once; an offline peer is told on Telegram, throttled', async () => {
    const he = await login({ name: 'Ali' });
    const she = await login({ name: 'Sara' });
    await onboard(he.token, 'male', 28, 'علی');
    const sara = await onboard(she.token, 'female', 26, 'سارا');

    const deck = await call('GET', '/v1/discover?limit=30', he.token);
    const card = deck.body.items.find((c: { id: string }) => c.id === sara.id);
    assert.ok(card, 'she is in his deck');
    assert.equal(card.newcomer, true);
    assert.equal('goal' in card, false, 'a card carries only the few things the profile still has');

    botMessages.length = 0;
    const open = await call('POST', '/v1/discover/chat', he.token, { targetId: sara.id, text: 'سلام سارا! 👋' });
    assert.equal(open.status, 200, JSON.stringify(open.body));
    assert.equal(open.body.existing, false);
    const matchId = open.body.matchId as string;
    assert.ok(matchId);

    // she has the conversation, with his first message in it, without doing anything
    const hers = await call('GET', '/v1/conversations', she.token);
    assert.equal(hers.body.items.length, 1);
    assert.equal(hers.body.items[0].id, matchId);
    assert.equal(hers.body.items[0].unread, 1);
    assert.deepEqual(hers.body.items[0].origin, { kind: 'message', by: he.me.id });

    // writing to her again just opens the conversation that is already there
    const again = await call('POST', '/v1/discover/chat', he.token, { targetId: sara.id, text: 'سلام دوباره' });
    assert.equal(again.status, 200);
    assert.deepEqual([again.body.matchId, again.body.existing], [matchId, true]);

    for (const text of ['خوبی؟', 'کجایی؟']) {
      const r = await call('POST', `/v1/conversations/${matchId}/messages`, he.token, { text, clientId: 'c' + Math.random().toString(36).slice(2, 12) });
      assert.equal(r.status, 200);
    }
    // push is fire-and-forget; give it a tick
    await new Promise((r) => setTimeout(r, 50));
    const toHer = botMessages.filter((b) => b.chatId === String(she.tgId));
    assert.equal(toHer.length, 1, 'one Telegram message per conversation per cooldown');
    assert.match(toHer[0]!.text, /پیام/);

    const list = await call('GET', '/v1/conversations', she.token);
    assert.equal(list.body.items[0].unread, 3);
    const msgs = await call('GET', `/v1/conversations/${matchId}/messages`, she.token);
    await call('POST', `/v1/conversations/${matchId}/read`, she.token, { upTo: msgs.body.items[0].id });
    assert.equal((await call('GET', '/v1/conversations', she.token)).body.items[0].unread, 0);

    // idempotent send: the same clientId twice stores one message
    const a = await call('POST', `/v1/conversations/${matchId}/messages`, she.token, { text: 'hi', clientId: 'dup-client-01' });
    const b = await call('POST', `/v1/conversations/${matchId}/messages`, she.token, { text: 'hi', clientId: 'dup-client-01' });
    assert.equal(a.body.id, b.body.id);
  });

  test('a skipped card does not come back, and the daily limit on new chats is the same for everyone', async () => {
    const { saveSettings, getSettings } = await import('../../src/modules/settings/settings.js');
    const he = await login();
    await onboard(he.token, 'male', 30);
    const she = await login();
    const her = await onboard(she.token, 'female', 27);

    assert.equal((await call('POST', '/v1/discover/skip', he.token, { targetId: her.id })).status, 200);
    const deck = await call('GET', '/v1/discover?limit=30', he.token);
    assert.equal(deck.body.items.some((c: { id: string }) => c.id === her.id), false, 'skipped: gone from the deck');
    // a skip is not a block: he can still write to her if he reaches her another way
    assert.equal((await call('POST', '/v1/discover/chat', he.token, { targetId: her.id, text: 'سلام!' })).status, 200);

    const before = (await getSettings()).matching;
    await saveSettings({ matching: { ...before, dailyNewChats: 1 } }, null);
    try {
      const other = await login();
      const them = await onboard(other.token, 'female', 24);
      const over = await call('POST', '/v1/discover/chat', he.token, { targetId: them.id, text: 'سلام!' });
      assert.equal(over.status, 429);
      assert.equal(over.body.code, 'chat_daily_limit');
    } finally {
      await saveSettings({ matching: before }, null);
    }
  });

  test('a first message cannot carry a phone number or an id', async () => {
    const he = await login();
    await onboard(he.token, 'male', 29);
    const she = await login();
    const her = await onboard(she.token, 'female', 25);
    const r = await call('POST', '/v1/discover/chat', he.token, { targetId: her.id, text: 'سلام، تلگرامم @alialavi' });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'contact_info');
  });
});

describe('Telegram init data parser', () => {
  test('start parameters', async () => {
    const { parseStartParam } = await import('../../src/lib/telegram.js');
    assert.deepEqual(parseStartParam('s_wall'), { kind: 'screen', name: 'wall' });
    assert.deepEqual(parseStartParam('u_0192f0a0-0000-7000-8000-000000000001'), {
      kind: 'user',
      userId: '0192f0a0-0000-7000-8000-000000000001',
    });
    assert.equal(parseStartParam('chat_not-a-uuid'), null);
    assert.equal(parseStartParam('pay_0192f0a0-0000-7000-8000-000000000001'), null, 'nothing is for sale any more');
    assert.equal(parseStartParam('s_<script>'), null);
  });

  test('deep links open the bot’s main Mini App: no app short name in them', async () => {
    const { miniAppLink, env } = await import('../../src/config.js');
    assert.equal(miniAppLink(), `https://t.me/${env.BOT_USERNAME}?startapp`);
    assert.equal(miniAppLink('w_123'), `https://t.me/${env.BOT_USERNAME}?startapp=w_123`);
    assert.doesNotMatch(miniAppLink('s_wall'), new RegExp(`${env.BOT_USERNAME}/`));
  });
});

describe('the Wall', () => {
  async function pair() {
    const her = await login({ name: 'Neda' });
    const him = await login({ name: 'Arash' });
    await onboard(her.token, 'female', 24, 'ندا');
    await onboard(him.token, 'male', 27, 'آرش');
    return { her, him };
  }
  const post = (token: string, body: Record<string, unknown>) =>
    call('POST', '/v1/wall', token, { lookingFor: 'male', showPhoto: true, toGroup: true, ...body });

  test('a request shows on the wall, with the author, and goes to the Telegram group', async () => {
    const { saveSettings, getSettings } = await import('../../src/modules/settings/settings.js');
    const wall = (await getSettings()).wall;
    await saveSettings({ wall: { ...wall, telegram: { enabled: true, chatId: '-1001234567890', link: 'https://t.me/vibe_wall' } } }, null);
    const { her, him } = await pair();
    wallJobs.length = 0;
    const created = await post(her.token, { text: 'دنبال یه هم‌صحبت خوش‌اخلاق برای عصرها هستم ☕' });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.mine, true);
    assert.ok(created.body.author.photo, 'author photo shown');
    assert.deepEqual(wallJobs, [{ name: 'wall-publish', postId: created.body.id }]);

    const feed = await call('GET', '/v1/wall?gender=female', him.token);
    const item = feed.body.items.find((i: { id: string }) => i.id === created.body.id);
    assert.ok(item, 'visible to others');
    assert.equal(item.author.name, 'ندا');
    assert.equal(item.mine, false);
    assert.equal(item.chatCount, undefined, 'only the author sees how many chats it started');
    const males = await call('GET', '/v1/wall?gender=male', him.token);
    assert.ok(!males.body.items.some((i: { id: string }) => i.id === created.body.id));
    await saveSettings({ wall: { ...wall, telegram: { enabled: false, chatId: '', link: '' } } }, null);
  });

  test('contact details are refused; one live request at a time, edited in place', async () => {
    const { her } = await pair();
    for (const text of ['شماره‌ام ۰۹۱۲۱۲۳۴۵۶۷ پیام بده', 'آیدی من @someone_here', 'بیا اینستا instagram.com/x']) {
      const r = await post(her.token, { text });
      assert.equal(r.status, 400, text);
      assert.equal(r.body.code, 'contact_info');
    }
    const first = await post(her.token, { text: 'کی پایه‌ی کوهنوردی جمعه‌هاست؟ ⛰️' });
    assert.equal(first.status, 200);
    const second = await post(her.token, { text: 'یه درخواست دیگه برای امروز' });
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'wall_active_limit');
    let mine = await call('GET', '/v1/wall/mine', her.token);
    assert.equal(mine.body.canPost, false);
    assert.equal(mine.body.postsLeft, 0);

    // editing instead of reposting
    const bad = await call('PATCH', `/v1/wall/${first.body.id}`, her.token, { text: 'زنگ بزن ۰۹۱۲۱۲۳۴۵۶۷', lookingFor: 'male' });
    assert.equal(bad.body.code, 'contact_info');
    const edited = await call('PATCH', `/v1/wall/${first.body.id}`, her.token, { text: 'کی پایه‌ی کوهنوردی پنجشنبه‌هاست؟ ⛰️', lookingFor: 'everyone' });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.text, 'کی پایه‌ی کوهنوردی پنجشنبه‌هاست؟ ⛰️');
    assert.equal(edited.body.lookingFor, 'everyone');
    assert.ok(edited.body.editedAt);

    // deleting doesn't open the door to reposting at once: there's a pause between requests…
    assert.equal((await call('DELETE', `/v1/wall/${first.body.id}`, her.token)).status, 200);
    const soon = await post(her.token, { text: 'یه درخواست تازه بعد از حذف قبلی' });
    assert.equal(soon.status, 429);
    assert.equal(soon.body.code, 'wall_limit');
    mine = await call('GET', '/v1/wall/mine', her.token);
    assert.equal(mine.body.canPost, false);
    assert.ok(mine.body.nextPostAt);
    // …counted from when the last one was posted
    await sql`UPDATE wall_posts SET created_at = now() - interval '23 hours' WHERE user_id = ${her.me.id}`;
    assert.equal((await call('GET', '/v1/wall/mine', her.token)).body.canPost, false, 'one a day, for everyone');
    await sql`UPDATE wall_posts SET created_at = now() - interval '25 hours' WHERE user_id = ${her.me.id}`;
    assert.equal((await call('GET', '/v1/wall/mine', her.token)).body.canPost, true);
    assert.equal((await post(her.token, { text: 'یه درخواست تازه بعد از حذف قبلی' })).status, 200);
  });

  test('likes count once, the author sees who liked, and can not like their own', async () => {
    const { her, him } = await pair();
    const p = (await post(her.token, { text: 'دنبال همسفر برای شمال، آخر هفته 🌊' })).body;
    assert.equal((await call('POST', `/v1/wall/${p.id}/like`, her.token, {})).status, 400);
    assert.equal((await call('POST', `/v1/wall/${p.id}/like`, him.token, {})).body.likeCount, 1);
    assert.equal((await call('POST', `/v1/wall/${p.id}/like`, him.token, {})).body.likeCount, 1, 'idempotent');
    const likers = await call('GET', `/v1/wall/${p.id}/likers`, her.token);
    assert.deepEqual(likers.body.items.map((l: { id: string }) => l.id), [him.me.id]);
    assert.equal((await call('GET', `/v1/wall/${p.id}/likers`, him.token)).status, 404, 'only the author');
    assert.equal((await call('DELETE', `/v1/wall/${p.id}/like`, him.token)).body.likeCount, 0);
  });

  test('answering a request writes to the author and the conversation opens at once', async () => {
    const { her, him } = await pair();
    const other = await login();
    await onboard(other.token, 'female', 30);
    const p = (await post(her.token, { text: 'یه آقای اهل کتاب برای گپ‌های شبانه 📚', lookingFor: 'male' })).body;
    const no = await call('POST', `/v1/wall/${p.id}/chat`, other.token, { text: 'سلام' });
    assert.equal(no.status, 403);
    assert.equal(no.body.code, 'wall_not_for_you');
    const sneaky = await call('POST', `/v1/wall/${p.id}/chat`, him.token, { text: 'بهم پیام بده ۰۹۱۲۱۲۳۴۵۶۷' });
    assert.equal(sneaky.body.code, 'contact_info', 'no contact details in the first message either');

    botMessages.length = 0;
    const sent = await call('POST', `/v1/wall/${p.id}/chat`, him.token, { text: 'سلام! منم عاشق کتابم 📖' });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.existing, false);
    const matchId = sent.body.matchId as string;
    assert.ok(matchId);
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(botMessages.some((m) => m.chatId === String(her.tgId) && /پیام/.test(m.text)), 'author told on Telegram');

    // she has the conversation, with his message in it, and it says where it came from
    const convs = await call('GET', '/v1/conversations', her.token);
    const c = convs.body.items.find((x: { id: string }) => x.id === matchId);
    assert.ok(c, 'the conversation is open');
    assert.equal(c.unread, 1, 'his message is its first one');
    assert.equal(c.origin.kind, 'wall', 'the chat knows it came from the Wall');
    assert.equal(c.origin.postId, p.id);
    assert.equal(c.origin.author, her.me.id);
    assert.equal(c.origin.requester, him.me.id);
    assert.ok(c.origin.text, 'and what the post said');

    // writing again just opens the same conversation; the author sees how many it started
    const again = await call('POST', `/v1/wall/${p.id}/chat`, him.token, { text: 'چه کتابی می‌خونی؟' });
    assert.equal(again.status, 200);
    assert.deepEqual([again.body.matchId, again.body.existing], [matchId, true]);
    const seen = await call('GET', `/v1/wall/${p.id}`, him.token);
    assert.equal(seen.body.matchId, matchId, '«continue the conversation» link');
    const mine = await call('GET', '/v1/wall/mine', her.token);
    assert.equal(mine.body.items[0].chatCount, 1);
  });

  test('a request reported by enough people is taken down', async () => {
    const { her } = await pair();
    const p = (await post(her.token, { text: 'یه متن عادی ولی گزارش‌شده برای تست' })).body;
    for (let i = 0; i < 3; i++) {
      const r = await login();
      await onboard(r.token, 'male');
      assert.equal((await call('POST', `/v1/wall/${p.id}/report`, r.token, { reason: 'spam' })).status, 200);
    }
    assert.equal((await call('GET', `/v1/wall/${p.id}`, (await login()).token)).status, 403, 'onboarding users cannot use the wall');
    const viewer = await login();
    await onboard(viewer.token, 'male');
    assert.equal((await call('GET', `/v1/wall/${p.id}`, viewer.token)).status, 404);
    const [row] = await sql<{ status: string }[]>`SELECT status FROM wall_posts WHERE id = ${p.id}`;
    assert.equal(row!.status, 'removed');
  });

  test('photos are live as soon as they are uploaded', async () => {
    const u = await login();
    const me = await onboard(u.token, 'male');
    assert.equal(me.photos[0].status, 'approved');
  });
});

describe('the Wall feed', () => {
  test('«for me» shows only requests the viewer can answer, and points to an existing chat', async () => {
    const her = await login();
    const him = await login();
    await onboard(her.token, 'female', 25);
    await onboard(him.token, 'male', 28);
    const forMen = (await call('POST', '/v1/wall', her.token, { text: 'یه آقای اهل موسیقی برای گپ', lookingFor: 'male' })).body;
    const other = await login();
    await onboard(other.token, 'female', 26);
    const forWomen = (await call('POST', '/v1/wall', other.token, { text: 'یه دوست دختر برای کافه‌گردی', lookingFor: 'female' })).body;

    const all = (await call('GET', '/v1/wall?limit=30', him.token)).body.items.map((i: { id: string }) => i.id);
    assert.ok(all.includes(forMen.id) && all.includes(forWomen.id));
    const mine = (await call('GET', '/v1/wall?limit=30&forMe=1', him.token)).body.items.map((i: { id: string }) => i.id);
    assert.ok(mine.includes(forMen.id));
    assert.ok(!mine.includes(forWomen.id), 'a request for women is hidden from a man with «for me»');

    const chat = await call('POST', `/v1/wall/${forMen.id}/chat`, him.token, { text: 'سلام!' });
    assert.equal(chat.status, 200);
    const post = await call('GET', `/v1/wall/${forMen.id}`, him.token);
    assert.equal(post.body.matchId, chat.body.matchId, 'the card points at the conversation it opened');
  });
});

describe('pictures on bot messages', () => {
  test('a slot image is uploaded to Telegram once, then reused by file_id; long or picture-less texts go as text', async () => {
    const { saveBotMedia, sendWithMedia, removeBotMedia, forgetBotMediaCache } = await import('../../src/modules/bot/media.js');
    const calls: { kind: 'photo' | 'text'; photo?: unknown; caption?: string }[] = [];
    const fakeApi = {
      sendPhoto: async (_chat: unknown, photo: unknown, opts: { caption?: string }) => {
        calls.push({ kind: 'photo', photo, caption: opts.caption });
        return { message_id: calls.length, photo: [{ file_id: 'small' }, { file_id: 'TG_FILE_1' }] };
      },
      sendMessage: async () => {
        calls.push({ kind: 'text' });
        return { message_id: calls.length };
      },
    } as unknown as import('grammy').Api;

    // nothing uploaded yet: plain text
    await sendWithMedia(fakeApi, 1, 'message', '<b>پیام جدید!</b>');
    assert.equal(calls.at(-1)!.kind, 'text');

    const png = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#2a1640' } }).png().toBuffer();
    const admin = '00000000-0000-7000-8000-000000000001';
    await saveBotMedia('default', png, admin);
    forgetBotMediaCache();

    // a slot without its own picture uses the default one: uploaded the first time…
    await sendWithMedia(fakeApi, 1, 'message', '<b>پیام جدید!</b>');
    assert.equal(calls.at(-1)!.kind, 'photo');
    assert.notEqual(typeof calls.at(-1)!.photo, 'string', 'first send uploads the bytes');
    assert.equal(calls.at(-1)!.caption, '<b>پیام جدید!</b>');
    forgetBotMediaCache();
    // …and named by its Telegram id afterwards
    await sendWithMedia(fakeApi, 1, 'wall_like', 'یک نفر درخواستت رو لایک کرد');
    assert.equal(calls.at(-1)!.photo, 'TG_FILE_1', 'later sends reuse the file_id');

    // a caption can't hold more than 1024 characters
    await sendWithMedia(fakeApi, 1, 'start', 'x'.repeat(1100));
    assert.equal(calls.at(-1)!.kind, 'text');

    // replacing the picture forgets the old Telegram id
    await saveBotMedia('default', png, admin);
    forgetBotMediaCache();
    await sendWithMedia(fakeApi, 1, 'start', 'سلام');
    assert.notEqual(typeof calls.at(-1)!.photo, 'string', 'a new picture is uploaded again');

    await removeBotMedia('default');
    forgetBotMediaCache();
  });
});

describe('the Markdown an admin writes', () => {
  test('becomes the HTML Telegram understands, and a bad link is refused before anything is sent', async () => {
    const { telegramHtml } = await import('../../src/lib/markdown.js');
    assert.equal(telegramHtml('*مهم* و _کج_'), '<b>مهم</b> و <i>کج</i>');
    assert.equal(telegramHtml('**پررنگ** __زیرخط__ ~~خط‌خورده~~ ||مخفی||'), '<b>پررنگ</b> <u>زیرخط</u> <s>خط‌خورده</s> <tg-spoiler>مخفی</tg-spoiler>');
    assert.equal(telegramHtml('[پشتیبانی](https://t.me/vibe?text=%D8%B3%D9%84%D8%A7%D9%85)'), '<a href="https://t.me/vibe?text=%D8%B3%D9%84%D8%A7%D9%85">پشتیبانی</a>');
    // anything that looks like a tag is text, never markup
    assert.equal(telegramHtml('<b>دستی</b> & <script>'), '&lt;b&gt;دستی&lt;/b&gt; &amp; &lt;script&gt;');
    // a marker glued to a word is left alone (snake_case, and the emoji-heavy texts admins paste)
    assert.equal(telegramHtml('نام_کاربری_من'), 'نام_کاربری_من');
    assert.equal(telegramHtml('🔥 فقط امروز! ۵۰٪ تخفیف 🔥'), '🔥 فقط امروز! ۵۰٪ تخفیف 🔥');
    // code is text, whatever it holds
    assert.equal(telegramHtml('`*نه*`'), '<code>*نه*</code>');
    assert.throws(() => telegramHtml('[بزن](javascript:alert(1))'), /معتبر نیست/);
    assert.throws(() => telegramHtml('[بزن](ftp://x.com/a)'), /معتبر نیست/);
    // a quote inside a link can't break out of the attribute
    assert.match(telegramHtml('[x](https://a.com/%22onmouseover=1)'), /^<a href="https:\/\/a\.com\/%22onmouseover=1">x<\/a>$/);
  });
});

describe('announcements with a picture and a button', () => {
  test('the admin’s picture and button ride along; the picture is uploaded once, then named by its id', async () => {
    const { saveAnnouncementImage, sendAnnouncementMedia, forgetBotMediaCache } = await import('../../src/modules/bot/media.js');
    const { announce } = await import('../../src/jobs.js');
    const u = await login();
    await onboard(u.token, 'male', 28);

    const png = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#2a1640' } }).png().toBuffer();
    const img = await saveAnnouncementImage(png);
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO announcements (title, body, segment, via_bot, image_key, image_preview, button_text, button_url)
      VALUES ('خبر تازه', 'یه خبر کوتاه', '{}'::jsonb, true, ${img.key}, ${img.preview}, 'گفتگو با پشتیبانی', 'https://t.me/vibe_support')
      RETURNING id`;
    const id = String(row!.id);

    botMessages.length = 0;
    await announce(id);
    const queued = botMessages.find((m) => m.chatId === String(u.tgId)) as unknown as
      | { button?: { text: string; url?: string }; announcementId?: string }
      | undefined;
    assert.ok(queued, 'the announcement is queued for him');
    assert.deepEqual(
      queued.button,
      [{ text: 'گفتگو با پشتیبانی', url: 'https://t.me/vibe_support' }, { text: '🔥 ورود به Vibe Chat' }],
      'the admin’s own button, and the way into the app under it — one message, two buttons',
    );
    assert.equal(queued.announcementId, id, 'and the announcement its picture belongs to');

    // the keyboard itself: two rows, the second one opening the Mini App
    const { keyboardFor } = await import('../../src/modules/bot/sender.js');
    const rows = keyboardFor(queued.button)!.inline_keyboard;
    assert.equal(rows.length, 2);
    assert.equal((rows[0]![0] as { url: string }).url, 'https://t.me/vibe_support');
    assert.ok((rows[1]![0] as { url?: string; web_app?: unknown }).url ?? (rows[1]![0] as { web_app?: unknown }).web_app, 'the second one goes to the app');

    // a button the admin left without a link already opens the app: it is not doubled
    const [plainBtn] = await sql<{ id: string }[]>`
      INSERT INTO announcements (title, body, via_bot, button_text) VALUES ('بدون لینک', 'متن', true, 'بزن بریم') RETURNING id`;
    botMessages.length = 0;
    await announce(String(plainBtn!.id));
    const one = botMessages.find((m) => m.chatId === String(u.tgId)) as unknown as { button?: unknown[] } | undefined;
    assert.deepEqual(one?.button, [{ text: 'بزن بریم' }], 'one button, which is the app itself');

    const calls: { photo: unknown; caption?: string }[] = [];
    const fakeApi = {
      sendPhoto: async (_chat: unknown, photo: unknown, opts: { caption?: string }) => {
        calls.push({ photo, caption: opts.caption });
        return { message_id: calls.length, photo: [{ file_id: 'small' }, { file_id: 'ANNOUNCE_FILE' }] };
      },
      sendMessage: async () => {
        calls.push({ photo: 'TEXT' });
        return { message_id: calls.length };
      },
    } as unknown as import('grammy').Api;

    // the first receiver uploads the picture, everyone after that just names it
    await sendAnnouncementMedia(fakeApi, 1, id, '<b>خبر تازه</b>');
    assert.notEqual(typeof calls.at(-1)!.photo, 'string', 'the first message uploads the bytes');
    assert.equal(calls.at(-1)!.caption, '<b>خبر تازه</b>');
    await sendAnnouncementMedia(fakeApi, 2, id, '<b>خبر تازه</b>');
    assert.equal(calls.at(-1)!.photo, 'ANNOUNCE_FILE', 'later messages reuse the file_id');

    // pinned for a day: the pin goes out with the message and its unpin is booked straight away
    const [pinned] = await sql<{ id: string }[]>`
      INSERT INTO announcements (title, body, via_bot, pin_hours) VALUES ('سنجاق', 'متن', true, 24) RETURNING id`;
    botMessages.length = 0;
    await announce(String(pinned!.id));
    const withPin = botMessages.find((m) => m.chatId === String(u.tgId)) as unknown as { pinHours?: number } | undefined;
    assert.equal(withPin?.pinHours, 24, 'the sender is told how long to keep it pinned');

    // a whole broadcast: the picture is uploaded once and named by its id for everyone else,
    // whether the messages go one after another or ten workers send them at the same moment
    const uploads = () => calls.filter((c) => typeof c.photo !== 'string').length;
    const before = uploads();
    for (let i = 0; i < 6; i++) await sendAnnouncementMedia(fakeApi, 100 + i, id, 'متن');
    await Promise.all(Array.from({ length: 10 }, (_, i) => sendAnnouncementMedia(fakeApi, 200 + i, id, 'متن')));
    assert.equal(uploads() - before, 0, '16 more messages, not one more upload');
    assert.equal(calls.slice(-16).every((c) => c.photo === 'ANNOUNCE_FILE'), true, 'every one of them named the same picture');

    // a brand new picture with ten senders starting at the same moment: one uploads, the others
    // wait for its file_id instead of each uploading their own copy
    const fresh = await saveAnnouncementImage(png);
    const [race] = await sql<{ id: string }[]>`
      INSERT INTO announcements (title, body, via_bot, image_key) VALUES ('هم‌زمان', 'متن', true, ${fresh.key}) RETURNING id`;
    const at = calls.length;
    await Promise.all(Array.from({ length: 10 }, (_, i) => sendAnnouncementMedia(fakeApi, 300 + i, String(race!.id), 'متن')));
    const raced = calls.slice(at);
    assert.equal(raced.filter((c) => typeof c.photo !== 'string').length, 1, 'ten at once, one upload');
    assert.equal(raced.filter((c) => c.photo === 'ANNOUNCE_FILE').length, 9, 'the other nine named it');

    // an announcement without its own picture falls back to the «announcement» slot (none here: text)
    const [plain] = await sql<{ id: string }[]>`INSERT INTO announcements (title, body, via_bot) VALUES ('بدون عکس', 'متن', true) RETURNING id`;
    forgetBotMediaCache();
    await sendAnnouncementMedia(fakeApi, 3, String(plain!.id), 'متن');
    assert.equal(calls.at(-1)!.photo, 'TEXT', 'no picture anywhere: plain text');
  });
});

describe('first impressions', () => {
  test('a newcomer is put in front of people online now', async () => {
    const { saveSettings, getSettings } = await import('../../src/modules/settings/settings.js');
    const before = (await getSettings()).newcomerFanout;
    await saveSettings({ newcomerFanout: 500 }, null);
    const him = await login();
    await onboard(him.token, 'male', 29);
    await call('GET', '/v1/discover?limit=1', him.token); // he has a deck already
    const newcomer = await login();
    await onboard(newcomer.token, 'female', 27);
    const next = await call('GET', '/v1/discover?limit=1', him.token);
    assert.equal(next.body.items[0]?.id, newcomer.me.id, 'the newcomer comes next in his deck');
    await saveSettings({ newcomerFanout: before }, null);
  });
});

describe('the rules of the app', () => {
  const say = (token: string, matchId: string, text: string) =>
    call('POST', `/v1/conversations/${matchId}/messages`, token, { text, clientId: 'c' + Math.random().toString(36).slice(2).padEnd(10, '0') });
  const forget = (id: string) => redis.del(`ust:${id}`, `card:${id}`);
  const write = (token: string, targetId: string, text = 'سلام! 👋') => call('POST', '/v1/discover/chat', token, { targetId, text });

  /** One writes to the other: returns the conversation id. */
  async function talking(a: { token: string }, b: { me: { id: string } }) {
    const r = await write(a.token, b.me.id);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.matchId as string;
  }

  /** The viewer's own deck, from scratch. */
  async function deck(u: { token: string }) {
    await call('POST', '/v1/discover/reset', u.token, {});
    const r = await call('GET', '/v1/discover?limit=30', u.token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body as { items: { id: string }[]; exhausted: boolean };
  }

  test('an age range only filters once its owner chose it', async () => {
    const older = await login();
    await onboard(older.token, 'male', 52);
    const she = await login();
    await onboard(she.token, 'female', 25);

    let me = await call('GET', '/v1/me', she.token);
    assert.equal(me.body.preferences.ageSet, false);
    assert.deepEqual([me.body.preferences.minAge, me.body.preferences.maxAge], [18, 99], 'every age until she chooses');
    assert.ok((await deck(she)).items.some((i) => i.id === older.me.id), 'a suggestion hides nobody');
    assert.ok((await deck(older)).items.some((i) => i.id === she.me.id));

    assert.equal((await call('PATCH', '/v1/me/preferences', she.token, { minAge: 20, maxAge: 30 })).status, 200);
    me = await call('GET', '/v1/me', she.token);
    assert.equal(me.body.preferences.ageSet, true);
    assert.equal((await deck(she)).items.some((i) => i.id === older.me.id), false, 'now it is her choice: he is outside it');
    assert.equal((await deck(older)).items.some((i) => i.id === she.me.id), false, 'and he is not shown someone who excluded his age');
  });

  test('a shadow-banned account reaches nobody', async () => {
    const ghost = await login({ name: 'Ghost' });
    await onboard(ghost.token, 'male', 28);
    const friend = await login();
    await onboard(friend.token, 'female', 26);
    const stranger = await login();
    await onboard(stranger.token, 'female', 25);
    const matchId = await talking(ghost, friend); // from before the ban

    await sql`UPDATE users SET shadow_banned = true WHERE id = ${ghost.me.id}`;
    await forget(ghost.me.id);

    // a new conversation looks open to him, and never arrives
    botMessages.length = 0;
    const opened = await write(ghost.token, stranger.me.id, 'سلام! آشنا بشیم؟');
    assert.equal(opened.status, 200);
    assert.ok(opened.body.matchId, 'he is shown a conversation');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal((await call('GET', '/v1/conversations', stranger.token)).body.items.length, 0, 'she has nothing');
    assert.ok(!botMessages.some((m) => m.chatId === String(stranger.tgId)));
    assert.equal((await call('GET', '/v1/conversations', ghost.token)).body.items.length, 2, 'both are there for him');

    // messages: he sees his own, she sees nothing
    assert.equal((await say(ghost.token, matchId, 'سلام، هستی؟')).status, 200);
    assert.equal((await call('GET', `/v1/conversations/${matchId}/messages`, ghost.token)).body.items.length, 2);
    assert.equal((await call('GET', `/v1/conversations/${matchId}/messages`, friend.token)).body.items.length, 1, 'only what he sent before the ban');
    assert.equal((await call('GET', `/v1/conversations/${matchId}`, friend.token)).body.unread, 1);

    // the Wall: his message looks sent to him, and never arrives
    const p = (await call('POST', '/v1/wall', stranger.token, { text: 'دنبال یه هم‌صحبت برای عصرها هستم', lookingFor: 'male' })).body;
    const req = await call('POST', `/v1/wall/${p.id}/chat`, ghost.token, { text: 'سلام! منم هستم' });
    assert.equal(req.status, 200);
    assert.ok(req.body.matchId);
    assert.equal((await call('GET', '/v1/conversations', stranger.token)).body.items.length, 0);
    assert.equal((await call('POST', `/v1/wall/${p.id}/like`, ghost.token, {})).body.likeCount, 1, 'looks liked to him');
    assert.equal((await call('GET', `/v1/wall/${p.id}`, stranger.token)).body.likeCount, 0);
  });

  test('several reports act before a moderator does: shadow ban, hidden photos, lower trust', async () => {
    const loud = await login();
    await onboard(loud.token, 'male', 30);
    for (let i = 0; i < 4; i++) {
      const r = await login();
      await onboard(r.token, 'female', 22 + i);
      assert.equal((await call('POST', '/v1/reports', r.token, { userId: loud.me.id, reason: 'harassment' })).status, 200);
    }
    const [row] = await sql<{ shadow_banned: boolean; shadow_auto: boolean; trust: number }[]>`
      SELECT shadow_banned, shadow_auto, trust FROM users WHERE id = ${loud.me.id}`;
    assert.equal(row!.shadow_banned, true);
    assert.equal(row!.shadow_auto, true, 'flagged for a moderator');
    assert.ok(row!.trust <= 20, `trust dropped (got ${row!.trust})`);

    const model = await login();
    await onboard(model.token, 'male', 29);
    for (let i = 0; i < 2; i++) {
      const r = await login();
      await onboard(r.token, 'female', 24);
      await call('POST', '/v1/reports', r.token, { userId: model.me.id, reason: 'inappropriate_photos' });
    }
    // there is no photo review any more: reports go to moderators, the photos stay up
    const me = await call('GET', '/v1/me', model.token);
    assert.equal(me.body.photos[0].visible, true, 'photo reports no longer hide photos');
    const [u] = await sql<{ photo_count: number; shadow_banned: boolean }[]>`SELECT photo_count, shadow_banned FROM users WHERE id = ${model.me.id}`;
    assert.equal(u!.photo_count, 1);
    assert.equal(u!.shadow_banned, false, 'two photo reports are not enough for a shadow ban');
  });

  test('a conversation nobody answered is nudged once, then archived; no flooding before a reply', async () => {
    const he = await login({ name: 'Reza' });
    await onboard(he.token, 'male', 28, 'رضا');
    const she = await login({ name: 'Mina' });
    await onboard(she.token, 'female', 26, 'مینا');
    const matchId = await talking(he, she);
    const { matchCare } = await import('../../src/modules/chat/jobs.js');
    const nudges = async (token: string) =>
      (await call('GET', '/v1/notifications', token)).body.items.filter((n: { type: string }) => n.type === 'chat_nudge').length;

    await sql`UPDATE matches SET created_at = now() - interval '25 hours' WHERE id = ${matchId}`;
    await matchCare();
    await matchCare();
    assert.equal(await nudges(she.token), 1, 'the one who has not answered is nudged, once');

    await sql`UPDATE matches SET created_at = now() - interval '15 days' WHERE id = ${matchId}`;
    await matchCare();
    let list = await call('GET', '/v1/conversations', he.token);
    assert.ok(!list.body.items.some((c: { id: string }) => c.id === matchId), 'out of the main list');
    assert.equal(list.body.archivedCount, 1);
    const archive = await call('GET', '/v1/conversations?archived=1', he.token);
    assert.ok(archive.body.items.some((c: { id: string }) => c.id === matchId));

    // his first message already counts towards the «wait for a reply» limit
    for (let i = 0; i < 2; i++) assert.equal((await say(he.token, matchId, `سلام ${i}`)).status, 200);
    const fourth = await say(he.token, matchId, 'هستی؟');
    assert.equal(fourth.status, 409);
    assert.equal(fourth.body.code, 'wait_for_reply');
    list = await call('GET', '/v1/conversations', he.token);
    assert.ok(list.body.items.some((c: { id: string }) => c.id === matchId), 'a new message brings it back');
    assert.equal((await say(she.token, matchId, 'سلام! ببخشید دیر شد')).status, 200);
    assert.equal((await say(he.token, matchId, 'خواهش می‌کنم 🙂')).status, 200, 'she answered: the limit is gone');

    const [her] = await sql<{ openers_received: number; replies_given: number }[]>`
      SELECT openers_received, replies_given FROM users WHERE id = ${she.me.id}`;
    assert.deepEqual([her!.openers_received, her!.replies_given], [1, 1], 'she was written to, and she answered');
  });
});

describe('profiles the app runs itself', () => {
  /** Stands in for the model gateway: remembers what was asked, answers what the test wants. */
  function fakeLlm(reply: string | Error) {
    const seen: { url: string; body: any; auth: string | undefined }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (!href.startsWith('https://llm.test')) return real(url as never, init);
      seen.push({
        url: href,
        body: init?.body ? JSON.parse(String(init.body)) : null,
        auth: new Headers(init?.headers as Record<string, string>).get('authorization') ?? undefined,
      });
      if (reply instanceof Error) return new Response('model exploded', { status: 500 });
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;
    return { seen, restore: () => void (globalThis.fetch = real) };
  }

  const admin = async () => {
    const { hashPassword } = await import('../../src/lib/tokens.js');
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO admins (id, username, password_hash, display_name, role)
      VALUES (${(await import('../../src/lib/ids.js')).uuidv7()}, ${'ai-admin-' + Math.random().toString(36).slice(2, 8)},
              ${await hashPassword('x'.repeat(12))}, 'tester', 'superadmin')
      RETURNING id`;
    return row!.id;
  };

  test('the panel makes them in a batch, and they are ordinary profiles with a persona', async () => {
    const adminId = await admin();
    const { createBot, listBots, updateBot } = await import('../../src/modules/ai/service.js');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await createBot({ name: `نیلوفر ${i + 1}`, gender: 'female', age: 24 + i, bio: 'عاشق کتاب و قهوه', persona: 'خجالتی و مهربون' }, adminId));
    }
    assert.equal(new Set(ids).size, 3, 'three separate profiles');
    const [u] = await sql<{ is_ai: boolean; status: string; telegram_id: string | null; can_dm: boolean; name: string }[]>`
      SELECT is_ai, status, telegram_id::text AS telegram_id, can_dm, name FROM users WHERE id = ${ids[0]!}`;
    assert.deepEqual([u!.is_ai, u!.status, u!.telegram_id, u!.can_dm], [true, 'active', null, false], 'live, and nobody can log in as it');
    const bots = await listBots();
    assert.ok(bots.length >= 3);
    assert.equal(bots.find((b) => b.user_id === ids[0])!.persona, 'خجالتی و مهربون');

    // switching one off takes it out of discovery too
    const off = await updateBot(ids[2]!, { enabled: false });
    assert.deepEqual([off.enabled, off.discoverable], [false, false]);
  });

  test('a newcomer meets them first, and they answer when written to', async () => {
    const adminId = await admin();
    const { createBot } = await import('../../src/modules/ai/service.js');
    const { replyAsBot } = await import('../../src/modules/ai/service.js');
    const botId = await createBot(
      { name: 'ساحل', gender: 'female', age: 26, bio: 'اهل کوه و قهوه', persona: 'پرانرژی و شوخ', model: 'test-model:1b' },
      adminId,
    );

    const him = await login({ name: 'Newbie' });
    await onboard(him.token, 'male', 29);
    const deck = await call('GET', '/v1/discover?limit=10', him.token);
    assert.equal(deck.body.items[0]?.id, botId, 'the first card a newcomer sees is one of ours');

    jobs.length = 0;
    const opened = await call('POST', '/v1/discover/chat', him.token, { targetId: botId, text: 'سلام ساحل! کوه رو دوست داری؟' });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    const matchId = opened.body.matchId as string;
    // booking the reply is fire-and-forget, like the Telegram push: give it a tick
    await new Promise((r) => setTimeout(r, 50));
    const booked = jobs.find((j) => j.name === 'ai-reply');
    assert.ok(booked, 'writing to one books a reply');
    assert.deepEqual([booked!.matchId, booked!.botId, booked!.toId], [matchId, botId, him.me.id]);

    // the worker's side: ask the model, post the answer as her
    const fake = fakeLlm('سلام! 😊 عاشق کوهم، جمعه‌ها می‌رم. تو کدوم مسیرها رو رفتی؟');
    try {
      await replyAsBot(matchId, botId, him.me.id);
    } finally {
      fake.restore();
    }
    assert.equal(fake.seen.length, 1, 'one call to ollama');
    assert.equal(fake.seen[0]!.url, 'https://llm.test/v1/chat/completions');
    assert.equal(fake.seen[0]!.auth, 'Bearer test-key');
    assert.equal(fake.seen[0]!.body.model, 'test-model:1b', 'her own model wins over the default');
    assert.equal(fake.seen[0]!.body.stream, false);
    assert.equal(fake.seen[0]!.body.messages[0].role, 'system');
    assert.match(fake.seen[0]!.body.messages[0].content, /ساحل/, 'the system prompt says who she is');
    assert.match(fake.seen[0]!.body.messages[0].content, /هوش مصنوعی/, 'and that she never admits to being one');
    assert.deepEqual(fake.seen[0]!.body.messages.at(-1), { role: 'user', content: 'سلام ساحل! کوه رو دوست داری؟' });

    const msgs = await call('GET', `/v1/conversations/${matchId}/messages`, him.token);
    assert.equal(msgs.body.items.length, 2);
    assert.equal(msgs.body.items[0].senderId, botId, 'her answer is the newest message');
    assert.match(msgs.body.items[0].body, /عاشق کوهم/);
    const [stat] = await sql<{ replies: number; last_error: string | null }[]>`SELECT replies, last_error FROM ai_bots WHERE user_id = ${botId}`;
    assert.deepEqual([stat!.replies, stat!.last_error], [1, null]);

    // she does not answer twice over the same message
    const again = fakeLlm('باید ساکت بمونم');
    try {
      await replyAsBot(matchId, botId, him.me.id);
    } finally {
      again.restore();
    }
    assert.equal(again.seen.length, 0, 'the last word is already hers');
  });

  test('the first answer is told to stay cool, a later one may warm up, and both get the spoken-Persian rules', async () => {
    const adminId = await admin();
    const { createBot, replyAsBot } = await import('../../src/modules/ai/service.js');
    const botId = await createBot({ name: 'پریا', gender: 'female', age: 25, persona: 'مهربون ولی محتاط' }, adminId);
    const him = await login();
    await onboard(him.token, 'male', 27);
    const say = (text: string) =>
      call('POST', `/v1/conversations/${matchId}/messages`, him.token, { text, clientId: 'c' + Math.random().toString(36).slice(2, 12) });
    const matchId = (await call('POST', '/v1/discover/chat', him.token, { targetId: botId, text: 'سلام پریا!' })).body.matchId as string;

    const first = fakeLlm('سلام، ممنون. خودت چطوری؟');
    try {
      await replyAsBot(matchId, botId, him.me.id);
    } finally {
      first.restore();
    }
    const opening = first.seen[0]!.body.messages[0].content as string;
    assert.match(opening, /اولین جواب تو به یک غریبه/, 'her very first answer is told not to gush');
    assert.match(opening, /عزیزم/, 'and which endearments are off limits');
    assert.match(opening, /خانمی که هر روز از غریبه‌ها پیام می‌گیری/, 'a woman\u2019s profile starts cooler still');
    // the language rules ride along with every answer
    assert.match(opening, /می‌رم.*نه.*می‌روم/);
    assert.match(opening, /می‌باشد/, 'the bookish words it must never write');
    assert.match(opening, /نیم‌فاصله/, 'and that the spelling has to be right');

    // four exchanges later she is allowed to be warmer
    for (let i = 0; i < 3; i++) {
      assert.equal((await say(`پیام ${i}`)).status, 200);
      const more = fakeLlm(`جواب ${i}`);
      try {
        await replyAsBot(matchId, botId, him.me.id);
      } finally {
        more.restore();
      }
    }
    assert.equal((await say('خب بگو از خودت')).status, 200);
    const later = fakeLlm('من که گفتم 😄');
    try {
      await replyAsBot(matchId, botId, him.me.id);
    } finally {
      later.restore();
    }
    const grown = later.seen[0]!.body.messages[0].content as string;
    assert.match(grown, /گرم‌تر باشی/, 'by now she can relax');
    assert.doesNotMatch(grown, /اولین جواب تو به یک غریبه/);
  });

  test('a name prefix, quotes and a stage direction are stripped off the answer', async () => {
    const adminId = await admin();
    const { createBot, replyAsBot } = await import('../../src/modules/ai/service.js');
    const botId = await createBot({ name: 'آیدا', gender: 'female', age: 25, persona: 'آرام' }, adminId);
    const him = await login();
    await onboard(him.token, 'male', 31);
    const matchId = (await call('POST', '/v1/discover/chat', him.token, { targetId: botId, text: 'سلام!' })).body.matchId as string;

    const fake = fakeLlm('آیدا: *لبخند می‌زند* «سلام! چه خبر؟»');
    try {
      await replyAsBot(matchId, botId, him.me.id);
    } finally {
      fake.restore();
    }
    const msgs = await call('GET', `/v1/conversations/${matchId}/messages`, him.token);
    assert.equal(msgs.body.items[0].body, 'سلام! چه خبر؟');
  });

  test('when the model fails, nothing is posted and the error is kept for the panel', async () => {
    const adminId = await admin();
    const { createBot, replyAsBot } = await import('../../src/modules/ai/service.js');
    const botId = await createBot({ name: 'مهتاب', gender: 'female', age: 27 }, adminId);
    const him = await login();
    await onboard(him.token, 'male', 28);
    const matchId = (await call('POST', '/v1/discover/chat', him.token, { targetId: botId, text: 'سلام مهتاب' })).body.matchId as string;

    const fake = fakeLlm(new Error('boom'));
    try {
      await assert.rejects(() => replyAsBot(matchId, botId, him.me.id));
    } finally {
      fake.restore();
    }
    const msgs = await call('GET', `/v1/conversations/${matchId}/messages`, him.token);
    assert.equal(msgs.body.items.length, 1, 'only his own message is there');
    const [stat] = await sql<{ last_error: string | null }[]>`SELECT last_error FROM ai_bots WHERE user_id = ${botId}`;
    assert.match(stat!.last_error ?? '', /500/, 'the panel can show why');
  });

  test('they are not shown to someone who is no longer new, and never fanned out as newcomers', async () => {
    const adminId = await admin();
    const { createBot } = await import('../../src/modules/ai/service.js');
    const { saveSettings, getSettings } = await import('../../src/modules/settings/settings.js');
    const before = (await getSettings()).ai;
    await saveSettings({ ai: { ...before, leadNewcomerHours: 1 } }, null);
    try {
      const botId = await createBot({ name: 'رها', gender: 'female', age: 24 }, adminId);
      const him = await login();
      await onboard(him.token, 'male', 30);
      // he signed up two hours ago: past the window
      await sql`UPDATE users SET activated_at = now() - interval '2 hours' WHERE id = ${him.me.id}`;
      await call('POST', '/v1/discover/reset', him.token, {});
      const deck = await call('GET', '/v1/discover?limit=30', him.token);
      assert.notEqual(deck.body.items[0]?.id, botId, 'no longer first in line');
      assert.equal(deck.body.items.some((c: { id: string }) => c.id === botId), false, 'and not mixed in with the real cards either');
    } finally {
      await saveSettings({ ai: before }, null);
    }
  });
});

describe('profile photos', () => {
  /** Sends one image to `url` as multipart, the way the app does. */
  async function sendPhoto(method: 'POST' | 'PUT', url: string, token: string, color: string) {
    const body = await sharp({ create: { width: 600, height: 800, channels: 3, background: color } }).jpeg().toBuffer();
    const boundary = '----vibe' + Math.random().toString(16).slice(2);
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      body,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  }

  test('the only photo can be replaced in place, keeping its id and its place', async () => {
    const u = await login();
    const me = await onboard(u.token, 'female', 27);
    const [only] = me.photos;
    assert.equal(me.photos.length, 1);

    // deleting it is refused — which is exactly why replacing must work
    const gone = await call('DELETE', `/v1/me/photos/${only.id}`, u.token);
    assert.equal(gone.status, 409);
    assert.equal(gone.body.code, 'last_photo');

    const replaced = await sendPhoto('PUT', `/v1/me/photos/${only.id}`, u.token, '#38bdf8');
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
    assert.equal(replaced.body.photos.length, 1, 'still one photo, not two');
    assert.equal(replaced.body.photos[0].id, only.id, 'the same photo, a new picture');
    assert.notEqual(replaced.body.photos[0].url, only.url, 'the picture really changed');
    assert.equal(replaced.body.photos[0].visible, true);
    const [row] = await sql<{ photo_count: number }[]>`SELECT photo_count FROM users WHERE id = ${u.me.id}`;
    assert.equal(row!.photo_count, 1);
  });

  test('replacing a photo that reports had hidden puts it back on show', async () => {
    const u = await login();
    const me = await onboard(u.token, 'male', 29);
    const [only] = me.photos;
    // what several «bad photo» reports do
    await sql`UPDATE photos SET status = 'pending', flagged = true WHERE id = ${only.id}`;
    const { refreshPhotoCount } = await import('../../src/modules/profile/service.js');
    await refreshPhotoCount(u.me.id);
    await redis.del(`ust:${u.me.id}`, `card:${u.me.id}`);
    const hidden = await call('GET', '/v1/me', u.token);
    assert.equal(hidden.body.photos[0].visible, false);

    const replaced = await sendPhoto('PUT', `/v1/me/photos/${only.id}`, u.token, '#2ee59d');
    assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
    assert.equal(replaced.body.photos[0].visible, true, 'a new picture starts over');
    const [row] = await sql<{ status: string; flagged: boolean; photo_count: number }[]>`
      SELECT p.status, p.flagged, u.photo_count FROM photos p JOIN users u ON u.id = p.user_id WHERE p.id = ${only.id}`;
    assert.equal(row!.status, 'approved');
    assert.equal(row!.flagged, false);
    assert.equal(row!.photo_count, 1);
  });

  test('photos keep the order they are given, and a replace does not disturb it', async () => {
    const u = await login();
    await onboard(u.token, 'female', 24);
    await sendPhoto('POST', '/v1/me/photos', u.token, '#8b5cf6');
    const three = await sendPhoto('POST', '/v1/me/photos', u.token, '#ffc542');
    assert.equal(three.body.photos.length, 3);
    const [a, b, c] = three.body.photos as { id: string }[];

    // the middle one becomes the main photo
    const ordered = await call('PUT', '/v1/me/photos/order', u.token, { ids: [b!.id, a!.id, c!.id] });
    assert.deepEqual(ordered.body.photos.map((p: { id: string }) => p.id), [b!.id, a!.id, c!.id]);

    const replaced = await sendPhoto('PUT', `/v1/me/photos/${a!.id}`, u.token, '#f43f5e');
    assert.deepEqual(replaced.body.photos.map((p: { id: string }) => p.id), [b!.id, a!.id, c!.id], 'order survives a replace');

    assert.equal((await call('DELETE', `/v1/me/photos/${c!.id}`, u.token)).status, 200, 'with others left, deleting is fine');
    assert.equal((await call('GET', '/v1/me', u.token)).body.photos.length, 2);
  });

  test('someone else cannot replace my photo', async () => {
    const mine = await login();
    const me = await onboard(mine.token, 'female', 26);
    const other = await login();
    await onboard(other.token, 'male', 28);
    const r = await sendPhoto('PUT', `/v1/me/photos/${me.photos[0].id}`, other.token, '#000000');
    assert.equal(r.status, 404);
  });
});

describe('where a chat started, and who looked', () => {
  async function two() {
    const he = await login({ name: 'Kian' });
    const she = await login({ name: 'Sahar' });
    await onboard(he.token, 'male', 29, 'کیان');
    await onboard(she.token, 'female', 27, 'سحر');
    return { he, she };
  }
  const write = (token: string, targetId: string, text = 'سلام! 👋') => call('POST', '/v1/discover/chat', token, { targetId, text });

  test('a conversation says who wrote first', async () => {
    const { he, she } = await two();
    const r = await write(he.token, she.me.id);
    assert.equal(r.status, 200);
    for (const token of [he.token, she.token]) {
      const c = (await call('GET', `/v1/conversations/${r.body.matchId}`, token)).body;
      assert.deepEqual(c.origin, { kind: 'message', by: he.me.id });
    }
  });

  test('the first look at a profile is told once, in the chat, to the one looked at', async () => {
    const { he, she } = await two();
    const matchId = (await write(he.token, she.me.id)).body.matchId as string;

    assert.equal((await call('POST', `/v1/users/${he.me.id}/viewed`, she.token, {})).status, 200);
    assert.equal((await call('POST', `/v1/users/${he.me.id}/viewed`, she.token, {})).status, 200, 'telling twice is harmless');
    const msgs = await call('GET', `/v1/conversations/${matchId}/messages`, he.token);
    const looks = msgs.body.items.filter((m: { kind: string }) => m.kind === 'system');
    assert.equal(looks.length, 1, 'he is told once that she looked');
    const hers = await call('GET', `/v1/conversations/${matchId}/messages`, she.token);
    assert.equal(hers.body.items.filter((m: { kind: string }) => m.kind === 'system').length, 0, 'she is not told that she looked');
  });

  test('looking at someone you are not talking to tells nobody', async () => {
    const { he, she } = await two();
    assert.equal((await call('POST', `/v1/users/${he.me.id}/viewed`, she.token, {})).status, 200);
    const convs = await call('GET', '/v1/conversations', he.token);
    assert.equal(convs.body.items.length, 0, 'no conversation, so nothing to tell him in');
  });
});
