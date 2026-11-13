import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/guard.js';
import { gateStatus } from './service.js';

export async function gateRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  /** The channels and groups to join before using the app, and which of them I'm already in. */
  app.get('/v1/gate', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) =>
    gateStatus(req.user.id, (e) => req.log.warn({ err: (e as Error).message }, 'gate check failed')),
  );
}
