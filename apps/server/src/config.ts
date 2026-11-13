import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  APP_NAME: z.string().default('Vibe Chat'),
  /** Public base URL of this API (payment callbacks, bot webhook), e.g. https://api.vibechat.app */
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:4000'),
  /** Comma-separated browser origins allowed to call the API (the Mini App and the admin panel). */
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),
  TRUST_PROXY: bool.default(true),
  /** Behind Cloudflare: take the client IP from CF-Connecting-IP. */
  BEHIND_CLOUDFLARE: bool.default(false),

  DATABASE_URL: z.string().default('postgres://vibe:vibe@localhost:5432/vibe'),
  DATABASE_POOL_MAX: z.coerce.number().int().default(20),
  /** Set when connecting through PgBouncer in transaction mode (no server-side prepared statements). */
  DATABASE_PGBOUNCER: bool.default(false),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(32).default('dev-only-secret-change-me-dev-only-secret'),
  ADMIN_JWT_SECRET: z.string().min(32).default('dev-only-admin-secret-change-me-dev-only'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().default(60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(60),

  /** local: photos on this server's disk (MEDIA_DIR) · s3: S3-compatible storage such as Cloudflare R2. */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('s3'),
  /** Folder for STORAGE_DRIVER=local (a Docker volume in production). */
  MEDIA_DIR: z.string().default('/data/media'),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default('vibe'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  S3_FORCE_PATH_STYLE: bool.default(true),
  /** Where clients load public media from (CDN / R2 custom domain), without a trailing slash. */
  MEDIA_PUBLIC_URL: z.string().default('http://localhost:9000/vibe'),

  // ---- Telegram ------------------------------------------------------------------------------
  /** Bot token from @BotFather. Also the key that signs Mini App init data. */
  BOT_TOKEN: z.string().default(''),
  /** Bot username without @ (for t.me links). */
  BOT_USERNAME: z.string().default('VibeChatBot'),
  /** Mini App short name set in @BotFather (/newapp) → https://t.me/<bot>/<short name>. */
  MINIAPP_SHORT_NAME: z.string().default('app'),
  /** Where the Mini App is hosted (HTTPS), used for the bot's menu and web_app buttons. */
  MINIAPP_URL: z.string().default('http://localhost:5173'),
  /** webhook (production, any API instance can take updates) · polling (local dev) · off */
  BOT_MODE: z.enum(['webhook', 'polling', 'off']).default('off'),
  /** Secret Telegram echoes in X-Telegram-Bot-Api-Secret-Token on every webhook call. */
  BOT_WEBHOOK_SECRET: z.string().default(''),
  /** How old Mini App init data may be when logging in (seconds). */
  TELEGRAM_AUTH_MAX_AGE_S: z.coerce.number().int().default(86400),
  /** Development only: accept unsigned init data from a browser outside Telegram. Refused in production. */
  DEV_FAKE_TELEGRAM: bool.default(false),

  // ---- Tetra98 payment gateway ---------------------------------------------------------------
  TETRA_API_KEY: z.string().default(''),
  TETRA_SANDBOX: bool.default(true),
  /** Optional egress proxy for gateway calls if it only accepts some IP ranges (http://user:pass@host:port). */
  TETRA_PROXY_URL: z.string().default(''),
  /** Ask the gateway to also call our webhook (requires a webhook key created in the Tetra98 panel). */
  TETRA_WEBHOOK: bool.default(false),

  /** Creates this admin on boot when no admin exists yet. */
  ADMIN_BOOTSTRAP_USERNAME: z.string().default(''),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().default(''),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

if (isProd) {
  const problems: string[] = [];
  if (env.DEV_FAKE_TELEGRAM) problems.push('DEV_FAKE_TELEGRAM must be false in production');
  if (!env.BOT_TOKEN) problems.push('BOT_TOKEN is required');
  if (env.JWT_SECRET.startsWith('dev-only')) problems.push('JWT_SECRET is the development default');
  if (env.ADMIN_JWT_SECRET.startsWith('dev-only')) problems.push('ADMIN_JWT_SECRET is the development default');
  if (env.BOT_MODE === 'webhook' && env.BOT_WEBHOOK_SECRET.length < 24) problems.push('BOT_WEBHOOK_SECRET must be at least 24 characters');
  if (problems.length) {
    console.error('Refusing to start:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
}

export const corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);

/** Telegram deep links into the Mini App. `startapp` allows [A-Za-z0-9_-], up to 512 chars. */
export function miniAppLink(startParam?: string): string {
  const base = `https://t.me/${env.BOT_USERNAME}/${env.MINIAPP_SHORT_NAME}`;
  return startParam ? `${base}?startapp=${startParam}` : base;
}

export function botLink(start?: string): string {
  return start ? `https://t.me/${env.BOT_USERNAME}?start=${start}` : `https://t.me/${env.BOT_USERNAME}`;
}
