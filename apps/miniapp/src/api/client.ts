import type { ApiErrorBody, AuthResponse } from './types';

/** Production builds set VITE_API_URL (https://api.<domain>); in development the Vite proxy serves /v1 on the same origin. */
export const API_URL = (import.meta.env.VITE_API_URL || location.origin).replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let tokens: Tokens | null = null;
/** How to get a brand new session when the refresh token is gone (log in again with init data). */
let relogin: (() => Promise<AuthResponse>) | null = null;
let refreshing: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function setSession(auth: Pick<AuthResponse, 'accessToken' | 'refreshToken' | 'expiresIn'>) {
  tokens = { accessToken: auth.accessToken, refreshToken: auth.refreshToken, expiresAt: Date.now() + auth.expiresIn * 1000 };
  listeners.forEach((l) => l());
}

export function setRelogin(fn: () => Promise<AuthResponse>) {
  relogin = fn;
}

export const accessToken = () => tokens?.accessToken ?? null;

/** Called when the token changes (the socket reconnects with the new one). */
export function onTokenChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function doRefresh(): Promise<void> {
  if (tokens) {
    const res = await fetch(API_URL + '/v1/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    }).catch(() => null);
    if (res?.ok) {
      setSession(await res.json());
      return;
    }
  }
  if (!relogin) throw new ApiError(401, 'unauthorized', 'لطفاً اپ را دوباره باز کنید');
  setSession(await relogin());
}

export async function ensureFreshToken() {
  if (tokens && tokens.expiresAt - Date.now() > 60_000) return;
  refreshing ??= doRefresh().finally(() => (refreshing = null));
  await refreshing;
}

const OFFLINE = 'اتصال اینترنت برقرار نیست. دوباره تلاش کن.';

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { auth?: boolean; retry?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const auth = opts.auth ?? true;
  if (auth) await ensureFreshToken();
  const headers: Record<string, string> = {};
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['content-type'] = 'application/json';
  if (auth && tokens) headers.authorization = 'Bearer ' + tokens.accessToken;
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network', OFFLINE);
  }
  if (res.status === 401 && auth && opts.retry !== false) {
    tokens = tokens ? { ...tokens, expiresAt: 0 } : null;
    refreshing ??= doRefresh().finally(() => (refreshing = null));
    await refreshing;
    return request<T>(method, path, body, { ...opts, retry: false });
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(res.status, err.code ?? 'error', err.message ?? 'خطایی رخ داد. دوباره تلاش کن.', err.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
  /** Replaces a file that already exists (PUT with multipart). */
  uploadPut: <T>(path: string, form: FormData) => request<T>('PUT', path, form),
};

export function wsUrl(): string {
  return API_URL.replace(/^http/, 'ws') + '/v1/ws?access_token=' + encodeURIComponent(tokens?.accessToken ?? '');
}

export const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : 'خطایی رخ داد. دوباره تلاش کن.');
