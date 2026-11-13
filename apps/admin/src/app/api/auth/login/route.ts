import { NextResponse, type NextRequest } from 'next/server';
import { BACKEND_URL, COOKIE } from '@/lib/session';

export async function POST(req: NextRequest) {
  const body = await req.text();
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/admin/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '' },
      body,
    });
  } catch {
    return NextResponse.json({ message: 'سرور در دسترس نیست' }, { status: 502 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(data, { status: res.status });

  const out = NextResponse.json({ admin: data.admin });
  out.cookies.set(COOKIE, data.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: 12 * 60 * 60,
  });
  return out;
}
