import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REPORT_REASON_IDS, WALL_CATEGORY_IDS } from '../../data/catalog.js';
import { normalizeText } from '../../lib/text.js';
import { parse, zLimit, zUuid } from '../../lib/validate.js';
import { requireActive } from '../auth/guard.js';
import {
  cancelRequest,
  createPost,
  decideRequest,
  deletePost,
  editPost,
  getPost,
  likers,
  listFeed,
  listInbox,
  listMine,
  listRequests,
  reportPost,
  requestChat,
  setLike,
} from './service.js';

export async function wallRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireActive);

  app.get('/v1/wall', async (req) => {
    const q = parse(
      z.object({
        cursor: z.string().max(80).optional(),
        gender: z.enum(['male', 'female']).optional(),
        category: z.enum(WALL_CATEGORY_IDS).optional(),
        city: z.enum(['1', 'true']).optional(),
        forMe: z.enum(['1', 'true']).optional(),
        limit: zLimit(30, 15),
      }),
      req.query,
    );
    return listFeed(req.user.id, { cursor: q.cursor, forMe: !!q.forMe, gender: q.gender, category: q.category, cityOnly: !!q.city, limit: q.limit });
  });

  app.get('/v1/wall/mine', async (req) => listMine(req.user.id));

  // conversation requests across all my posts: received (to answer) or sent (to follow / take back)
  app.get('/v1/wall/requests', async (req) => {
    const { box } = parse(z.object({ box: z.enum(['in', 'out']).default('in') }), req.query);
    return listInbox(req.user.id, box);
  });

  app.get('/v1/wall/:id', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return getPost(id, req.user.id);
  });

  app.post('/v1/wall', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const body = parse(
      z.object({
        text: z.string().min(1).max(600),
        category: z.enum(WALL_CATEGORY_IDS),
        lookingFor: z.enum(['male', 'female', 'everyone']),
        showPhoto: z.boolean().default(true),
        toGroup: z.boolean().default(true),
      }),
      req.body,
    );
    return createPost(req.user, body);
  });

  app.patch('/v1/wall/:id', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(
      z.object({
        text: z.string().min(1).max(600),
        category: z.enum(WALL_CATEGORY_IDS),
        lookingFor: z.enum(['male', 'female', 'everyone']),
      }),
      req.body,
    );
    return editPost(id, req.user, body);
  });

  app.delete('/v1/wall/:id', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    await deletePost(id, req.user.id);
    return { ok: true };
  });

  app.post('/v1/wall/:id/like', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return setLike(id, req.user.id, true);
  });

  app.delete('/v1/wall/:id/like', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return setLike(id, req.user.id, false);
  });

  app.get('/v1/wall/:id/likers', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return likers(id, req.user.id);
  });

  // a reader asks the author for a conversation; the author accepts or declines
  app.post('/v1/wall/:id/chat', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { text } = parse(z.object({ text: z.string().min(1).max(500) }), req.body);
    return requestChat(id, req.user, text);
  });

  app.delete('/v1/wall/:id/chat', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    await cancelRequest(id, req.user.id);
    return { ok: true };
  });

  app.get('/v1/wall/:id/requests', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return listRequests(id, req.user.id);
  });

  app.post('/v1/wall/requests/:rid/:decision', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const { rid, decision } = parse(z.object({ rid: zUuid, decision: z.enum(['accept', 'decline']) }), req.params);
    return decideRequest(rid, req.user.id, decision === 'accept');
  });

  app.post('/v1/wall/:id/report', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(z.object({ reason: z.enum(REPORT_REASON_IDS), details: z.string().max(1000).transform(normalizeText).optional() }), req.body);
    await reportPost(id, req.user.id, body.reason, body.details);
    return { ok: true };
  });
}
