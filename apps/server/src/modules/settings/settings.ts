import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { redis, redisSub } from '../../lib/redis.js';

/** Everything an admin can change at runtime from the panel. Stored as one JSON row. */
export const SettingsSchema = z.object({
  signupOpen: z.boolean(),
  /** Fresh profiles are ranked higher in discovery for this long after onboarding. */
  newUserBoostHours: z.number().int().min(0).max(24 * 14),
  /** People away longer than this are not shown in discovery. */
  inactiveDays: z.number().int().min(1).max(365),
  /** When everyone has been seen, people skipped more than this many days ago come back (0 = never). */
  skipRecycleDays: z.number().int().min(0).max(365),
  /** On finishing sign-up, a newcomer is put at the front of this many online people's decks. */
  newcomerFanout: z.number().int().min(0).max(500),
  minAge: z.number().int().min(18).max(99),
  maxPhotos: z.number().int().min(1).max(12),
  chatMediaEnabled: z.boolean(),
  /** Each side must have sent this many messages before photos can be sent in a chat. */
  chatMediaMinMessages: z.number().int().min(0).max(100),
  bannedWords: z.array(z.string().min(1).max(50)).max(2000),
  maintenance: z.object({ enabled: z.boolean(), message: z.string().max(500) }),
  /** Conversations. Everything here is the same for everyone: nothing in the app is for sale. */
  matching: z.object({
    /**
     * New conversations one person may start in a day. Not a paywall — it is what keeps one
     * account from writing to everybody (0 = no limit).
     */
    dailyNewChats: z.number().int().min(0).max(1000),
    /** Until the other side answers, at most this many messages in a row (0 = no limit). */
    maxUnanswered: z.number().int().min(0).max(50),
    /** A conversation with no message gets one reminder after this many hours (0 = off). */
    nudgeHours: z.number().int().min(0).max(24 * 14),
    /** …and moves to the archive after this many days (0 = never). */
    archiveDays: z.number().int().min(0).max(365),
  }),
  /** Trust and automatic protection. */
  safety: z.object({
    /** Reports from this many different people within a day → shadow ban until a moderator looks (0 = off). */
    autoShadowReports: z.number().int().min(0).max(100),
  }),
  /** The Wall: public requests, mirrored to a Telegram group. */
  wall: z.object({
    enabled: z.boolean(),
    /** Requests a user may have on the Wall at the same time. */
    freeDailyPosts: z.number().int().min(0).max(50),
    /** Hours between posting one request and the next (0 = none). */
    repostCooldownHours: z.number().int().min(0).max(24 * 7),
    /** How long a request stays up. */
    ttlHours: z.number().int().min(1).max(24 * 14),
    /** A request reported by this many people is taken down until a moderator looks at it. */
    autoHideReports: z.number().int().min(1).max(100),
    telegram: z.object({
      enabled: z.boolean(),
      /** Group/channel id where the bot posts (the bot must be an admin there). The panel lists the groups the bot is an admin of. */
      chatId: z.string().max(32),
      /** Public link shown in the app (https://t.me/…). */
      link: z.string().max(200),
    }),
  }),
  /** «تأیید حساب»: an unverified man may send only so many messages, then he has to verify. */
  verification: z.object({
    enabled: z.boolean(),
    /** Messages he may send in one conversation before the gate comes down (0 = no gate). */
    freeMessages: z.number().int().min(0).max(100),
  }),
  /** Profiles the app runs itself, answered by a model through an OpenAI-compatible gateway. */
  ai: z.object({
    /** Off: AI profiles stay as they are but stop answering and leave discovery. */
    enabled: z.boolean(),
    /** The model every profile uses unless it names its own (ids come from the provider's /models). */
    model: z.string().max(120),
    /** An AI profile leads the deck for this long after someone signs up (0 = never). */
    leadNewcomerHours: z.number().int().min(0).max(24 * 30),
    /** How many AI profiles at most are put in front of a newcomer. */
    leadCount: z.number().int().min(0).max(20),
    /** Seconds before the answer lands (plus up to the same again at random), so it isn't instant. */
    replyDelayS: z.number().int().min(0).max(600),
    /** How many of the conversation's last messages the model is given. */
    historyMessages: z.number().int().min(2).max(50),
    /** After this many messages of its own to one person, the profile stops answering (0 = never). */
    maxMessages: z.number().int().min(0).max(1000),
    /**
     * Telegram ids allowed to make a profile by forwarding a message to the bot. Nobody else sees
     * that the feature exists. `/id` in the bot tells someone their own id.
     */
    telegramAdmins: z.array(z.string().regex(/^\d{3,15}$/)).max(20),
    /** The age a profile made by forwarding starts at (editable per profile in the panel). */
    defaultAge: z.number().int().min(18).max(80),
    temperature: z.number().min(0).max(2),
  }),
  /** Telegram messages from the bot (the app's push notifications). */
  bot: z.object({
    /** Tell offline users about new messages (at most once per conversation per this many minutes). */
    messageCooldownMin: z.number().int().min(1).max(24 * 60),
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
  newUserBoostHours: 48,
  inactiveDays: 30,
  skipRecycleDays: 30,
  newcomerFanout: 40,
  minAge: 18,
  maxPhotos: 6,
  chatMediaEnabled: true,
  chatMediaMinMessages: 3,
  bannedWords: [],
  maintenance: { enabled: false, message: 'در حال بروزرسانی هستیم. کمی بعد برگرد 🌙' },
  matching: { dailyNewChats: 30, maxUnanswered: 3, nudgeHours: 24, archiveDays: 14 },
  safety: { autoShadowReports: 4 },
  wall: {
    enabled: true,
    freeDailyPosts: 1,
    repostCooldownHours: 24,
    ttlHours: 48,
    autoHideReports: 3,
    telegram: { enabled: false, chatId: '', link: '' },
  },
  verification: { enabled: true, freeMessages: 3 },
  ai: {
    enabled: true,
    model: 'glm-5.2',
    leadNewcomerHours: 48,
    leadCount: 3,
    replyDelayS: 8,
    historyMessages: 16,
    maxMessages: 40,
    telegramAdmins: [],
    defaultAge: 25,
    temperature: 0.8,
  },
  bot: {
    messageCooldownMin: 10,
    comebackAfterDays: 3,
    welcomeText: 'سلام {name} 👋\nبه <b>Vibe Chat</b> خوش اومدی 💜\n\nاینجا آدم‌های جدید و واقعی رو می‌بینی؛ هر کی رو پسندیدی بهش پیام بده و گفتگو رو شروع کن 🔥\n\nبرای شروع روی دکمه‌ی پایین بزن 👇',
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
