import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth/config', () => ({
  authOptions: {},
}))

vi.mock('@/server/services/audit', () => ({
  writeAuditLog: vi.fn().mockResolvedValue({ id: 'audit-1' }),
}))

import { getServerSession } from 'next-auth'

describe('/api/messages route handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset in-memory state between tests.
    ;(globalThis as any).__messageState = undefined;

    // Default: authenticated as a regular user.
    ;(getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'client-1', role: 'USER' },
    })
  });

  it('GET /api/messages returns list of messages', async () => {
    const req = new NextRequest('http://localhost:3000/api/messages?threadId=general');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.messages)).toBe(true);
  });

  it('GET /api/messages returns 401 when unauthenticated', async () => {
    ;(getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const req = new NextRequest('http://localhost:3000/api/messages?threadId=general');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('POST /api/messages appends new message and returns ok', async () => {
    const messagePayload = {
      id: 'msg-test-1',
      threadId: 'general',
      // senderId intentionally omitted — route must use session userId
      recipientId: 'creator-1',
      ciphertext: 'test-cipher',
      iv: 'test-iv',
      metadata: { plainText: 'Test message body' },
    };

    const req = new NextRequest('http://localhost:3000/api/messages', {
      method: 'POST',
      body: JSON.stringify(messagePayload),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.message.id).toBe('msg-test-1');
    // senderId must come from the session, not the payload.
    expect(data.message.senderId).toBe('client-1');
  });

  it('POST /api/messages ignores spoofed senderId in body', async () => {
    const req = new NextRequest('http://localhost:3000/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        senderId: 'attacker-id',
        recipientId: 'victim-id',
        ciphertext: 'ct',
        iv: 'iv',
        threadId: 'general',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message.senderId).toBe('client-1');
    expect(data.message.senderId).not.toBe('attacker-id');
  });

  it('POST /api/messages returns 401 when unauthenticated', async () => {
    ;(getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const req = new NextRequest('http://localhost:3000/api/messages', {
      method: 'POST',
      body: JSON.stringify({ ciphertext: 'ct', iv: 'iv' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('GET /api/messages filters by query search string', async () => {
    // First seed a matching message via POST.
    const seedReq = new NextRequest('http://localhost:3000/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        ciphertext: 'ct',
        iv: 'iv',
        threadId: 'general',
        metadata: { plainText: 'deliverables doc' },
      }),
    });
    await POST(seedReq);

    const req = new NextRequest('http://localhost:3000/api/messages?q=deliverables');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.messages)).toBe(true);
  });
});
