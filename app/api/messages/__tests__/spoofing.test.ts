/**
 * Regression tests for the message identity-spoofing vulnerability.
 *
 * Attack vectors tested
 * ─────────────────────
 * 1. senderId spoofing   — client supplies a different user's ID in `senderId`;
 *                          the stored message must use the session user ID.
 * 2. read-receipt forgery — client supplies a different user's ID in `userId`;
 *                          the `readBy` list must contain only the session user.
 * 3. moderatorId spoofing — client supplies a fake `moderatorId`; the broadcast
 *                          must carry the real session user ID.
 * 4. non-admin moderate   — a USER-role caller cannot moderate/delete messages.
 * 5. non-member typing    — a user not in a thread cannot broadcast typing events.
 * 6. non-member read-receipt — a user not in a thread cannot mark messages read.
 * 7. Unauthenticated POST — no session → 401.
 * 8. Unauthenticated GET  — no session → 401.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import {
  handleMessageEvent,
  getState,
  type AuthContext,
  type ServerState,
} from '../message-handler'
import { GET, POST } from '../route'

// ── Mock next-auth ────────────────────────────────────────────────────────────

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth/config', () => ({
  authOptions: {},
}))

// Audit log — fire-and-forget; we just verify it was called where expected.
vi.mock('@/server/services/audit', () => ({
  writeAuditLog: vi.fn().mockResolvedValue({ id: 'audit-1' }),
}))

import { getServerSession } from 'next-auth'
import { writeAuditLog } from '@/server/services/audit'

// ── Minimal WebSocket stub ────────────────────────────────────────────────────

class FakeSocket {
  public sent: string[] = []
  send(data: string) {
    this.sent.push(data)
  }
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(): ServerState {
  return {
    clients: new Map(),
    history: [],
    threadMembers: new Map(),
  }
}

function makeAuth(overrides?: Partial<AuthContext>): AuthContext {
  return { userId: 'session-user-id', role: 'USER', ...overrides }
}

function lastSent(socket: FakeSocket) {
  return JSON.parse(socket.sent[socket.sent.length - 1])
}

// ── Unit tests: handleMessageEvent ───────────────────────────────────────────

describe('handleMessageEvent — identity spoofing', () => {
  let socket: FakeSocket
  let state: ServerState
  const auth = makeAuth()

  beforeEach(() => {
    socket = new FakeSocket()
    state = makeState()
    vi.clearAllMocks()
  })

  // ── Attack 1: senderId spoofing ─────────────────────────────────────────────

  it('ignores client-supplied senderId and uses session userId', async () => {
    const payload = JSON.stringify({
      type: 'message',
      threadId: 'thread-abc',
      senderId: 'attacker-wants-to-be-this-user', // spoofed
      recipientId: 'recipient-1',
      ciphertext: 'enc-data',
      iv: 'iv-data',
    })

    await handleMessageEvent(socket as unknown as WebSocket, payload, auth, state)

    expect(state.history).toHaveLength(1)
    expect(state.history[0].senderId).toBe('session-user-id')
    expect(state.history[0].senderId).not.toBe('attacker-wants-to-be-this-user')
  })

  it('initial readBy contains only the session userId, not spoofed sender', async () => {
    const payload = JSON.stringify({
      type: 'message',
      threadId: 'thread-abc',
      senderId: 'someone-else',
      recipientId: 'recipient-1',
      ciphertext: 'enc-data',
      iv: 'iv-data',
    })

    await handleMessageEvent(socket as unknown as WebSocket, payload, auth, state)

    expect(state.history[0].readBy).toEqual(['session-user-id'])
  })

  // ── Attack 2: read-receipt userId forgery ──────────────────────────────────

  it('ignores client-supplied userId in read-receipt and uses session userId', async () => {
    // Seed a message in a thread the session user belongs to.
    state.threadMembers.set('thread-abc', new Set(['session-user-id']))
    const msgId = 'msg-001'
    state.history.push({
      id: msgId,
      threadId: 'thread-abc',
      senderId: 'other-user',
      recipientId: 'session-user-id',
      ciphertext: 'x',
      iv: 'y',
      createdAt: new Date().toISOString(),
      status: 'sent',
      readBy: ['other-user'],
    })

    const payload = JSON.stringify({
      type: 'read-receipt',
      messageId: msgId,
      userId: 'victim-user-id', // attacker tries to forge a receipt for someone else
    })

    await handleMessageEvent(socket as unknown as WebSocket, payload, auth, state)

    const msg = state.history.find((m) => m.id === msgId)!
    expect(msg.readBy).toContain('session-user-id')
    expect(msg.readBy).not.toContain('victim-user-id')
  })

  it('read-receipt broadcast carries session userId, not spoofed userId', async () => {
    state.threadMembers.set('thread-abc', new Set(['session-user-id']))
    const msgId = 'msg-002'
    state.history.push({
      id: msgId,
      threadId: 'thread-abc',
      senderId: 'other-user',
      recipientId: 'session-user-id',
      ciphertext: 'x',
      iv: 'y',
      createdAt: new Date().toISOString(),
      status: 'sent',
      readBy: [],
    })

    // Connect the session user's socket to capture the broadcast.
    state.clients.set('session-user-id', socket as unknown as WebSocket)

    const payload = JSON.stringify({
      type: 'read-receipt',
      messageId: msgId,
      userId: 'forged-user-id',
    })

    await handleMessageEvent(socket as unknown as WebSocket, payload, auth, state)

    const broadcast = socket.sent
      .map((s) => JSON.parse(s))
      .find((p) => p.type === 'read-receipt')

    expect(broadcast).toBeDefined()
    expect(broadcast.userId).toBe('session-user-id')
    expect(broadcast.userId).not.toBe('forged-user-id')
  })

  // ── Attack 3: moderatorId spoofing ─────────────────────────────────────────

  it('ignores client-supplied moderatorId and uses session userId in moderated broadcast', async () => {
    const adminAuth = makeAuth({ userId: 'real-admin-id', role: 'ADMIN' })
    const msgId = 'msg-003'
    state.history.push({
      id: msgId,
      threadId: 'thread-abc',
      senderId: 'some-user',
      recipientId: 'all',
      ciphertext: 'x',
      iv: 'y',
      createdAt: new Date().toISOString(),
      status: 'sent',
      readBy: [],
    })

    state.clients.set('real-admin-id', socket as unknown as WebSocket)

    const payload = JSON.stringify({
      type: 'moderate',
      messageId: msgId,
      action: 'delete',
      moderatorId: 'fake-moderator-id', // attacker claims to be someone else
      reason: 'spam',
    })

    await handleMessageEvent(socket as unknown as WebSocket, payload, adminAuth, state)

    const broadcast = socket.sent
      .map((s) => JSON.parse(s))
      .find((p) => p.type === 'moderated')

    expect(broadcast).toBeDefined()
    expect(broadcast.moderatorId).toBe('real-admin-id')
    expect(broadcast.moderatorId).not.toBe('fake-moderator-id')
  })

  // ── Attack 4: non-admin moderate ───────────────────────────────────────────

  it('rejects moderate action from USER role with FORBIDDEN error', async () => {
    const msgId = 'msg-004'
    state.history.push({
      id: msgId,
      threadId: 'thread-abc',
      senderId: 'some-user',
      recipientId: 'all',
      ciphertext: 'x',
      iv: 'y',
      createdAt: new Date().toISOString(),
      status: 'sent',
      readBy: [],
    })

    const payload = JSON.stringify({
      type: 'moderate',
      messageId: msgId,
      action: 'delete',
      reason: '',
    })

    // auth has role USER (default makeAuth)
    await handleMessageEvent(socket as unknown as WebSocket, payload, auth, state)

    const response = lastSent(socket)
    expect(response.type).toBe('error')
    expect(response.code).toBe('FORBIDDEN')
    // Message must NOT have been deleted.
    expect(state.history.some((m) => m.id === msgId)).toBe(true)
  })

  it('rejects moderate action from CREATOR role with FORBIDDEN error', async () => {
    const creatorAuth = makeAuth({ userId: 'creator-user', role: 'CREATOR' })
    const msgId = 'msg-005'
    state.history.push({
      id: msgId,
      threadId: 'thread-abc',
      senderId: 'someone',
      recipientId: 'all',
      ciphertext: 'x',
      iv: 'y',
      createdAt: new Date().toISOString(),
      status: 'sent',
      readBy: [],
    })

    await handleMessageEvent(
      socket as unknown as WebSocket,
      JSON.stringify({ type: 'moderate', messageId: msgId, action: 'delete' }),
      creatorAuth,
      state,
    )

    const response = lastSent(socket)
    expect(response.type).toBe('error')
    expect(response.code).toBe('FORBIDDEN')
    expect(state.history.some((m) => m.id === msgId)).toBe(true)
  })

  it('writes a DENIED audit log entry when non-admin attempts to moderate', async () => {
    const msgId = 'msg-006'
    state.history.push({
      id: msgId,
      threadId: 'thread-abc',
      senderId: 'someone',
      recipientId: 'all',
      ciphertext: 'x',
      iv: 'y',
      createdAt: new Date().toISOString(),
      status: 'sent',
      readBy: [],
    })

    await handleMessageEvent(
      socket as unknown as WebSocket,
      JSON.stringify({ type: 'moderate', messageId: msgId, action: 'delete' }),
      auth, // USER role
      state,
    )

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'DENIED', userId: 'session-user-id' }),
    )
  })

  it('allows ADMIN to delete a message and audits SUCCESS', async () => {
    const adminAuth = makeAuth({ userId: 'admin-user', role: 'ADMIN' })
    const msgId = 'msg-007'
    state.history.push({
      id: msgId,
      threadId: 'thread-abc',
      senderId: 'some-user',
      recipientId: 'all',
      ciphertext: 'x',
      iv: 'y',
      createdAt: new Date().toISOString(),
      status: 'sent',
      readBy: [],
    })

    await handleMessageEvent(
      socket as unknown as WebSocket,
      JSON.stringify({ type: 'moderate', messageId: msgId, action: 'delete', reason: 'TOS' }),
      adminAuth,
      state,
    )

    // Message deleted.
    expect(state.history.some((m) => m.id === msgId)).toBe(false)
    // Audit written with SUCCESS.
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SUCCESS', userId: 'admin-user' }),
    )
  })

  // ── Attack 5: non-member typing ────────────────────────────────────────────

  it('blocks typing event from a user who is not a thread member', async () => {
    // thread-xyz has no members yet.
    const payload = JSON.stringify({ type: 'typing', threadId: 'thread-xyz' })
    await handleMessageEvent(socket as unknown as WebSocket, payload, auth, state)

    const response = lastSent(socket)
    expect(response.type).toBe('error')
    expect(response.code).toBe('FORBIDDEN')
  })

  it('allows typing event once the user has joined a thread', async () => {
    state.threadMembers.set('thread-xyz', new Set(['session-user-id']))
    const payload = JSON.stringify({ type: 'typing', threadId: 'thread-xyz' })
    await handleMessageEvent(socket as unknown as WebSocket, payload, auth, state)

    // No error sent to socket.
    expect(socket.sent.every((s) => JSON.parse(s).type !== 'error')).toBe(true)
  })

  // ── Attack 6: non-member read-receipt ─────────────────────────────────────

  it('blocks read-receipt from a user who is not a thread member', async () => {
    const msgId = 'msg-008'
    state.history.push({
      id: msgId,
      threadId: 'thread-restricted',
      senderId: 'other-user',
      recipientId: 'all',
      ciphertext: 'x',
      iv: 'y',
      createdAt: new Date().toISOString(),
      status: 'sent',
      readBy: ['other-user'],
    })
    // session-user-id is NOT in thread-restricted

    await handleMessageEvent(
      socket as unknown as WebSocket,
      JSON.stringify({ type: 'read-receipt', messageId: msgId }),
      auth,
      state,
    )

    const response = lastSent(socket)
    expect(response.type).toBe('error')
    expect(response.code).toBe('FORBIDDEN')

    // readBy must not include the attacker.
    const msg = state.history.find((m) => m.id === msgId)!
    expect(msg.readBy).not.toContain('session-user-id')
  })

  // ── Miscellaneous ──────────────────────────────────────────────────────────

  it('responds with PARSE_ERROR on malformed JSON', async () => {
    await handleMessageEvent(socket as unknown as WebSocket, 'not-json', auth, state)
    const response = lastSent(socket)
    expect(response.type).toBe('error')
    expect(response.code).toBe('PARSE_ERROR')
  })

  it('responds with UNKNOWN_EVENT for unrecognised event types', async () => {
    await handleMessageEvent(
      socket as unknown as WebSocket,
      JSON.stringify({ type: 'some_unknown_event' }),
      auth,
      state,
    )
    const response = lastSent(socket)
    expect(response.type).toBe('error')
    expect(response.code).toBe('UNKNOWN_EVENT')
  })

  it('join-thread admits the user and allows subsequent typing', async () => {
    // User joins thread via join-thread event.
    await handleMessageEvent(
      socket as unknown as WebSocket,
      JSON.stringify({ type: 'join-thread', threadId: 'thread-new' }),
      auth,
      state,
    )

    expect(state.threadMembers.get('thread-new')?.has('session-user-id')).toBe(true)

    // Now typing is allowed.
    socket.sent = []
    await handleMessageEvent(
      socket as unknown as WebSocket,
      JSON.stringify({ type: 'typing', threadId: 'thread-new' }),
      auth,
      state,
    )

    expect(socket.sent.every((s) => JSON.parse(s).type !== 'error')).toBe(true)
  })
})

// ── Route-level tests: authentication guard ───────────────────────────────────

describe('GET /api/messages — authentication guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset global state between route tests.
    ;(globalThis as any).__messageState = undefined
  })

  it('returns 401 when no session exists', async () => {
    ;(getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const req = new NextRequest('http://localhost:3000/api/messages')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 200 with message list when session exists', async () => {
    ;(getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'user-1', role: 'USER' },
    })
    const req = new NextRequest('http://localhost:3000/api/messages')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.messages)).toBe(true)
  })
})

describe('POST /api/messages — authentication guard and senderId override', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).__messageState = undefined
  })

  it('returns 401 when no session exists', async () => {
    ;(getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const req = new NextRequest('http://localhost:3000/api/messages', {
      method: 'POST',
      body: JSON.stringify({ ciphertext: 'ct', iv: 'iv' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('stores senderId from session, ignoring the body field', async () => {
    ;(getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'real-user-id', role: 'USER' },
    })

    const req = new NextRequest('http://localhost:3000/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        senderId: 'attacker-id', // should be ignored
        recipientId: 'recipient-1',
        ciphertext: 'encrypted-data',
        iv: 'some-iv',
        threadId: 'thread-1',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.message.senderId).toBe('real-user-id')
    expect(data.message.senderId).not.toBe('attacker-id')
  })

  it('returns 400 when ciphertext is missing', async () => {
    ;(getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'user-1', role: 'USER' },
    })

    const req = new NextRequest('http://localhost:3000/api/messages', {
      method: 'POST',
      body: JSON.stringify({ iv: 'some-iv' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when iv is missing', async () => {
    ;(getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'user-1', role: 'USER' },
    })

    const req = new NextRequest('http://localhost:3000/api/messages', {
      method: 'POST',
      body: JSON.stringify({ ciphertext: 'enc' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
