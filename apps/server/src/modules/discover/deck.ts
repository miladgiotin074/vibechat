import { sql } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { ageFrom, birthdateForAge } from '../../lib/text.js';
import { getSettings, type AppSettings } from '../settings/settings.js';

const DECK_TTL_S = 1800;
const REFILL_SIZE = 100;
/** Candidates scanned (newest-active first, via the partial indexes) before ranking. */
const SCAN_LIMIT = 1000;
const LOW_WATERMARK = 20;
/** How many people who already liked the viewer are mixed into one batch. */
const LIKERS_PER_BATCH = 30;

const deckKey = (userId: string) => `deck:${userId}`;
const noteKey = (userId: string) => `deck_widened:${userId}`;
/** Likes a profile received in the last day (see growth.exposureSoftCap). */
export const exposureKey = (userId: string) => `lk24:${userId}`;

export type Scope = 'city' | 'province' | 'country' | 'nearby';
/** Why the cards aren't exactly what the user asked for: a wider area, or people passed long ago. */
export type DeckNote = 'province' | 'country' | 'recycled';

interface Me {
  gender: 'male' | 'female';
  interested_in: 'male' | 'female' | 'everyone';
  birthdate: string;
  province_id: number | null;
  city_id: number | null;
  lat: number | null;
  lng: number | null;
  pref_min_age: number;
  pref_max_age: number;
  pref_age_set: boolean;
  pref_scope: Scope;
  pref_max_km: number;
  premium: boolean;
}

/** The areas to look in, narrowest first: the chosen one, then wider ones if it runs dry. */
function scopeChain(me: Me, widen: boolean): Scope[] {
  let scope = me.pref_scope;
  if (scope === 'nearby' && (me.lat == null || me.lng == null)) scope = 'province';
  if (scope === 'city' && !me.city_id) scope = 'province';
  if (scope === 'province' && !me.province_id) scope = 'country';
  const chain: Scope[] = [scope];
  if (widen) {
    if ((scope === 'city' || scope === 'nearby') && me.province_id) chain.push('province');
    if (scope !== 'country') chain.push('country');
  }
  return chain;
}

interface ScopeQuery {
  scope: Scope;
  exclude: string[];
  limit: number;
  growth: AppSettings['growth'];
  newHours: number;
  /** Everyone has been seen: let people passed long ago come back. */
  recycle: boolean;
}

async function queryScope(userId: string, me: Me, q: ScopeQuery) {
  const genders = me.interested_in === 'everyone' ? ['male', 'female'] : [me.interested_in];
  const myAge = ageFrom(me.birthdate) ?? 18;
  const meters = me.pref_max_km * 1000;
  const scopeFilter =
    q.scope === 'city'
      ? sql`AND u.city_id = ${me.city_id}`
      : q.scope === 'province'
        ? sql`AND u.province_id = ${me.province_id}`
        : q.scope === 'nearby'
          ? sql`AND u.lat IS NOT NULL AND u.lng IS NOT NULL
                AND earth_box(ll_to_earth(${me.lat}, ${me.lng}), ${meters}) @> ll_to_earth(u.lat, u.lng)
                AND earth_distance(ll_to_earth(${me.lat}, ${me.lng}), ll_to_earth(u.lat, u.lng)) <= ${meters}`
          : sql``;
  // my own age range filters only once I chose it; until then it just orders the cards
  const myAgeFilter = me.pref_age_set
    ? sql`AND u.birthdate > ${birthdateForAge(me.pref_max_age + 1)}::date AND u.birthdate <= ${birthdateForAge(me.pref_min_age)}::date`
    : sql``;
  // a pass is not forever: with nobody new left, old passes may be shown again
  const notSwiped =
    q.recycle && q.growth.passRecycleDays > 0
      ? sql`AND NOT EXISTS (
              SELECT 1 FROM swipes s WHERE s.swiper_id = ${userId} AND s.target_id = u.id
                AND (s.action > 0 OR s.created_at > now() - make_interval(days => ${q.growth.passRecycleDays})))`
      : sql`AND NOT EXISTS (SELECT 1 FROM swipes s WHERE s.swiper_id = ${userId} AND s.target_id = u.id)`;

  const rows = await sql<{ id: string }[]>`
    SELECT c.id FROM (
      SELECT u.id, u.score, u.boost_until, u.last_active_at, u.activated_at, u.trust, u.birthdate,
             u.city_id, u.province_id, u.photo_count, u.bio, u.interests, u.openers_received, u.replies_given
      FROM users u
      WHERE u.status = 'active' AND u.discoverable AND NOT u.shadow_banned AND u.photo_count > 0
        AND u.gender = ANY(${genders})
        AND (u.interested_in = 'everyone' OR u.interested_in = ${me.gender})
        ${myAgeFilter}
        -- their age range hides me only if they chose it themselves
        AND (NOT u.pref_age_set OR ${myAge} BETWEEN u.pref_min_age AND u.pref_max_age)
        AND u.last_active_at > now() - make_interval(days => ${q.growth.inactiveDays})
        AND u.id <> ${userId}
        AND u.id <> ALL(${q.exclude}::uuid[])
        ${scopeFilter}
        ${notSwiped}
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = ${userId} AND b.blocked_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = u.id AND b.blocked_id = ${userId})
        -- incognito (a premium option) hides people from everyone they haven't liked
        AND (NOT (u.incognito AND (u.premium_until > now() OR u.gender = 'female'))
             OR EXISTS (SELECT 1 FROM swipes i WHERE i.swiper_id = u.id AND i.target_id = ${userId} AND i.action > 0))
      ORDER BY u.last_active_at DESC
      LIMIT ${SCAN_LIMIT}
    ) c
    ORDER BY (c.boost_until IS NOT NULL AND c.boost_until > now()) DESC,
             random() * 0.8
             -- new faces get seen (and liked) quickly: the first hours decide whether they stay
             + CASE WHEN c.activated_at > now() - make_interval(hours => ${q.newHours}) THEN 0.9 ELSE 0 END
             -- people who are around now answer: a deck of long-gone profiles feels empty
             + CASE WHEN c.last_active_at > now() - interval '1 hour' THEN 0.9
                    WHEN c.last_active_at > now() - interval '1 day' THEN 0.6
                    WHEN c.last_active_at > now() - interval '3 days' THEN 0.35
                    WHEN c.last_active_at > now() - interval '14 days' THEN 0.1
                    ELSE -0.3 END
             -- how often they are liked (likes from people who like everyone weigh less)
             + c.score * 0.6
             -- they answer when someone writes
             + ((c.replies_given + 1)::real / (c.openers_received + 2)) * 0.3
             -- a profile worth opening: photos, a bio, interests
             + least(c.photo_count, 3) * 0.04
             + CASE WHEN length(coalesce(c.bio, '')) >= 20 THEN 0.1 ELSE 0 END
             + CASE WHEN cardinality(c.interests) > 0 THEN 0.08 ELSE 0 END
             -- trust: established, well rated — or reported
             + (c.trust - 50) * 0.006
             -- nearer first when looking wider than one's own city
             + CASE WHEN c.city_id = ${me.city_id}::int THEN 0.3 WHEN c.province_id = ${me.province_id}::int THEN 0.15 ELSE 0 END
             -- closer in age first
             - least(abs(date_part('year', age(c.birthdate)) - ${myAge}), 15) * 0.02 DESC
    LIMIT ${q.limit}`;
  return rows.map((r) => r.id);
}

/**
 * People who already liked the viewer and are still waiting for an answer: super likes first, then
 * the newest. Showing them is the fastest way to a match, so they are mixed into every batch —
 * wherever they live (they chose the viewer), but never against the viewer's gender wish or a block.
 */
async function likersOf(userId: string, me: Me, exclude: string[]): Promise<string[]> {
  const genders = me.interested_in === 'everyone' ? ['male', 'female'] : [me.interested_in];
  const rows = await sql<{ id: string }[]>`
    SELECT s.swiper_id AS id
    FROM swipes s
    JOIN users u ON u.id = s.swiper_id
    WHERE s.target_id = ${userId} AND s.action > 0 AND s.created_at > now() - interval '60 days'
      AND u.status = 'active' AND NOT u.shadow_banned AND u.photo_count > 0
      AND u.gender = ANY(${genders})
      AND u.id <> ALL(${exclude}::uuid[])
      AND NOT EXISTS (SELECT 1 FROM swipes m WHERE m.swiper_id = ${userId} AND m.target_id = s.swiper_id)
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${userId} AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ${userId}))
    ORDER BY s.action DESC, s.created_at DESC
    LIMIT ${LIKERS_PER_BATCH}`;
  return rows.map((r) => r.id);
}

/**
 * Fair exposure: a profile that already collected many likes today goes to the back of the batch,
 * so likes spread over more people instead of piling up on a few (who can't answer them anyway).
 */
async function spreadExposure(ids: string[], cap: number): Promise<string[]> {
  if (cap <= 0 || !ids.length) return ids;
  const counts = await redis.mget(ids.map(exposureKey));
  const front: string[] = [];
  const back: string[] = [];
  ids.forEach((id, i) => (Number(counts[i] ?? 0) > cap ? back : front).push(id));
  return [...front, ...back];
}

/**
 * Finds the next batch of people to show. Both sides' wishes must match (gender; age ranges people
 * set themselves), nobody already swiped, blocked either way, or already queued. Scanning
 * newest-active first and ranking only the first SCAN_LIMIT keeps the cost flat for any city size.
 *
 *  - When the chosen area has fewer than `autoWidenBelow` fresh people, the rest comes from the
 *    province and then the whole country.
 *  - When there is nobody new anywhere, people passed more than `passRecycleDays` ago come back.
 *  - One of every `likersEvery` cards is someone who already liked the viewer.
 */
export async function findCandidates(userId: string, exclude: string[]): Promise<{ ids: string[]; note: DeckNote | null }> {
  const [row] = await sql<(Omit<Me, 'premium'> & { premium_until: Date | null })[]>`
    SELECT gender, interested_in, birthdate::text AS birthdate, province_id, city_id, lat, lng,
           pref_min_age, pref_max_age, pref_age_set, pref_scope, pref_max_km, premium_until
    FROM users WHERE id = ${userId}`;
  if (!row || !row.gender || !row.interested_in || !row.birthdate) return { ids: [], note: null };
  const me: Me = { ...row, premium: !!row.premium_until && row.premium_until.getTime() > Date.now() };

  const settings = await getSettings();
  const growth = settings.growth;
  const likers = growth.likersEvery > 0 ? await likersOf(userId, me, exclude) : [];
  const skip = [...exclude, ...likers];
  const chain = scopeChain(me, growth.autoWidenBelow > 0);

  const collect = async (recycle: boolean) => {
    const found: string[] = [];
    let widened: Scope | null = null;
    for (const [i, scope] of chain.entries()) {
      const part = await queryScope(userId, me, {
        scope,
        exclude: [...skip, ...found],
        limit: REFILL_SIZE - found.length,
        growth,
        newHours: settings.newUserBoostHours,
        recycle,
      });
      if (i > 0 && part.length) widened = scope;
      found.push(...part);
      if (found.length >= growth.autoWidenBelow || found.length >= REFILL_SIZE) break;
    }
    return { found, widened };
  };

  let { found, widened } = await collect(false);
  let note: DeckNote | null = widened === 'province' || widened === 'country' ? widened : null;
  if (!found.length && !likers.length && growth.passRecycleDays > 0) {
    ({ found } = await collect(true));
    if (found.length) note = 'recycled';
  }
  const main = await spreadExposure(found, growth.exposureSoftCap);

  // one of every N cards is someone who liked the viewer
  const ids: string[] = [];
  let li = 0;
  let mi = 0;
  while (ids.length < REFILL_SIZE && (li < likers.length || mi < main.length)) {
    const likerSlot = growth.likersEvery > 0 && ids.length % growth.likersEvery === 0;
    if ((likerSlot || mi >= main.length) && li < likers.length) ids.push(likers[li++]!);
    else if (mi < main.length) ids.push(main[mi++]!);
    else break;
  }
  return { ids, note };
}

async function refill(userId: string, taken: string[] = []): Promise<number> {
  const lock = await redis.set(`deck_lock:${userId}`, '1', 'EX', 15, 'NX');
  if (lock !== 'OK') return 0;
  try {
    const queued = await redis.lrange(deckKey(userId), 0, -1);
    // also skip what this request already took off the deck, so nobody shows twice in a batch
    const { ids, note } = await findCandidates(userId, [...queued, ...taken]);
    if (!ids.length) {
      // Nobody new right now: don't rescan on every request.
      await redis.set(`deck_empty:${userId}`, '1', 'EX', 120);
      return 0;
    }
    const tx = redis.multi().rpush(deckKey(userId), ...ids).expire(deckKey(userId), DECK_TTL_S);
    if (note) tx.set(noteKey(userId), note, 'EX', DECK_TTL_S);
    else tx.del(noteKey(userId));
    await tx.exec();
    return ids.length;
  } finally {
    await redis.del(`deck_lock:${userId}`);
  }
}

/** Takes the next `count` ids off the user's deck, refilling it as needed. */
export async function takeFromDeck(userId: string, count: number): Promise<{ ids: string[]; exhausted: boolean; widened: DeckNote | null }> {
  const key = deckKey(userId);
  const ids = (await redis.lpop(key, count)) ?? [];
  if (ids.length < count && !(await redis.exists(`deck_empty:${userId}`))) {
    await refill(userId, ids);
    ids.push(...((await redis.lpop(key, count - ids.length)) ?? []));
  } else if ((await redis.llen(key)) < LOW_WATERMARK) {
    refill(userId).catch(() => undefined); // top up in the background
  }
  const widened = (await redis.get(noteKey(userId))) as DeckNote | null;
  // someone can be queued twice (pushed to the front after the batch was built): show them once
  const unique = [...new Set(ids)];
  return { ids: unique, exhausted: unique.length === 0, widened };
}

export async function pushFront(userId: string, targetId: string) {
  await redis.multi().lpush(deckKey(userId), targetId).expire(deckKey(userId), DECK_TTL_S).del(`deck_empty:${userId}`).exec();
}

export async function resetDeck(userId: string) {
  await redis.del(deckKey(userId), `deck_empty:${userId}`, noteKey(userId));
}

/**
 * A newcomer just finished sign-up: put them at the front of the decks of people who are online
 * right now and would see them anyway (both sides' gender wishes, age ranges people chose, the
 * viewer's area). Their first likes then come within minutes instead of whenever those decks refill.
 */
export async function exposeNewcomer(userId: string, limit: number): Promise<number> {
  if (limit <= 0) return 0;
  const [n] = await sql<
    (Pick<Me, 'gender' | 'interested_in' | 'birthdate' | 'province_id' | 'city_id' | 'pref_min_age' | 'pref_max_age' | 'pref_age_set'> & {
      discoverable: boolean;
      shadow_banned: boolean;
      photo_count: number;
    })[]
  >`
    SELECT gender, interested_in, birthdate::text AS birthdate, province_id, city_id, pref_min_age, pref_max_age, pref_age_set,
           discoverable, shadow_banned, photo_count
    FROM users WHERE id = ${userId} AND status = 'active'`;
  if (!n || !n.gender || !n.birthdate || !n.discoverable || n.shadow_banned || n.photo_count < 1) return 0;
  const age = ageFrom(n.birthdate) ?? 18;
  const genders = n.interested_in === 'everyone' ? ['male', 'female'] : [n.interested_in];
  const viewers = await sql<{ id: string }[]>`
    SELECT v.id FROM users v
    WHERE v.status = 'active' AND v.id <> ${userId} AND NOT v.shadow_banned
      AND v.last_active_at > now() - interval '30 minutes'
      AND v.gender = ANY(${genders})
      AND (v.interested_in = 'everyone' OR v.interested_in = ${n.gender})
      AND (NOT v.pref_age_set OR ${age} BETWEEN v.pref_min_age AND v.pref_max_age)
      ${
        n.pref_age_set
          ? sql`AND v.birthdate > ${birthdateForAge(n.pref_max_age + 1)}::date AND v.birthdate <= ${birthdateForAge(n.pref_min_age)}::date`
          : sql``
      }
      AND (v.pref_scope = 'country'
           OR (v.pref_scope IN ('province', 'nearby') AND v.province_id = ${n.province_id})
           OR (v.pref_scope = 'city' AND v.city_id = ${n.city_id}))
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = v.id AND b.blocked_id = ${userId}) OR (b.blocker_id = ${userId} AND b.blocked_id = v.id))
    ORDER BY (v.city_id IS NOT DISTINCT FROM ${n.city_id}) DESC, v.last_active_at DESC
    LIMIT ${limit}`;
  if (!viewers.length) return 0;
  const tx = redis.multi();
  for (const v of viewers) tx.lpush(deckKey(v.id), userId).expire(deckKey(v.id), DECK_TTL_S).del(`deck_empty:${v.id}`);
  await tx.exec();
  return viewers.length;
}
