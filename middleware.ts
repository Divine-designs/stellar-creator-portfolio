import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Content-Security-Policy with per-request nonces (issue #1537).
 *
 * Threat closed: a missed sanitisation sink or a vulnerable dependency lets an
 * attacker inject a <script> into the page. With `script-src 'self'
 * 'nonce-…' 'strict-dynamic'` only scripts carrying the per-request nonce (or
 * scripts they load) execute, so injected inline scripts are blocked.
 *
 * Rollout: start in Report-Only so violations are collected at
 * /api/csp-report without breaking the app, then flip CSP_ENFORCE=true once the
 * report stream is clean.
 */

const CSP_ENFORCE = process.env.CSP_ENFORCE === 'true';

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Next.js injects inline styles; keep style-src permissive for now.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // Wallet extensions, Stripe and Sentry need explicit connect/frame entries.
    "connect-src 'self' https: wss:",
    "frame-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'report-uri /api/csp-report',
  ].join('; ');
}

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(
    CSP_ENFORCE ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    csp,
  );
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
