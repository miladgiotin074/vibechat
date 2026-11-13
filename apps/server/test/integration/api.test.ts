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
const wallJobs: { name: string; postId: string }[] = [];
mock.module('../../src/lib/queue.js', {
  namedExports: {
    QUEUE_NAME: 'jobs',
    BOT_QUEUE_NAME: 'bot',
    WALL_QUEUE_NAME: 'wall',
    enqueueWall: async (job: { name: string; postId: string }) => void wallJobs.push(job),
    closeQueue: async () => {},
    enqueue: async () => {},
    enqueueBotMessage: async (m: { userId: string; chatId: string; text: string }) => void botMessages.push(m),
    enqueueBotMessages: async (ms: { userId: string; chatId: string; text: string }[]) => void botMessages.push(...ms),
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
  const { uuidv7 } = await import('../../src/lib/ids.js');
  await sql`INSERT INTO plans (id, title, duration_days, price_toman) VALUES (${uuidv7()}, 'یک ماهه', 30, 99000)`;
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
  test('only gender, age and one photo are required', async () => {
    const u = await login();
    assert.equal((await call('PATCH', '/v1/me', u.token, { gender: 'female', age: 24 })).body.interestedIn, 'male');
    const early = await call('POST', '/v1/me/complete', u.token, {});
    assert.equal(early.status, 400);
    assert.deepEqual(early.body.details.map((d: { path: string }) => d.path), ['photos']);
    await uploadPhoto(u.token);
    const done = await call('POST', '/v1/me/complete', u.token, {});
    assert.equal(done.body.status, 'active');
    assert.ok(done.body.activatedAt);
    // gender and age are locked once live
    assert.equal((await call('PATCH', '/v1/me', u.token, { gender: 'male' })).status, 403);
    assert.equal((await call('PATCH', '/v1/me', u.token, { age: 30 })).status, 403);
  });

  test('under-age is refused', async () => {
    const u = await login();
    const r = await call('PATCH', '/v1/me', u.token, { gender: 'male', age: 16 });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'underage');
  });
});

describe('invites: friends added to the Wall group', () => {
  const GROUP = '-1001112223334';
  async function withGroup<T>(run: () => Promise<T>): Promise<T> {
    const { saveSettings, getSettings } = await import('../../src/modules/settings/settings.js');
    const { wall, referral } = await getSettings();
    await saveSettings({ wall: { ...wall, telegram: { enabled: true, chatId: GROUP, link: 'https://t.me/vibe_wall' } }, referral: { enabled: true, minAdds: 20, rewardChats: 5, rewardLikes: 25 } }, null);
    try {
      return await run();
    } finally {
      await saveSettings({ wall, referral }, null);
    }
  }
  let friendSeq = 9_000_000;

  test('nothing below 20 friends, then 5 chats per 20 — each friend counts once, only in the Wall group', async () => {
    await withGroup(async () => {
      const { recordGroupAdd } = await import('../../src/modules/referrals/service.js');
      const u = await login({ name: 'Adder' });
      await onboard(u.token, 'male', 26);
      for (let i = 0; i < 19; i++) await recordGroupAdd(u.tgId, ++friendSeq, Number(GROUP));
      let r = (await call('GET', '/v1/referrals', u.token)).body;
      assert.deepEqual([r.adds, r.earnedChats, r.untilNext, r.random.left], [19, 0, 1, 5]);
      assert.equal(r.group.link, 'https://t.me/vibe_wall');

      await recordGroupAdd(u.tgId, ++friendSeq, Number(GROUP));
      r = (await call('GET', '/v1/referrals', u.token)).body;
      assert.deepEqual([r.adds, r.earnedChats, r.random.left], [20, 5, 10], '20 friends: 5 more chats');
      const notes = (await call('GET', '/v1/notifications', u.token)).body.items.filter((n: { type: string }) => n.type === 'referral');
      assert.equal(notes.length, 1, 'told once, when it earned something');

      // the same friend again (left and re-added, or added by someone else), a bot-free other group: nothing
      await recordGroupAdd(u.tgId, friendSeq, Number(GROUP));
      const other = await login();
      await recordGroupAdd(other.tgId, friendSeq, Number(GROUP));
      await recordGroupAdd(u.tgId, ++friendSeq, -100999);
      r = (await call('GET', '/v1/referrals', u.token)).body;
      assert.equal(r.adds, 20);

      // past 20 every 4 friends are one more chat
      for (let i = 0; i < 4; i++) await recordGroupAdd(u.tgId, ++friendSeq, Number(GROUP));
      r = (await call('GET', '/v1/referrals', u.token)).body;
      assert.deepEqual([r.adds, r.earnedChats, r.untilNext], [24, 6, 4]);
    });
  });

  test('a man runs out of random chats and earns them back; women and members never run out', async () => {
    await withGroup(async () => {
      const { recordGroupAdd } = await import('../../src/modules/referrals/service.js');
      await redis.del('rc:wait');
      const him = await login();
      await onboard(him.token, 'male', 27);
      const state = await call('GET', '/v1/random/state', him.token);
      assert.deepEqual(state.body.credits, { unlimited: false, left: 5 }, 'five to start with');

      await sql`UPDATE users SET rc_used = 5 WHERE id = ${him.me.id}`;
      const out = await call('POST', '/v1/random/join', him.token, {});
      assert.equal(out.status, 402);
      assert.equal(out.body.code, 'random_limit');

      for (let i = 0; i < 20; i++) await recordGroupAdd(him.tgId, ++friendSeq, Number(GROUP));
      assert.equal((await call('POST', '/v1/random/join', him.token, { want: 'female' })).body.status, 'waiting');
      await call('POST', '/v1/random/leave', him.token, {});

      const her = await login();
      await onboard(her.token, 'female', 24);
      await sql`UPDATE users SET rc_used = 500 WHERE id = ${her.me.id}`;
      assert.deepEqual((await call('GET', '/v1/random/state', her.token)).body.credits, { unlimited: true, left: null });
      assert.equal((await call('POST', '/v1/random/join', her.token, {})).body.status, 'waiting');
      await call('POST', '/v1/random/leave', her.token, {});
    });
  });

  test('likes: a man has a number in total, earns more by adding friends; members have a daily cap; women none', async () => {
    await withGroup(async () => {
      const { saveSettings, getSettings } = await import('../../src/modules/settings/settings.js');
      const { recordGroupAdd } = await import('../../src/modules/referrals/service.js');
      const before = await getSettings();
      await saveSettings({ freeLikes: 2, premiumDailyLikes: 1 }, null);
      try {
        const women: string[] = [];
        for (let i = 0; i < 5; i++) {
          const w = await login();
          women.push((await onboard(w.token, 'female', 24 + i)).id);
        }
        const him = await login();
        await onboard(him.token, 'male', 29);
        const like = (token: string, targetId: string, action = 'like') => call('POST', '/v1/swipes', token, { targetId, action });

        assert.equal((await like(him.token, women[0]!)).status, 200);
        assert.equal((await like(him.token, women[0]!)).body.duplicate, true, 'the same person again costs nothing');
        assert.equal((await like(him.token, women[1]!)).status, 200);
        const out = await like(him.token, women[2]!);
        assert.equal(out.status, 402);
        assert.equal(out.body.code, 'like_limit');
        assert.equal((await like(him.token, women[2]!, 'pass')).status, 200, 'passing is always free');

        // 20 friends in the group: 25 more likes
        for (let i = 0; i < 20; i++) await recordGroupAdd(him.tgId, ++friendSeq, Number(GROUP));
        assert.equal((await like(him.token, women[3]!)).status, 200);
        const note = (await call('GET', '/v1/notifications', him.token)).body.items.find((n: { type: string }) => n.type === 'referral');
        assert.match(note.title, /۵ چت ناشناس و ۲۵ لایک/);

        // with membership: one a day (set above), not the total
        const member = await login();
        await onboard(member.token, 'male', 31);
        await sql`UPDATE users SET premium_until = now() + interval '30 days', likes_used = 999 WHERE id = ${member.me.id}`;
        await redis.del(`ust:${member.me.id}`);
        assert.equal((await like(member.token, women[0]!)).status, 200);
        const capped = await like(member.token, women[1]!);
        assert.equal(capped.status, 429);
        assert.equal(capped.body.code, 'like_daily_limit');

        // a woman: neither
        const her = await login();
        await onboard(her.token, 'female', 27);
        for (const target of [him.me.id, member.me.id]) assert.equal((await like(her.token, target)).status, 200);
      } finally {
        await saveSettings({ freeLikes: before.freeLikes, premiumDailyLikes: before.premiumDailyLikes }, null);
      }
    });
  });

  test('a man with membership has a daily limit; a woman has none', async () => {
    const { saveSettings, getSettings } = await import('../../src/modules/settings/settings.js');
    const saved = (await getSettings()).randomChat;
    await saveSettings({ randomChat: { ...saved, premiumDailySessions: 2 } }, null);
    try {
      await redis.del('rc:wait');
      const him = await login();
      await onboard(him.token, 'male', 30);
      await sql`UPDATE users SET premium_until = now() + interval '30 days' WHERE id = ${him.me.id}`;
      await redis.del(`ust:${him.me.id}`);
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());
      await redis.set(`rc:day:${him.me.id}:${day}`, '2');
      const full = await call('POST', '/v1/random/join', him.token, {});
      assert.equal(full.status, 429);
      assert.equal(full.body.code, 'random_daily_limit');

      const her = await login();
      await onboard(her.token, 'female', 26);
      await redis.set(`rc:day:${her.me.id}:${day}`, '99');
      assert.equal((await call('POST', '/v1/random/join', her.token, {})).body.status, 'waiting');
      await call('POST', '/v1/random/leave', her.token, {});

      // a real chat counts toward his limit: one left today → used up after this one
      await redis.set(`rc:day:${him.me.id}:${day}`, '1');
      assert.equal((await call('POST', '/v1/random/join', her.token, {})).body.status, 'waiting');
      const paired = await call('POST', '/v1/random/join', him.token, {});
      assert.equal(paired.body.status, 'chatting', JSON.stringify(paired.body));
      const say = (token: string) => call('POST', '/v1/random/messages', token, { text: 'سلام', clientId: 'c' + Math.random().toString(36).slice(2).padEnd(10, '0') });
      await say(him.token);
      await say(her.token);
      assert.equal(await redis.get(`rc:day:${him.me.id}:${day}`), '2');
      assert.equal(await redis.get(`rc:day:${her.me.id}:${day}`), '99', 'hers is not counted');
      await call('POST', '/v1/random/leave', him.token, {});
      assert.equal((await call('POST', '/v1/random/join', him.token, {})).body.code, 'random_daily_limit');
    } finally {
      await saveSettings({ randomChat: saved }, null);
    }
  });
});

describe('women: the perks of a member, quietly', () => {
  test('no limits, but nothing says «member» — to her or to anyone else', async () => {
    const her = await login();
    const me = await onboard(her.token, 'female', 25);
    assert.equal(me.premium.active, true);
    assert.equal(me.premium.until, null);
    assert.equal(me.premium.offered, false, 'no membership to sell her, no «you are a member» card');
    assert.equal(me.limits.dailyLikes, null);
    assert.equal((await call('PATCH', '/v1/me/privacy', her.token, { hideAge: true })).status, 200);

    const him = await login();
    const his = await onboard(him.token, 'male', 28);
    assert.equal(his.premium.active, false);
    assert.equal(his.premium.offered, true);
    const card = (await call('GET', `/v1/users/${her.me.id}`, him.token)).body;
    assert.equal(card.premium, false, 'no badge');
    assert.equal(card.age, null, 'her hidden age stays hidden');
  });
});

describe('discovery, match and chat', () => {
  test('mutual likes match; messages notify an offline peer on Telegram, throttled', async () => {
    const he = await login({ name: 'Ali' });
    const she = await login({ name: 'Sara' });
    await onboard(he.token, 'male', 28, 'علی');
    const sara = await onboard(she.token, 'female', 26, 'سارا');

    const deck = await call('GET', '/v1/discover?limit=30', he.token);
    assert.ok(deck.body.items.some((c: { id: string }) => c.id === sara.id), 'she is in his deck');
    const card = deck.body.items.find((c: { id: string }) => c.id === sara.id);
    assert.equal(card.newcomer, true);

    assert.equal((await call('POST', '/v1/swipes', he.token, { targetId: sara.id, action: 'like' })).body.matched, false);
    const m = await call('POST', '/v1/swipes', she.token, { targetId: he.me.id, action: 'like' });
    assert.equal(m.body.matched, true);
    const matchId = m.body.matchId as string;

    botMessages.length = 0;
    for (const text of ['سلام!', 'خوبی؟', 'کجایی؟']) {
      const r = await call('POST', `/v1/conversations/${matchId}/messages`, he.token, { text, clientId: 'c' + Math.random().toString(36).slice(2, 12) });
      assert.equal(r.status, 200);
    }
    // push is fire-and-forget; give it a tick
    await new Promise((r) => setTimeout(r, 50));
    const toHer = botMessages.filter((b) => b.chatId === String(she.tgId));
    assert.equal(toHer.length, 1, 'one Telegram message per conversation per cooldown');
    assert.match(toHer[0]!.text, /پیام فرستاد/);

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

  test('super likes: his own few first, then earned bonus ones', async () => {
    const u = await login();
    await onboard(u.token, 'male');
    // one of his own three is left, and one bonus
    await sql`UPDATE users SET bonus_superlikes = 1, superlikes_used = 2 WHERE id = ${u.me.id}`;
    const targets: string[] = [];
    for (let i = 0; i < 3; i++) {
      const t = await login();
      targets.push((await onboard(t.token, 'female')).id);
    }
    assert.equal((await call('POST', '/v1/swipes', u.token, { targetId: targets[0], action: 'superlike' })).status, 200); // his own
    const second = await call('POST', '/v1/swipes', u.token, { targetId: targets[1], action: 'superlike' }); // bonus
    assert.equal(second.status, 200);
    assert.equal(second.body.bonusSuperLikes, 0);
    const third = await call('POST', '/v1/swipes', u.token, { targetId: targets[2], action: 'superlike' });
    assert.equal(third.status, 402);
    assert.equal(third.body.code, 'superlike_limit');
  });
});

describe('payments', () => {
  test('a paid payment activates premium exactly once', async () => {
    const u = await login();
    await onboard(u.token, 'male');
    const plans = await call('GET', '/v1/plans');
    const created = await call('POST', '/v1/payments', u.token, { planId: plans.body.items[0].id });
    assert.equal(created.status, 200);
    const [p] = await sql<{ token: string }[]>`SELECT token FROM payments WHERE id = ${created.body.paymentId}`;
    const ok = await app.inject({ method: 'GET', url: `/v1/payments/dev/result?ok=1&token=${p!.token}` });
    assert.match(ok.body, /پرداخت موفق بود/);
    await app.inject({ method: 'GET', url: `/v1/payments/dev/result?ok=1&token=${p!.token}` });
    const me = await call('GET', '/v1/me', u.token);
    assert.equal(me.body.premium.active, true);
    const days = (new Date(me.body.premium.until).getTime() - Date.now()) / 86400_000;
    assert.ok(days > 29 && days < 31, `30 days, not 60 (got ${days})`);
    const status = await call('GET', `/v1/payments/${created.body.paymentId}`, u.token);
    assert.equal(status.body.status, 'paid');
  });
});

describe('Telegram init data parser', () => {
  test('start parameters', async () => {
    const { parseStartParam } = await import('../../src/lib/telegram.js');
    assert.deepEqual(parseStartParam('r_abcd2345'), { kind: 'ref', code: 'abcd2345' });
    assert.deepEqual(parseStartParam('s_likes'), { kind: 'screen', name: 'likes' });
    assert.equal(parseStartParam('chat_not-a-uuid'), null);
    assert.equal(parseStartParam('r_<script>'), null);
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
    call('POST', '/v1/wall', token, { category: 'chat', lookingFor: 'male', showPhoto: true, toGroup: true, ...body });

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
    assert.equal(item.requestCount, undefined, 'only the author sees request counts');
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
    const bad = await call('PATCH', `/v1/wall/${first.body.id}`, her.token, { text: 'زنگ بزن ۰۹۱۲۱۲۳۴۵۶۷', category: 'sport', lookingFor: 'male' });
    assert.equal(bad.body.code, 'contact_info');
    const edited = await call('PATCH', `/v1/wall/${first.body.id}`, her.token, { text: 'کی پایه‌ی کوهنوردی پنجشنبه‌هاست؟ ⛰️', category: 'sport', lookingFor: 'everyone' });
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
    assert.equal((await call('GET', '/v1/wall/mine', her.token)).body.canPost, false, 'one a day, members and women too');
    await sql`UPDATE wall_posts SET created_at = now() - interval '25 hours' WHERE user_id = ${her.me.id}`;
    assert.equal((await call('GET', '/v1/wall/mine', her.token)).body.canPost, true);
    assert.equal((await post(her.token, { text: 'یه درخواست تازه بعد از حذف قبلی' })).status, 200);
  });

  test('likes count once, the author sees who liked, and can not like their own', async () => {
    const { her, him } = await pair();
    const p = (await post(her.token, { text: 'دنبال همسفر برای شمال، آخر هفته 🌊', category: 'travel' })).body;
    assert.equal((await call('POST', `/v1/wall/${p.id}/like`, her.token, {})).status, 400);
    assert.equal((await call('POST', `/v1/wall/${p.id}/like`, him.token, {})).body.likeCount, 1);
    assert.equal((await call('POST', `/v1/wall/${p.id}/like`, him.token, {})).body.likeCount, 1, 'idempotent');
    const likers = await call('GET', `/v1/wall/${p.id}/likers`, her.token);
    assert.deepEqual(likers.body.items.map((l: { id: string }) => l.id), [him.me.id]);
    assert.equal((await call('GET', `/v1/wall/${p.id}/likers`, him.token)).status, 404, 'only the author');
    assert.equal((await call('DELETE', `/v1/wall/${p.id}/like`, him.token)).body.likeCount, 0);
  });

  test('answering a request is a chat request: no conversation until the author accepts', async () => {
    const { her, him } = await pair();
    const other = await login();
    await onboard(other.token, 'female', 30);
    const p = (await post(her.token, { text: 'یه آقای اهل کتاب برای گپ‌های شبانه 📚', lookingFor: 'male' })).body;
    const no = await call('POST', `/v1/wall/${p.id}/chat`, other.token, { text: 'سلام' });
    assert.equal(no.status, 403);
    assert.equal(no.body.code, 'wall_not_for_you');
    const sneaky = await call('POST', `/v1/wall/${p.id}/chat`, him.token, { text: 'بهم پیام بده ۰۹۱۲۱۲۳۴۵۶۷' });
    assert.equal(sneaky.body.code, 'contact_info', 'no contact details to skip the approval');

    botMessages.length = 0;
    const sent = await call('POST', `/v1/wall/${p.id}/chat`, him.token, { text: 'سلام! منم عاشق کتابم 📖' });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.status, 'pending');
    assert.equal((await call('GET', '/v1/conversations', her.token)).body.items.length, 0, 'no conversation yet');
    const twice = await call('POST', `/v1/wall/${p.id}/chat`, him.token, { text: 'چه کتابی می‌خونی؟' });
    assert.equal(twice.status, 409);
    assert.equal(twice.body.code, 'wall_request_pending');
    assert.equal((await call('GET', `/v1/wall/${p.id}`, him.token)).body.myRequest, 'pending');
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(botMessages.some((m) => m.chatId === String(her.tgId) && /گفتگو/.test(m.text)), 'author told on Telegram');

    const mine = await call('GET', '/v1/wall/mine', her.token);
    assert.equal(mine.body.items[0].requestCount, 1);
    assert.equal(mine.body.items[0].pendingCount, 1);
    assert.equal(mine.body.pendingRequests, 1);
    assert.equal((await call('GET', `/v1/wall/${p.id}/requests`, him.token)).status, 404, 'only the author sees requests');
    const inbox = await call('GET', `/v1/wall/${p.id}/requests`, her.token);
    assert.equal(inbox.body.items.length, 1);
    const req = inbox.body.items[0];
    assert.equal(req.user.id, him.me.id);
    assert.equal(req.text, 'سلام! منم عاشق کتابم 📖');
    assert.equal((await call('POST', `/v1/wall/requests/${req.id}/accept`, him.token, {})).status, 404, 'only the author decides');

    const ok = await call('POST', `/v1/wall/requests/${req.id}/accept`, her.token, {});
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.status, 'accepted');
    const again = await call('POST', `/v1/wall/requests/${req.id}/accept`, her.token, {});
    assert.equal(again.body.matchId, ok.body.matchId, 'accepting twice is harmless');
    const convs = await call('GET', '/v1/conversations', her.token);
    const c = convs.body.items.find((x: { id: string }) => x.id === ok.body.matchId);
    assert.equal(c.origin.kind, 'wall', 'the chat knows it came from the Wall');
    assert.equal(c.origin.postId, p.id);
    assert.equal(c.origin.author, her.me.id);
    assert.equal(c.origin.requester, him.me.id);
    assert.ok(c.origin.text, 'and what the post said');
    assert.ok(c, 'the conversation is open');
    assert.equal(c.unread, 1, 'the intro is its first message');
    const seen = await call('GET', `/v1/wall/${p.id}`, him.token);
    assert.equal(seen.body.myRequest, 'accepted');
    assert.equal(seen.body.matchId, ok.body.matchId, '«continue the conversation» link');
    const notes = await call('GET', '/v1/notifications', him.token);
    assert.ok(notes.body.items.some((n: { type: string }) => n.type === 'wall_accept'), 'the sender is told');
    assert.equal((await call('GET', '/v1/wall/mine', her.token)).body.pendingRequests, 0);
  });

  test('a declined request stays declined; a cancelled one can be sent again', async () => {
    const { her, him } = await pair();
    const p = (await post(her.token, { text: 'دنبال یه هم‌صحبت برای آخر هفته', lookingFor: 'everyone' })).body;
    const other = await login();
    await onboard(other.token, 'female', 29);

    await call('POST', `/v1/wall/${p.id}/chat`, him.token, { text: 'سلام 👋' });
    const [req] = (await call('GET', `/v1/wall/${p.id}/requests`, her.token)).body.items;
    const no = await call('POST', `/v1/wall/requests/${req.id}/decline`, her.token, {});
    assert.equal(no.body.status, 'declined');
    assert.equal((await call('GET', `/v1/wall/${p.id}`, him.token)).body.myRequest, 'declined');
    const retry = await call('POST', `/v1/wall/${p.id}/chat`, him.token, { text: 'دوباره سلام' });
    assert.equal(retry.status, 403);
    assert.equal(retry.body.code, 'wall_request_declined');
    assert.equal((await call('POST', `/v1/wall/requests/${req.id}/accept`, her.token, {})).status, 409, 'decided is decided');

    assert.equal((await call('POST', `/v1/wall/${p.id}/chat`, other.token, { text: 'سلام از طرف من' })).body.status, 'pending');
    assert.equal((await call('DELETE', `/v1/wall/${p.id}/chat`, other.token)).status, 200);
    assert.equal((await call('GET', `/v1/wall/${p.id}`, other.token)).body.myRequest, null);
    assert.equal((await call('GET', '/v1/wall/mine', her.token)).body.pendingRequests, 0);
    const back = await call('POST', `/v1/wall/${p.id}/chat`, other.token, { text: 'ببخشید، دوباره سلام' });
    assert.equal(back.body.status, 'pending', 'a cancelled request can be sent again');
  });

  test('one inbox for every request received through the Wall, and a list of the ones sent', async () => {
    const { her, him } = await pair();
    const p = (await post(her.token, { text: 'یه همراه برای سینمای این هفته 🎬', category: 'outing', lookingFor: 'male' })).body;
    await call('POST', `/v1/wall/${p.id}/chat`, him.token, { text: 'منم پایه‌ام 🍿' });

    const inbox = await call('GET', '/v1/wall/requests', her.token);
    assert.equal(inbox.status, 200, JSON.stringify(inbox.body));
    assert.equal(inbox.body.pending, 1);
    const [item] = inbox.body.items;
    assert.equal(item.user.id, him.me.id);
    assert.equal(item.post.id, p.id);
    assert.equal(item.post.live, true);
    assert.equal((await call('GET', '/v1/wall/mine', her.token)).body.pendingRequests, 1);

    const sent = await call('GET', '/v1/wall/requests?box=out', him.token);
    assert.equal(sent.body.items.length, 1);
    assert.equal(sent.body.items[0].user.id, her.me.id, 'the sender sees the author');
    assert.equal(sent.body.items[0].status, 'pending');
    assert.equal((await call('GET', '/v1/wall/requests', him.token)).body.items.length, 0, 'nothing received');

    // taking the post down closes what was still waiting on it
    assert.equal((await call('DELETE', `/v1/wall/${p.id}`, her.token)).status, 200);
    assert.equal((await call('GET', '/v1/wall/requests', her.token)).body.pending, 0);
    assert.equal((await call('GET', '/v1/wall/mine', her.token)).body.pendingRequests, 0);
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
    const forMen = (await call('POST', '/v1/wall', her.token, { text: 'یه آقای اهل موسیقی برای گپ', category: 'chat', lookingFor: 'male' })).body;
    const other = await login();
    await onboard(other.token, 'female', 26);
    const forWomen = (await call('POST', '/v1/wall', other.token, { text: 'یه دوست دختر برای کافه‌گردی', category: 'outing', lookingFor: 'female' })).body;

    const all = (await call('GET', '/v1/wall?limit=30', him.token)).body.items.map((i: { id: string }) => i.id);
    assert.ok(all.includes(forMen.id) && all.includes(forWomen.id));
    const mine = (await call('GET', '/v1/wall?limit=30&forMe=1', him.token)).body.items.map((i: { id: string }) => i.id);
    assert.ok(mine.includes(forMen.id));
    assert.ok(!mine.includes(forWomen.id), 'a request for women is hidden from a man with «for me»');

    const chat = await call('POST', `/v1/wall/${forMen.id}/chat`, him.token, { text: 'سلام!' });
    assert.equal(chat.body.status, 'pending');
    const post = await call('GET', `/v1/wall/${forMen.id}`, him.token);
    assert.equal(post.body.myRequest, 'pending');
    assert.equal(post.body.matchId, null, 'no conversation before the author accepts');
  });
});

describe('the Wall bump', () => {
  test('members move a live request back to the top, once in a while; others are asked to join', async () => {
    const him = await login();
    await onboard(him.token, 'male', 30);
    const p = (await call('POST', '/v1/wall', him.token, { text: 'دنبال یه هم‌صحبت برای شب‌ها هستم', category: 'chat', lookingFor: 'female' })).body;
    const refused = await call('POST', `/v1/wall/${p.id}/bump`, him.token);
    assert.equal(refused.status, 402);
    assert.equal(refused.body.code, 'bump_premium');

    // newer requests by others push it down
    const reader = await login();
    await onboard(reader.token, 'female', 26);
    const later = await login();
    await onboard(later.token, 'female', 27);
    const newer = (await call('POST', '/v1/wall', later.token, { text: 'یه همراه برای پیاده‌روی عصرها', category: 'outing', lookingFor: 'male' })).body;
    // as if it had been posted a day ago, so the cooldown has passed
    await sql`UPDATE wall_posts SET created_at = now() - interval '1 day', sort_at = now() - interval '1 day' WHERE id = ${p.id}`;
    const ids = async () => (await call('GET', '/v1/wall?limit=30', reader.token)).body.items.map((i: { id: string }) => i.id);
    let order = await ids();
    assert.ok(order.indexOf(newer.id) < order.indexOf(p.id), 'older request is lower');

    await sql`UPDATE users SET premium_until = now() + interval '30 days' WHERE id = ${him.me.id}`;
    await redis.del(`ust:${him.me.id}`, `card:${him.me.id}`);
    wallJobs.length = 0;
    const bumped = await call('POST', `/v1/wall/${p.id}/bump`, him.token);
    assert.equal(bumped.status, 200, JSON.stringify(bumped.body));
    assert.ok(bumped.body.bumpedAt);
    assert.ok(bumped.body.nextBumpAt, 'the next bump waits');
    assert.equal(wallJobs.length, 0, 'not in the group: nothing to re-send');
    order = await ids();
    assert.equal(order[0], p.id, 'back on top');

    const again = await call('POST', `/v1/wall/${p.id}/bump`, him.token);
    assert.equal(again.status, 429);
    assert.equal(again.body.code, 'bump_wait');

    // women have it without membership, like every other perk
    const her = await login();
    await onboard(her.token, 'female', 24);
    const hers = (await call('POST', '/v1/wall', her.token, { text: 'یه آقای اهل کتاب برای گپ زدن', category: 'chat', lookingFor: 'male' })).body;
    await sql`UPDATE wall_posts SET sort_at = now() - interval '1 day' WHERE id = ${hers.id}`;
    assert.equal((await call('POST', `/v1/wall/${hers.id}/bump`, her.token)).status, 200);
  });

  test('Telegram service messages are recognised', async () => {
    const { isServiceMessage } = await import('../../src/modules/bot/bot.js');
    assert.equal(isServiceMessage({ message_id: 1, new_chat_members: [] }), true);
    assert.equal(isServiceMessage({ message_id: 1, left_chat_member: {} }), true);
    assert.equal(isServiceMessage({ message_id: 1, pinned_message: {} }), true);
    assert.equal(isServiceMessage({ message_id: 1, text: 'سلام' }), false);
    assert.equal(isServiceMessage({ message_id: 1, photo: [] }), false);
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
    await sendWithMedia(fakeApi, 1, 'match', '<b>مچ جدید!</b>');
    assert.equal(calls.at(-1)!.kind, 'text');

    const png = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#2a1640' } }).png().toBuffer();
    const admin = '00000000-0000-7000-8000-000000000001';
    await saveBotMedia('default', png, admin);
    forgetBotMediaCache();

    // a slot without its own picture uses the default one: uploaded the first time…
    await sendWithMedia(fakeApi, 1, 'match', '<b>مچ جدید!</b>');
    assert.equal(calls.at(-1)!.kind, 'photo');
    assert.notEqual(typeof calls.at(-1)!.photo, 'string', 'first send uploads the bytes');
    assert.equal(calls.at(-1)!.caption, '<b>مچ جدید!</b>');
    forgetBotMediaCache();
    // …and named by its Telegram id afterwards
    await sendWithMedia(fakeApi, 1, 'like', 'یک نفر لایکت کرد');
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

describe('first impressions', () => {
  test('a small area widens to the whole country instead of leaving the deck empty', async () => {
    const { saveSettings, getSettings } = await import('../../src/modules/settings/settings.js');
    const { PROVINCES } = await import('../../src/data/locations.js');
    const growth = (await getSettings()).growth;
    const her = await login();
    await onboard(her.token, 'female', 26);
    const viewer = await login();
    await onboard(viewer.token, 'male', 27);
    // the viewer lives in a city nobody else in the test database lives in, and wants only that city
    const province = PROVINCES[0]!;
    await sql`UPDATE users SET province_id = ${province.id}, city_id = ${province.cities[0]!.id} WHERE id = ${viewer.me.id}`;
    assert.equal((await call('PATCH', '/v1/me/preferences', viewer.token, { scope: 'city' })).status, 200);

    await call('POST', '/v1/discover/reset', viewer.token, {});
    const wide = await call('GET', '/v1/discover?limit=30', viewer.token);
    assert.equal(wide.status, 200, JSON.stringify(wide.body));
    assert.ok(wide.body.items.length > 0, 'people from elsewhere instead of an empty deck');
    assert.equal(wide.body.widened, 'country');

    await saveSettings({ growth: { ...growth, autoWidenBelow: 0 } }, null);
    await call('POST', '/v1/discover/reset', viewer.token, {});
    const strict = await call('GET', '/v1/discover?limit=30', viewer.token);
    assert.equal(strict.body.items.length, 0, 'with widening off, only the chosen city');
    assert.equal(strict.body.widened, null);
    await saveSettings({ growth }, null);
  });

  test('a newcomer is put in front of people online now', async () => {
    const { saveSettings, getSettings } = await import('../../src/modules/settings/settings.js');
    const growth = (await getSettings()).growth;
    await saveSettings({ growth: { ...growth, newcomerFanout: 500 } }, null);
    const him = await login();
    await onboard(him.token, 'male', 29);
    await call('GET', '/v1/discover?limit=1', him.token); // he has a deck already
    const newcomer = await login();
    await onboard(newcomer.token, 'female', 27);
    const next = await call('GET', '/v1/discover?limit=1', him.token);
    assert.equal(next.body.items[0]?.id, newcomer.me.id, 'the newcomer comes next in his deck');
    await saveSettings({ growth }, null);
  });

  test('the first likes are free to see, and the very first one is announced', async () => {
    const her = await login();
    await onboard(her.token, 'male', 23);
    botMessages.length = 0;
    const likers = [];
    for (let i = 0; i < 4; i++) {
      const u = await login();
      await onboard(u.token, 'female', 25 + i);
      assert.equal((await call('POST', '/v1/swipes', u.token, { targetId: her.me.id, action: 'like' })).status, 200);
      likers.push(u);
    }
    await new Promise((r) => setTimeout(r, 30));
    const firsts = botMessages.filter((m) => m.chatId === String(her.tgId) && /اولین لایکت/.test(m.text));
    assert.equal(firsts.length, 1, 'only the very first like gets the special message');

    const likes = await call('GET', '/v1/likes', her.token);
    assert.equal(likes.status, 200);
    assert.equal(likes.body.locked, true, 'the fourth one stays behind premium');
    const open = likes.body.items.filter((i: { user: unknown }) => i.user);
    assert.equal(open.length, 3);
    const openIds = open.map((i: { user: { id: string } }) => i.user.id).sort();
    assert.deepEqual(openIds, likers.slice(0, 3).map((u) => u.me.id).sort(), 'the first three who liked her');
  });

  test('Vibe Night: the window, and one gift per night', async () => {
    const { nightWindow } = await import('../../src/modules/growth/vibeNight.js');
    const cfg = { enabled: true, startHour: 21, durationMinutes: 120, bonusSuperLikes: 1, reminderEveryDays: 2, text: '' };
    // Tehran is UTC+3:30
    const on = nightWindow(cfg, new Date('2026-11-10T18:00:00Z')); // 21:30 Tehran
    assert.equal(on.active, true);
    assert.equal(on.minutesIn, 30);
    assert.equal(on.endsAt, '2026-11-10T19:30:00.000Z');
    const before = nightWindow(cfg, new Date('2026-11-10T15:00:00Z')); // 18:30 Tehran
    assert.equal(before.active, false);
    assert.equal(before.startsAt, '2026-11-10T17:30:00.000Z');
    const late = nightWindow({ ...cfg, startHour: 23 }, new Date('2026-11-10T21:00:00Z')); // 00:30 Tehran
    assert.equal(late.active, true, 'a night can run past midnight');
    assert.equal(late.minutesIn, 90);

    const { saveSettings, getSettings } = await import('../../src/modules/settings/settings.js');
    const saved = (await getSettings()).vibeNight;
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    await saveSettings({ vibeNight: { ...saved, enabled: true, startHour: hour, durationMinutes: 120, bonusSuperLikes: 2 } }, null);
    const u = await login();
    await onboard(u.token, 'male');
    const before0 = (await sql<{ b: number }[]>`SELECT bonus_superlikes AS b FROM users WHERE id = ${u.me.id}`)[0]!.b;
    const first = await call('GET', '/v1/vibe-night', u.token);
    assert.equal(first.body.active, true);
    assert.equal(first.body.granted, 2);
    assert.equal((await call('GET', '/v1/vibe-night', u.token)).body.granted, 0, 'once per night');
    const b = (await sql<{ b: number }[]>`SELECT bonus_superlikes AS b FROM users WHERE id = ${u.me.id}`)[0]!.b;
    assert.equal(b, before0 + 2);
    await saveSettings({ vibeNight: saved }, null);
  });

  test("a newcomer's first Wall request is in the spotlight", async () => {
    const her = await login();
    await onboard(her.token, 'female', 24);
    const him = await login();
    await onboard(him.token, 'male', 27);
    assert.equal((await call('GET', '/v1/wall/mine', her.token)).body.spotlightFirst, true);
    const p = (await call('POST', '/v1/wall', her.token, { text: 'تازه اومدم، کی پایه‌ی آشنایی‌ه؟ 🙂', category: 'friendship', lookingFor: 'male' })).body;
    assert.equal((await call('GET', '/v1/wall/mine', her.token)).body.spotlightFirst, false);
    const feed = await call('GET', '/v1/wall?limit=30', him.token);
    const spot = feed.body.spotlight.find((x: { id: string }) => x.id === p.id);
    assert.ok(spot, 'on top of the Wall');
    assert.equal(spot.firstRequest, true);
    const older = await call('GET', `/v1/wall?limit=30&cursor=${encodeURIComponent(new Date().toISOString() + '|' + p.id)}`, him.token);
    assert.deepEqual(older.body.spotlight, [], 'only on the first page');
  });
});

describe('the rules of the app', () => {
  const settingsModule = () => import('../../src/modules/settings/settings.js');
  const dayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());
  const swipe = (token: string, targetId: string, action: 'like' | 'pass' | 'superlike') => call('POST', '/v1/swipes', token, { targetId, action });
  const say = (token: string, matchId: string, text: string) =>
    call('POST', `/v1/conversations/${matchId}/messages`, token, { text, clientId: 'c' + Math.random().toString(36).slice(2).padEnd(10, '0') });
  const forget = (id: string) => redis.del(`ust:${id}`, `card:${id}`);

  /** Two people who like each other: returns the match id. */
  async function matched(a: { token: string; me: { id: string } }, b: { token: string; me: { id: string } }) {
    await swipe(a.token, b.me.id, 'like');
    const r = await swipe(b.token, a.me.id, 'like');
    assert.equal(r.body.matched, true, JSON.stringify(r.body));
    return r.body.matchId as string;
  }

  // every test here gets a city of its own, so a «city» deck holds exactly the people it put there
  let cityN = 1;
  async function ownCity(...ids: string[]) {
    const { PROVINCES } = await import('../../src/data/locations.js');
    const p = PROVINCES[cityN++]!;
    await sql`UPDATE users SET province_id = ${p.id}, city_id = ${p.cities[0]!.id} WHERE id = ANY(${ids}::uuid[])`;
    for (const id of ids) await forget(id);
  }
  async function cityDeck(u: { token: string }) {
    assert.equal((await call('PATCH', '/v1/me/preferences', u.token, { scope: 'city' })).status, 200);
    await call('POST', '/v1/discover/reset', u.token, {});
    const r = await call('GET', '/v1/discover?limit=30', u.token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body as { items: { id: string; superLikedYou?: boolean }[]; exhausted: boolean; widened: string | null };
  }

  let savedGrowth: Awaited<ReturnType<Awaited<ReturnType<typeof settingsModule>>['getSettings']>>['growth'];
  before(async () => {
    const { getSettings, saveSettings } = await settingsModule();
    savedGrowth = (await getSettings()).growth;
    // no widening, no newcomer fan-out: decks contain only what a test arranges
    await saveSettings({ growth: { ...savedGrowth, autoWidenBelow: 0, newcomerFanout: 0 } }, null);
  });
  after(async () => {
    const { saveSettings } = await settingsModule();
    await saveSettings({ growth: savedGrowth }, null);
  });

  test('an age range only filters once its owner chose it', async () => {
    const older = await login();
    await onboard(older.token, 'male', 52);
    const she = await login();
    await onboard(she.token, 'female', 25);
    await ownCity(older.me.id, she.me.id);

    let me = await call('GET', '/v1/me', she.token);
    assert.equal(me.body.preferences.ageSet, false);
    assert.deepEqual([me.body.preferences.minAge, me.body.preferences.maxAge], [18, 99], 'every age until she chooses');
    assert.deepEqual((await cityDeck(she)).items.map((i) => i.id), [older.me.id], 'a suggestion hides nobody');
    assert.deepEqual((await cityDeck(older)).items.map((i) => i.id), [she.me.id]);

    assert.equal((await call('PATCH', '/v1/me/preferences', she.token, { minAge: 20, maxAge: 30 })).status, 200);
    me = await call('GET', '/v1/me', she.token);
    assert.equal(me.body.preferences.ageSet, true);
    assert.equal((await cityDeck(she)).items.length, 0, 'now it is her choice: he is outside it');
    assert.equal((await cityDeck(older)).items.length, 0, 'and he is not shown someone who excluded his age');
  });

  test('a pass is not forever, and a super like comes first with a star', async () => {
    const he = await login();
    await onboard(he.token, 'male', 27);
    const she = await login();
    await onboard(she.token, 'female', 25);
    await ownCity(he.me.id, she.me.id);

    assert.deepEqual((await cityDeck(she)).items.map((i) => i.id), [he.me.id]);
    await swipe(she.token, he.me.id, 'pass');
    let deck = await cityDeck(she);
    assert.equal(deck.items.length, 0);
    assert.equal(deck.exhausted, true);

    await sql`UPDATE swipes SET created_at = now() - interval '31 days' WHERE swiper_id = ${she.me.id} AND target_id = ${he.me.id}`;
    await swipe(he.token, she.me.id, 'superlike');
    deck = await cityDeck(she);
    assert.equal(deck.items[0]?.id, he.me.id, 'passed a month ago: shown again');
    assert.equal(deck.widened, 'recycled');
    assert.equal(deck.items[0]?.superLikedYou, true);
    const again = await swipe(she.token, he.me.id, 'like');
    assert.equal(again.body.matched, true, 'the new answer replaces the old pass');
  });

  test('someone who already liked you is among the first cards; likes a day depend on gender', async () => {
    const she = await login();
    await onboard(she.token, 'female', 24);
    const men = [];
    for (let i = 0; i < 4; i++) {
      const m = await login();
      await onboard(m.token, 'male', 25 + i);
      men.push(m);
    }
    await ownCity(she.me.id, ...men.map((m) => m.me.id));
    await swipe(men[2]!.token, she.me.id, 'like');
    const deck = await cityDeck(she);
    assert.equal(deck.items.length, 4);
    assert.equal(deck.items[0]!.id, men[2]!.me.id, 'the one who liked her comes first');
    assert.equal(deck.items[0]!.superLikedYou, undefined, 'an ordinary like stays a secret');

    assert.equal((await call('GET', '/v1/me', she.token)).body.limits.dailyLikes, null);
    assert.equal((await call('GET', '/v1/me', men[0]!.token)).body.limits.likesLeft, null, 'how many are left is never told');
  });

  test('a shadow-banned account reaches nobody', async () => {
    const ghost = await login({ name: 'Ghost' });
    await onboard(ghost.token, 'male', 28);
    const friend = await login();
    await onboard(friend.token, 'female', 26);
    const fan = await login();
    await onboard(fan.token, 'female', 27);
    const stranger = await login();
    await onboard(stranger.token, 'female', 25);
    const matchId = await matched(ghost, friend); // from before the ban
    await swipe(fan.token, ghost.me.id, 'like'); // she liked him before the ban

    await sql`UPDATE users SET shadow_banned = true WHERE id = ${ghost.me.id}`;
    await forget(ghost.me.id);

    // likes: nobody is told, nothing matches
    botMessages.length = 0;
    assert.equal((await swipe(ghost.token, stranger.me.id, 'like')).body.matched, false);
    assert.equal((await swipe(ghost.token, fan.me.id, 'like')).body.matched, false, 'even a like back makes no match');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal((await call('GET', '/v1/likes', stranger.token)).body.total, 0);
    assert.equal((await call('GET', '/v1/conversations', fan.token)).body.items.length, 0);
    assert.ok(!botMessages.some((m) => m.chatId === String(stranger.tgId)));

    // messages: he sees his own, she sees nothing
    assert.equal((await say(ghost.token, matchId, 'سلام، هستی؟')).status, 200);
    assert.equal((await call('GET', `/v1/conversations/${matchId}/messages`, ghost.token)).body.items.length, 1);
    assert.equal((await call('GET', `/v1/conversations/${matchId}/messages`, friend.token)).body.items.length, 0);
    assert.equal((await call('GET', `/v1/conversations/${matchId}`, friend.token)).body.unread, 0);

    // the Wall: his request looks sent to him, and never arrives
    const p = (await call('POST', '/v1/wall', stranger.token, { text: 'دنبال یه هم‌صحبت برای عصرها هستم', category: 'chat', lookingFor: 'male' })).body;
    const req = await call('POST', `/v1/wall/${p.id}/chat`, ghost.token, { text: 'سلام! منم هستم' });
    assert.equal(req.body.status, 'pending');
    assert.equal((await call('GET', `/v1/wall/${p.id}`, ghost.token)).body.myRequest, 'pending');
    const inbox = await call('GET', '/v1/wall/requests', stranger.token);
    assert.equal(inbox.body.items.length, 0);
    assert.equal((await call('GET', '/v1/wall/mine', stranger.token)).body.pendingRequests, 0);
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

  test('premium-only options end with premium', async () => {
    const u = await login();
    await onboard(u.token, 'male', 31);
    const refused = await call('PATCH', '/v1/me/privacy', u.token, { incognito: true });
    assert.equal(refused.body.code, 'premium_required');

    await sql`UPDATE users SET premium_until = now() + interval '1 day' WHERE id = ${u.me.id}`;
    await forget(u.me.id);
    assert.equal((await call('PATCH', '/v1/me/privacy', u.token, { incognito: true, hideAge: true })).status, 200);
    const on = await call('GET', '/v1/me', u.token);
    assert.deepEqual([on.body.privacy.incognito, on.body.privacy.hideAge], [true, true]);

    await sql`UPDATE users SET premium_until = now() - interval '1 minute' WHERE id = ${u.me.id}`;
    await forget(u.me.id);
    const me = await call('GET', '/v1/me', u.token);
    assert.deepEqual([me.body.privacy.incognito, me.body.privacy.hideAge], [false, false], 'off at once');
    const { expirePremiumPerks } = await import('../../src/jobs.js');
    await expirePremiumPerks();
    const [row] = await sql<{ incognito: boolean; hide_age: boolean }[]>`
      SELECT incognito, hide_age FROM users WHERE id = ${u.me.id}`;
    assert.deepEqual([row!.incognito, row!.hide_age], [false, false]);
  });

  test('silent matches are nudged once, then archived; no flooding before a reply', async () => {
    const he = await login({ name: 'Reza' });
    await onboard(he.token, 'male', 28, 'رضا');
    const she = await login({ name: 'Mina' });
    await onboard(she.token, 'female', 26, 'مینا');
    const matchId = await matched(he, she);
    const { matchCare } = await import('../../src/modules/chat/jobs.js');
    const nudges = async (token: string) =>
      (await call('GET', '/v1/notifications', token)).body.items.filter((n: { type: string }) => n.type === 'match_nudge').length;

    await matchCare();
    assert.equal(await nudges(he.token), 0, 'not on the first day');
    await sql`UPDATE matches SET created_at = now() - interval '25 hours' WHERE id = ${matchId}`;
    await matchCare();
    await matchCare();
    assert.equal(await nudges(he.token), 1);
    assert.equal(await nudges(she.token), 1);

    await sql`UPDATE matches SET created_at = now() - interval '15 days' WHERE id = ${matchId}`;
    await matchCare();
    let list = await call('GET', '/v1/conversations', he.token);
    assert.ok(!list.body.items.some((c: { id: string }) => c.id === matchId), 'out of the main list');
    assert.equal(list.body.archivedCount, 1);
    const archive = await call('GET', '/v1/conversations?archived=1', he.token);
    assert.ok(archive.body.items.some((c: { id: string }) => c.id === matchId));

    for (let i = 0; i < 3; i++) assert.equal((await say(he.token, matchId, `سلام ${i}`)).status, 200);
    const fourth = await say(he.token, matchId, 'هستی؟');
    assert.equal(fourth.status, 409);
    assert.equal(fourth.body.code, 'wait_for_reply');
    list = await call('GET', '/v1/conversations', he.token);
    assert.ok(list.body.items.some((c: { id: string }) => c.id === matchId), 'a first message brings it back');
    assert.equal((await say(she.token, matchId, 'سلام! ببخشید دیر شد')).status, 200);
    assert.equal((await say(he.token, matchId, 'خواهش می‌کنم 🙂')).status, 200, 'she answered: the limit is gone');

    const [her] = await sql<{ openers_received: number; replies_given: number }[]>`
      SELECT openers_received, replies_given FROM users WHERE id = ${she.me.id}`;
    assert.deepEqual([her!.openers_received, her!.replies_given], [1, 1], 'she was written to, and she answered');
  });

  test('random chat: counts once both wrote, ratings feed trust, serial skippers wait', async () => {
    const { getSettings, saveSettings } = await settingsModule();
    const saved = (await getSettings()).randomChat;
    await saveSettings({ randomChat: { ...saved, skipLimit: 1 } }, null);
    const a = await login();
    await onboard(a.token, 'male', 27);
    const b = await login();
    await onboard(b.token, 'female', 25);
    // only these two in the queue
    await redis.del('rc:wait');

    assert.equal((await call('POST', '/v1/random/join', a.token, {})).body.status, 'waiting');
    const joined = await call('POST', '/v1/random/join', b.token, {});
    assert.equal(joined.body.status, 'chatting', JSON.stringify(joined.body));
    const sessionId = joined.body.session.id as string;
    const countOf = async (id: string) => (await sql<{ n: number }[]>`SELECT rc_used AS n FROM users WHERE id = ${id}`)[0]!.n;
    assert.equal(await countOf(a.me.id), 0, 'being paired costs nothing yet');

    const send = (token: string, text: string) =>
      call('POST', '/v1/random/messages', token, { text, clientId: 'r' + Math.random().toString(36).slice(2).padEnd(10, '0') });
    assert.equal((await call('POST', '/v1/random/rate', a.token, { sessionId, up: true })).body.counted, false, 'nothing to rate before a real chat');
    await send(a.token, 'سلام');
    assert.equal(await countOf(a.me.id), 0);
    await send(b.token, 'سلام!');
    assert.deepEqual([await countOf(a.me.id), await countOf(b.me.id)], [1, 0], 'both wrote: it counts — for him; she has no limit');

    assert.equal((await call('POST', '/v1/random/rate', a.token, { sessionId, up: true })).body.counted, true);
    assert.equal((await call('POST', '/v1/random/rate', a.token, { sessionId, up: false })).body.counted, false, 'once per chat');
    const [rated] = await sql<{ rc_up: number; rc_down: number; trust: number }[]>`SELECT rc_up, rc_down, trust FROM users WHERE id = ${b.me.id}`;
    assert.deepEqual([rated!.rc_up, rated!.rc_down], [1, 0]);
    assert.ok(rated!.trust > 50);

    const left = await call('POST', '/v1/random/leave', a.token, {});
    assert.ok(left.body.cooldownSeconds > 0, 'left within seconds');
    const retry = await call('POST', '/v1/random/join', a.token, {});
    assert.equal(retry.status, 429);
    assert.equal(retry.body.code, 'random_cooldown');
    await redis.del(`rc:cool:${a.me.id}`);
    await saveSettings({ randomChat: saved }, null);
  });

  test('requests nobody answered end with the post, and the quota comes back', async () => {
    const her = await login();
    await onboard(her.token, 'female', 26);
    const him = await login();
    await onboard(him.token, 'male', 28);
    const p = (await call('POST', '/v1/wall', her.token, { text: 'یه همراه برای کافه‌گردی آخر هفته', category: 'outing', lookingFor: 'male' })).body;
    assert.equal((await call('POST', `/v1/wall/${p.id}/chat`, him.token, { text: 'من پایه‌ام ☕' })).body.status, 'pending');
    const quotaKey = `wallreq:${him.me.id}:${dayKey()}`;
    assert.equal(Number(await redis.get(quotaKey)), 1);

    const { wallRequestCare } = await import('../../src/modules/wall/service.js');
    const reminders = async () =>
      (await call('GET', '/v1/notifications', her.token)).body.items.filter(
        (n: { type: string; data: { reminder?: boolean } | null }) => n.type === 'wall_request' && n.data?.reminder,
      ).length;
    await wallRequestCare();
    assert.equal(await reminders(), 0, 'not yet');
    await sql`UPDATE wall_chat_requests SET created_at = now() - interval '13 hours' WHERE from_id = ${him.me.id}`;
    await wallRequestCare();
    await wallRequestCare();
    assert.equal(await reminders(), 1, 'one reminder per waiting request');

    await sql`UPDATE wall_posts SET expires_at = now() - interval '1 minute' WHERE id = ${p.id}`;
    await wallRequestCare();
    const sent = await call('GET', '/v1/wall/requests?box=out', him.token);
    assert.equal(sent.body.items[0].status, 'expired');
    assert.equal(Number(await redis.get(quotaKey)), 0, 'the slot is given back');
    assert.equal((await call('GET', '/v1/wall/requests', her.token)).body.pending, 0);
  });

  test('the store sells memberships only; boosts someone already has still work', async () => {
    const { uuidv7 } = await import('../../src/lib/ids.js');
    await sql`
      INSERT INTO plans (id, title, kind, quantity, duration_days, price_toman, sort) VALUES
        (${uuidv7()}, '۲ بوست', 'boost', 2, 0, 30000, 10), (${uuidv7()}, '۵ سوپرلایک', 'superlikes', 5, 0, 25000, 20)`;
    const plans = await call('GET', '/v1/plans');
    assert.ok(plans.body.items.length > 0);
    assert.ok(plans.body.items.every((i: { durationDays: number }) => i.durationDays > 0), 'memberships only');
    assert.equal(plans.body.packs, undefined, 'no packs on sale');

    const u = await login();
    await onboard(u.token, 'male', 27);
    const none = await call('POST', '/v1/boost', u.token, {});
    assert.equal(none.status, 402);
    assert.equal(none.body.code, 'boost_required');

    await sql`UPDATE users SET boost_credits = 2 WHERE id = ${u.me.id}`;
    await forget(u.me.id);
    const boosted = await call('POST', '/v1/boost', u.token, {});
    assert.equal(boosted.status, 200, JSON.stringify(boosted.body));
    assert.equal(boosted.body.usedCredit, true);
    assert.equal(boosted.body.boostCredits, 1);
    assert.equal((await call('POST', '/v1/boost', u.token, {})).body.code, 'boost_active', 'one at a time');
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
  /** Two fresh people who like each other; \`first\` likes first, with a super like if asked. */
  async function pair(firstAction: 'like' | 'superlike' = 'like') {
    const a = await login();
    const b = await login();
    const am = await onboard(a.token, 'male', 29, 'آرش');
    const bm = await onboard(b.token, 'female', 27, 'بهار');
    assert.equal((await call('POST', '/v1/swipes', a.token, { targetId: bm.id, action: firstAction })).status, 200);
    const m = await call('POST', '/v1/swipes', b.token, { targetId: am.id, action: 'like' });
    assert.equal(m.body.matched, true, JSON.stringify(m.body));
    return { a, b, am, bm, matchId: m.body.matchId as string };
  }

  test('a like match says who liked first; a super like says who sent it', async () => {
    const liked = await pair('like');
    const conv = await call('GET', `/v1/conversations/${liked.matchId}`, liked.b.token);
    assert.deepEqual(conv.body.origin, { kind: 'like', by: liked.am.id });

    const starred = await pair('superlike');
    const conv2 = await call('GET', `/v1/conversations/${starred.matchId}`, starred.a.token);
    assert.deepEqual(conv2.body.origin, { kind: 'superlike', by: starred.am.id });
  });

  test('the first look at a match’s profile is told once, in the chat, to the one looked at', async () => {
    const { a, b, bm, matchId } = await pair();
    // loading the card for the chat header is not «looking»
    assert.equal((await call('GET', `/v1/users/${bm.id}`, a.token)).status, 200);
    let hers = await call('GET', `/v1/conversations/${matchId}/messages`, b.token);
    assert.equal(hers.body.items.length, 0);

    const looked = await call('POST', `/v1/users/${bm.id}/viewed`, a.token, {});
    assert.equal(looked.body.noted, true);
    hers = await call('GET', `/v1/conversations/${matchId}/messages`, b.token);
    assert.equal(hers.body.items.length, 1);
    assert.equal(hers.body.items[0].kind, 'system');
    assert.match(hers.body.items[0].body, /آرش پروفایلت رو دید/);
    assert.equal((await call('GET', `/v1/conversations/${matchId}`, b.token)).body.unread, 1, 'it counts as new');

    const his = await call('GET', `/v1/conversations/${matchId}/messages`, a.token);
    assert.equal(his.body.items.length, 0, 'the one who looked sees nothing');
    assert.equal((await call('GET', `/v1/conversations/${matchId}`, a.token)).body.lastMessage, null, 'nor in the list');

    assert.equal((await call('POST', `/v1/users/${bm.id}/viewed`, a.token, {})).body.noted, false, 'only the first time');
    assert.equal((await call('GET', `/v1/conversations/${matchId}/messages`, b.token)).body.items.length, 1);

    // reading the chat clears it like any message
    await call('POST', `/v1/conversations/${matchId}/read`, b.token, { upTo: hers.body.items[0].id });
    assert.equal((await call('GET', `/v1/conversations/${matchId}`, b.token)).body.unread, 0);
  });

  test('a premium member in incognito looks quietly', async () => {
    const { a, b, am, bm, matchId } = await pair();
    await sql`UPDATE users SET premium_until = now() + interval '1 day' WHERE id = ${am.id}`;
    await redis.del(`ust:${am.id}`, `card:${am.id}`);
    assert.equal((await call('PATCH', '/v1/me/privacy', a.token, { incognito: true })).status, 200);
    assert.equal((await call('POST', `/v1/users/${bm.id}/viewed`, a.token, {})).body.noted, false);
    assert.equal((await call('GET', `/v1/conversations/${matchId}/messages`, b.token)).body.items.length, 0, 'nothing in her chat');

    // and switching incognito off later does not announce that earlier look
    assert.equal((await call('PATCH', '/v1/me/privacy', a.token, { incognito: false })).status, 200);
    assert.equal((await call('POST', `/v1/users/${bm.id}/viewed`, a.token, {})).body.noted, false);
    assert.equal((await call('GET', `/v1/conversations/${matchId}/messages`, b.token)).body.items.length, 0);
  });

  test('looking at someone you are not matched with tells nobody', async () => {
    const x = await login();
    const y = await login();
    await onboard(x.token, 'male', 30);
    const ym = await onboard(y.token, 'female', 28);
    assert.equal((await call('POST', `/v1/users/${ym.id}/viewed`, x.token, {})).body.noted, false);
    assert.equal((await call('GET', '/v1/conversations', y.token)).body.items.length, 0);
  });
});
