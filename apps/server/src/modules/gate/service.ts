import type { ChatMember } from 'grammy/types';
import { sql } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { botApi } from '../bot/sender.js';

/**
 * Channels and groups everyone must join before using the app. The bot checks membership
 * (getChatMember), so it must be an admin of each one. Membership is checked live on every app
 * launch and every return to the app (nothing is cached), since people can leave at any time.
 *
 * When the bot can't tell (no token, Telegram out of reach, bot removed from the channel), the
 * chat is treated as joined: a broken setting must never lock everybody out of the app.
 */

export interface RequiredChatRow {
  id: string;
  chat_id: string;
  title: string;
  kind: 'channel' | 'group';
  username: string | null;
  link: string;
  position: number;
  is_active: boolean;
  created_at: Date;
}

const LIST_KEY = 'gate:chats';
const LIST_TTL_S = 60;

export async function activeRequiredChats(): Promise<RequiredChatRow[]> {
  const cached = await redis.get(LIST_KEY);
  if (cached) return JSON.parse(cached) as RequiredChatRow[];
  const rows = await sql<RequiredChatRow[]>`
    SELECT id, chat_id::text AS chat_id, title, kind, username, link, position, is_active, created_at
    FROM required_chats WHERE is_active ORDER BY position, created_at`;
  await redis.set(LIST_KEY, JSON.stringify(rows), 'EX', LIST_TTL_S);
  return rows;
}

/** After the panel changes the list. */
export async function forgetRequiredChats() {
  await redis.del(LIST_KEY);
}

export function isMember(m: ChatMember): boolean {
  if (m.status === 'creator' || m.status === 'administrator' || m.status === 'member') return true;
  return m.status === 'restricted' && m.is_member;
}

/** Asked of Telegram every time, never remembered: someone who left a minute ago is caught at once. */
async function hasJoined(chat: RequiredChatRow, tgId: string | null, log?: (e: unknown) => void): Promise<boolean> {
  const api = botApi();
  if (!api || !tgId) return true;
  try {
    return isMember(await api.getChatMember(chat.chat_id, Number(tgId)));
  } catch (e) {
    log?.(e);
    return true;
  }
}

export interface GateStatus {
  ok: boolean;
  chats: { id: string; title: string; kind: 'channel' | 'group'; link: string; joined: boolean }[];
}

export async function gateStatus(userId: string, log?: (e: unknown) => void): Promise<GateStatus> {
  const chats = await activeRequiredChats();
  if (!chats.length) return { ok: true, chats: [] };
  const [u] = await sql<{ telegram_id: string | null }[]>`SELECT telegram_id::text AS telegram_id FROM users WHERE id = ${userId}`;
  const tgId = u?.telegram_id ?? null;
  const list = await Promise.all(
    chats.map(async (c) => ({ id: c.id, title: c.title, kind: c.kind, link: c.link, joined: await hasJoined(c, tgId, log) })),
  );
  return { ok: list.every((c) => c.joined), chats: list };
}
