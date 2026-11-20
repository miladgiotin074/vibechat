import type { FastifyInstance } from 'fastify';
import { telegramCredentials } from './telegram.js';
import {
  cancelLogin,
  forgotPassword,
  loginState,
  recoverWithCode,
  resendLoginCode,
  startPhone,
  submitCaptcha,
  submitCode,
  submitEmail,
  submitEmailCode,
  submitNames,
  submitPassword,
  submitTerms,
} from './telegram.js';
import type { AuthResponse } from './types.js';
import { requireUser } from '../auth/guard.js';

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

async function handle(body: Record<string, unknown>, vibeUserId: string, alreadyVerified: boolean): Promise<AuthResponse> {
  if (alreadyVerified) return { step: 'done', verified: true, user: { id: '', firstName: '', lastName: '', username: '', phone: '' } };

  const action = text(body.action);
  const loginId = text(body.loginId);
  switch (action) {
    case 'phone':
      return startPhone(text(body.phone), text(body.locale) || 'fa', vibeUserId);
    case 'code':
      return submitCode(loginId, vibeUserId, text(body.code));
    case 'password':
      return submitPassword(loginId, vibeUserId, text(body.password));
    case 'signup':
      return submitNames(loginId, vibeUserId, text(body.firstName), text(body.lastName));
    case 'email':
      return submitEmail(loginId, vibeUserId, text(body.email));
    case 'email_code':
      return submitEmailCode(loginId, vibeUserId, text(body.code));
    case 'terms':
      return submitTerms(loginId, vibeUserId, body.accept !== false);
    case 'captcha':
      return submitCaptcha(loginId, vibeUserId, text(body.token));
    case 'resend':
      return resendLoginCode(loginId, vibeUserId);
    case 'state':
      return loginState(loginId, vibeUserId);
    case 'forgot':
      return forgotPassword(loginId, vibeUserId);
    case 'recover':
      return recoverWithCode(loginId, vibeUserId, text(body.code));
    case 'cancel':
      return cancelLogin(loginId, vibeUserId);
    default:
      return { step: 'error', code: 'BAD_REQUEST' };
  }
}

/** «تأیید حساب» via Telegram phone login (MTProto). Proves the number belongs to the same `telegram_id` as the Mini App. */
export async function verificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/v1/verification/telegram', async (req) => ({
    enabled: !!telegramCredentials(),
  }));

  app.post(
    '/v1/verification/telegram',
    { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } },
    async (req) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!telegramCredentials()) return { step: 'error', code: 'CONFIG' } satisfies AuthResponse;
      return handle(body, req.user.id, req.user.verified);
    },
  );
}