import { sql } from '../../lib/db.js';
import { hasPerks } from '../auth/guard.js';
import { notify } from '../notifications/service.js';
import { publishToUser } from '../realtime/bus.js';
import { type AppSettings, getSettings } from '../settings/settings.js';
import { bumpDailyCounter } from '../users/activity.js';

/**
 * Invites: a user adds friends from their Telegram contacts to the Wall group, and every full
 * batch of them is worth likes (see the referral settings). The bot sees each add (chat_member);
 * a Telegram account counts once, for whoever added it first.
 */

type ReferralSettings = AppSettings['referral'];

/** Likes earned by this many adds: rewardLikes for every full minAdds friends. */
export function earnedLikes(adds: number, r: ReferralSettings): number {
  return Math.floor(adds / r.minAdds) * r.rewardLikes;
}

/** More adds needed for the next reward. */
export function addsUntilNext(adds: number, r: ReferralSettings): number {
  return r.minAdds - (adds % r.minAdds);
}

async function addsBy(telegramId: string | number | null): Promise<number> {
  if (telegramId == null) return 0;
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM group_adds WHERE adder_tg_id = ${telegramId}`;
  return row?.n ?? 0;
}

interface PerkRow {
  gender: string | null;
  premium_until: Date | null;
  telegram_id: string | null;
}

async function perkRow(userId: string): Promise<PerkRow | undefined> {
  const [u] = await sql<PerkRow[]>`SELECT gender, premium_until, telegram_id::text AS telegram_id FROM users WHERE id = ${userId}`;
  return u;
}

/** All the likes a man without membership may ever use: the ones to start with and the earned ones. */
export async function likeAllowance(userId: string, settings: AppSettings): Promise<number> {
  if (!settings.referral.enabled || settings.referral.rewardLikes <= 0) return settings.freeLikes;
  const [u] = await sql<{ telegram_id: string | null }[]>`SELECT telegram_id::text AS telegram_id FROM users WHERE id = ${userId}`;
  return settings.freeLikes + earnedLikes(await addsBy(u?.telegram_id ?? null), settings.referral);
}

/**
 * Someone joined the Wall group because `adderTgId` added them. Counted once per added account;
 * the adder is told when a full batch earned them likes (if they have a like limit at all).
 */
export async function recordGroupAdd(adderTgId: number, addedTgId: number, chatId: number) {
  const settings = await getSettings();
  if (!settings.referral.enabled || String(chatId) !== settings.wall.telegram.chatId.trim()) return;
  const inserted = await sql`
    INSERT INTO group_adds (added_tg_id, adder_tg_id, chat_id) VALUES (${addedTgId}, ${adderTgId}, ${chatId})
    ON CONFLICT (added_tg_id) DO NOTHING RETURNING 1`;
  if (!inserted.length) return;
  await bumpDailyCounter('referrals');
  const [user] = await sql<{ id: string }[]>`SELECT id FROM users WHERE telegram_id = ${adderTgId} AND status IN ('active', 'onboarding')`;
  if (!user) return;
  const u = await perkRow(user.id);
  await publishToUser(user.id, { type: 'referral.joined', data: {} });
  // women and members have no like limit: the reward would mean nothing to them
  if (!u || hasPerks({ premiumUntil: u.premium_until, gender: u.gender })) return;
  const adds = await addsBy(adderTgId);
  const r = settings.referral;
  const gained = earnedLikes(adds, r) - earnedLikes(adds - 1, r);
  if (gained <= 0) return;
  const fa = (n: number) => n.toLocaleString('fa-IR');
  await notify(user.id, {
    type: 'referral',
    title: `🎁 هدیه گرفتی: ${fa(gained)} لایک!`,
    body: `${fa(adds)} نفر رو به گروه اضافه کردی. بزن بریم 💜`,
    data: { adds },
  });
}

/** The invite screen: the group, how many I added, what it earned, what the next one needs. */
export async function referralSummary(userId: string) {
  const settings = await getSettings();
  const u = await perkRow(userId);
  const adds = await addsBy(u?.telegram_id ?? null);
  const r = settings.referral;
  const group = settings.wall.telegram;
  return {
    enabled: r.enabled && !!group.chatId && r.rewardLikes > 0,
    group: group.chatId && group.link ? { link: group.link } : null,
    adds,
    minAdds: r.minAdds,
    rewardLikes: r.rewardLikes,
    earnedLikes: earnedLikes(adds, r),
    untilNext: addsUntilNext(adds, r),
    /** likes are capped only for men without membership: the invite pitch is theirs */
    limited: u ? !hasPerks({ premiumUntil: u.premium_until, gender: u.gender }) : false,
  };
}
