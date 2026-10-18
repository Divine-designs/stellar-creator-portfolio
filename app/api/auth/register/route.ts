import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/config';

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(100).optional(),
});

// Registration throttling. IP limit is generous to tolerate shared IPs
// (offices, mobile NAT); the per-email limit is strict to stop enumeration
// and mass account creation against a single address.
const WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT = 20;
const EMAIL_LIMIT = 5;

const ipHits = new Map<string, number[]>();
const emailHits = new Map<string, number[]>();

function isLimited(store: Map<string, number[]>, key: string, limit: number): boolean {
  const now = Date.now();
  const recent = (store.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    store.set(key, recent);
    return true;
  }
  recent.push(now);
  store.set(key, recent);
  return false;
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * POST /api/auth/register — email/password account creation.
 *
 * TODO: this auto-verifies the email at creation instead of sending a real
 * verification link. lib/email/mailer.ts (which lib/email/index.ts already
 * imports from) doesn't exist yet, so there's no working mail-sending path
 * to hook up here — wire this to VerificationToken + /api/auth/verify-email
 * (both already exist) once that's built.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }
  const { email, password, name } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  if (isLimited(ipHits, clientIp(req), IP_LIMIT)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  if (isLimited(emailHits, normalizedEmail, EMAIL_LIMIT)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Uniform response: do not reveal whether the email is already registered.
    return NextResponse.json({ success: true });
  }

  await prisma.user.create({
    data: {
      email,
      name: name ?? null,
      password: hashPassword(password),
      emailVerified: new Date(),
    },
  });

  return NextResponse.json({ success: true });
}
