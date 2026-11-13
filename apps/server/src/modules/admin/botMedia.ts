import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { BOT_MEDIA_SLOT_IDS, listBotMedia, removeBotMedia, saveBotMedia } from '../bot/media.js';
import { allow, audit, requireAdmin } from './guard.js';

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Pictures for the bot's messages, one per kind of message. The panel sends the image as a data
 * URL in JSON (it goes through the panel's JSON proxy); the server validates and re-encodes it.
 */
export async function adminBotMediaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/v1/bot-media', { preHandler: allow() }, async () => listBotMedia());

  app.put('/admin/v1/bot-media/:slot', { preHandler: allow(), bodyLimit: 12 * 1024 * 1024 }, async (req) => {
    const { slot } = parse(z.object({ slot: z.enum(BOT_MEDIA_SLOT_IDS) }), req.params);
    const { image } = parse(z.object({ image: z.string().max(12 * 1024 * 1024) }), req.body);
    const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!m) throw badRequest('فقط تصویر PNG، JPG یا WebP');
    const bytes = Buffer.from(m[2]!, 'base64');
    if (bytes.length > MAX_BYTES) throw badRequest('حجم تصویر حداکثر ۸ مگابایت است');
    await saveBotMedia(slot, bytes, req.admin.id);
    await audit(req.admin.id, 'bot_media.update', 'bot_media', null, { slot });
    return listBotMedia();
  });

  app.delete('/admin/v1/bot-media/:slot', { preHandler: allow() }, async (req) => {
    const { slot } = parse(z.object({ slot: z.enum(BOT_MEDIA_SLOT_IDS) }), req.params);
    await removeBotMedia(slot);
    await audit(req.admin.id, 'bot_media.remove', 'bot_media', null, { slot });
    return listBotMedia();
  });
}
