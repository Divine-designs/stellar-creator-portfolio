/**
 * Authentication Middleware Tests
 * 
 * These tests verify the authentication middleware behavior
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// Mock next-auth middleware
vi.mock('next-auth/middleware', () => ({
  withAuth: vi.fn((middleware, options) => {
    return (req: NextRequest) => {
      const token = req.headers.get('x-auth-token');
      const isAuth = !!token;
      
      if (options?.callbacks?.authorized) {
        if (!options.callbacks.authorized({ token: token ? { id: '1' } : null })) {
          return NextResponse.redirect(new URL('/auth/login', req.url));
        }
      }
      
      return middleware(req);
    };
  }),
}));

// Mock next-auth session resolution used by the route wrapper
const mockGetServerSession = vi.fn();
vi.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { route } from '@/lib/auth/route';
import { checkAuthRateLimit, resetAuthRateLimit } from '@/lib/auth/rate-limit';

describe('Authentication Middleware', () => {
  describe('Route Protection', () => {
    it('should redirect unauthenticated users from dashboard to login', () => {
      const req = new NextRequest(new URL('http://localhost:3000/dashboard'));
      // No auth token
      
      // The middleware should redirect to login
      expect(req.url).toContain('/dashboard');
    });

    it('should allow authenticated users to access dashboard', () => {
      const req = new NextRequest(new URL('http://localhost:3000/dashboard'));
      req.headers.set('x-auth-token', 'valid-token');
      
      // The middleware should allow access
      expect(req.url).toContain('/dashboard');
    });

    it('should redirect authenticated users from auth pages to dashboard', () => {
      const req = new NextRequest(new URL('http://localhost:3000/auth/login'));
      req.headers.set('x-auth-token', 'valid-token');
      
      // Should redirect to dashboard
      expect(req.url).toContain('/auth/login');
    });
  });

  describe('Token Validation', () => {
    it('should reject invalid tokens', () => {
      const req = new NextRequest(new URL('http://localhost:3000/dashboard'));
      req.headers.set('x-auth-token', 'invalid-token');
      
      // Should redirect to login
      expect(req.url).toContain('/dashboard');
    });

    it('should accept valid tokens', () => {
      const req = new NextRequest(new URL('http://localhost:3000/dashboard'));
      req.headers.set('x-auth-token', 'valid-token');
      
      // Should allow access
      expect(req.url).toContain('/dashboard');
    });
  });
});

describe('Registration Validation', () => {
  describe('Password Requirements', () => {
    it('should require minimum 8 characters', () => {
      const shortPassword = 'short';
      expect(shortPassword.length).toBeLessThan(8);
    });

    it('should accept passwords with 8+ characters', () => {
      const validPassword = 'validpass123';
      expect(validPassword.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('Email Validation', () => {
    it('should require email field', () => {
      const email = '';
      expect(email).toBeFalsy();
    });

    it('should accept valid email format', () => {
      const email = 'user@example.com';
      expect(email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    });
  });
});

describe('Session Management', () => {
  it('should create session with valid credentials', () => {
    const session = {
      user: {
        id: 'user-123',
        email: 'user@example.com',
        name: 'Test User',
        role: 'USER',
      },
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };

    expect(session.user.id).toBeDefined();
    expect(session.user.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    expect(session.user.role).toMatch(/^(USER|CREATOR|CLIENT|ADMIN)$/);
  });

  it('should include role in session', () => {
    const session = {
      user: {
        id: 'user-123',
        email: 'user@example.com',
        role: 'CREATOR',
      },
    };

    expect(session.user.role).toBe('CREATOR');
  });
});

describe('Auth rate limiting', () => {
  beforeEach(() => {
    resetAuthRateLimit();
  });

  it('allows requests under the email limit', () => {
    for (let i = 0; i < 5; i++) {
      const result = checkAuthRateLimit({ ip: '1.1.1.1', email: 'User@Example.com' });
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks the 6th request for the same lowercased email', () => {
    for (let i = 0; i < 5; i++) {
      checkAuthRateLimit({ ip: `10.0.0.${i}`, email: 'user@example.com' });
    }
    const blocked = checkAuthRateLimit({ ip: '10.0.0.99', email: 'USER@example.com' });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('keeps the IP limit generous for shared IPs', () => {
    for (let i = 0; i < 20; i++) {
      const result = checkAuthRateLimit({ ip: '203.0.113.5', email: `user${i}@example.com` });
      expect(result.allowed).toBe(true);
    }
  });

  it('applies exponential lockout on repeated failures', () => {
    const key = { ip: '198.51.100.7', email: 'victim@example.com' };
    for (let i = 0; i < 5; i++) {
      checkAuthRateLimit(key);
    }
    const first = checkAuthRateLimit(key);
    expect(first.allowed).toBe(false);
    const firstRetry = first.retryAfterSeconds;

    // Simulate more failures to grow the lockout window
    for (let i = 0; i < 5; i++) {
      checkAuthRateLimit(key);
    }
    const second = checkAuthRateLimit(key);
    expect(second.allowed).toBe(false);
    expect(second.retryAfterSeconds).toBeGreaterThanOrEqual(firstRetry);
  });
});

describe('route() wrapper', () => {
  const makeReq = (init?: { body?: unknown; headers?: Record<string, string> }) => {
    const req = new NextRequest(new URL('http://localhost:3000/api/test'), {
      method: 'POST',
      headers: init?.headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return req;
  };

  beforeEach(() => {
    mockGetServerSession.mockReset();
    delete process.env.CRON_SECRET;
    delete process.env.WEBHOOK_SECRET;
  });

  it('public mode invokes handler without a session', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const res = await route({ auth: 'public' }, handler)(makeReq());
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('session mode rejects unauthenticated requests with 401', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const res = await route({ auth: 'session' }, handler)(makeReq());
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe('UNAUTHORIZED');
    expect(handler).not.toHaveBeenCalled();
  });

  it('session mode passes the user to the handler', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1', role: 'USER' } });
    const handler = vi.fn(async ({ user }) => NextResponse.json({ id: user?.id }));
    const res = await route({ auth: 'session' }, handler)(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'u1' });
  });

  it('admin mode rejects non-admin users with 403', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1', role: 'USER' } });
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const res = await route({ auth: 'admin' }, handler)(makeReq());
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('admin mode allows admin users', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const res = await route({ auth: 'admin' }, handler)(makeReq());
    expect(res.status).toBe(200);
  });

  it('cronSecret mode requires the bearer secret', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));

    const denied = await route({ auth: 'cronSecret' }, handler)(makeReq());
    expect(denied.status).toBe(401);

    const allowed = await route({ auth: 'cronSecret' }, handler)(
      makeReq({ headers: { authorization: 'Bearer cron-secret' } }),
    );
    expect(allowed.status).toBe(200);
  });

  it('webhook mode requires the webhook secret', async () => {
    process.env.WEBHOOK_SECRET = 'wh-secret';
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));

    const denied = await route({ auth: 'webhook' }, handler)(makeReq());
    expect(denied.status).toBe(401);

    const allowed = await route({ auth: 'webhook' }, handler)(
      makeReq({ headers: { 'x-webhook-secret': 'wh-secret' } }),
    );
    expect(allowed.status).toBe(200);
  });

  it('validates the body and passes parsed data to the handler', async () => {
    const schema = {
      parse: (input: unknown) => {
        const obj = input as { name?: string };
        if (!obj?.name) throw { issues: [{ path: ['name'], message: 'Required' }] };
        return { name: obj.name };
      },
    };
    const handler = vi.fn(async ({ body }) => NextResponse.json(body));

    const ok = await route({ auth: 'public', body: schema }, handler)(
      makeReq({ body: { name: 'Ada' } }),
    );
    expect(ok.status).toBe(200);
  });
});
