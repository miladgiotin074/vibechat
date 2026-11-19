/** The panel's side of the AI profiles: make them, dress them, switch them off, delete them. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MARITAL_IDS } from '../../data/catalog.js';
import { badRequest } from '../../lib/errors.js';
import { hasOllamaKey, listModels, OllamaError } from '../../lib/ollama.js';
import { parse, zUuid } from '../../lib/validate.js';
import { allow, audit, requireAdmin } from './../admin/guard.js';
import { savePhotoFor } from '../profile/routes.js';
import { getSettings } from '../settings/settings.js';
import { createBot, deleteBot, getBot, listBots, testModel, updateBot } from './service.js';

const dto = (b: Awaited<ReturnType<typeof getBot>>) => ({
  id: b.user_id,
  name: b.name,
  gender: b.gender,
  birthdate: b.birthdate,
  interestedIn: b.interested_in,
  bio: b.bio,
  maritalStatus: b.marital_status,
  persona: b.persona,
  model: b.model,
  enabled: b.enabled,
  discoverable: b.discoverable,
  photoCount: b.photo_count,
  replies: b.replies,
  lastReplyAt: b.last_reply_at,
  lastError: b.last_error,
  status: b.status,
  createdAt: b.created_at,
});

const Profile = {
  name: z.string().min(2).max(30),
  gender: z.enum(['male', 'female']),
  age: z.number().int().min(18).max(80),
  interestedIn: z.enum(['male', 'female', 'everyone']).optional(),
  bio: z.string().max(500).nullable().optional(),
  maritalStatus: z.enum(MARITAL_IDS).nullable().optional(),
  persona: z.string().max(4000).optional(),
  model: z.string().max(120).optional(),
  enabled: z.boolean().optional(),
};

/** data:image/png|jpeg|webp;base64,… — the same shape the announcement picture uses. */
const IMAGE = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/;

function decodeImage(value: string): Buffer {
  const m = IMAGE.exec(value);
  if (!m) throw badRequest('فرمت عکس پشتیبانی نمی‌شود (png، jpg یا webp)');
  const bytes = Buffer.from(m[2]!, 'base64');
  if (!bytes.length) throw badRequest('عکس خالی است');
  return bytes;
}

export async function aiRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  /** Everything the panel's page needs in one call: the profiles, and whether replying can work. */
  app.get('/admin/v1/ai', { preHandler: allow() }, async () => {
    const settings = await getSettings();
    const bots = await listBots();
    return {
      items: bots.map(dto),
      config: { enabled: settings.ai.enabled, model: settings.ai.model, keySet: hasOllamaKey() },
    };
  });

  /** The model ids this account may use. Empty list (with a reason) when the key is missing. */
  app.get('/admin/v1/ai/models', { preHandler: allow() }, async () => {
    if (!hasOllamaKey()) return { items: [], error: 'کلید Ollama روی سرور تنظیم نشده (OLLAMA_API_KEY)' };
    try {
      return { items: await listModels(), error: null };
    } catch (e) {
      return { items: [], error: e instanceof OllamaError ? e.message : 'فهرست مدل‌ها دریافت نشد' };
    }
  });

  app.post('/admin/v1/ai', { preHandler: allow(), bodyLimit: 12 * 1024 * 1024 }, async (req) => {
    const body = parse(
      z.object({
        ...Profile,
        /** How many profiles to make from this one description (names get a number appended). */
        count: z.number().int().min(1).max(50).default(1),
        photo: z.string().max(12 * 1024 * 1024).nullable().optional(),
      }),
      req.body,
    );
    const image = body.photo ? decodeImage(body.photo) : null;
    const ids: string[] = [];
    for (let i = 0; i < body.count; i++) {
      const name = body.count > 1 ? `${body.name} ${i + 1}` : body.name;
      const id = await createBot({ ...body, name }, req.admin.id);
      // a little spread in age, so a batch doesn't look like one person copied
      if (image) await savePhotoFor(id, image);
      ids.push(id);
    }
    await audit(req.admin.id, 'ai.create', 'ai', ids[0]!, { count: body.count, name: body.name, model: body.model });
    return { ids, items: await Promise.all(ids.map(async (id) => dto(await getBot(id)))) };
  });

  app.get('/admin/v1/ai/:id', { preHandler: allow() }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return dto(await getBot(id));
  });

  app.patch('/admin/v1/ai/:id', { preHandler: allow() }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(
      z.object({
        name: Profile.name.optional(),
        gender: Profile.gender.optional(),
        age: Profile.age.optional(),
        interestedIn: Profile.interestedIn,
        bio: Profile.bio,
        maritalStatus: Profile.maritalStatus,
        persona: Profile.persona,
        model: Profile.model,
        enabled: Profile.enabled,
        discoverable: z.boolean().optional(),
      }),
      req.body,
    );
    const updated = await updateBot(id, body);
    await audit(req.admin.id, 'ai.update', 'ai', id, body);
    return dto(updated);
  });

  /** Adds one more picture to an AI profile (the first one is its main photo). */
  app.put('/admin/v1/ai/:id/photo', { preHandler: allow(), bodyLimit: 12 * 1024 * 1024 }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { photo } = parse(z.object({ photo: z.string().max(12 * 1024 * 1024) }), req.body);
    await getBot(id);
    await savePhotoFor(id, decodeImage(photo));
    await audit(req.admin.id, 'ai.photo', 'ai', id);
    return dto(await getBot(id));
  });

  app.delete('/admin/v1/ai/:id', { preHandler: allow() }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    await deleteBot(id);
    await audit(req.admin.id, 'ai.delete', 'ai', id);
    return { ok: true };
  });

  /** «Does it answer?» — one real call to the model, shown back in the panel. */
  app.post('/admin/v1/ai/test', { preHandler: allow(), config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const { model } = parse(z.object({ model: z.string().max(120).optional() }), req.body ?? {});
    const settings = await getSettings();
    try {
      return { ok: true, reply: await testModel(model || settings.ai.model), error: null };
    } catch (e) {
      return { ok: false, reply: null, error: e instanceof Error ? e.message : 'تست ناموفق بود' };
    }
  });
}
