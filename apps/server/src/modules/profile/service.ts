import { sql } from '../../lib/db.js';
import { dayKey, redis } from '../../lib/redis.js';
import { ageFrom } from '../../lib/text.js';
import { getSettings } from '../settings/settings.js';
import { photoDto, type PhotoRow, VISIBLE_PHOTO_STATUSES } from '../users/cards.js';

/** The logged-in user's own profile and settings. Nothing here is for sale: the limits are shared. */
export async function getMe(userId: string) {
  const [u] = await sql`SELECT *, birthdate::text AS birthdate_text FROM users WHERE id = ${userId}`;
  if (!u) return null;
  const settings = await getSettings();
  const photos = await sql<PhotoRow[]>`
    SELECT id, user_id, position, status, storage_key, blur_key, width, height, color, reject_reason
    FROM photos WHERE user_id = ${userId} ORDER BY position, created_at`;
  const startedToday = Number((await redis.get(`newchats:${userId}:${dayKey()}`)) ?? 0);

  return {
    id: u.id as string,
    status: u.status as string,
    telegram: {
      id: String(u.telegram_id ?? ''),
      username: u.tg_username as string | null,
      firstName: u.tg_first_name as string | null,
      premium: u.tg_premium as boolean,
      canDm: (u.can_dm as boolean) && !(u.bot_blocked as boolean),
    },
    refCode: u.ref_code as string,
    name: u.name as string | null,
    gender: u.gender as string | null,
    birthdate: u.birthdate_text as string | null,
    age: ageFrom(u.birthdate_text),
    interestedIn: u.interested_in as string | null,
    bio: u.bio as string | null,
    maritalStatus: u.marital_status as string | null,
    privacy: {
      showTelegram: u.show_telegram as boolean,
      hideAge: u.hide_age as boolean,
      discoverable: u.discoverable as boolean,
    },
    preferences: {
      minAge: u.pref_min_age as number,
      maxAge: u.pref_max_age as number,
      /** false: the range is only a suggestion (nothing is filtered by it yet) */
      ageSet: u.pref_age_set as boolean,
    },
    notifications: { messages: u.notify_messages as boolean },
    photos: photos.map((p) => ({
      ...photoDto(p),
      status: p.status,
      visible: VISIBLE_PHOTO_STATUSES.includes(p.status),
      rejectReason: p.reject_reason ?? null,
    })),
    limits: {
      /** New conversations a day — the same number for everyone (0 = no limit). */
      dailyNewChats: settings.matching.dailyNewChats,
      newChatsLeft: settings.matching.dailyNewChats > 0 ? Math.max(0, settings.matching.dailyNewChats - startedToday) : null,
      maxPhotos: settings.maxPhotos,
    },
    createdAt: (u.created_at as Date).toISOString(),
    activatedAt: u.activated_at ? (u.activated_at as Date).toISOString() : null,
  };
}

export type MeDto = NonNullable<Awaited<ReturnType<typeof getMe>>>;

export async function refreshPhotoCount(userId: string) {
  await sql`
    UPDATE users
    SET photo_count = (SELECT count(*) FROM photos WHERE user_id = ${userId} AND status = ANY(${VISIBLE_PHOTO_STATUSES})),
        updated_at = now()
    WHERE id = ${userId}`;
}

/** Every stored object of a photo (for deletion). */
export function photoObjectKeys(p: { storage_key: string; blur_key: string }): string[] {
  return [...['lg', 'md', 'sm'].map((size) => `${p.storage_key}/${size}.webp`), p.blur_key];
}
