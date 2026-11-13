import { createHmac, timingSafeEqual } from 'node:crypto';
import { env, isProd } from '../config.js';

/** The `user` object inside Mini App init data. */
export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
  allows_write_to_pm?: boolean;
}

export interface InitData {
  user: TelegramUser;
  authDate: Date;
  startParam: string | null;
  chatType: string | null;
  queryId: string | null;
}

export class InitDataError extends Error {
  constructor(readonly reason: 'missing' | 'signature' | 'expired' | 'malformed') {
    super(`init data ${reason}`);
  }
}

let secretKey: Buffer | null = null;
/** secret = HMAC_SHA256(key = "WebAppData", message = bot token); computed once. */
function webAppSecret(): Buffer {
  secretKey ??= createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest();
  return secretKey;
}

/** Builds the data-check string: every field except `hash`, sorted by key, `key=value` joined by \n. */
function dataCheckString(params: URLSearchParams): string {
  const pairs: string[] = [];
  for (const [k, v] of params) if (k !== 'hash') pairs.push(`${k}=${v}`);
  return pairs.sort().join('\n');
}

function parseFields(params: URLSearchParams): InitData {
  const rawUser = params.get('user');
  const authDate = Number(params.get('auth_date'));
  if (!rawUser || !Number.isFinite(authDate)) throw new InitDataError('malformed');
  let user: TelegramUser;
  try {
    user = JSON.parse(rawUser) as TelegramUser;
  } catch {
    throw new InitDataError('malformed');
  }
  if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || typeof user.first_name !== 'string') {
    throw new InitDataError('malformed');
  }
  return {
    user,
    authDate: new Date(authDate * 1000),
    startParam: params.get('start_param'),
    chatType: params.get('chat_type'),
    queryId: params.get('query_id'),
  };
}

/**
 * Validates the raw init data string the Mini App receives from Telegram (the client sends it as is).
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(raw: string, maxAgeS = env.TELEGRAM_AUTH_MAX_AGE_S): InitData {
  if (!raw || raw.length > 8192) throw new InitDataError('missing');
  const params = new URLSearchParams(raw);

  if (env.DEV_FAKE_TELEGRAM && !isProd) {
    // Development only (refused in production by config.ts):
    //  - hash=dev: a normal browser outside Telegram (apps/miniapp/src/telegram/tg.ts mock);
    //  - no BOT_TOKEN yet: real Telegram data can't be checked, so it is trusted as is.
    // As soon as BOT_TOKEN is set, real Telegram logins are verified again.
    if (params.get('hash') === 'dev' || !env.BOT_TOKEN) return parseFields(params);
  }

  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash) || !env.BOT_TOKEN) throw new InitDataError('signature');
  const expected = createHmac('sha256', webAppSecret()).update(dataCheckString(params)).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new InitDataError('signature');

  const data = parseFields(params);
  if (maxAgeS > 0 && Date.now() - data.authDate.getTime() > maxAgeS * 1000) throw new InitDataError('expired');
  return data;
}

/** Test helper: signs init data the way Telegram does. */
export function signInitData(fields: Record<string, string>, botToken = env.BOT_TOKEN): string {
  const params = new URLSearchParams(fields);
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString(params)).digest('hex'));
  return params.toString();
}

/** Start parameters the Mini App understands (t.me/<bot>/<app>?startapp=…). */
export type StartParam =
  | { kind: 'ref'; code: string }
  | { kind: 'chat'; matchId: string }
  | { kind: 'user'; userId: string }
  | { kind: 'pay'; paymentId: string }
  | { kind: 'wall'; postId: string }
  | { kind: 'screen'; name: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseStartParam(p: string | null | undefined): StartParam | null {
  if (!p || !/^[\w-]{1,512}$/.test(p)) return null;
  const [kind, ...rest] = p.split('_');
  const value = rest.join('_');
  switch (kind) {
    case 'r':
      return /^[A-Za-z0-9]{4,16}$/.test(value) ? { kind: 'ref', code: value } : null;
    case 'chat':
      return UUID.test(value) ? { kind: 'chat', matchId: value } : null;
    case 'u':
      return UUID.test(value) ? { kind: 'user', userId: value } : null;
    case 'pay':
      return UUID.test(value) ? { kind: 'pay', paymentId: value } : null;
    case 'w':
      return UUID.test(value) ? { kind: 'wall', postId: value } : null;
    case 's':
      return /^[a-z]{2,20}$/.test(value) ? { kind: 'screen', name: value } : null;
    default:
      return null;
  }
}
