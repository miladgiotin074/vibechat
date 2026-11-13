import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/guard.js';
import { referralSummary } from './service.js';

export async function referralRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  /** My invite link, how many friends joined, what I earned, what the next reward is. */
  app.get('/v1/referrals', async (req) => referralSummary(req.user.id));
}
