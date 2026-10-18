import { createHash, randomBytes } from "crypto";

/**
 * Email delivery + verification-token helpers.
 *
 * The mailer transport is intentionally pluggable: when no provider is
 * configured we fall back to logging the message (never the raw token) so
 * local development keeps working without leaking secrets.
 */

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendMailResult {
  ok: boolean;
  error?: string;
}

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function generateVerificationToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verificationTokenExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + VERIFICATION_TOKEN_TTL_MS);
}

export function buildVerificationUrl(token: string, baseUrl?: string): string {
  const origin =
    baseUrl ??
    process.env.NEXTAUTH_URL ??
    process.env.APP_URL ??
    "http://localhost:3000";
  const url = new URL("/api/auth/verify-email", origin);
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * Send an email. Uses RESEND_API_KEY when present; otherwise logs a redacted
 * notice so the flow is testable locally without a real provider.
 */
export async function sendMail(options: SendMailOptions): Promise<SendMailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "no-reply@localhost";

  if (!apiKey) {
    console.info(`[email] (no provider configured) would send "${options.subject}" to ${options.to}`);
    return { ok: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `mail provider responded ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown mail error" };
  }
}

export async function sendVerificationEmail(to: string, token: string): Promise<SendMailResult> {
  const url = buildVerificationUrl(token);
  return sendMail({
    to,
    subject: "Verify your email address",
    text: `Confirm your email address by visiting:\n\n${url}\n\nThis link expires in 24 hours. If you did not create an account, ignore this email.`,
    html: `<p>Confirm your email address by clicking the link below:</p><p><a href="${url}">Verify email</a></p><p>This link expires in 24 hours. If you did not create an account, ignore this email.</p>`,
  });
}
