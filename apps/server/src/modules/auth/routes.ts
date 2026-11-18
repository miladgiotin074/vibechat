import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { clientIp } from '../../lib/ip.js';
import { redis } from '../../lib/redis.js';
import { InitDataError, validateInitData } from '../../lib/telegram.js';
import { parse } from '../../lib/validate.js';
import { getMe } from '../profile/service.js';
import { getSettings } from '../settings/settings.js';
import { upsertTelegramUser } from '../users/telegram.js';
import { requireUser } from './guard.js';
import { createSession, refreshSession, revokeSession } from './sessions.js';

const REASONS: Record<InitDataError['reason'], string> = {
  missing: 'اطلاعات ورود تلگرام ارسال نشد. اپ را از داخل تلگرام باز کنید.',
  malformed: 'اطلاعات ورود تلگرام نامعتبر است.',
  signature: 'ورود تأیید نشد. اپ را از داخل ربات در تلگرام باز کنید.',
  expired: 'نشست تلگرام منقضی شده است. اپ را ببندید و دوباره باز کنید.',
};

export async function authRoutes(app: FastifyInstance) {
  /**
   * Login = opening the Mini App. Telegram signs the init data with our bot token, so a valid
   * signature proves who the user is; the account is created on first open (no sign-up form).
   */
  app.post('/v1/auth/telegram', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(
      z.object({
        initData: z.string().min(10).max(8192),
        /** tgWebAppStartParam from the launch params, in case the init data doesn't carry it. */
        startParam: z.string().max(512).optional(),
        platform: z.string().max(32).optional(),
        version: z.string().max(16).optional(),
      }),
      req.body,
    );
    let data;
    try {
      data = validateInitData(body.initData);
    } catch (e) {
      if (e instanceof InitDataError) {
        req.log.info({ reason: e.reason }, 'telegram init data rejected');
        throw new AppError(401, 'telegram_auth_failed', REASONS[e.reason], { reason: e.reason });
      }
      throw e;
    }
    const settings = await getSettings();
    if (settings.maintenance.enabled) throw new AppError(503, 'maintenance', settings.maintenance.message);

    const account = await upsertTelegramUser(data.user);

    // The Telegram profile photo (if the user's privacy allows it) is offered during onboarding.
    if (data.user.photo_url && /^https:\/\/t\.me\//.test(data.user.photo_url)) {
      await redis.set(`tgphoto:${account.id}`, data.user.photo_url, 'EX', 86400);
    }

    const tokens = await createSession(account.id, { platform: body.platform, appVersion: body.version }, clientIp(req));
    return { ...tokens, isNew: account.isNew, user: await getMe(account.id) };
  });

  app.post('/v1/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(z.object({ refreshToken: z.string().min(20).max(200) }), req.body);
    return refreshSession(body.refreshToken, clientIp(req));
  });

  app.post('/v1/auth/logout', { preHandler: requireUser }, async (req) => {
    await revokeSession(req.user.sid);
    return { ok: true };
  });
}
