import { randomBytes } from 'node:crypto';

/**
 * UUIDv7: time-ordered, so new rows land at the end of B-tree indexes instead of scattering
 * across them (much better insert locality than v4 at high write rates).
 */
export function uuidv7(): string {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** URL-safe random token (refresh tokens, login ids). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Short, readable invite code (no 0/o/1/l/i): 8 chars ≈ 40 bits, collisions retried by the caller. */
export function inviteCode(length = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return out;
}
