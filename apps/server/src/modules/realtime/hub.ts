import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { redis, redisSub } from '../../lib/redis.js';
import { authenticate } from '../auth/guard.js';
import { membership } from '../chat/service.js';
import { touchActivity } from '../users/activity.js';
import { publishToUser } from './bus.js';

/**
 * WebSocket endpoint. Each instance keeps only its own sockets and subscribes to `u:<id>` in Redis
 * for the users connected here, so any number of API instances can run behind the load balancer.
 */
const local = new Map<string, Set<WebSocket>>();
const PRESENCE_TTL_S = 75;

/** Presence key for this user + a 2-minute HyperLogLog bucket the admin dashboard counts as "online now". */
async function markOnline(userId: string) {
  const bucket = `onl:${Math.floor(Date.now() / 120_000)}`;
  await Promise.all([
    redis.set(`online:${userId}`, '1', 'EX', PRESENCE_TTL_S),
    redis.pfadd(bucket, userId),
    redis.expire(bucket, 600),
  ]);
}
const MAX_BUFFERED = 1 << 20;

function deliver(userId: string, payload: string) {
  const sockets = local.get(userId);
  if (!sockets) return;
  for (const ws of sockets) {
    if (ws.readyState !== ws.OPEN) continue;
    if (ws.bufferedAmount > MAX_BUFFERED) {
      ws.terminate(); // a stuck client must not grow server memory; it reconnects and resyncs over HTTP
      continue;
    }
    ws.send(payload);
    if (payload.startsWith('{"type":"session.revoked"')) ws.close(4001, 'revoked');
  }
}

async function attach(userId: string, ws: WebSocket) {
  let set = local.get(userId);
  if (!set) {
    set = new Set();
    local.set(userId, set);
    await redisSub.subscribe(`u:${userId}`);
  }
  set.add(ws);
  await markOnline(userId);
}

async function detach(userId: string, ws: WebSocket) {
  const set = local.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) {
    local.delete(userId);
    await redisSub.unsubscribe(`u:${userId}`);
    await redis.del(`online:${userId}`);
  }
}

export function connectedSockets(): number {
  let n = 0;
  for (const s of local.values()) n += s.size;
  return n;
}

export async function realtimeRoutes(app: FastifyInstance) {
  redisSub.on('message', (channel, message) => {
    if (channel.startsWith('u:')) deliver(channel.slice(2), message);
  });

  app.get(
    '/v1/ws',
    {
      websocket: true,
      preValidation: async (req) => {
        req.user = await authenticate(req);
      },
    },
    (socket, req) => {
      const userId = req.user.id;
      let alive = true;
      const typingSentAt = new Map<string, number>();

      attach(userId, socket).catch((e) => req.log.warn(e, 'ws attach failed'));
      socket.send(JSON.stringify({ type: 'hello', data: { userId } }));

      const heartbeat = setInterval(() => {
        if (!alive) {
          socket.terminate();
          return;
        }
        alive = false;
        socket.ping();
      }, 30_000);
      socket.on('pong', () => (alive = true));

      socket.on('message', async (raw) => {
        let msg: { type?: string; matchId?: string };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        try {
          if (msg.type === 'ping') {
            alive = true;
            await markOnline(userId);
            await touchActivity(userId);
            socket.send('{"type":"pong"}');
          } else if (msg.type === 'typing' && typeof msg.matchId === 'string' && /^[0-9a-f-]{36}$/.test(msg.matchId)) {
            const last = typingSentAt.get(msg.matchId) ?? 0;
            if (Date.now() - last < 2500) return;
            typingSentAt.set(msg.matchId, Date.now());
            const m = await membership(msg.matchId, userId);
            if (m.active) await publishToUser(m.peerId, { type: 'typing', data: { matchId: msg.matchId, userId } });
          }
        } catch (e) {
          req.log.debug(e, 'ws message failed');
        }
      });

      socket.on('close', () => {
        clearInterval(heartbeat);
        detach(userId, socket).catch(() => undefined);
      });
    },
  );
}
