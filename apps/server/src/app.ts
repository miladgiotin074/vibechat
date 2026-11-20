import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyError } from 'fastify';
import { corsOrigins, env, isProd } from './config.js';
import { AppError } from './lib/errors.js';
import { clientIp } from './lib/ip.js';
import { redis } from './lib/redis.js';
import { verifyAccessToken } from './lib/tokens.js';
import { aiRoutes } from './modules/ai/routes.js';
import { adminAuthRoutes } from './modules/admin/auth.js';
import { adminContentRoutes } from './modules/admin/content.js';
import { adminStatsRoutes } from './modules/admin/stats.js';
import { adminUserRoutes } from './modules/admin/users.js';
import { adminBotMediaRoutes } from './modules/admin/botMedia.js';
import { adminGateRoutes } from './modules/admin/gate.js';
import { adminTgGroupOrderRoutes } from './modules/admin/tgGroupOrders.js';
import { gateRoutes } from './modules/gate/routes.js';
import { adminWallRoutes } from './modules/admin/wall.js';
import { authRoutes } from './modules/auth/routes.js';
import { botRoutes } from './modules/bot/bot.js';
import { chatRoutes } from './modules/chat/routes.js';
import { discoverRoutes } from './modules/discover/routes.js';
import { metaRoutes } from './modules/meta/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { profileRoutes } from './modules/profile/routes.js';
import { realtimeRoutes } from './modules/realtime/hub.js';
import { safetyRoutes } from './modules/safety/routes.js';
import { wallRoutes } from './modules/wall/routes.js';
import { verificationRoutes } from './modules/verification/routes.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-telegram-bot-api-secret-token"]'],
      ...(isProd ? {} : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
    },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 256 * 1024,
    // Behind a load balancer: keep idle keep-alive sockets longer than the balancer does.
    keepAliveTimeout: 75_000,
  });

  // JSON API: no CSP; resources may be embedded cross-origin (Mini App, admin panel, local /media in dev)
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } });
  // The Mini App is served from its own origin and calls every verb; preflights are cached for a day.
  await app.register(cors, {
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type'],
    maxAge: 86400,
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    redis,
    nameSpace: 'rl:',
    // Per verified user when logged in (mobile carriers put many users behind one NAT IP), else per IP.
    // Only a valid token counts, so made-up tokens can't be used to get fresh buckets.
    keyGenerator: async (req) => {
      const auth = req.headers.authorization;
      if (auth?.startsWith('Bearer ')) {
        const claims = await verifyAccessToken(auth.slice(7));
        if (claims) return 'u:' + claims.sub;
      }
      return 'ip:' + clientIp(req);
    },
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      code: 'rate_limited',
      message: 'تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.',
      retryAfter: Math.ceil(ctx.ttl / 1000),
    }),
  });
  await app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 5 } });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

  app.setErrorHandler((error: FastifyError | AppError, req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({ code: error.code, message: error.message, details: error.details });
    }
    const status = (error as FastifyError).statusCode ?? 500;
    if (status === 429) return reply.status(429).send(error);
    if (status < 500) {
      return reply.status(status).send({ code: (error as FastifyError).code ?? 'bad_request', message: 'درخواست نامعتبر است' });
    }
    req.log.error(error);
    return reply.status(500).send({ code: 'internal', message: 'خطای داخلی سرور. کمی بعد دوباره تلاش کنید.' });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ code: 'not_found', message: 'پیدا نشد' }));

  await app.register(metaRoutes);
  await app.register(authRoutes);
  await app.register(profileRoutes);
  await app.register(discoverRoutes);
  await app.register(chatRoutes);
  await app.register(safetyRoutes);
  await app.register(notificationRoutes);
  await app.register(gateRoutes);
  await app.register(wallRoutes);
  await app.register(verificationRoutes);
  await app.register(realtimeRoutes);
  await app.register(botRoutes);

  await app.register(adminAuthRoutes);
  await app.register(adminStatsRoutes);
  await app.register(adminUserRoutes);
  await app.register(adminContentRoutes);
  await app.register(adminWallRoutes);
  await app.register(adminBotMediaRoutes);
  await app.register(aiRoutes);
  await app.register(adminGateRoutes);
  await app.register(adminTgGroupOrderRoutes);

  return app;
}
