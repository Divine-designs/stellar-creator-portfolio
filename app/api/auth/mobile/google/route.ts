import { NextRequest, NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import { upsertOAuthUser } from '@/lib/auth/oauth-user';
import { issueMobileSession } from '@/lib/auth/mobile-session';

const client = new OAuth2Client();

/**
 * POST /api/auth/mobile/google
 *
 * Mobile equivalent of the web Google sign-in path: the app gets an ID
 * token from Google via expo-auth-session, sends it here, we verify it
 * server-side (never trust a client-supplied token without verification)
 * and find-or-create the matching User.
 *
 * On success we issue a short-lived access JWT (15 min) plus a rotating
 * refresh token (30 days, stored hashed server-side) so the app can make
 * authenticated API calls. Untested end-to-end: this repo has no
 * device/simulator to exercise the native Google OAuth screen against, and
 * needs real GOOGLE_CLIENT_ID values (separate iOS/Android OAuth clients
 * from Google Cloud Console, not just the web one) before it can work at all.
 */
export async function POST(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Google sign-in is not configured' }, { status: 501 });
  }

  const body = await req.json().catch(() => null);
  const idToken = typeof body?.idToken === 'string' ? body.idToken : '';
  if (!idToken) {
    return NextResponse.json({ error: 'idToken is required' }, { status: 422 });
  }

  // Accept the web client plus any per-platform (iOS/Android) OAuth clients.
  const audiences = [
    clientId,
    process.env.GOOGLE_IOS_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
  ].filter((id): id is string => !!id);

  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: audiences });
    payload = ticket.getPayload();
  } catch {
    return NextResponse.json({ error: 'Invalid Google token' }, { status: 401 });
  }

  if (!payload?.email) {
    return NextResponse.json({ error: 'Google account has no email' }, { status: 422 });
  }

  const user = await upsertOAuthUser({
    email: payload.email,
    name: payload.name,
    image: payload.picture,
  });

  const session = await issueMobileSession(user.id);

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    walletAddress: user.walletAddress,
    onboardingCompleted: !!user.onboardingCompletedAt,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresIn: session.expiresIn,
  });
}
