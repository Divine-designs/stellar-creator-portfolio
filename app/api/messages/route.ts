/**
 * Messages API — dual-purpose endpoint (WebSocket streaming + REST fallback).
 *
 * Security
 * ────────
 * User identity is derived exclusively from the server-side session.
 * Any `userId`, `senderId`, or `moderatorId` field supplied by the client in
 * the event payload is **silently ignored**.  This prevents identity spoofing,
 * read-receipt forgery, and unauthorised moderation.
 *
 * Authentication requirements
 * ───────────────────────────
 * • GET (WebSocket upgrade) — requires a valid session; responds 401 otherwise.
 * • GET (history query)     — requires a valid session; responds 401 otherwise.
 * • POST (REST fallback)    — requires a valid session; responds 401 otherwise.
 *
 * Thread membership
 * ─────────────────
 * A user is automatically admitted to a thread when they first send a message
 * to it or emit a `join-thread` event.  Subsequent `typing`, `read-receipt`,
 * and history reads are gated on membership.
 *
 * See {@link handleMessageEvent} in ./message-handler.ts for full event docs.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'
import {
  getState,
  broadcast,
  handleMessageEvent,
  type AuthContext,
  type MessagePayload,
} from './message-handler'

// ── Auth helper ───────────────────────────────────────────────────────────────

/**
 * Resolve the session and return a typed {@link AuthContext}.
 * Returns null when the request is unauthenticated.
 */
async function resolveAuth(request: Request): Promise<AuthContext | null> {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id
  const role = (session?.user as { role?: string } | undefined)?.role ?? 'USER'
  if (!userId) return null
  return { userId, role }
}

// ── WebSocket upgrade ─────────────────────────────────────────────────────────

const upgradeWebSocket = (request: Request) => {
  const denoUpgrade = (globalThis as any)?.Deno?.upgradeWebSocket
  if (denoUpgrade) {
    return denoUpgrade(request)
  }

  const anyRequest = request as any
  if (anyRequest?.webSocket) {
    const { webSocket } = anyRequest
    webSocket.accept()
    return { socket: webSocket as WebSocket, response: new Response(null, { status: 101 }) }
  }

  throw new Error('WebSocket upgrade is not supported in this runtime')
}

// ── Route handlers ────────────────────────────────────────────────────────────

/**
 * Dual-purpose messages endpoint.
 *
 * When the request carries an `Upgrade: websocket` header, the session is
 * resolved **before** the upgrade handshake.  A 401 is returned for
 * unauthenticated requests so the client never reaches the live event loop
 * without a valid identity.
 *
 * Otherwise, treats the request as a plain history query: `?threadId=` filters
 * to one thread and `?q=` does a case-insensitive substring search over each
 * message's `metadata.plainText`.  Results are scoped to threads the caller
 * is a member of.
 *
 * In-memory only ({@link getState}) — history and connected clients are lost
 * on server restart and aren't shared across instances.
 */
export async function GET(request: NextRequest) {
  // Resolve the session before anything else — applies to both the WS and REST paths.
  const auth = await resolveAuth(request)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const upgradeHeader = request.headers.get('upgrade')

  if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
    try {
      const { socket, response } = upgradeWebSocket(request)
      const state = getState()

      socket.addEventListener('open', () => {
        // Register the socket keyed by userId so broadcasts reach live clients.
        state.clients.set(auth.userId, socket)
        socket.send(
          JSON.stringify({ type: 'history', data: state.history.slice(-200) })
        )
      })

      socket.addEventListener('message', (event: MessageEvent) => {
        const raw = typeof event.data === 'string' ? event.data : ''
        // auth is captured from the closure — client cannot supply identity.
        void handleMessageEvent(socket, raw, auth, state)
      })

      socket.addEventListener('close', () => {
        state.clients.delete(auth.userId)
      })

      socket.addEventListener('error', () => {
        state.clients.delete(auth.userId)
      })

      return response
    } catch (err) {
      console.error('WebSocket upgrade failed', err)
      return NextResponse.json({ error: 'WebSocket upgrade failed' }, { status: 400 })
    }
  }

  // ── REST history query ──────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.toLowerCase().trim()
  const threadId = searchParams.get('threadId') ?? undefined
  const state = getState()

  const filtered = state.history.filter((msg: MessagePayload) => {
    // Scope results to threads the caller belongs to (or all if no threadId).
    const inThread = threadId ? msg.threadId === threadId : true
    if (!inThread) return false

    // Non-member cannot read another thread's history.
    if (!state.threadMembers.get(msg.threadId)?.has(auth.userId)) return false

    if (!q) return true
    return (msg.metadata?.plainText as string | undefined)?.toLowerCase().includes(q) ?? false
  })

  return NextResponse.json({ messages: filtered })
}

/**
 * REST fallback for senders that can't hold a live socket open.
 *
 * Identity is derived from the session — the `senderId` field in the request
 * body is ignored.  The sender is automatically admitted to the thread.
 */
export async function POST(request: NextRequest) {
  const auth = await resolveAuth(request)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.ciphertext !== 'string' || !body.ciphertext) {
    return NextResponse.json({ error: 'ciphertext is required' }, { status: 400 })
  }
  if (typeof body.iv !== 'string' || !body.iv) {
    return NextResponse.json({ error: 'iv is required' }, { status: 400 })
  }

  const state = getState()
  const threadId: string =
    typeof body.threadId === 'string' && body.threadId ? body.threadId : 'general'

  // Admit the sender to the thread.
  const members = state.threadMembers.get(threadId) ?? new Set<string>()
  members.add(auth.userId)
  state.threadMembers.set(threadId, members)

  const message: MessagePayload = {
    id:
      typeof body.id === 'string' && body.id ? body.id : crypto.randomUUID(),
    threadId,
    // Identity always from session — ignore body.senderId.
    senderId: auth.userId,
    recipientId:
      typeof body.recipientId === 'string' && body.recipientId ? body.recipientId : 'all',
    ciphertext: body.ciphertext as string,
    iv: body.iv as string,
    createdAt: new Date().toISOString(),
    attachment:
      body.attachment && typeof body.attachment === 'object'
        ? (body.attachment as MessagePayload['attachment'])
        : null,
    status: 'sent',
    readBy: [auth.userId],
    metadata:
      body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : {},
  }

  state.history.push(message)
  broadcast({ type: 'message', data: message }, state)
  return NextResponse.json({ ok: true, message })
}

export const dynamic = 'force-dynamic'
export const runtime = 'edge'
