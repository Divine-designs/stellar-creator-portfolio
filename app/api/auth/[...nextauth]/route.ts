import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { checkRateLimit, getClientIp } from '@/lib/auth/route';

const handler = NextAuth(authOptions);

/**
 * Wrap the NextAuth handler so credentials sign-in attempts are throttled by
 * IP before they reach `authorize()`. The IP limit is kept generous to avoid
 * punishing shared IPs (offices, mobile NAT); the strict per-email limit and
 * exponential lockout live inside `authorize()` itself.
 */
function withAuthRateLimit(
  next: (req: Request, ctx: unknown) => Promise<Response>,
) {
  return async (req: Request, ctx: unknown): Promise<Response> => {
    const ip = getClientIp(req);
    const limited = await checkRateLimit({
      key: `auth:signin:ip:${ip}`,
      limit: 30,
      windowMs: 15 * 60 * 1000,
    });

    if (!limited.ok) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': String(limited.retryAfterSeconds),
          },
        },
      );
    }

    return next(req, ctx);
  };
}

export const GET = withAuthRateLimit(handler as never);
export const POST = withAuthRateLimit(handler as never);
