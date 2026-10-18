import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/config';

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(100).optional(),
});

/**
 * POST /api/auth/register — email/password account creation.
 *
 * New accounts start unverified (emailVerified: null). A VerificationToken is
 * created and a verification link to /api/auth/verify-email is sent via the
 * mailer. Sensitive actions must gate on a verified email.
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

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
  }

  await prisma.user.create({
    data: {
      email,
      name: name ?? null,
      password: hashPassword(password),
      emailVerified: null,
    },
  });

  return NextResponse.json({ success: true });
}
