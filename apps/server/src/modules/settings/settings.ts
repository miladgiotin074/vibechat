import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { redis, redisSub } from '../../lib/redis.js';

/** Everything an admin can change at runtime from the panel. Stored as one JSON row. */
export const SettingsSchema = z.object({
  signupOpen: z.boolean(),
  /**
   * Discovery, by the random chat's rules. Women are never limited. A man without membership has
   * freeLikes likes in total (not per day); when they are gone, liking is locked until he adds
   * friends to the Wall group (referral.rewardLikes) or becomes a member.
   */
  freeLikes: z.number().int().min(0).max(100_000),
  /** Likes a day for men with membership (0 = no limit). */
  premiumDailyLikes: z.number().int().min(0).max(100_000),
  /** Super likes a man without membership has in total. */
  freeSuperLikes: z.number().int().min(0).max(1000),
  /** Super likes a day for members (and women). */
  premiumDailySuperLikes: z.number().int().min(0).max(100),
  boostMinutes: z.number().int().min(5).max(24 * 60),
  /** Fresh profiles are ranked higher in discovery for this long after onboarding. */
  newUserBoostHours: z.number().int().min(0).max(24 * 14),
  minAge: z.number().int().min(18).max(99),
  maxPhotos: z.number().int().min(1).max(12),
  chatMediaEnabled: z.boolean(),
  /** Each side must have sent this many messages before photos can be sent in a chat. */
  chatMediaMinMessages: z.number().int().min(0).max(100),
  bannedWords: z.array(z.string().min(1).max(50)).max(2000),
  maintenance: z.object({ enabled: z.boolean(), message: z.string().max(500) }),
  /** Online payment (Tetra98). */
  paymentsEnabled: z.boolean(),
  randomChat: z.object({
    enabled: z.boolean(),
    /**
     * Random chats a man without membership gets to start with (women and members: unlimited).
     * More come from adding friends to the Wall group (see referral). Only chats where both wrote count.
     */
    freeSessions: z.number().int().min(0).max(1000),
    /** Random chats a day for men with membership (0 = no limit). Women are never limited. */
    premiumDailySessions: z.number().int().min(0).max(1000),
    /** Leaving within this many seconds is a «skip». */
    skipSeconds: z.number().int().min(0).max(300),
    /** This many skips in a row → a short wait before the next search (0 = off). */
    skipLimit: z.number().int().min(0).max(50),
    cooldownSeconds: z.number().int().min(10).max(3600),
  }),
  /** Matches and conversations. */
  matching: z.object({
    /** Until the other side answers, at most this many messages in a row (0 = no limit). */
    maxUnanswered: z.number().int().min(0).max(50),
    /** A match with no message gets one reminder after this many hours (0 = off). */
    nudgeHours: z.number().int().min(0).max(24 * 14),
    /** …and moves to the archive after this many days (0 = never). */
    archiveDays: z.number().int().min(0).max(365),
  }),
  /** Trust and automatic protection. */
  safety: z.object({
    /** Reports from this many different people within a day → shadow ban until a moderator looks (0 = off). */
    autoShadowReports: z.number().int().min(0).max(100),
  }),
  /**
   * Growth: adding friends to the Wall group (wall.telegram) earns random chats and likes. Nothing
   * counts below minAdds; from there every minAdds people are worth rewardChats chats and
   * rewardLikes likes, and each further friend adds its share (with 20 → 5: 20 friends = 5 chats,
   * 24 = 6, 40 = 10). The bot sees who added whom; each Telegram account counts once.
   */
  referral: z.object({
    enabled: z.boolean(),
    minAdds: z.number().int().min(1).max(1000),
    rewardChats: z.number().int().min(1).max(1000),
    /** Likes for the same minAdds friends (0 = invites earn no likes). */
    rewardLikes: z.number().int().min(0).max(100_000),
  }),
  /** The Wall: public requests, mirrored to a Telegram group. */
  wall: z.object({
    enabled: z.boolean(),
    /** Requests a user may have on the Wall at the same time (everyone, members included). */
    freeDailyPosts: z.number().int().min(0).max(50),
    /** Hours between posting one request and the next, for everyone (0 = none). */
    repostCooldownHours: z.number().int().min(0).max(24 * 7),
    /** Members can bump a live request back to the top once every this many hours. */
    bumpCooldownHours: z.number().int().min(1).max(24 * 7),
    /** Remind the author of requests still waiting after this many hours (0 = off). */
    requestReminderHours: z.number().int().min(0).max(24 * 7),
    /** How long a request stays up. */
    ttlHours: z.number().int().min(1).max(24 * 14),
    /** New conversations a user may open from the Wall per day. */
    freeDailyChats: z.number().int().min(0).max(1000),
    premiumDailyChats: z.number().int().min(0).max(1000),
    /** A request reported by this many people is taken down until a moderator looks at it. */
    autoHideReports: z.number().int().min(1).max(100),
    /** A newcomer's first request is shown in a spotlight on top of the Wall for this long (0 = off). */
    newcomerSpotlightHours: z.number().int().min(0).max(72),
    telegram: z.object({
      enabled: z.boolean(),
      /** Group/channel id where the bot posts (the bot must be an admin there). The panel lists the groups the bot is an admin of. */
      chatId: z.string().max(32),
      /** Public link shown in the app (https://t.me/…). */
      link: z.string().max(200),
    }),
  }),
  /** First impressions: a newcomer should never see an empty app or wait long for a first like. */
  growth: z.object({
    /** When the chosen area has fewer fresh people than this, discovery widens (city → province → country). 0 = never. */
    autoWidenBelow: z.number().int().min(0).max(500),
    /** The first N people who ever liked a user are shown to them without premium. */
    freeRevealedLikes: z.number().int().min(0).max(20),
    /** On finishing sign-up, a newcomer is put at the front of this many online people's decks. */
    newcomerFanout: z.number().int().min(0).max(500),
    /** One of every N cards is someone who already liked the viewer (0 = don't mix them in). */
    likersEvery: z.number().int().min(0).max(20),
    /** A profile that got more likes than this in a day is shown less until they catch up (0 = off). */
    exposureSoftCap: z.number().int().min(0).max(10_000),
    /** When everyone has been seen, people passed more than this many days ago come back (0 = never). */
    passRecycleDays: z.number().int().min(0).max(365),
    /** People away longer than this are not shown in discovery. */
    inactiveDays: z.number().int().min(1).max(365),
  }),
  /** «شب Vibe»: one nightly peak hour that gathers people at the same time. */
  vibeNight: z.object({
    enabled: z.boolean(),
    /** Start, Tehran time (0–23). */
    startHour: z.number().int().min(0).max(23),
    durationMinutes: z.number().int().min(15).max(360),
    /** Super likes for opening the app during the night (once per night). */
    bonusSuperLikes: z.number().int().min(0).max(10),
    /** Telegram reminder when it starts; one per user per this many days (0 = no reminders). */
    reminderEveryDays: z.number().int().min(0).max(30),
    /** The reminder (HTML). */
    text: z.string().max(1000),
  }),
  /** Telegram messages from the bot (the app's push notifications). */
  bot: z.object({
    /** Tell offline users about new messages (at most once per conversation per this many minutes). */
    messageCooldownMin: z.number().int().min(1).max(24 * 60),
    /** "Someone liked you" pings, at most once per this many minutes. */
    likeCooldownMin: z.number().int().min(10).max(7 * 24 * 60),
    /** Nudge users who have been away this many days (0 disables). */
    comebackAfterDays: z.number().int().min(0).max(90),
    welcomeText: z.string().max(2000),
  }),
  support: z.object({
    /** Telegram username of support (without @). */
    telegram: z.string().max(64),
    channel: z.string().max(64),
    termsUrl: z.string().max(500),
    privacyUrl: z.string().max(500),
  }),
});

export type AppSettings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  signupOpen: true,
  freeLikes: 50,
  premiumDailyLikes: 100,
  freeSuperLikes: 3,
  premiumDailySuperLikes: 5,
  boostMinutes: 30,
  newUserBoostHours: 48,
  minAge: 18,
  maxPhotos: 6,
  chatMediaEnabled: true,
  chatMediaMinMessages: 3,
  bannedWords: [],
  maintenance: { enabled: false, message: 'در حال بروزرسانی هستیم. کمی بعد برگرد 🌙' },
  paymentsEnabled: true,
  randomChat: { enabled: true, freeSessions: 5, premiumDailySessions: 30, skipSeconds: 15, skipLimit: 3, cooldownSeconds: 90 },
  matching: { maxUnanswered: 3, nudgeHours: 24, archiveDays: 14 },
  safety: { autoShadowReports: 4 },
  referral: { enabled: true, minAdds: 20, rewardChats: 5, rewardLikes: 25 },
  wall: {
    enabled: true,
    freeDailyPosts: 1,
    repostCooldownHours: 24,
    bumpCooldownHours: 6,
    requestReminderHours: 12,
    ttlHours: 48,
    freeDailyChats: 10,
    premiumDailyChats: 50,
    autoHideReports: 3,
    newcomerSpotlightHours: 6,
    telegram: { enabled: false, chatId: '', link: '' },
  },
  growth: { autoWidenBelow: 20, freeRevealedLikes: 3, newcomerFanout: 40, likersEvery: 4, exposureSoftCap: 50, passRecycleDays: 30, inactiveDays: 30 },
  vibeNight: {
    enabled: true,
    startHour: 21,
    durationMinutes: 120,
    bonusSuperLikes: 1,
    reminderEveryDays: 2,
    text: '🌙 <b>شب Vibe شروع شد!</b>\nالان شلوغ‌ترین وقت Vibe ـه و بیشترین آدم‌ها آنلاینن. یه سر بزن و سوپرلایک هدیه‌ی امشبت رو بگیر ⭐',
  },
  bot: {
    messageCooldownMin: 10,
    likeCooldownMin: 180,
    comebackAfterDays: 3,
    welcomeText:
      'سلام {name} 👋\nبه <b>Vibe Chat</b> خوش اومدی 💜\n\nاینجا آدم‌های جدید و واقعی رو می‌بینی، لایک می‌کنی و اگه اونا هم لایکت کنن، مچ می‌شید و چت رو شروع می‌کنید 🔥\n\nبرای شروع روی دکمه‌ی پایین بزن 👇',
  },
  support: { telegram: '', channel: '', termsUrl: '', privacyUrl: '' },
};

const CHANNEL = 'settings:changed';
const TTL_MS = 30_000;
let cached: { value: AppSettings; at: number } | null = null;
let loading: Promise<AppSettings> | null = null;

function merge(stored: Partial<AppSettings> | undefined): AppSettings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [k, v] of Object.entries(stored ?? {})) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    const def = (DEFAULT_SETTINGS as Record<string, unknown>)[k];
    out[k] = def && typeof def === 'object' && !Array.isArray(def) && v && typeof v === 'object' ? { ...def, ...v } : v;
  }
  const parsed = SettingsSchema.safeParse(out);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function getSettings(): Promise<AppSettings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  loading ??= (async () => {
    try {
      const rows = await sql<{ value: Partial<AppSettings> }[]>`SELECT value FROM app_settings WHERE key = 'app'`;
      const value = merge(rows[0]?.value);
      cached = { value, at: Date.now() };
      return value;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export async function saveSettings(patch: Partial<AppSettings>, adminId: string | null): Promise<AppSettings> {
  const next = SettingsSchema.parse(merge({ ...(await getSettings()), ...patch }));
  await sql`
    INSERT INTO app_settings (key, value, updated_at, updated_by)
    VALUES ('app', ${sql.json(next as never)}, now(), ${adminId})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`;
  cached = { value: next, at: Date.now() };
  await redis.publish(CHANNEL, '1');
  return next;
}

/** Other instances drop their cached copy as soon as an admin saves. */
export async function listenForSettingsChanges() {
  await redisSub.subscribe(CHANNEL);
  redisSub.on('message', (channel) => {
    if (channel === CHANNEL) cached = null;
  });
}
