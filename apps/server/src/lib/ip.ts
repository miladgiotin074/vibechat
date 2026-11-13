import type { FastifyRequest } from 'fastify';
import { env } from '../config.js';

/** Real client IP: Cloudflare's header when the API sits directly behind Cloudflare, else the trusted proxy chain. */
export function clientIp(req: FastifyRequest): string {
  if (env.BEHIND_CLOUDFLARE) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.length <= 45) return cf;
  }
  return req.ip;
}
