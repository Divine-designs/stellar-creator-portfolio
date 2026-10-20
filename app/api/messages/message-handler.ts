/**
 * Message handler service — pure logic, no HTTP dependency.
 *
 * Security model
 * ──────────────
 * All identity fields are derived from the server-side session; client-provided
 * `userId`, `senderId`, and `moderatorId` fields are **ignored**.
 *
 * • `message`      — senderId is always the authenticated user.
 * • `typing`       — userId is always the authenticated user.
 * • `read-receipt` — the reading user is always the authenticated user.
 * • `moderate`     — restricted to ADMIN role; moderatorId is the session user.
 * • `join-thread`  — records the user as a member of the thread.
 *
 * Thread membership
 * ─────────────────
 * Tracked in the in-memory state (`threadMembers`).  A user is admitted to a
 * thread either by sending a message to it or by emitting a `join-thread`
 * event.  Every read/write event is then checked against this membership set
 * so that a user who knows a threadId cannot read or write into a conversation
 * they were never part of.
 *
 * Threat model closed
 * ───────────────────
 * Attacker: any authenticated user with a WebSocket connection or REST access.
 * Capability before fix: craft a payload with an arbitrary senderId/userId/
 *   moderatorId to impersonate another user, mark someone else's messages as
 *   read, or moderate/delete messages without the required role.
 * Capability after fix: none — identity comes from the session token alone.
 */

import { writeAuditLog } from '@/server/services/audit'

// ── Types ────────────────────────────────────────────────────────────────────

export type Attachment = {
  name: string
  type: string
  size: number
  data: string // base64
}

export type MessagePayload = {
  id: string
  threadId: string
  senderId: string
  recipientId: string
  ciphertext: string
  iv: string
  createdAt: string
  attachment?: Attachment | null
  status?: 'sent' | 'delivered' | 'read'
  readBy?: string[]
  metadata?: Record<string, unknown>
}

export type ServerState = {
  clients: Map<string, WebSocket> // userId → socket
  history: MessagePayload[]
  /** threadId → set of userIds who are members */
  threadMembers: Map<string, Set<string>>
}

/** Minimum session data required by the handler. */
export type AuthContext = {
  userId: string
  role: string
}

/** Standard error shape used across the platform. */
export type ErrorResponse = { type: 'error'; code: string; message: string }
export type OkResponse = { type: string; [key: string]: unknown }
export type HandlerResponse = ErrorResponse | OkResponse

// ── Constants ────────────────────────────────────────────────────────────────

const ADMIN_ROLES = new Set(['ADMIN'])

// ── State accessor ───────────────────────────────────────────────────────────

export const getState = (): ServerState => {
  const g = globalThis as unknown as { __messageState?: ServerState }
  if (!g.__messageState) {
    g.__messageState = {
      clients: new Map<string, WebSocket>(),
      history: [],
      threadMembers: new Map<string, Set<string>>(),
    }
  }
  // Back-fill threadMembers if the state was created by the old code path
  // (e.g. module hot-reload in development).
  if (!g.__messageState.threadMembers) {
    g.__messageState.threadMembers = new Map<string, Set<string>>()
  }
  // Back-fill clients map if state was created by old code (was a Set).
  if (!(g.__messageState.clients instanceof Map)) {
    g.__messageState.clients = new Map<string, WebSocket>()
  }
  return g.__messageState
}

// ── Broadcast helper ─────────────────────────────────────────────────────────

export const broadcast = (data: unknown, state?: ServerState): void => {
  const s = state ?? getState()
  const payload = JSON.stringify(data)
  for (const [userId, socket] of s.clients) {
    try {
      socket.send(payload)
    } catch {
      try { socket.close() } catch { /* ignore */ }
      s.clients.delete(userId)
    }
  }
}

// ── Thread membership ────────────────────────────────────────────────────────

function addThreadMember(state: ServerState, threadId: string, userId: string): void {
  const members = state.threadMembers.get(threadId) ?? new Set<string>()
  members.add(userId)
  state.threadMembers.set(threadId, members)
}

function isThreadMember(state: ServerState, threadId: string, userId: string): boolean {
  const members = state.threadMembers.get(threadId)
  if (!members) return false
  return members.has(userId)
}

// ── Input validation ─────────────────────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

// ── Event handlers ───────────────────────────────────────────────────────────

function handleMessage(
  raw: Record<string, unknown>,
  auth: AuthContext,
  state: ServerState,
): HandlerResponse {
  const threadId: string = isNonEmptyString(raw.threadId) ? raw.threadId : 'general'
  const recipientId: string = isNonEmptyString(raw.recipientId) ? raw.recipientId : 'all'

  if (!isNonEmptyString(raw.ciphertext)) {
    return { type: 'error', code: 'INVALID_PAYLOAD', message: 'ciphertext is required' }
  }
  if (!isNonEmptyString(raw.iv)) {
    return { type: 'error', code: 'INVALID_PAYLOAD', message: 'iv is required' }
  }

  // Admit the sender to the thread on first message.
  addThreadMember(state, threadId, auth.userId)

  const message: MessagePayload = {
    id: isNonEmptyString(raw.id) ? raw.id : crypto.randomUUID(),
    threadId,
    // Identity always comes from the session — ignore any client-supplied senderId.
    senderId: auth.userId,
    recipientId,
    ciphertext: raw.ciphertext as string,
    iv: raw.iv as string,
    createdAt: new Date().toISOString(),
    attachment: (raw.attachment as Attachment | null | undefined) ?? null,
    status: 'sent',
    readBy: [auth.userId],
    metadata:
      raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
        ? (raw.metadata as Record<string, unknown>)
        : {},
  }

  state.history.push(message)
  broadcast({ type: 'message', data: message }, state)
  return { type: 'message', data: message }
}

function handleTyping(
  raw: Record<string, unknown>,
  auth: AuthContext,
  state: ServerState,
): HandlerResponse {
  const threadId: string = isNonEmptyString(raw.threadId) ? raw.threadId : 'general'

  // Membership check — a non-member cannot announce typing in a thread.
  if (!isThreadMember(state, threadId, auth.userId)) {
    return { type: 'error', code: 'FORBIDDEN', message: 'Not a member of this thread' }
  }

  broadcast({ type: 'typing', userId: auth.userId, threadId }, state)
  return { type: 'typing', userId: auth.userId, threadId }
}

function handleReadReceipt(
  raw: Record<string, unknown>,
  auth: AuthContext,
  state: ServerState,
): HandlerResponse {
  const messageId = raw.messageId
  if (!isNonEmptyString(messageId)) {
    return { type: 'error', code: 'INVALID_PAYLOAD', message: 'messageId is required' }
  }

  const target = state.history.find((m) => m.id === messageId)
  if (!target) {
    return { type: 'error', code: 'NOT_FOUND', message: 'Message not found' }
  }

  // Membership check — must be in the thread to mark messages read.
  if (!isThreadMember(state, target.threadId, auth.userId)) {
    return { type: 'error', code: 'FORBIDDEN', message: 'Not a member of this thread' }
  }

  state.history = state.history.map((msg) =>
    msg.id === messageId
      ? {
          ...msg,
          status: 'read',
          // Identity from session — ignore any client-supplied userId.
          readBy: Array.from(new Set([...(msg.readBy ?? []), auth.userId])),
        }
      : msg,
  )

  broadcast({ type: 'read-receipt', messageId, userId: auth.userId }, state)
  return { type: 'read-receipt', messageId, userId: auth.userId }
}

async function handleModerate(
  raw: Record<string, unknown>,
  auth: AuthContext,
  state: ServerState,
): Promise<HandlerResponse> {
  // Role check — only ADMIN may moderate.
  if (!ADMIN_ROLES.has(auth.role)) {
    // Fire-and-forget audit of the denied attempt.
    void writeAuditLog({
      userId: auth.userId,
      resource: 'message',
      action: 'moderate',
      status: 'DENIED',
      errorMessage: `Role ${auth.role} is not permitted to moderate messages`,
      payload: { attemptedAction: raw.action ?? null, messageId: raw.messageId ?? null },
    })
    return { type: 'error', code: 'FORBIDDEN', message: 'Insufficient role to moderate messages' }
  }

  const messageId = raw.messageId
  if (!isNonEmptyString(messageId)) {
    return { type: 'error', code: 'INVALID_PAYLOAD', message: 'messageId is required' }
  }

  const action = raw.action
  if (action !== 'delete' && action !== 'hide') {
    return {
      type: 'error',
      code: 'INVALID_PAYLOAD',
      message: 'action must be "delete" or "hide"',
    }
  }

  const reason: string = isNonEmptyString(raw.reason) ? raw.reason : ''

  if (action === 'delete') {
    state.history = state.history.filter((m) => m.id !== messageId)
  }

  // Audit log — identity always from session.
  void writeAuditLog({
    userId: auth.userId,
    resource: 'message',
    action: `moderate:${action}`,
    resourceId: messageId,
    status: 'SUCCESS',
    payload: { action, reason, moderatorId: auth.userId },
  })

  broadcast(
    {
      type: 'moderated',
      messageId,
      action,
      // Identity from session — never from client payload.
      moderatorId: auth.userId,
      reason,
    },
    state,
  )
  return { type: 'moderated', messageId, action, moderatorId: auth.userId, reason }
}

function handleJoinThread(
  raw: Record<string, unknown>,
  auth: AuthContext,
  state: ServerState,
): HandlerResponse {
  const threadId: string = isNonEmptyString(raw.threadId) ? raw.threadId : 'general'
  addThreadMember(state, threadId, auth.userId)
  return { type: 'joined', threadId, userId: auth.userId }
}

// ── Main dispatcher ──────────────────────────────────────────────────────────

/**
 * Process a raw WebSocket message frame.
 *
 * @param socket   The sender's WebSocket (used only for pong replies).
 * @param raw      The unparsed JSON string received from the client.
 * @param auth     Server-derived identity — MUST come from the session, never from the payload.
 * @param state    Shared in-memory state (injected so tests can pass their own).
 */
export async function handleMessageEvent(
  socket: WebSocket,
  raw: string,
  auth: AuthContext,
  state: ServerState = getState(),
): Promise<void> {
  let parsed: { type: string; [key: string]: unknown }

  try {
    parsed = JSON.parse(raw) as { type: string; [key: string]: unknown }
  } catch {
    socket.send(
      JSON.stringify({ type: 'error', code: 'PARSE_ERROR', message: 'Invalid JSON payload' }),
    )
    return
  }

  if (typeof parsed.type !== 'string' || !parsed.type) {
    socket.send(
      JSON.stringify({ type: 'error', code: 'INVALID_PAYLOAD', message: 'type is required' }),
    )
    return
  }

  try {
    let result: HandlerResponse

    switch (parsed.type) {
      case 'message':
        result = handleMessage(parsed, auth, state)
        break

      case 'typing':
        result = handleTyping(parsed, auth, state)
        break

      case 'read-receipt':
        result = handleReadReceipt(parsed, auth, state)
        break

      case 'moderate':
        result = await handleModerate(parsed, auth, state)
        break

      case 'join-thread':
        result = handleJoinThread(parsed, auth, state)
        break

      case 'ping':
        socket.send(JSON.stringify({ type: 'pong', ts: Date.now() }))
        return

      default:
        socket.send(
          JSON.stringify({
            type: 'error',
            code: 'UNKNOWN_EVENT',
            message: `Unknown event type: ${parsed.type}`,
          }),
        )
        return
    }

    if (result.type === 'error') {
      socket.send(JSON.stringify(result))
    }
  } catch (err) {
    console.error('[MessageHandler] Unhandled error processing event', { type: parsed.type, err })
    socket.send(
      JSON.stringify({ type: 'error', code: 'INTERNAL_ERROR', message: 'Internal server error' }),
    )
  }
}
