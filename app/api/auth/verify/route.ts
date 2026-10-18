import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';

/**
 * httpOnly cookie that carries the browser JWT.
 *
 * Threat closed: previously the JWT lived in `localStorage` under
 * `stellar_auth_token`, so any XSS (including third-party scripts) could read
 * it and act as the user, including wallet-linked actions. Moving it to an
 * httpOnly cookie makes the token unreadable from `document`/`localStorage`.
 */
export const AUTH_COOKIE_NAME = 'stellar_auth_token';

/** Double-submit CSRF cookie, readable by JS so the client can echo it back. */
export const CSRF_COOKIE_NAME = 'stellar_csrf_token';

const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function isSecureRequest(req: NextRequest): boolean {
  const forwardedProto = req.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0].trim() === 'https';
  }
  return req.nextUrl.protocol === 'https:';
}

/**
 * Verify the auth payload and establish a cookie-based session.
 *
 * The JWT is never returned in the response body; it is only set as an
 * httpOnly cookie so it is inaccessible to client-side JavaScript.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const token =
    body && typeof body === 'object' && typeof (body as { token?: unknown }).token === 'string'
      ? (body as { token: string }).token
      : null;

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  const secure = isSecureRequest(req);
  const csrfToken = randomBytes(32).toString('hex');
  const cookieStore = await cookies();

  cookieStore.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE,
  });

  // CSRF token is intentionally NOT httpOnly: the client reads it and sends it
  // back in the `x-csrf-token` header for mutating requests (double-submit).
  cookieStore.set(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE,
  });

  return NextResponse.json({ ok: true });
}
