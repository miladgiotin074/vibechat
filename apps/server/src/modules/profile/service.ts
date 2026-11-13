import { cityName, provinceName } from '../../data/locations.js';
import { sql } from '../../lib/db.js';
import { dayKey, redis } from '../../lib/redis.js';
import { ageFrom } from '../../lib/text.js';
import { hasPerks, isPremium } from '../auth/guard.js';
import { getSettings } from '../settings/settings.js';
import { photoDto, type PhotoRow, VISIBLE_PHOTO_STATUSES } from '../users/cards.js';

export async function dailyUsage(userId: string): Promise<{ likes: number; superLikes: number }> {
  const day = dayKey();
  const [likes, superLikes] = await redis.mget(`likes:${userId}:${day}`, `slikes:${userId}:${day}`);
  return { likes: Number(likes ?? 0), superLikes: Number(superLikes ?? 0) };
}

/** The logged-in user's own profile, settings and limits. */
export async function getMe(userId: string) {
  const [u] = await sql`SELECT *, birthdate::text AS birthdate_text FROM users WHERE id = ${userId}`;
  if (!u) return null;
  const settings = await getSettings();
  const photos = await sql<PhotoRow[]>`
    SELECT id, user_id, position, status, storage_key, blur_key, width, height, color, reject_reason
    FROM photos WHERE user_id = ${userId} ORDER BY position, created_at`;
  const paid = isPremium({ premiumUntil: u.premium_until });
  // members, and (silently) every woman: the perks and limits of a member
  const premium = hasPerks({ premiumUntil: u.premium_until, gender: u.gender });
  const usage = await dailyUsage(userId);
  const freeBoostUsed = premium ? (await redis.exists(`boost_used:${userId}`)) === 1 : true;
  // members (and women): super likes a day; a man without membership: a number in total
  const dailySuperLikes = premium ? settings.premiumDailySuperLikes : settings.freeSuperLikes;
  const superLikesLeft = Math.max(0, dailySuperLikes - (premium ? usage.superLikes : (u.superlikes_used as number)));
  const visible = VISIBLE_PHOTO_STATUSES;

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
    goal: u.goal as string | null,
    bio: u.bio as string | null,
    job: u.job as string | null,
    education: u.education as string | null,
    heightCm: u.height_cm as number | null,
    smoking: u.smoking as string | null,
    maritalStatus: u.marital_status as string | null,
    interests: (u.interests ?? []) as string[],
    provinceId: u.province_id as number | null,
    province: provinceName(u.province_id),
    cityId: u.city_id as number | null,
    city: cityName(u.city_id),
    hasLocation: u.lat != null,
    premium: { active: premium, until: paid ? (u.premium_until as Date).toISOString() : null, offered: !premium || paid },
    boostUntil: u.boost_until && new Date(u.boost_until) > new Date() ? (u.boost_until as Date).toISOString() : null,
    /** Boosts bought in the store, and whether today's free one (premium) is still there. */
    boost: { credits: u.boost_credits as number, freeAvailable: premium && !freeBoostUsed },
    privacy: {
      showTelegram: u.show_telegram as boolean,
      hideAge: (u.hide_age as boolean) && premium,
      hideDistance: u.hide_distance as boolean,
      incognito: (u.incognito as boolean) && premium,
      discoverable: u.discoverable as boolean,
    },
    preferences: {
      minAge: u.pref_min_age as number,
      maxAge: u.pref_max_age as number,
      scope: u.pref_scope as string,
      maxKm: u.pref_max_km as number,
      /** false: the range is only a suggestion around their age (nothing is filtered by it yet) */
      ageSet: u.pref_age_set as boolean,
    },
    notifications: {
      matches: u.notify_matches as boolean,
      messages: u.notify_messages as boolean,
      likes: u.notify_likes as boolean,
    },
    photos: photos.map((p) => ({
      ...photoDto(p),
      status: p.status,
      visible: visible.includes(p.status),
      rejectReason: p.reject_reason ?? null,
    })),
    limits: {
      // likes left are never told (as with random chats); kept as null for older app builds
      dailyLikes: null,
      likesLeft: null,
      dailySuperLikes,
      superLikesLeft,
      bonusSuperLikes: u.bonus_superlikes as number,
      maxPhotos: settings.maxPhotos,
    },
    createdAt: (u.created_at as Date).toISOString(),
    activatedAt: u.activated_at ? (u.activated_at as Date).toISOString() : null,
  };
}

export type MeDto = NonNullable<Awaited<ReturnType<typeof getMe>>>;

export async function refreshPhotoCount(userId: string) {
  const settings = await getSettings();
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
