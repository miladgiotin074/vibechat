import { sql } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { publicUrl } from '../../lib/storage.js';
import { ageFrom } from '../../lib/text.js';
import { onlineSet } from '../realtime/bus.js';
import { getSettings } from '../settings/settings.js';

export interface PhotoRow {
  id: string;
  user_id: string;
  position: number;
  status: 'pending' | 'approved' | 'rejected';
  storage_key: string;
  blur_key: string;
  width: number;
  height: number;
  color: string | null;
  reject_reason?: string | null;
}

export interface PhotoDto {
  id: string;
  url: string;
  md: string;
  thumb: string;
  blur: string;
  width: number;
  height: number;
  color: string | null;
}

export function photoDto(p: Pick<PhotoRow, 'id' | 'storage_key' | 'blur_key' | 'width' | 'height' | 'color'>): PhotoDto {
  return {
    id: p.id,
    url: publicUrl(`${p.storage_key}/lg.webp`),
    md: publicUrl(`${p.storage_key}/md.webp`),
    thumb: publicUrl(`${p.storage_key}/sm.webp`),
    blur: publicUrl(p.blur_key),
    width: p.width,
    height: p.height,
    color: p.color,
  };
}

/** Viewer-independent part of a profile; cached in Redis as `card:<id>`. */
interface CachedCard {
  id: string;
  status: string;
  name: string;
  age: number | null;
  gender: string | null;
  bio: string | null;
  maritalStatus: string | null;
  /** Joined in the last 3 days (shown as a «تازه‌وارد» badge). */
  newcomer: boolean;
  photos: PhotoDto[];
  lastActiveAt: string;
  // private, never sent as-is
  telegramUsername: string | null;
  showTelegram: boolean;
}

export interface CardDto extends Omit<CachedCard, 'telegramUsername' | 'showTelegram' | 'status'> {
  online: boolean;
  /** Telegram @username: only to people this user matched with, and only if they chose to share it. */
  telegramUsername: string | null;
}

export interface Viewer {
  id: string;
}

const CARD_TTL_S = 600;

/** Photos go live as soon as they are uploaded; a moderator can still remove one (rejected). */
export const VISIBLE_PHOTO_STATUSES = ['approved'];

async function loadFromDb(ids: string[]): Promise<CachedCard[]> {
  const settings = await getSettings();
  const users = await sql`
    SELECT id, status, name, birthdate::text AS birthdate, hide_age, gender, bio, marital_status,
           last_active_at, tg_username, show_telegram, activated_at
    FROM users WHERE id = ANY(${ids}::uuid[])`;
  const photos = await sql<PhotoRow[]>`
    SELECT id, user_id, position, status, storage_key, blur_key, width, height, color
    FROM photos
    WHERE user_id = ANY(${ids}::uuid[]) AND status = ANY(${VISIBLE_PHOTO_STATUSES})
    ORDER BY user_id, position, created_at`;
  const byUser = new Map<string, PhotoDto[]>();
  for (const p of photos) {
    const list = byUser.get(p.user_id) ?? [];
    list.push(photoDto(p));
    byUser.set(p.user_id, list);
  }
  return users.map((u) => {
    const deleted = u.status === 'deleted';
    return {
      id: u.id,
      status: u.status,
      name: deleted ? 'کاربر حذف‌شده' : u.name ?? '',
      age: u.hide_age || deleted ? null : ageFrom(u.birthdate),
      gender: u.gender,
      bio: deleted ? null : u.bio,
      maritalStatus: u.marital_status,
      newcomer: !!u.activated_at && Date.now() - new Date(u.activated_at).getTime() < 3 * 86400_000,
      photos: deleted ? [] : byUser.get(u.id) ?? [],
      lastActiveAt: new Date(u.last_active_at).toISOString(),
      telegramUsername: u.tg_username,
      showTelegram: u.show_telegram,
    } satisfies CachedCard;
  });
}

async function cachedCards(ids: string[]): Promise<Map<string, CachedCard>> {
  const out = new Map<string, CachedCard>();
  if (!ids.length) return out;
  const unique = [...new Set(ids)];
  const values = await redis.mget(unique.map((id) => `card:${id}`));
  const missing: string[] = [];
  unique.forEach((id, i) => {
    const v = values[i];
    if (v) out.set(id, JSON.parse(v) as CachedCard);
    else missing.push(id);
  });
  if (missing.length) {
    const loaded = await loadFromDb(missing);
    const m = redis.multi();
    for (const card of loaded) {
      out.set(card.id, card);
      m.set(`card:${card.id}`, JSON.stringify(card), 'EX', CARD_TTL_S);
    }
    await m.exec();
  }
  return out;
}

/**
 * Public profiles in the order of `ids`, with the viewer-specific parts (distance, online, Telegram username).
 * `matchedWith` = ids the viewer has an active match with (they may see the Telegram username).
 */
export async function loadCards(
  ids: string[],
  viewer: Viewer,
  opts: { onlyActive?: boolean; matchedWith?: Set<string> } = {},
): Promise<CardDto[]> {
  const cards = await cachedCards(ids);
  const online = await onlineSet([...cards.keys()]);
  const result: CardDto[] = [];
  for (const id of ids) {
    const c = cards.get(id);
    if (!c) continue;
    if (opts.onlyActive && c.status !== 'active') continue;
    const { telegramUsername, showTelegram, status: _status, ...pub } = c;
    result.push({
      ...pub,
      online: online.has(id),
      telegramUsername: showTelegram && opts.matchedWith?.has(id) ? telegramUsername : null,
    });
  }
  return result;
}

export async function viewerOf(userId: string): Promise<Viewer> {
  return { id: userId };
}
