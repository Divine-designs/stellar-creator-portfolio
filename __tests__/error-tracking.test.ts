/**
 * Error tracking tests
 * Verifies centralized error tracking functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { errorTracker } from '@/lib/error-tracking';

describe('Error Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('errorTracker', () => {
    it('should generate unique error IDs', () => {
      const id1 = (errorTracker as any).generateErrorId();
      const id2 = (errorTracker as any).generateErrorId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^err_/);
    });

    it('should generate unique session IDs', () => {
      const sessionId = errorTracker.getSessionId();
      expect(sessionId).toMatch(/^sess_/);
    });

    it('should build error report with all fields', () => {
      const error = new Error('Test error');
      const context = {
        userId: 'user123',
        component: 'TestComponent',
        action: 'testAction',
        metadata: { key: 'value' },
      };

      const report = (errorTracker as any).buildErrorReport(error, context);

      expect(report).toHaveProperty('id');
      expect(report).toHaveProperty('timestamp');
      expect(report.level).toBe('error');
      expect(report.message).toBe('Test error');
      expect(report.stack).toBeDefined();
      expect(report.context.userId).toBe('user123');
      expect(report.context.component).toBe('TestComponent');
      expect(report.context.action).toBe('testAction');
      expect(report.context.sessionId).toBeDefined();
    });

    it('should handle string errors', async () => {
      const report = (errorTracker as any).buildErrorReport('String error', {});
      expect(report.message).toBe('String error');
      expect(report.level).toBe('error');
    });

    it('should capture error with context', async () => {
      const error = new Error('Test error');
      const context = {
        userId: 'user123',
        component: 'TestComponent',
      };

      const errorId = await errorTracker.captureError(error, context);
      expect(errorId).toMatch(/^err_/);
    });

    it('should capture warning', async () => {
      const warningId = await errorTracker.captureWarning('Test warning', {
        component: 'TestComponent',
      });
      expect(warningId).toMatch(/^err_/);
    });

    it('should set user context', () => {
      expect(() => {
        errorTracker.setUserContext('user123', 'user@example.com');
      }).not.toThrow();
    });

    it('should clear user context', () => {
      expect(() => {
        errorTracker.clearUserContext();
      }).not.toThrow();
    });

    it('should add breadcrumb', () => {
      expect(() => {
        errorTracker.addBreadcrumb('Test breadcrumb', 'user-action', 'info');
      }).not.toThrow();
    });
  });

  describe('Error Report Format', () => {
    it('should have required fields', async () => {
      const error = new Error('Test error');
      const report = (errorTracker as any).buildErrorReport(error, {});

      expect(report).toHaveProperty('id');
      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('level');
      expect(report).toHaveProperty('message');
      expect(report).toHaveProperty('context');
      expect(report).toHaveProperty('environment');
    });

    it('should include session ID in context', async () => {
      const error = new Error('Test error');
      const report = (errorTracker as any).buildErrorReport(error, {});

      expect(report.context.sessionId).toBeDefined();
      expect(report.context.sessionId).toMatch(/^sess_/);
    });

    it('should preserve custom metadata', async () => {
      const error = new Error('Test error');
      const context = {
        metadata: {
          customField: 'customValue',
          amount: 100,
        },
      };

      const report = (errorTracker as any).buildErrorReport(error, context);
      expect(report.context.metadata).toEqual(context.metadata);
    });
  });

  describe('Error Tracking Disabled', () => {
    it('should handle disabled tracking gracefully', async () => {
      const originalEnv = process.env.NEXT_PUBLIC_ENABLE_ERROR_TRACKING;
      process.env.NEXT_PUBLIC_ENABLE_ERROR_TRACKING = 'false';

      const error = new Error('Test error');
      const errorId = await errorTracker.captureError(error);

      expect(errorId).toBe('');

      process.env.NEXT_PUBLIC_ENABLE_ERROR_TRACKING = originalEnv;
    });
  });
});

describe('Error Handling Integration', () => {
  it('should format API errors with context', async () => {
    const { formatApiError } = await import('@/lib/error-handling');

    const error = {
      code: 'VALIDATION_ERROR',
      message: 'Invalid input',
      fieldErrors: [
        { field: 'email', message: 'Invalid email' },
      ],
    };

    const formatted = formatApiError(error);

    expect(formatted.code).toBe('VALIDATION_ERROR');
    expect(formatted.message).toBe('Invalid input');
    expect(formatted.fieldErrors.email).toBe('Invalid email');
  });

  it('should handle string errors', async () => {
    const { formatApiError } = await import('@/lib/error-handling');

    const formatted = formatApiError('String error');

    expect(formatted.code).toBe('UNKNOWN_ERROR');
    expect(formatted.message).toBe('String error');
  });
});

describe('API Tracking Wrapper', () => {
  it('should wrap fetch calls', async () => {
    const { fetchWithTracking } = await import('@/lib/api-with-tracking');

    // Mock fetch
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: 'test' }),
      })
    );

    const result = await fetchWithTracking('/api/test', {
      context: { component: 'TestComponent' },
    });

    expect(result).toEqual({ data: 'test' });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('should handle fetch errors', async () => {
    const { fetchWithTracking } = await import('@/lib/api-with-tracking');

    global.fetch = vi.fn(() =>
      Promise.reject(new Error('Network error'))
    );

    await expect(
      fetchWithTracking('/api/test', {
        context: { component: 'TestComponent' },
      })
    ).rejects.toThrow('Network error');
  });

  it('should handle fetch timeouts', async () => {
    const { fetchWithTracking } = await import('@/lib/api-with-tracking');

    // A request that never completes on its own; like the real fetch, it
    // rejects once the caller's AbortSignal fires.
    global.fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        })
    );

    await expect(
      fetchWithTracking('/api/test', {
        context: { component: 'TestComponent' },
        timeout: 100,
      })
    ).rejects.toThrow();
  });
});

describe('Error Tracking Hooks', () => {
  it('should export useErrorTracking hooks', async () => {
    const {
      useInitializeErrorTracking,
      useSetErrorTrackingUser,
      useCaptureError,
      useAddBreadcrumb,
    } = await import('@/hooks/useErrorTracking');

    expect(typeof useInitializeErrorTracking).toBe('function');
    expect(typeof useSetErrorTrackingUser).toBe('function');
    expect(typeof useCaptureError).toBe('function');
    expect(typeof useAddBreadcrumb).toBe('function');
  });
});

describe('Error Log Flood Guard', () => {
  const MAX_PAYLOAD_BYTES = 8 * 1024;

  it('should reject payloads larger than 8KB', async () => {
    const { isPayloadWithinLimit } = await import('@/lib/error-log-guard');

    const small = JSON.stringify({ message: 'boom' });
    const huge = JSON.stringify({ message: 'x'.repeat(MAX_PAYLOAD_BYTES + 1) });

    expect(isPayloadWithinLimit(small)).toBe(true);
    expect(isPayloadWithinLimit(huge)).toBe(false);
  });

  it('should throttle a flood of requests from the same client', async () => {
    const { createRateLimiter } = await import('@/lib/error-log-guard');

    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
    const key = 'flood-client';

    const results = Array.from({ length: 20 }, () => limiter.check(key));
    const allowed = results.filter((r) => r.allowed).length;

    expect(allowed).toBe(5);
    expect(results[results.length - 1].allowed).toBe(false);
  });

  it('should dedupe identical stack hashes within a minute', async () => {
    const { createStackDeduper } = await import('@/lib/error-log-guard');

    const deduper = createStackDeduper({ windowMs: 60_000 });
    const stack = 'Error: boom\n    at foo (bar.ts:1:1)';

    expect(deduper.shouldLog(stack)).toBe(true);
    expect(deduper.shouldLog(stack)).toBe(false);
  });

  it('should redact emails, tokens and Stellar secrets', async () => {
    const { redactSensitive } = await import('@/lib/error-log-guard');

    const secret = 'S' + 'A'.repeat(55);
    const input = `user@example.com token=abc123 secret=${secret}`;
    const output = redactSensitive(input);

    expect(output).not.toContain('user@example.com');
    expect(output).not.toContain('abc123');
    expect(output).not.toContain(secret);
  });
});
