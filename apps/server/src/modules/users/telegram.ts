import { sql } from '../../lib/db.js';
import { forbidden } from '../../lib/errors.js';
import { inviteCode, uuidv7 } from '../../lib/ids.js';
import { normalizeText } from '../../lib/text.js';
import type { TelegramUser } from '../../lib/telegram.js';
import { invalidateUser } from '../auth/guard.js';
import { getSettings } from '../settings/settings.js';
import { bumpDailyCounter } from './activity.js';

export interface TelegramAccount {
  id: string;
  status: string;
  isNew: boolean;
  refCode: string;
}

/** Telegram first names can hold anything; keep letters, marks and spaces so it passes profile validation. */
export function cleanName(first: string | undefined): string | null {
  const name = normalizeText((first ?? '').replace(/[^\p{L}\p{M} ]+/gu, ' ')).slice(0, 30).trim();
  return name.length >= 2 ? name : null;
}

/**
 * Finds or creates the user for a Telegram account. Called from the Mini App login (init data) and
 * from the bot's /start, so whichever comes first registers the user — there is no sign-up form.
 */
export async function upsertTelegramUser(
  tg: TelegramUser,
  opts: { canDm?: boolean; startedBot?: boolean; refCode?: string | null } = {},
): Promise<TelegramAccount> {
  const canDm = !!(opts.canDm || opts.startedBot || tg.allows_write_to_pm);
  const [existing] = await sql<{ id: string; status: string; ref_code: string }[]>`
    UPDATE users SET
      tg_username = ${tg.username ?? null}, tg_first_name = ${tg.first_name}, tg_last_name = ${tg.last_name ?? null},
      tg_language = ${tg.language_code ?? null}, tg_premium = ${!!tg.is_premium},
      can_dm = can_dm OR ${canDm},
      bot_blocked = CASE WHEN ${!!opts.startedBot} THEN false ELSE bot_blocked END
    WHERE telegram_id = ${tg.id}
    RETURNING id, status, ref_code`;
  if (existing) {
    if (existing.status === 'banned' || existing.status === 'suspended') {
      throw forbidden('حساب شما مسدود شده است. برای پیگیری با پشتیبانی در تماس باشید.', 'account_banned');
    }
    return { id: existing.id, status: existing.status, isNew: false, refCode: existing.ref_code };
  }

  const settings = await getSettings();
  if (!settings.signupOpen) throw forbidden('ثبت‌نام جدید موقتاً بسته است', 'signup_closed');

  const id = uuidv7();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = inviteCode();
    const [row] = await sql<{ id: string; ref_code: string; inserted: boolean }[]>`
      INSERT INTO users (id, telegram_id, tg_username, tg_first_name, tg_last_name, tg_language, tg_premium,
                         can_dm, ref_code, name)
      VALUES (${id}, ${tg.id}, ${tg.username ?? null}, ${tg.first_name}, ${tg.last_name ?? null},
              ${tg.language_code ?? null}, ${!!tg.is_premium}, ${canDm}, ${code}, ${cleanName(tg.first_name)})
      ON CONFLICT (telegram_id) DO UPDATE SET can_dm = users.can_dm OR EXCLUDED.can_dm
      RETURNING id, ref_code, (xmax = 0) AS inserted`
      .catch((e: { code?: string; constraint_name?: string }) => {
        if (e.code === '23505' && e.constraint_name === 'users_ref_code_key') return [];
        throw e;
      });
    if (!row) continue; // invite code collision: try another
    if (!row.inserted) {
      // created by a concurrent request (bot /start and Mini App opened at the same moment)
      const [u] = await sql<{ status: string }[]>`SELECT status FROM users WHERE id = ${row.id}`;
      return { id: row.id, status: u?.status ?? 'onboarding', isNew: false, refCode: row.ref_code };
    }
    await bumpDailyCounter('signups');
    await invalidateUser(row.id);
    return { id: row.id, status: 'onboarding', isNew: true, refCode: row.ref_code };
  }
  throw new Error('could not allocate an invite code');
}
