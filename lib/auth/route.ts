import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export type AuthMode = 'public' | 'session' | 'admin' | 'cronSecret' | 'webhook';

export interface RouteUser {
  id?: string;
  email?: string | null;
  role?: string;
  [key: string]: unknown;
}

export interface RouteContext<TBody = unknown> {
  req: NextRequest;
  user: RouteUser | null;
  body: TBody;
  params: Record<string, string>;
}

export interface BodySchema<TBody> {
  parse: (input: unknown) => TBody;
}

export interface RouteConfig<TBody = unknown> {
  auth?: AuthMode;
  body?: BodySchema<TBody>;
}

export type RouteHandler<TBody = unknown> = (
  ctx: RouteContext<TBody>,
) => Promise<Response> | Response;

interface StandardError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse<StandardError> {
  return NextResponse.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status },
  );
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function resolveUser(): Promise<RouteUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return session.user as RouteUser;
}

async function authorize(
  mode: AuthMode,
  req: NextRequest,
): Promise<{ user: RouteUser | null } | { response: NextResponse<StandardError> }> {
  switch (mode) {
    case 'public':
      return { user: null };

    case 'session': {
      const user = await resolveUser();
      if (!user) {
        return {
          response: errorResponse(401, 'UNAUTHORIZED', 'Authentication required'),
        };
      }
      return { user };
    }

    case 'admin': {
      const user = await resolveUser();
      if (!user) {
        return {
          response: errorResponse(401, 'UNAUTHORIZED', 'Authentication required'),
        };
      }
      if (user.role !== 'admin') {
        return {
          response: errorResponse(403, 'FORBIDDEN', 'Admin access required'),
        };
      }
      return { user };
    }

    case 'cronSecret': {
      const expected = process.env.CRON_SECRET;
      if (!expected) {
        return {
          response: errorResponse(
            500,
            'CRON_SECRET_NOT_CONFIGURED',
            'Cron secret is not configured',
          ),
        };
      }
      const provided =
        req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      if (!provided || !timingSafeEqual(provided, expected)) {
        return {
          response: errorResponse(401, 'UNAUTHORIZED', 'Invalid cron secret'),
        };
      }
      return { user: null };
    }

    case 'webhook': {
      const expected = process.env.WEBHOOK_SECRET;
      if (!expected) {
        return {
          response: errorResponse(
            500,
            'WEBHOOK_SECRET_NOT_CONFIGURED',
            'Webhook secret is not configured',
          ),
        };
      }
      const provided =
        req.headers.get('x-webhook-secret') ??
        req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
        '';
      if (!provided || !timingSafeEqual(provided, expected)) {
        return {
          response: errorResponse(401, 'UNAUTHORIZED', 'Invalid webhook signature'),
        };
      }
      return { user: null };
    }

    default: {
      const exhaustive: never = mode;
      return {
        response: errorResponse(
          500,
          'UNKNOWN_AUTH_MODE',
          `Unknown auth mode: ${String(exhaustive)}`,
        ),
      };
    }
  }
}

async function parseBody<TBody>(
  req: NextRequest,
  schema: BodySchema<TBody>,
): Promise<{ body: TBody } | { response: NextResponse<StandardError> }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      response: errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON'),
    };
  }

  try {
    return { body: schema.parse(raw) };
  } catch (err) {
    const details =
      err && typeof err === 'object' && 'issues' in err
        ? (err as { issues: unknown }).issues
        : undefined;
    return {
      response: errorResponse(400, 'VALIDATION_ERROR', 'Invalid request body', details),
    };
  }
}

/**
 * Wrap an App Router handler with auth and body validation.
 *
 * ```ts
 * export const POST = route({ auth: 'session', body: schema }, async ({ user, body }) => {
 *   return NextResponse.json({ ok: true });
 * });
 * ```
 */
export function route<TBody = unknown>(
  config: RouteConfig<TBody>,
  handler: RouteHandler<TBody>,
) {
  const mode: AuthMode = config.auth ?? 'session';

  return async (
    req: NextRequest,
    ctx?: { params?: Record<string, string> | Promise<Record<string, string>> },
  ): Promise<Response> => {
    const authResult = await authorize(mode, req);
    if ('response' in authResult) return authResult.response;

    let body = undefined as TBody;
    if (config.body) {
      const bodyResult = await parseBody(req, config.body);
      if ('response' in bodyResult) return bodyResult.response;
      body = bodyResult.body;
    }

    const params = ctx?.params ? await ctx.params : {};

    try {
      return await handler({
        req,
        user: authResult.user,
        body,
        params,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      return errorResponse(500, 'INTERNAL_ERROR', message);
    }
  };
}

export default route;
