/**
 * useGoogleAuth — Google sign-in via expo-auth-session (#onboarding-gap)
 *
 * Exchanges a Google ID token for the matching Tamgora user record by
 * calling the Next.js web app's /api/auth/mobile/google endpoint — the
 * same account-creation path (lib/auth/oauth-user.ts) the web app's Google
 * sign-in uses, so a creator who signs up on web and later opens the
 * mobile app lands on the same account.
 *
 * The endpoint now also issues a short-lived access token (15 min) and a
 * 30-day refresh token. Both are persisted in SecureStore so the rest of
 * the app can attach the access token as a Bearer credential on protected
 * API calls, and refresh it via /api/auth/mobile/refresh when it expires.
 *
 * NOTE: this hits the Next.js app (Prisma/NextAuth's User table), which is
 * a *different* backend than the rest of this file's siblings talk to —
 * ApiClient.ts's bounty/creator/review endpoints go to the separate Rust
 * `stellar-api` service. Intentional for now (identity lives in Next.js),
 * but worth knowing if you're wiring up anything else here.
 *
 * TODO: still untested end-to-end, and not reachable from any screen yet —
 * nothing in src/screens/ or app/ calls useGoogleAuth().signIn(). #1623
 * added real Maestro E2E coverage for this app's actual sign-in path
 * (wallet-signature auth via useWalletAuth.ts — see
 * .maestro/sign-in-flow.yaml and mobile/docs/E2E_TESTING.md) but
 * deliberately left this one alone: driving a real Google account-consent
 * screen from a CI emulator needs a test Google account and consent-screen
 * automation, neither of which exist here, plus real per-platform
 * GOOGLE_*_CLIENT_ID values from Google Cloud Console before it can work
 * at all. Once this hook is wired into a screen, the same test-mode-flag
 * pattern used in useWalletAuth.ts (EXPO_PUBLIC_E2E_TEST_MODE) is the
 * straightforward way to add a Maestro flow for it without needing a real
 * Google consent screen in CI.
 */

import { useCallback, useEffect, useState } from 'react';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';

WebBrowser.maybeCompleteAuthSession();

const WEB_API_BASE = process.env.EXPO_PUBLIC_WEB_API_URL ?? 'http://localhost:3000';

const ACCESS_TOKEN_KEY = 'tamgora.mobile.accessToken';
const REFRESH_TOKEN_KEY = 'tamgora.mobile.refreshToken';

export interface GoogleAuthUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  walletAddress: string | null;
  onboardingCompleted: boolean;
}

export interface GoogleAuthSession {
  user: GoogleAuthUser;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
}

export type GoogleAuthStatus = 'idle' | 'requesting' | 'verifying' | 'success' | 'error';

export function useGoogleAuth() {
  const [status, setStatus] = useState<GoogleAuthStatus>('idle');
  const [user, setUser] = useState<GoogleAuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });

  const verifyWithBackend = useCallback(async (idToken: string) => {
    setStatus('verifying');
    try {
      const res = await fetch(`${WEB_API_BASE}/api/auth/mobile/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? 'Google sign-in failed');
        setStatus('error');
        return;
      }
      const session = body as GoogleAuthSession;
      await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, session.accessToken);
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, session.refreshToken);
      setUser(session.user);
      setStatus('success');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (response?.type === 'success' && response.authentication?.idToken) {
      verifyWithBackend(response.authentication.idToken);
    } else if (response?.type === 'error') {
      setError(response.error?.message ?? 'Google sign-in was cancelled or failed');
      setStatus('error');
    }
  }, [response, verifyWithBackend]);

  const signIn = useCallback(() => {
    setError(null);
    setStatus('requesting');
    promptAsync();
  }, [promptAsync]);

  const signOut = useCallback(async () => {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    if (refreshToken) {
      try {
        await fetch(`${WEB_API_BASE}/api/auth/mobile/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
      } catch {
        // Best-effort revocation; local tokens are cleared regardless.
      }
    }
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    setUser(null);
    setStatus('idle');
  }, []);

  return {
    signIn,
    signOut,
    status,
    user,
    error,
    isReady: !!request,
  };
}
