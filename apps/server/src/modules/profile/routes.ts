import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { MARITAL_IDS } from '../../data/catalog.js';
import { sql } from '../../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { randomToken, uuidv7 } from '../../lib/ids.js';
import { processPhoto } from '../../lib/images.js';
import { enqueue } from '../../lib/queue.js';
import { redis } from '../../lib/redis.js';
import { putObject } from '../../lib/storage.js';
import { ageFrom, birthdateForAge, containsBannedWord, normalizeText } from '../../lib/text.js';
import { env } from '../../config.js';
import { botApi } from '../bot/sender.js';
import { bumpDailyCounter } from '../users/activity.js';
import { parse, zUuid } from '../../lib/validate.js';
import { invalidateUser, requireUser } from '../auth/guard.js';
import { exposeNewcomer, resetDeck } from '../discover/deck.js';
import { deleteAccount } from '../users/lifecycle.js';
import { getSettings } from '../settings/settings.js';
import { getMe, photoObjectKeys, refreshPhotoCount } from './service.js';

const text = (max: number) => z.string().max(max).transform(normalizeText);

const ProfilePatch = z.object({
  name: text(30)
    .refine((v) => v.length >= 2, 'نام کوتاه است')
    .refine((v) => /^[\p{L}\p{M} ]+$/u.test(v), 'نام فقط می‌تواند حروف باشد')
    .optional(),
  gender: z.enum(['male', 'female']).optional(),
  birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Onboarding asks only for an age; it is stored as a birthdate (today minus `age` years). */
  age: z.number().int().min(13).max(99).optional(),
  interestedIn: z.enum(['male', 'female', 'everyone']).optional(),
  bio: text(500).nullable().optional(),
  maritalStatus: z.enum(MARITAL_IDS).nullable().optional(),
});

const COLUMN: Record<string, string> = {
  name: 'name',
  gender: 'gender',
  birthdate: 'birthdate',
  interestedIn: 'interested_in',
  bio: 'bio',
  maritalStatus: 'marital_status',
};

async function readUpload(req: FastifyRequest, field: string): Promise<Buffer> {
  const file = await req.file();
  if (!file || file.fieldname !== field) throw badRequest('فایل ارسال نشده است');
  try {
    return await file.toBuffer();
  } catch {
    throw badRequest('حجم فایل بیش از حد مجاز است');
  }
}

const MAX_REMOTE_PHOTO = 10 * 1024 * 1024;

async function download(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_REMOTE_PHOTO) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > MAX_REMOTE_PHOTO ? null : buf;
}

/** Biggest size of the user's current Telegram profile photo (bot API), else the init data photo_url. */
async function fetchTelegramPhoto(userId: string): Promise<Buffer | null> {
  const [u] = await sql<{ telegram_id: string | null }[]>`SELECT telegram_id FROM users WHERE id = ${userId}`;
  const api = botApi();
  if (api && u?.telegram_id) {
    try {
      const res = await api.getUserProfilePhotos(Number(u.telegram_id), { limit: 1 });
      const sizes = res.photos[0];
      const best = sizes?.[sizes.length - 1];
      if (best) {
        const file = await api.getFile(best.file_id);
        if (file.file_path) {
          const buf = await download(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`);
          if (buf) return buf;
        }
      }
    } catch {
      // fall back to the init data URL
    }
  }
  const url = await redis.get(`tgphoto:${userId}`);
  return url ? download(url).catch(() => null) : null;
}

/** Adds a picture to any profile (used by the panel for the profiles the app runs itself). */
export const savePhotoFor = (userId: string, input: Buffer) => savePhoto(userId, input, 'upload');

/** Normalizes, stores all sizes and the unrelated-key blur, and appends the photo to the profile. */
async function savePhoto(userId: string, input: Buffer, source: 'upload' | 'telegram') {
  const image = await processPhoto(input);
  const id = uuidv7();
  const key = `photos/${userId}/${id}`;
  const blurKey = `photos/x/${randomToken(16)}.webp`;
  await Promise.all([
    ...image.variants.map((v) => putObject(`${key}/${v.name}.webp`, v.body, 'image/webp')),
    putObject(blurKey, image.blur, 'image/webp'),
  ]);
  await sql`
    INSERT INTO photos (id, user_id, position, status, source, storage_key, blur_key, width, height, color, risk)
    VALUES (${id}, ${userId},
            (SELECT coalesce(max(position) + 1, 0) FROM photos WHERE user_id = ${userId}),
            'approved', ${source}, ${key}, ${blurKey}, ${image.width}, ${image.height}, ${image.color}, ${image.risk})`;
  await refreshPhotoCount(userId);
  await afterProfileChange(userId);
}

/** Profile changes invalidate the card cache and the user's queued decks elsewhere pick it up within minutes. */
async function afterProfileChange(userId: string) {
  await invalidateUser(userId);
}

export async function profileRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/v1/me', async (req) => getMe(req.user.id));

  app.patch('/v1/me', async (req) => {
    const patch = parse(ProfilePatch, req.body);
    const settings = await getSettings();
    const [current] = await sql`SELECT status, interested_in FROM users WHERE id = ${req.user.id}`;
    if (!current) throw notFound();

    // Gender and age are fixed once the profile is live (prevents abuse); support can change them.
    if (current.status !== 'onboarding' && (patch.gender !== undefined || patch.birthdate !== undefined)) {
      throw forbidden('جنسیت و تاریخ تولد بعد از ثبت قابل تغییر نیست. برای اصلاح با پشتیبانی تماس بگیرید.', 'locked_field');
    }
    if (current.status !== 'onboarding' && patch.age !== undefined) {
      throw forbidden('سن بعد از ثبت قابل تغییر نیست. برای اصلاح با پشتیبانی تماس بگیرید.', 'locked_field');
    }
    if (patch.age !== undefined) {
      if (patch.age < settings.minAge) throw forbidden(`حداقل سن برای استفاده ${settings.minAge} سال است`, 'underage');
      patch.birthdate = birthdateForAge(patch.age);
      delete patch.age;
    }
    if (patch.gender !== undefined && patch.interestedIn === undefined && current.status === 'onboarding' && !current.interested_in) {
      patch.interestedIn = patch.gender === 'male' ? 'female' : 'male';
    }
    if (patch.birthdate !== undefined) {
      const age = ageFrom(patch.birthdate);
      if (age == null || Number.isNaN(age)) throw badRequest('تاریخ تولد نامعتبر است');
      if (age < settings.minAge) throw forbidden(`حداقل سن برای استفاده ${settings.minAge} سال است`, 'underage');
      if (age > 99) throw badRequest('تاریخ تولد نامعتبر است');
    }
    for (const field of ['name', 'bio'] as const) {
      const v = patch[field];
      if (typeof v === 'string' && containsBannedWord(v, settings.bannedWords)) {
        throw badRequest('متن شامل کلمات غیرمجاز است', [{ path: field, message: 'banned_word' }]);
      }
    }
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) values[COLUMN[key]!] = value === '' ? null : value;
    }
    if (Object.keys(values).length) {
      values.updated_at = new Date();
      await sql`UPDATE users SET ${sql(values)} WHERE id = ${req.user.id}`;
      await afterProfileChange(req.user.id);
    }
    return getMe(req.user.id);
  });

  /** Ends onboarding: the profile becomes visible in discovery. */
  app.post('/v1/me/complete', async (req) => {
    const [u] = await sql`
      SELECT status, name, gender, birthdate, interested_in,
             (SELECT count(*)::int FROM photos p WHERE p.user_id = users.id AND p.status <> 'rejected') AS photos
      FROM users WHERE id = ${req.user.id}`;
    if (!u) throw notFound();
    if (u.status === 'active') return getMe(req.user.id);
    // A photo is not required: someone whose Telegram has none gets their name as their picture.
    const missing = [!u.name && 'name', !u.gender && 'gender', !u.birthdate && 'birthdate'].filter(Boolean);
    if (missing.length) throw badRequest('پروفایل کامل نیست', missing.map((m) => ({ path: m, message: 'required' })));
    const activated = await sql`
      UPDATE users SET status = 'active', activated_at = now(), updated_at = now(),
        interested_in = coalesce(interested_in, CASE WHEN gender = 'male' THEN 'female' ELSE 'male' END),
        -- «تأیید حساب»: women start verified, men have to be verified to keep writing
        verified = verified OR gender = 'female',
        verified_at = CASE WHEN verified OR gender = 'female' THEN coalesce(verified_at, now()) ELSE verified_at END,
        -- a suggested age range around their own age; it only orders the cards until they set one
        -- every age until they choose a range themselves
        pref_min_age = CASE WHEN pref_age_set THEN pref_min_age ELSE 18 END,
        pref_max_age = CASE WHEN pref_age_set THEN pref_max_age ELSE 99 END
      WHERE id = ${req.user.id} AND status = 'onboarding' RETURNING 1`;
    await afterProfileChange(req.user.id);
    if (activated.length) {
      await bumpDailyCounter('activations');
      // straight into the decks of people online now: the first message should come in minutes
      const { newcomerFanout } = await getSettings();
      await exposeNewcomer(req.user.id, newcomerFanout).catch((e) => req.log.warn(e, 'newcomer fan-out failed'));
    }
    return getMe(req.user.id);
  });

  app.patch('/v1/me/preferences', async (req) => {
    const p = parse(
      z
        .object({
          minAge: z.number().int().min(18).max(99).optional(),
          maxAge: z.number().int().min(18).max(99).optional(),
          /** who to see in discovery (also changeable from the profile) */
          interestedIn: z.enum(['male', 'female', 'everyone']).optional(),
        })
        .refine((v) => v.minAge === undefined || v.maxAge === undefined || v.minAge <= v.maxAge, 'بازه‌ی سنی نامعتبر'),
      req.body,
    );
    const values: Record<string, unknown> = {};
    if (p.minAge !== undefined) values.pref_min_age = p.minAge;
    if (p.maxAge !== undefined) values.pref_max_age = p.maxAge;
    // from now on the range is theirs: it filters, and others' cards respect it
    if (p.minAge !== undefined || p.maxAge !== undefined) values.pref_age_set = true;
    if (p.interestedIn !== undefined) values.interested_in = p.interestedIn;
    if (Object.keys(values).length) {
      await sql`UPDATE users SET ${sql(values)}, updated_at = now() WHERE id = ${req.user.id}`;
      await sql`UPDATE users SET pref_max_age = pref_min_age WHERE id = ${req.user.id} AND pref_max_age < pref_min_age`;
      await resetDeck(req.user.id);
    }
    return getMe(req.user.id);
  });

  app.patch('/v1/me/privacy', async (req) => {
    const p = parse(
      z.object({
        showTelegram: z.boolean().optional(),
        hideAge: z.boolean().optional(),
        discoverable: z.boolean().optional(),
      }),
      req.body,
    );
    const values: Record<string, unknown> = {};
    if (p.showTelegram !== undefined) values.show_telegram = p.showTelegram;
    if (p.hideAge !== undefined) values.hide_age = p.hideAge;
    if (p.discoverable !== undefined) values.discoverable = p.discoverable;
    if (Object.keys(values).length) {
      await sql`UPDATE users SET ${sql(values)}, updated_at = now() WHERE id = ${req.user.id}`;
      await afterProfileChange(req.user.id);
    }
    return getMe(req.user.id);
  });

  app.patch('/v1/me/notification-settings', async (req) => {
    const p = parse(z.object({ messages: z.boolean().optional() }), req.body);
    const values: Record<string, unknown> = {};
    if (p.messages !== undefined) values.notify_messages = p.messages;
    if (Object.keys(values).length) await sql`UPDATE users SET ${sql(values)} WHERE id = ${req.user.id}`;
    return getMe(req.user.id);
  });

  /** The user allowed the bot to message them from inside the Mini App (requestWriteAccess). */
  app.post('/v1/me/write-access', async (req) => {
    const { allowed } = parse(z.object({ allowed: z.boolean() }), req.body);
    if (allowed) await sql`UPDATE users SET can_dm = true, bot_blocked = false WHERE id = ${req.user.id}`;
    return { ok: true };
  });

  // ---- photos ---------------------------------------------------------------------------

  app.post('/v1/me/photos', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const settings = await getSettings();
    const [{ count }] = (await sql`SELECT count(*)::int AS count FROM photos WHERE user_id = ${req.user.id} AND status <> 'rejected'`) as unknown as [{ count: number }];
    if (count >= settings.maxPhotos) throw conflict(`حداکثر ${settings.maxPhotos} عکس می‌توانید داشته باشید`, 'too_many_photos');
    const input = await readUpload(req, 'photo');
    await savePhoto(req.user.id, input, 'upload');
    return getMe(req.user.id);
  });

  /** Imports the user's Telegram profile photo (one tap during onboarding instead of an upload). */
  app.post('/v1/me/photos/telegram', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const settings = await getSettings();
    const [{ count }] = (await sql`SELECT count(*)::int AS count FROM photos WHERE user_id = ${req.user.id} AND status <> 'rejected'`) as unknown as [{ count: number }];
    if (count >= settings.maxPhotos) throw conflict(`حداکثر ${settings.maxPhotos} عکس می‌توانید داشته باشید`, 'too_many_photos');
    const [dup] = await sql`SELECT 1 FROM photos WHERE user_id = ${req.user.id} AND source = 'telegram' AND status <> 'rejected'`;
    if (dup) throw conflict('عکس تلگرامت قبلاً اضافه شده است', 'telegram_photo_exists');
    const input = await fetchTelegramPhoto(req.user.id);
    if (!input) throw notFound('عکس پروفایل تلگرامت در دسترس نیست. یک عکس از گالری انتخاب کن 📷');
    await savePhoto(req.user.id, input, 'telegram');
    return getMe(req.user.id);
  });

  /**
   * Replaces one photo's picture, keeping its id and position — so «change my photo» works for
   * someone who only has one (deleting it would be refused) and never costs them their main slot.
   */
  app.put('/v1/me/photos/:id', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [old] = await sql<{ storage_key: string; blur_key: string }[]>`
      SELECT storage_key, blur_key FROM photos WHERE id = ${id} AND user_id = ${req.user.id}`;
    if (!old) throw notFound('عکس پیدا نشد');
    const input = await readUpload(req, 'photo');
    const image = await processPhoto(input);
    const key = `photos/${req.user.id}/${uuidv7()}`;
    const blurKey = `photos/x/${randomToken(16)}.webp`;
    await Promise.all([
      ...image.variants.map((v) => putObject(`${key}/${v.name}.webp`, v.body, 'image/webp')),
      putObject(blurKey, image.blur, 'image/webp'),
    ]);
    // a replaced picture starts over: whatever a moderator decided was about the old one
    await sql`
      UPDATE photos SET storage_key = ${key}, blur_key = ${blurKey}, width = ${image.width}, height = ${image.height},
        color = ${image.color}, risk = ${image.risk}, status = 'approved', reject_reason = NULL,
        reviewed_by = NULL, reviewed_at = NULL, flagged = false
      WHERE id = ${id} AND user_id = ${req.user.id}`;
    await enqueue({ name: 'delete-objects', keys: photoObjectKeys(old) });
    await refreshPhotoCount(req.user.id);
    await afterProfileChange(req.user.id);
    return getMe(req.user.id);
  });

  app.delete('/v1/me/photos/:id', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [row] = await sql<{ storage_key: string; blur_key: string; status: string }[]>`
      SELECT storage_key, blur_key, status FROM photos WHERE id = ${id} AND user_id = ${req.user.id}`;
    if (!row) throw notFound('عکس پیدا نشد');
    if (req.user.status === 'active' && row.status !== 'rejected') {
      const [{ others }] = (await sql`
        SELECT count(*)::int AS others FROM photos
        WHERE user_id = ${req.user.id} AND id <> ${id} AND status <> 'rejected'`) as unknown as [{ others: number }];
      if (others < 1) throw conflict('پروفایل باید حداقل یک عکس داشته باشد', 'last_photo');
    }
    await sql`DELETE FROM photos WHERE id = ${id}`;
    await enqueue({ name: 'delete-objects', keys: photoObjectKeys(row) });
    await refreshPhotoCount(req.user.id);
    await afterProfileChange(req.user.id);
    return getMe(req.user.id);
  });

  app.put('/v1/me/photos/order', async (req) => {
    const { ids } = parse(z.object({ ids: z.array(zUuid).min(1).max(12) }), req.body);
    await sql.begin(async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx`UPDATE photos SET position = ${index} WHERE id = ${id} AND user_id = ${req.user.id}`;
      }
    });
    await afterProfileChange(req.user.id);
    return getMe(req.user.id);
  });

  // ---- account --------------------------------------------------------------------------

  /** Deletes the account: personal data is wiped now, files are removed by the worker. */
  app.delete('/v1/me', async (req) => {
    await deleteAccount(req.user.id);
    return { ok: true };
  });
}
