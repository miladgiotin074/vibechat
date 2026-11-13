import { cookies } from 'next/headers';

export const COOKIE = 'admin_token';
export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4000';

export interface AdminInfo {
  id: string;
  username: string;
  displayName: string | null;
  role: 'superadmin' | 'moderator' | 'support';
}

export async function getToken(): Promise<string | null> {
  return (await cookies()).get(COOKIE)?.value ?? null;
}

/** The logged-in admin, or null when the cookie is missing, expired or revoked. */
export async function currentAdmin(): Promise<AdminInfo | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/admin/v1/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as AdminInfo;
  } catch {
    return null;
  }
}
