/**
 * Unified in-memory rate limiter for auth endpoints.
 *
 * Threat closed: unthrottled registration and password login enable
 * credential stuffing and account enumeration. We throttle by IP (generous,
 * to tolerate shared office / mobile-NAT IPs) and by lowercased email
 * (strict), and apply an exponential lockout on repeated login failures.
 *
 * NOTE: this is process-local state. In a multi-instance deployment swap the
 * backing store for a shared one (e.g. Redis) behind the same interface.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may retry (0 when allowed). */
  retryAfter: number;
  remaining: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 15 * 60 * 1000;

// Generous IP limit for shared IPs; strict email limit.
const IP_LIMIT = 30;
const EMAIL_LIMIT = 5;

const ipBuckets = new Map<string, Bucket>();
const emailBuckets = new Map<string, Bucket>();

// Exponential lockout state for repeated credentials sign-in failures.
interface FailureState {
  failures: number;
  lockedUntil: number;
}
const failureStates = new Map<string, FailureState>();

const BASE_LOCKOUT_MS = 30 * 1000;
const MAX_LOCKOUT_MS = 15 * 60 * 1000;

function now(): number {
  return Date.now();
}

function hit(map: Map<string, Bucket>, key: string, limit: number): RateLimitResult {
  const t = now();
  const existing = map.get(key);

  if (!existing || existing.resetAt <= t) {
    map.set(key, { count: 1, resetAt: t + WINDOW_MS });
    return { allowed: true, retryAfter: 0, remaining: limit - 1 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((existing.resetAt - t) / 1000)),
      remaining: 0,
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfter: 0, remaining: limit - existing.count };
}

/** Normalize an email for keying (never log the raw value). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Extract a best-effort client IP from request headers. */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Check and consume a rate-limit slot for registration.
 * Applies both the IP and (when present) the email limit.
 */
export function checkRegisterLimit(ip: string, email?: string | null): RateLimitResult {
  const ipResult = hit(ipBuckets, `ip:${ip}`, IP_LIMIT);
  if (!ipResult.allowed) return ipResult;

  if (email) {
    const emailResult = hit(emailBuckets, `email:${normalizeEmail(email)}`, EMAIL_LIMIT);
    if (!emailResult.allowed) return emailResult;
    return emailResult;
  }

  return ipResult;
}

/**
 * Check whether a credentials sign-in attempt is currently locked out.
 * Returns allowed=false with retryAfter while a lockout is active.
 */
export function checkLoginLockout(ip: string, email?: string | null): RateLimitResult {
  const t = now();
  const keys = [`ip:${ip}`];
  if (email) keys.push(`email:${normalizeEmail(email)}`);

  let retryAfter = 0;
  for (const key of keys) {
    const state = failureStates.get(key);
    if (state && state.lockedUntil > t) {
      retryAfter = Math.max(retryAfter, Math.ceil((state.lockedUntil - t) / 1000));
    }
  }

  if (retryAfter > 0) {
    return { allowed: false, retryAfter, remaining: 0 };
  }
  return { allowed: true, retryAfter: 0, remaining: 1 };
}

/** Record a failed credentials sign-in and apply exponential lockout. */
export function recordLoginFailure(ip: string, email?: string | null): void {
  const t = now();
  const keys = [`ip:${ip}`];
  if (email) keys.push(`email:${normalizeEmail(email)}`);

  for (const key of keys) {
    const state = failureStates.get(key) ?? { failures: 0, lockedUntil: 0 };
    state.failures += 1;
    // Exponential backoff: 30s, 60s, 120s, ... capped at 15min.
    const lockout = Math.min(BASE_LOCKOUT_MS * 2 ** (state.failures - 1), MAX_LOCKOUT_MS);
    state.lockedUntil = t + lockout;
    failureStates.set(key, state);
  }
}

/** Clear failure state after a successful sign-in. */
export function recordLoginSuccess(ip: string, email?: string | null): void {
  const keys = [`ip:${ip}`];
  if (email) keys.push(`email:${normalizeEmail(email)}`);
  for (const key of keys) {
    failureStates.delete(key);
  }
}

/** Test helper: reset all limiter state. */
export function resetRateLimits(): void {
  ipBuckets.clear();
  emailBuckets.clear();
  failureStates.clear();
}
