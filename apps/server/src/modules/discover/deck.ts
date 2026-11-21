import { sql } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { ageFrom, birthdateForAge } from '../../lib/text.js';
import { getSettings } from '../settings/settings.js';

/**
 * Who to show next. There is no liking and no matching: a card is someone you either write to or
 * skip, so the deck is simply «people we both want to see, minus the ones I already answered».
 */
const DECK_TTL_S = 1800;
const REFILL_SIZE = 100;
/** Candidates scanned (newest-active first, through the partial index) before ranking. */
const SCAN_LIMIT = 1000;
const LOW_WATERMARK = 20;

const deckKey = (userId: string) => `deck:${userId}`;
const noteKey = (userId: string) => `deck_recycled:${userId}`;

/** Why the cards aren't all fresh: people skipped long ago are being shown again. */
export type DeckNote = 'recycled';

interface Me {
  gender: 'male' | 'female';
  /** 'all', or — for a «محرم» — only verified accounts or only unverified ones. */
  pref_verified: 'all' | 'verified' | 'unverified';
  interested_in: 'male' | 'female' | 'everyone';
  birthdate: string;
  pref_min_age: number;
  pref_max_age: number;
  pref_age_set: boolean;
  /** When they finished sign-up: a newcomer is led by the profiles the app runs itself. */
  activated_at: Date | null;
}

async function queryPeople(userId: string, me: Me, exclude: string[], limit: number, recycle: boolean): Promise<string[]> {
  const settings = await getSettings();
  const genders = me.interested_in === 'everyone' ? ['male', 'female'] : [me.interested_in];
  const myAge = ageFrom(me.birthdate) ?? 18;
  // my own age range filters only once I chose it; until then it just orders the cards
  const myAgeFilter = me.pref_age_set
    ? sql`AND u.birthdate > ${birthdateForAge(me.pref_max_age + 1)}::date AND u.birthdate <= ${birthdateForAge(me.pref_min_age)}::date`
    : sql``;
  // skipping is not forever: with nobody new left, old skips may be shown again
  const notSkipped =
    recycle && settings.skipRecycleDays > 0
      ? sql`AND NOT EXISTS (
              SELECT 1 FROM skips s WHERE s.user_id = ${userId} AND s.target_id = u.id
                AND s.created_at > now() - make_interval(days => ${settings.skipRecycleDays}))`
      : sql`AND NOT EXISTS (SELECT 1 FROM skips s WHERE s.user_id = ${userId} AND s.target_id = u.id)`;

  const verifiedFilter = me.pref_verified === 'all' ? sql`` : sql`AND u.verified = ${me.pref_verified === 'verified'}`;
  const rows = await sql<{ id: string }[]>`
    SELECT c.id FROM (
      SELECT u.id, u.last_active_at, u.activated_at, u.trust, u.birthdate, u.photo_count, u.bio,
             u.openers_received, u.replies_given
      FROM users u
      WHERE u.status = 'active' AND u.discoverable AND NOT u.shadow_banned
        ${verifiedFilter} AND NOT u.is_ai
        AND u.gender = ANY(${genders})
        AND (u.interested_in = 'everyone' OR u.interested_in = ${me.gender})
        ${myAgeFilter}
        -- their age range hides me only if they chose it themselves
        AND (NOT u.pref_age_set OR ${myAge} BETWEEN u.pref_min_age AND u.pref_max_age)
        AND u.last_active_at > now() - make_interval(days => ${settings.inactiveDays})
        AND u.id <> ${userId}
        AND u.id <> ALL(${exclude}::uuid[])
        ${notSkipped}
        -- someone I already write to is in «گفتگوها», not here
        AND NOT EXISTS (SELECT 1 FROM match_members mm WHERE mm.user_id = ${userId} AND mm.peer_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = ${userId} AND b.blocked_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = u.id AND b.blocked_id = ${userId})
      ORDER BY u.last_active_at DESC
      LIMIT ${SCAN_LIMIT}
    ) c
    ORDER BY random() * 0.8
             -- new faces get seen (and written to) quickly: the first hours decide whether they stay
             + CASE WHEN c.activated_at > now() - make_interval(hours => ${settings.newUserBoostHours}) THEN 0.9 ELSE 0 END
             -- people who are around now answer: a deck of long-gone profiles feels empty
             + CASE WHEN c.last_active_at > now() - interval '1 hour' THEN 0.9
                    WHEN c.last_active_at > now() - interval '1 day' THEN 0.6
                    WHEN c.last_active_at > now() - interval '3 days' THEN 0.35
                    WHEN c.last_active_at > now() - interval '14 days' THEN 0.1
                    ELSE -0.3 END
             -- they answer when someone writes
             + ((c.replies_given + 1)::real / (c.openers_received + 2)) * 0.5
             -- a profile worth opening: photos and a few words
             + least(c.photo_count, 3) * 0.05
             + CASE WHEN length(coalesce(c.bio, '')) >= 20 THEN 0.15 ELSE 0 END
             -- trust: established and well behaved — or reported
             + (c.trust - 50) * 0.006
             -- closer in age first
             - least(abs(date_part('year', age(c.birthdate)) - ${myAge}), 15) * 0.02 DESC
    LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

/**
 * AI profiles this man has not skipped and has not written to. They open his deck, ahead of
 * everyone else — for a new account and for one that has been around for months.
 */
async function queryAiPeople(userId: string, me: Me, exclude: string[], limit: number): Promise<string[]> {
  const myAge = ageFrom(me.birthdate) ?? 18;
  const genders = me.interested_in === 'everyone' ? ['male', 'female'] : [me.interested_in];
  const rows = await sql<{ id: string }[]>`
    SELECT u.id FROM users u
    JOIN ai_bots b ON b.user_id = u.id AND b.enabled
    WHERE u.is_ai AND u.status = 'active' AND u.discoverable
      AND u.gender = ANY(${genders})
      AND (u.interested_in = 'everyone' OR u.interested_in = ${me.gender})
      AND (NOT u.pref_age_set OR ${myAge} BETWEEN u.pref_min_age AND u.pref_max_age)
      AND u.id <> ALL(${exclude}::uuid[])
      AND NOT EXISTS (SELECT 1 FROM skips s WHERE s.user_id = ${userId} AND s.target_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM match_members mm WHERE mm.user_id = ${userId} AND mm.peer_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM blocks bl WHERE bl.blocker_id = ${userId} AND bl.blocked_id = u.id)
    ORDER BY abs(date_part('year', age(u.birthdate)) - ${myAge}), random()
    LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

/** Men see every unseen AI profile before real people. Women do not get this lead. */
async function aiLead(userId: string, me: Me, exclude: string[]): Promise<string[]> {
  const { ai } = await getSettings();
  if (!ai.enabled || me.gender !== 'male') return [];
  // these profiles are verified: a deck filtered down to unverified accounts is not led by them
  if (me.pref_verified === 'unverified') return [];
  return queryAiPeople(userId, me, exclude, 50);
}

/**
 * A deck already sitting in Redis was filled before these profiles, or in a different order.
 * Put the unseen AI profiles at the front again so the next cards a man draws start with them.
 */
async function pinUnseenAi(userId: string) {
  const [row] = await sql<Me[]>`
    SELECT gender, interested_in, birthdate::text AS birthdate, pref_min_age, pref_max_age, pref_age_set, pref_verified, activated_at
    FROM users WHERE id = ${userId}`;
  if (!row || row.gender !== 'male') return;
  const lead = await aiLead(userId, row, []);
  const key = deckKey(userId);
  const queued = await redis.lrange(key, 0, -1);
  if (!lead.length && !queued.length) return;
  const leadSet = new Set(lead);
  const rest = queued.filter((id) => !leadSet.has(id));
  const next = [...lead, ...rest];
  if (queued.length === next.length && queued.every((id, i) => id === next[i])) return;
  const tx = redis.multi().del(key).del(`deck_empty:${userId}`);
  if (next.length) tx.rpush(key, ...next).expire(key, DECK_TTL_S);
  await tx.exec();
}

/**
 * The next batch of people to show. Both sides' wishes must match (gender, and the age ranges
 * people set themselves); nobody already skipped, blocked either way, written to, or queued.
 * When there is nobody new at all, people skipped more than `skipRecycleDays` ago come back.
 */
export async function findCandidates(userId: string, exclude: string[]): Promise<{ ids: string[]; note: DeckNote | null }> {
  const [row] = await sql<Me[]>`
    SELECT gender, interested_in, birthdate::text AS birthdate, pref_min_age, pref_max_age, pref_age_set, pref_verified, activated_at
    FROM users WHERE id = ${userId}`;
  if (!row?.gender || !row.interested_in || !row.birthdate) return { ids: [], note: null };

  const lead = await aiLead(userId, row, exclude);
  const ids = await queryPeople(userId, row, [...exclude, ...lead], REFILL_SIZE, false);
  if (ids.length || lead.length) return { ids: [...lead, ...ids], note: null };
  const again = await queryPeople(userId, row, exclude, REFILL_SIZE, true);
  return { ids: again, note: again.length ? 'recycled' : null };
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
  await pinUnseenAi(userId);
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
 * right now and would see them anyway (both sides' gender wishes, and the age ranges people chose).
 * Their first messages then come within minutes instead of whenever those decks refill.
 */
export async function exposeNewcomer(userId: string, limit: number): Promise<number> {
  if (limit <= 0) return 0;
  const [n] = await sql<
    (Pick<Me, 'gender' | 'interested_in' | 'birthdate' | 'pref_min_age' | 'pref_max_age' | 'pref_age_set'> & {
      discoverable: boolean;
      shadow_banned: boolean;
      photo_count: number;
    })[]
  >`
    SELECT gender, interested_in, birthdate::text AS birthdate, pref_min_age, pref_max_age, pref_age_set,
           discoverable, shadow_banned, photo_count
    FROM users WHERE id = ${userId} AND status = 'active'`;
  if (!n || !n.gender || !n.birthdate || !n.discoverable || n.shadow_banned) return 0;
  const age = ageFrom(n.birthdate) ?? 18;
  const genders = n.interested_in === 'everyone' ? ['male', 'female'] : [n.interested_in];
  const viewers = await sql<{ id: string }[]>`
    SELECT v.id FROM users v
    WHERE v.status = 'active' AND v.id <> ${userId} AND NOT v.shadow_banned AND NOT v.is_ai
      AND v.last_active_at > now() - interval '30 minutes'
      AND v.gender = ANY(${genders})
      AND (v.interested_in = 'everyone' OR v.interested_in = ${n.gender})
      AND (NOT v.pref_age_set OR ${age} BETWEEN v.pref_min_age AND v.pref_max_age)
      ${
        n.pref_age_set
          ? sql`AND v.birthdate > ${birthdateForAge(n.pref_max_age + 1)}::date AND v.birthdate <= ${birthdateForAge(n.pref_min_age)}::date`
          : sql``
      }
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = v.id AND b.blocked_id = ${userId}) OR (b.blocker_id = ${userId} AND b.blocked_id = v.id))
    ORDER BY v.last_active_at DESC
    LIMIT ${limit}`;
  if (!viewers.length) return 0;
  const tx = redis.multi();
  for (const v of viewers) tx.lpush(deckKey(v.id), userId).expire(deckKey(v.id), DECK_TTL_S).del(`deck_empty:${v.id}`);
  await tx.exec();
  return viewers.length;
}
