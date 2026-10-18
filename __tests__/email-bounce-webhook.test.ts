import { createHmac } from 'crypto';

/**
 * Regression tests for issue #1522: the email bounce webhook must verify
 * provider signatures and reject unsigned requests with 401.
 *
 * These tests exercise the route handler directly (no HTTP server) so they
 * stay fast and deterministic. They reproduce the attack (unsigned request
 * suppressing an address) before the fix and assert it is rejected after.
 */

const ORIGINAL_ENV = { ...process.env };

function signResend(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function signPostmark(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64');
}

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/webhooks/email/bounce', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('/api/webhooks/email/bounce signature verification', () => {
  let POST: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    process.env.RESEND_WEBHOOK_SECRET = 'test-resend-secret';
    process.env.POSTMARK_WEBHOOK_SECRET = 'test-postmark-secret';
    // Import after env is set so the module reads the secrets.
    ({ POST } = await import('@/app/api/webhooks/email/bounce/route'));
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('rejects an unsigned request with 401 (attack reproduction)', async () => {
    const res = await POST(
      makeRequest({ type: 'email.bounced', data: { to: ['victim@example.com'] } }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects a request with an invalid Resend signature', async () => {
    const body = { type: 'email.bounced', data: { to: ['victim@example.com'] } };
    const res = await POST(
      makeRequest(body, {
        'svix-id': 'msg_1',
        'svix-timestamp': String(Math.floor(Date.now() / 1000)),
        'svix-signature': 'v1,deadbeef',
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects an expired Resend signature', async () => {
    const body = { type: 'email.bounced', data: { to: ['victim@example.com'] } };
    const timestamp = String(Math.floor(Date.now() / 1000) - 60 * 60);
    const id = 'msg_expired';
    const signed = `v1,${signResend(`${id}.${timestamp}.${JSON.stringify(body)}`, 'test-resend-secret')}`;
    const res = await POST(
      makeRequest(body, {
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': signed,
      }),
    );
    expect(res.status).toBe(401);
  });

  it('accepts a valid Resend signature', async () => {
    const body = { type: 'email.bounced', data: { to: ['victim@example.com'] } };
    const id = 'msg_valid';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signed = `v1,${signResend(`${id}.${timestamp}.${JSON.stringify(body)}`, 'test-resend-secret')}`;
    const res = await POST(
      makeRequest(body, {
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': signed,
      }),
    );
    expect(res.status).toBeLessThan(400);
  });

  it('rejects a Postmark request with an invalid HMAC header', async () => {
    const body = { RecordType: 'Bounce', Email: 'victim@example.com' };
    const res = await POST(
      makeRequest(body, { 'x-postmark-signature': 'invalid' }),
    );
    expect(res.status).toBe(401);
  });

  it('accepts a valid Postmark HMAC signature', async () => {
    const body = { RecordType: 'Bounce', Email: 'victim@example.com' };
    const signature = signPostmark(JSON.stringify(body), 'test-postmark-secret');
    const res = await POST(
      makeRequest(body, { 'x-postmark-signature': signature }),
    );
    expect(res.status).toBeLessThan(400);
  });

  it('rejects an unknown provider payload by default', async () => {
    const res = await POST(makeRequest({ foo: 'bar' }));
    expect(res.status).toBe(401);
  });
});
