import { api } from '@/api/client';
import type { AuthResponse } from './types';

export async function authRequest(body: Record<string, unknown>): Promise<AuthResponse> {
  return api.post<AuthResponse>('/v1/verification/telegram', body);
}

/** Pending MTProto login id (sessionStorage — survives refresh, not another device). */
export const LOGIN_KEY = 'vibe.verify.login';