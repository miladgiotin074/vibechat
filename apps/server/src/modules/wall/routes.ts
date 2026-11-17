import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REPORT_REASON_IDS } from '../../data/catalog.js';
import { normalizeText } from '../../lib/text.js';
import { parse, zLimit, zUuid } from '../../lib/validate.js';
import { requireActive } from '../auth/guard.js';
import { createPost, deletePost, editPost, getPost, likers, listFeed, listMine, messageAuthor, reportPost, setLike } from './service.js';

export async function wallRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireActive);

  app.get('/v1/wall', async (req) => {
    const q = parse(
      z.object({
        cursor: z.string().max(80).optional(),
        gender: z.enum(['male', 'female']).optional(),
        forMe: z.enum(['1', 'true']).optional(),
        limit: zLimit(30, 15),
      }),
      req.query,
    );
    return listFeed(req.user.id, { cursor: q.cursor, forMe: !!q.forMe, gender: q.gender, limit: q.limit });
  });

  app.get('/v1/wall/mine', async (req) => listMine(req.user.id));

  app.get('/v1/wall/:id', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return getPost(id, req.user.id);
  });

  app.post('/v1/wall', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const body = parse(
      z.object({
        text: z.string().min(1).max(600),
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
    const body = parse(z.object({ text: z.string().min(1).max(600), lookingFor: z.enum(['male', 'female', 'everyone']) }), req.body);
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

  /** Writing to the author opens the conversation right there, with this as its first message. */
  app.post('/v1/wall/:id/chat', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { text } = parse(z.object({ text: z.string().min(1).max(1000) }), req.body);
    return messageAuthor(id, req.user, text);
  });

  app.post('/v1/wall/:id/report', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(z.object({ reason: z.enum(REPORT_REASON_IDS), details: z.string().max(1000).transform(normalizeText).optional() }), req.body);
    await reportPost(id, req.user.id, body.reason, body.details);
    return { ok: true };
  });
}
