import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { jwtVerify, SignJWT } from 'jose';
import { env } from '../config.js';

const userKey = new TextEncoder().encode(env.JWT_SECRET);
const adminKey = new TextEncoder().encode(env.ADMIN_JWT_SECRET);
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface UserClaims {
  sub: string;
  sid: string;
}

export async function signAccessToken(userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setAudience('app')
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_MIN}m`)
    .sign(userKey);
}

export async function verifyAccessToken(token: string): Promise<UserClaims | null> {
  try {
    const { payload } = await jwtVerify(token, userKey, { audience: 'app', algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { sub: payload.sub, sid: payload.sid };
  } catch {
    return null;
  }
}

export interface AdminClaims {
  sub: string;
  role: 'superadmin' | 'moderator' | 'support';
}

export async function signAdminToken(adminId: string, role: AdminClaims['role']): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(adminId)
    .setAudience('admin')
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(adminKey);
}

export async function verifyAdminToken(token: string): Promise<AdminClaims | null> {
  try {
    const { payload } = await jwtVerify(token, adminKey, { audience: 'admin', algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string') return null;
    const role = payload.role;
    if (role !== 'superadmin' && role !== 'moderator' && role !== 'support') return null;
    return { sub: payload.sub, role };
  } catch {
    return null;
  }
}

/** Refresh tokens are stored only as SHA-256 hashes. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}
