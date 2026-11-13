import type { FastifyInstance } from 'fastify';
import { GrammyError } from 'grammy';
import { z } from 'zod';
import { sql } from '../../lib/db.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { uuidv7 } from '../../lib/ids.js';
import { parse, zUuid } from '../../lib/validate.js';
import { botApi } from '../bot/sender.js';
import { forgetRequiredChats, type RequiredChatRow } from '../gate/service.js';
import { allow, audit, requireAdmin } from './guard.js';

/** «@name», «t.me/name», «https://t.me/name» or a numeric id → what getChat accepts. */
function chatRef(input: string): string | number {
  const s = input.trim();
  if (/^-?\d+$/.test(s)) return Number(s);
  const m = s.match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{4,})\/?$/) ?? s.match(/^@?([A-Za-z0-9_]{4,})$/);
  if (!m) throw badRequest('شناسه‌ی عددی یا یوزرنیم کانال/گروه را وارد کنید. برای کانال خصوصی شناسه‌ی عددی لازم است.');
  return `@${m[1]}`;
}

function telegramProblem(e: unknown): never {
  const why = e instanceof GrammyError ? e.description : (e as Error).message;
  if (/inaccessible|not enough rights|administrator/i.test(why)) {
    throw new AppError(400, 'bot_not_admin', 'ربات در این کانال/گروه ادمین نیست. اول ربات را ادمین کنید، بعد دوباره امتحان کنید.');
  }
  if (/chat not found/i.test(why)) {
    throw new AppError(400, 'chat_not_found', 'این کانال/گروه پیدا نشد. یوزرنیم یا شناسه را بررسی کنید (برای کانال خصوصی، ربات باید عضو آن باشد).');
  }
  throw new AppError(400, 'telegram_error', `تلگرام جواب نداد؛ کمی بعد دوباره امتحان کنید (${why})`);
}

export async function adminGateRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/v1/required-chats', { preHandler: allow() }, async () => {
    const items = await sql<RequiredChatRow[]>`
      SELECT id, chat_id::text AS chat_id, title, kind, username, link, position, is_active, created_at
      FROM required_chats ORDER BY position, created_at`;
    // places the bot was made admin of and that aren't on the list yet: one click to add
    const candidates = await sql`
      SELECT chat_id::text AS chat_id, title, kind, username, updated_at FROM bot_chats b
      WHERE bot_status = 'administrator' AND NOT EXISTS (SELECT 1 FROM required_chats r WHERE r.chat_id = b.chat_id)
      ORDER BY updated_at DESC LIMIT 20`;
    return { items, candidates, botReady: !!botApi() };
  });

  /** Adds a channel or group after checking with Telegram that it exists and that the bot is an admin there. */
  app.post('/admin/v1/required-chats', { preHandler: allow() }, async (req) => {
    const body = parse(z.object({ chat: z.string().min(2).max(200), link: z.string().max(200).optional(), title: z.string().max(100).optional() }), req.body);
    const api = botApi();
    if (!api) throw badRequest('توکن ربات تنظیم نشده است');
    const ref = chatRef(body.chat);
    const chat = await api.getChat(ref).catch(telegramProblem);
    if (chat.type === 'private') throw badRequest('این یک کاربر است، نه کانال یا گروه');
    const me = await api.getMe().catch(telegramProblem);
    const member = await api.getChatMember(chat.id, me.id).catch(telegramProblem);
    if (member.status !== 'administrator') {
      throw badRequest('ربات باید در این کانال/گروه ادمین باشد تا بتواند عضویت کاربران را بررسی کند');
    }
    const username = 'username' in chat && chat.username ? chat.username : null;
    let link = body.link?.trim() || (username ? `https://t.me/${username}` : '') || ('invite_link' in chat && chat.invite_link ? chat.invite_link : '');
    if (!link) link = await api.exportChatInviteLink(chat.id).catch(telegramProblem);
    if (!/^https:\/\/t\.me\//.test(link)) throw badRequest('لینک باید با https://t.me/ شروع شود');
    const title = body.title?.trim() || ('title' in chat && chat.title ? chat.title : 'کانال');
    const [{ n }] = (await sql`SELECT count(*)::int AS n FROM required_chats`) as unknown as [{ n: number }];
    const id = uuidv7();
    const [row] = await sql`
      INSERT INTO required_chats (id, chat_id, title, kind, username, link, position)
      VALUES (${id}, ${chat.id}, ${title}, ${chat.type === 'channel' ? 'channel' : 'group'}, ${username}, ${link}, ${n})
      ON CONFLICT (chat_id) DO UPDATE SET title = EXCLUDED.title, username = EXCLUDED.username, link = EXCLUDED.link, is_active = true
      RETURNING id`;
    await forgetRequiredChats();
    await audit(req.admin.id, 'required_chat.add', 'required_chat', row!.id as string, { chatId: chat.id, title });
    return { ok: true };
  });

  app.patch('/admin/v1/required-chats/:id', { preHandler: allow() }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(
      z.object({
        isActive: z.boolean().optional(),
        title: z.string().min(1).max(100).optional(),
        link: z.string().regex(/^https:\/\/t\.me\//, 'لینک باید با https://t.me/ شروع شود').max(200).optional(),
        position: z.number().int().min(0).max(1000).optional(),
      }),
      req.body,
    );
    const [row] = await sql`
      UPDATE required_chats SET
        is_active = coalesce(${body.isActive ?? null}, is_active),
        title = coalesce(${body.title ?? null}, title),
        link = coalesce(${body.link ?? null}, link),
        position = coalesce(${body.position ?? null}, position)
      WHERE id = ${id} RETURNING id`;
    if (!row) throw notFound();
    await forgetRequiredChats();
    await audit(req.admin.id, 'required_chat.update', 'required_chat', id, body);
    return { ok: true };
  });

  app.delete('/admin/v1/required-chats/:id', { preHandler: allow() }, async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    await sql`DELETE FROM required_chats WHERE id = ${id}`;
    await forgetRequiredChats();
    await audit(req.admin.id, 'required_chat.delete', 'required_chat', id);
    return { ok: true };
  });
}
