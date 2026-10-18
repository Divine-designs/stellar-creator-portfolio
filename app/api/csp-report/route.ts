import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * CSP violation report sink (issue #1537).
 *
 * Receives both the legacy `application/csp-report` and the Reporting API
 * `application/reports+json` payloads. Reports are rate limited per client IP
 * and logged without any secrets or PII.
 */

const WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 30;

// Simple in-memory sliding window; sufficient for a single-instance report sink.
const hits = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_REPORTS_PER_WINDOW;
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

export async function POST(request: NextRequest) {
  if (isRateLimited(clientIp(request))) {
    return new NextResponse(null, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // Normalise both report shapes into a compact, PII-free log line.
  const reports = Array.isArray(body) ? body : [body];
  for (const report of reports) {
    const r = (report as { 'csp-report'?: Record<string, unknown> })['csp-report'] ??
      (report as { body?: Record<string, unknown> }).body ??
      {};
    console.warn('[csp-report]', {
      directive: r['violated-directive'] ?? r['effectiveDirective'],
      blocked: r['blocked-uri'] ?? r['blockedURL'],
      document: r['document-uri'] ?? r['documentURL'],
    });
  }

  return new NextResponse(null, { status: 204 });
}
