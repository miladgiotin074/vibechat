import { NextResponse, type NextRequest } from 'next/server';
import { BACKEND_URL, getToken } from '@/lib/session';

/**
 * The browser never sees the admin token: it calls /api/backend/..., and this handler forwards
 * to the API with the token from the httpOnly cookie. Only admin and public meta paths pass.
 */
async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = path.join('/');
  if (!target.startsWith('admin/v1/') && target !== 'v1/meta') {
    return NextResponse.json({ message: 'not allowed' }, { status: 404 });
  }
  const token = await getToken();
  if (!token && target.startsWith('admin/')) return NextResponse.json({ code: 'unauthorized' }, { status: 401 });

  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  // a body (and its JSON content type) only when there is one: the API refuses an empty JSON body,
  // which is what a DELETE would otherwise carry
  const body = req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : '';
  if (body) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/${target}${req.nextUrl.search}`, {
      method: req.method,
      headers,
      body: body || undefined,
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ message: 'سرور در دسترس نیست' }, { status: 502 });
  }
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
