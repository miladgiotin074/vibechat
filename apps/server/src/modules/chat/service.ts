import { sql } from '../../lib/db.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { uuidv7 } from '../../lib/ids.js';
import { redis } from '../../lib/redis.js';
import { publicUrl } from '../../lib/storage.js';
import { loadCards, viewerOf, type CardDto } from '../users/cards.js';
import { bumpDailyCounter } from '../users/activity.js';
import { notify } from '../notifications/service.js';
import { publishToUser } from '../realtime/bus.js';

export interface MessageRow {
  match_id: string;
  id: string;
  sender_id: string;
  kind: 'text' | 'image' | 'system';
  body: string | null;
  media: { key: string; blurKey: string; width: number; height: number; color: string | null } | null;
  reply_to: string | null;
  client_id: string | null;
  created_at: Date;
  deleted_at: Date | null;
}

/**
 * Where a conversation started, shown at the top of the chat. `by` is who liked first (or who
 * sent the super like); a Wall conversation keeps the post it came from, as it read then.
 */
export type ChatOrigin =
  /** written to from their card in discovery (`by`: who wrote first) */
  | { kind: 'message'; by?: string }
  | { kind: 'wall'; postId?: string; author?: string; requester?: string; text?: string; category?: string }
  // from before the app was simplified: these conversations are still here, and still say where they began
  | { kind: 'like' | 'superlike'; by?: string }
  | { kind: 'random' };

export function messageDto(m: MessageRow) {
  const deleted = m.deleted_at != null;
  return {
    id: m.id,
    matchId: m.match_id,
    senderId: m.sender_id,
    kind: m.kind,
    body: deleted ? null : m.body,
    media:
      m.media && !deleted
        ? {
            url: publicUrl(`${m.media.key}/lg.webp`),
            thumb: publicUrl(`${m.media.key}/sm.webp`),
            blur: publicUrl(m.media.blurKey),
            width: m.media.width,
            height: m.media.height,
            color: m.media.color,
          }
        : null,
    replyTo: m.reply_to,
    clientId: m.client_id,
    deleted,
    createdAt: m.created_at.toISOString(),
  };
}

export type MessageDto = ReturnType<typeof messageDto>;

export interface Membership {
  peerId: string;
  active: boolean;
}

/** Who is on the other side of a match, cached because every message and typing event asks. */
export async function membership(matchId: string, userId: string): Promise<Membership> {
  const key = `mm:${matchId}:${userId}`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached) as Membership;
  const [row] = await sql<{ peer_id: string; status: string }[]>`
    SELECT mm.peer_id, m.status FROM match_members mm JOIN matches m ON m.id = mm.match_id
    WHERE mm.match_id = ${matchId} AND mm.user_id = ${userId}`;
  if (!row) throw notFound('گفتگو پیدا نشد');
  const value: Membership = { peerId: row.peer_id, active: row.status === 'active' };
  await redis.set(key, JSON.stringify(value), 'EX', 300);
  return value;
}

export async function forgetMembership(matchId: string, userIds: string[]) {
  await redis.del(...userIds.map((u) => `mm:${matchId}:${u}`));
}

interface ConversationRow {
  match_id: string;
  peer_id: string;
  unread_count: number;
  last_read_id: string;
  muted: boolean;
  sort_at: Date;
  created_at: Date;
  status: string;
  last_message_id: string | null;
  last_message_at: Date | null;
  last_message_preview: string | null;
  last_message_kind: string | null;
  last_sender_id: string | null;
  peer_last_read_id: string;
  /** 'random' only on legacy rows: the random chat is gone */
  source: 'swipe' | 'random' | 'wall';
  origin: ChatOrigin | null;
}

function conversationDto(row: ConversationRow, peer: CardDto | undefined) {
  return {
    id: row.match_id,
    peer: peer
      ? {
          id: peer.id,
          name: peer.name,
          age: peer.age,
          photo: peer.photos[0]?.thumb ?? null,
          online: peer.online,
          verified: peer.verified,
          telegramUsername: peer.telegramUsername,
        }
      : null,
    createdAt: row.created_at.toISOString(),
    origin: row.origin ?? (row.source === 'swipe' ? { kind: 'like' } : { kind: row.source }),
    active: row.status === 'active',
    lastMessage: row.last_message_id
      ? {
          id: row.last_message_id,
          kind: row.last_message_kind,
          preview: row.last_message_preview,
          senderId: row.last_sender_id,
          createdAt: row.last_message_at?.toISOString() ?? null,
        }
      : null,
    unread: row.unread_count,
    muted: row.muted,
    /** Highest message id the peer has read (for read ticks). */
    peerLastReadId: row.peer_last_read_id,
  };
}

export type ConversationDto = ReturnType<typeof conversationDto>;

const CONVERSATION_SELECT = sql`
  SELECT mm.match_id, mm.peer_id, mm.unread_count, mm.last_read_id, mm.muted, mm.sort_at,
         m.created_at, m.status, m.last_message_id, m.last_message_at, m.last_message_preview,
         m.last_message_kind, m.last_sender_id, pm.last_read_id AS peer_last_read_id, m.source, m.origin
  FROM match_members mm
  JOIN matches m ON m.id = mm.match_id
  JOIN match_members pm ON pm.match_id = mm.match_id AND pm.user_id = mm.peer_id`;

/**
 * The user's conversations, newest activity first. Matches where nobody ever wrote move to the
 * archive after a while (`archived`); a first message brings one back.
 */
export async function listConversations(userId: string, before: string | null, limit: number, archived = false) {
  const rows = await sql<ConversationRow[]>`
    ${CONVERSATION_SELECT}
    WHERE mm.user_id = ${userId} AND NOT mm.hidden AND mm.archived = ${archived}
      ${before ? sql`AND mm.sort_at < ${before}::timestamptz` : sql``}
    ORDER BY mm.sort_at DESC
    LIMIT ${limit}`;
  const viewer = await viewerOf(userId);
  const activePeers = new Set(rows.filter((r) => r.status === 'active').map((r) => r.peer_id));
  const cards = new Map((await loadCards(rows.map((r) => r.peer_id), viewer, { matchedWith: activePeers })).map((c) => [c.id, c]));
  // on the first page of the main list: how many are in the archive (for the «بایگانی» row)
  let archivedCount: number | undefined;
  if (!archived && !before) {
    const [a] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM match_members WHERE user_id = ${userId} AND NOT hidden AND archived`;
    archivedCount = a?.n ?? 0;
  }
  return {
    items: rows.map((r) => conversationDto(r, cards.get(r.peer_id))),
    nextBefore: rows.length === limit ? rows[rows.length - 1]!.sort_at.toISOString() : null,
    archivedCount,
  };
}

export async function getConversation(userId: string, matchId: string): Promise<ConversationDto> {
  const [row] = await sql<ConversationRow[]>`${CONVERSATION_SELECT} WHERE mm.user_id = ${userId} AND mm.match_id = ${matchId}`;
  if (!row) throw notFound('گفتگو پیدا نشد');
  const viewer = await viewerOf(userId);
  const [peer] = await loadCards([row.peer_id], viewer, {
    matchedWith: row.status === 'active' ? new Set([row.peer_id]) : new Set(),
  });
  return conversationDto(row, peer);
}

/**
 * Opens the conversation between two people, once (both may write at the same moment), and tells
 * them both. `ghost`: the writer is shadow-banned — the conversation is real only for them.
 */
export async function openConversation(
  a: string,
  b: string,
  source: 'message' | 'wall',
  origin: ChatOrigin,
  opts: { ghost?: boolean } = {},
): Promise<string | null> {
  const [userA, userB] = a < b ? [a, b] : [b, a];
  const id = uuidv7();
  const created = await sql.begin(async (tx) => {
    const [m] = await tx<{ id: string }[]>`
      INSERT INTO matches (id, user_a, user_b, source, origin) VALUES (${id}, ${userA}, ${userB}, ${source}, ${tx.json(origin as never)})
      ON CONFLICT (user_a, user_b) DO NOTHING RETURNING id`;
    if (!m) return null;
    await tx`
      INSERT INTO match_members (match_id, user_id, peer_id, hidden) VALUES (${id}, ${a}, ${b}, false), (${id}, ${b}, ${a}, ${!!opts.ghost})`;
    return m.id;
  });
  if (!created) return null;
  await bumpDailyCounter('matches');
  const told = opts.ghost ? [a] : [a, b];
  await Promise.all(told.map((u) => publishToUser(u, { type: 'conversation.new', data: { matchId: id } })));
  return created;
}

/**
 * The first time someone opens their match's profile, the match is told — once, inside the chat,
 * as a line only they see (a message from themselves that nobody else is shown, like a ghost one).
 * It does not touch the conversation's last message, so the viewer's list shows nothing.
 * Premium incognito looks quietly: the look still counts as the first one, so turning incognito
 * off later does not announce it after the fact.
 */
export async function noteProfileView(viewerId: string, ownerId: string): Promise<boolean> {
  const [first] = await sql<{ match_id: string }[]>`
    UPDATE match_members mm SET viewed_peer_at = now()
    FROM matches m
    WHERE mm.user_id = ${viewerId} AND mm.peer_id = ${ownerId} AND m.id = mm.match_id
      AND m.status = 'active' AND mm.viewed_peer_at IS NULL
    RETURNING mm.match_id`;
  if (!first) return false;
  const [viewer] = await sql<{ name: string | null; shadow_banned: boolean }[]>`
    SELECT name, shadow_banned FROM users WHERE id = ${viewerId}`;
  // a shadow-banned account reaches nobody, not even this way
  if (!viewer || viewer.shadow_banned) return false;
  const [row] = await sql<MessageRow[]>`
    INSERT INTO messages (match_id, sender_id, kind, body, ghost)
    VALUES (${first.match_id}, ${ownerId}, 'system', ${`${viewer.name ?? 'طرف مقابل'} پروفایلت رو دید 👀`}, true)
    RETURNING *`;
  await sql`
    UPDATE match_members SET unread_count = unread_count + 1, sort_at = now(), hidden = false, archived = false
    WHERE match_id = ${first.match_id} AND user_id = ${ownerId}`;
  await publishToUser(ownerId, { type: 'message.new', data: messageDto(row!) });
  return true;
}
