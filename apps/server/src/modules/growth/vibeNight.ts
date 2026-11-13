import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { sql } from '../../lib/db.js';
import { enqueueBotMessages, type BotMessage } from '../../lib/queue.js';
import { redis } from '../../lib/redis.js';
import { invalidateUser, requireActive } from '../auth/guard.js';
import { getSettings, type AppSettings } from '../settings/settings.js';

/**
 * «شب Vibe»: one fixed peak window every night (Tehran time). A dating app with a few hundred
 * people online at once feels alive; the same people spread over the day feel like nobody's there.
 * Opening the app during the night is worth a gift (super likes, once per night), and people who
 * aren't around get one Telegram reminder when it starts (at most every few days).
 */

const DAY_MIN = 24 * 60;

/** Minutes since midnight in Tehran. */
function tehranMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

export interface NightWindow {
  enabled: boolean;
  active: boolean;
  /** start of the current night when active, else of the next one */
  startsAt: string;
  endsAt: string;
  /** identifies one night (the date its window started, UTC) */
  nightId: string;
  /** minutes since the current night started (when active) */
  minutesIn: number;
}

export function nightWindow(cfg: AppSettings['vibeNight'], now = new Date()): NightWindow {
  const nowMin = tehranMinutes(now);
  const start = cfg.startHour * 60;
  const since = (nowMin - start + DAY_MIN) % DAY_MIN; // minutes since the most recent start
  const active = cfg.enabled && since < cfg.durationMinutes;
  const lastStart = new Date(now.getTime() - since * 60_000);
  lastStart.setSeconds(0, 0);
  const startsAt = active ? lastStart : new Date(lastStart.getTime() + DAY_MIN * 60_000);
  return {
    enabled: cfg.enabled,
    active,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + cfg.durationMinutes * 60_000).toISOString(),
    nightId: lastStart.toISOString().slice(0, 10),
    minutesIn: since,
  };
}

export async function vibeNightRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireActive);

  /**
   * The night's state for the app's banner. Called while it's on, it also hands out tonight's gift
   * the first time (`granted` = super likes just added).
   */
  app.get('/v1/vibe-night', async (req) => {
    const cfg = (await getSettings()).vibeNight;
    const w = nightWindow(cfg);
    let granted = 0;
    let claimed = false;
    if (w.active && cfg.bonusSuperLikes > 0) {
      const key = `vn:gift:${req.user.id}:${w.nightId}`;
      const fresh = await redis.set(key, '1', 'EX', 2 * 86400, 'NX');
      if (fresh === 'OK') {
        await sql`UPDATE users SET bonus_superlikes = bonus_superlikes + ${cfg.bonusSuperLikes} WHERE id = ${req.user.id}`;
        await invalidateUser(req.user.id);
        granted = cfg.bonusSuperLikes;
      }
      claimed = true;
    }
    return { enabled: w.enabled, active: w.active, startsAt: w.startsAt, endsAt: w.endsAt, bonus: cfg.bonusSuperLikes, granted, claimed };
  });
}

/**
 * Worker (every few minutes): in the first quarter hour of the night, once per night across all
 * workers, remind people who haven't been around today — each at most once every few days.
 */
export async function vibeNightReminder(log?: Logger) {
  const cfg = (await getSettings()).vibeNight;
  if (!cfg.enabled || cfg.reminderEveryDays <= 0) return;
  const w = nightWindow(cfg);
  if (!w.active || w.minutesIn > 15) return;
  const once = await redis.set(`vn:sent:${w.nightId}`, '1', 'EX', 2 * 86400, 'NX');
  if (once !== 'OK') return;

  const cooldown = cfg.reminderEveryDays * 86400;
  let after = '00000000-0000-0000-0000-000000000000';
  let queued = 0;
  for (;;) {
    const rows = await sql<{ id: string; telegram_id: string }[]>`
      SELECT id, telegram_id FROM users
      WHERE id > ${after} AND status = 'active' AND can_dm AND NOT bot_blocked AND telegram_id IS NOT NULL
        AND last_active_at < now() - interval '6 hours'
        AND last_active_at > now() - interval '30 days'
      ORDER BY id LIMIT 1000`;
    if (!rows.length) break;
    after = rows[rows.length - 1]!.id;
    const tx = redis.multi();
    for (const r of rows) tx.set(`vn:rem:${r.id}`, '1', 'EX', cooldown, 'NX');
    const results = (await tx.exec()) ?? [];
    const batch: BotMessage[] = [];
    rows.forEach((r, i) => {
      if (results[i]?.[1] !== 'OK') return;
      batch.push({ userId: r.id, chatId: r.telegram_id, text: cfg.text, button: { text: '🌙 بزن بریم' }, media: 'vibe_night' });
    });
    await enqueueBotMessages(batch);
    queued += batch.length;
  }
  log?.info({ queued }, 'vibe night reminders queued');
}
