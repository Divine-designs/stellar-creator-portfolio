import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/auth/verify-email?token=...
 * Marks email as verified and redirects to onboarding.
 *
 * Tokens are stored hashed (see lib/email verification flow), so the raw
 * token from the link is hashed before lookup. Legacy plaintext tokens are
 * still accepted so in-flight links keep working.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.redirect(new URL('/auth/login?error=missing_token', req.url));
  }

  const hashedToken = await hashToken(token);

  const record =
    (await prisma.verificationToken.findUnique({
      where: { token: hashedToken },
      include: { user: true },
    })) ??
    (await prisma.verificationToken.findUnique({
      where: { token },
      include: { user: true },
    }));

  if (!record || record.expires < new Date()) {
    return NextResponse.redirect(new URL('/auth/login?error=invalid_token', req.url));
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: new Date() },
    }),
    prisma.verificationToken.delete({ where: { id: record.id } }),
  ]);

  const onboardingUrl = new URL('/onboarding', req.url);
  onboardingUrl.searchParams.set('verified', '1');
  return NextResponse.redirect(onboardingUrl);
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
