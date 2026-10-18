import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import crypto from 'crypto';

// Reject requests whose timestamp is further than this from "now" in either
// direction. Without this bound, a signature captured once (e.g. from a
// retried delivery or a network observer) stays valid forever and can be
// replayed at will, since the signature covers the timestamp but nothing
// ever checks it against the clock.
const MAX_WEBHOOK_CLOCK_SKEW_MS = 5 * 60 * 1000;

function timingSafeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  if (aBuf.length === 0 || aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// Generic HMAC scheme used by Resend/Postmark-style providers and our own
// internal senders: `x-webhook-signature` = HMAC-SHA256(secret, `${timestamp}.${rawBody}`).
function verifyHmacSignature(rawBody: string, request: NextRequest): boolean {
  const signature = request.headers.get('x-webhook-signature');
  const timestamp = request.headers.get('x-webhook-timestamp');
  const secret = process.env.EMAIL_WEBHOOK_SECRET;

  if (!signature || !timestamp || !secret) {
    return false;
  }

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs)) {
    return false;
  }
  if (Math.abs(Date.now() - timestampMs) > MAX_WEBHOOK_CLOCK_SKEW_MS) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${timestamp}.${rawBody}`);
  const expectedSignature = hmac.digest('hex');

  return timingSafeEqualHex(signature, expectedSignature);
}

// Postmark signs the raw body with HMAC-SHA256 and sends the hex digest in
// `x-postmark-signature` (no timestamp component).
function verifyPostmarkSignature(rawBody: string, request: NextRequest): boolean {
  const signature = request.headers.get('x-postmark-signature');
  const secret = process.env.POSTMARK_WEBHOOK_SECRET;
  if (!signature || !secret) {
    return false;
  }
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqualHex(signature, expected);
}

// Resend signs with Svix: `svix-id`, `svix-timestamp`, `svix-signature`.
// The signed content is `${id}.${timestamp}.${rawBody}` and the secret is
// base64-encoded (prefixed with `whsec_`). The signature header may contain
// multiple space-separated `v1,<base64sig>` entries.
function verifyResendSignature(rawBody: string, request: NextRequest): boolean {
  const id = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const signatureHeader = request.headers.get('svix-signature');
  const secret = process.env.RESEND_WEBHOOK_SECRET;

  if (!id || !timestamp || !signatureHeader || !secret) {
    return false;
  }

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs)) {
    return false;
  }
  if (Math.abs(Date.now() - timestampMs) > MAX_WEBHOOK_CLOCK_SKEW_MS) {
    return false;
  }

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto
    .createHmac('sha256', secretBytes)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');

  const expectedBuf = Buffer.from(expected);
  for (const entry of signatureHeader.split(' ')) {
    const [version, sig] = entry.split(',');
    if (version !== 'v1' || !sig) continue;
    const sigBuf = Buffer.from(sig);
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

// SES delivers bounce/complaint notifications through SNS. SNS signs the
// canonical message with the topic's public key (RSA-SHA1/SHA256) and the
// signature is verifiable against the certificate at `SigningCertURL`.
// We validate the certificate host and the message type before trusting it.
function isTrustedSnsCertUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

function buildSnsStringToSign(message: Record<string, unknown>): string | null {
  const type = message.Type;
  if (type === 'Notification') {
    const fields = ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'];
    let out = '';
    for (const field of fields) {
      if (field === 'Subject' && message.Subject === undefined) continue;
      const value = message[field];
      if (typeof value !== 'string') return null;
      out += `${field}\n${value}\n`;
    }
    return out;
  }
  if (type === 'SubscriptionConfirmation' || type === 'UnsubscribeConfirmation') {
    const fields = ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
    let out = '';
    for (const field of fields) {
      const value = message[field];
      if (typeof value !== 'string') return null;
      out += `${field}\n${value}\n`;
    }
    return out;
  }
  return null;
}

async function verifySnsSignature(rawBody: string): Promise<boolean> {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(rawBody);
  } catch {
    return false;
  }
  if (!message || typeof message !== 'object') return false;

  const signature = message.Signature;
  const signatureVersion = message.SignatureVersion;
  const certUrl = message.SigningCertURL;
  if (typeof signature !== 'string' || typeof certUrl !== 'string') return false;
  if (signatureVersion !== '1' && signatureVersion !== '2') return false;
  if (!isTrustedSnsCertUrl(certUrl)) return false;

  const stringToSign = buildSnsStringToSign(message);
  if (!stringToSign) return false;

  let cert: string;
  try {
    const res = await fetch(certUrl);
    if (!res.ok) return false;
    cert = await res.text();
  } catch {
    return false;
  }

  const algorithm = signatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
  try {
    const verifier = crypto.createVerify(algorithm);
    verifier.update(stringToSign, 'utf8');
    return verifier.verify(cert, signature, 'base64');
  } catch {
    return false;
  }
}

async function verifyWebhookSignature(rawBody: string, request: NextRequest): Promise<boolean> {
  // Deny-by-default: only accept requests that carry a signature we can verify
  // for a known provider. Unknown/unsigned requests are rejected.
  if (request.headers.get('x-postmark-signature')) {
    return verifyPostmarkSignature(rawBody, request);
  }
  if (request.headers.get('svix-signature')) {
    return verifyResendSignature(rawBody, request);
  }
  if (request.headers.get('x-webhook-signature')) {
    return verifyHmacSignature(rawBody, request);
  }
  // Fall back to SNS/SES signature verification when the body looks like an
  // SNS envelope (has a Signature + SigningCertURL).
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'Signature' in parsed && 'SigningCertURL' in parsed) {
      return await verifySnsSignature(rawBody);
    }
  } catch {
    // fall through to reject
  }
  return false;
}

export async function POST(request: NextRequest) {
  try {
    // Read the body once and reuse the string for both signature verification and JSON parsing
    const rawBody = await request.text();
    const isValid = await verifyWebhookSignature(rawBody, request);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = JSON.parse(rawBody);
    const events = Array.isArray(body) ? body : [body];

    for (const event of events) {
      const email = event.email || event.recipient;
      if (!email) continue;

      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) continue;

      if (event.type === 'bounce') {
        if (event.bounce_type === 'permanent' || event.bounce_type === 'hard') {
          await prisma.user.update({
            where: { id: user.id },
            data: { emailBounced: true },
          });
          await prisma.emailDeliveryLog.create({
            data: {
              userId: user.id,
              toEmail: email,
              templateKey: 'bounce',
              subject: 'Bounce',
              category: 'system',
              status: 'SKIPPED',
              provider: 'webhook',
              providerMessageId: event.message_id,
              errorMessage: `Hard bounce: ${event.diagnostic_code || 'unknown'}`,
              payload: event,
            },
          });
        } else if (event.bounce_type === 'temporary' || event.bounce_type === 'soft') {
          const log = await prisma.emailDeliveryLog.findFirst({
            where: {
              toEmail: email,
              templateKey: 'bounce',
            },
            orderBy: { createdAt: 'desc' },
          });

          let count = 1;
          if (
            log &&
            log.payload &&
            typeof log.payload === 'object' &&
            'softBounceCount' in log.payload &&
            typeof (log.payload as { softBounceCount: unknown }).softBounceCount === 'number'
          ) {
            count = (log.payload as { softBounceCount: number }).softBounceCount + 1;
          }

          if (count >= 3) {
            await prisma.user.update({
              where: { id: user.id },
              data: { emailBounced: true },
            });
          }

          await prisma.emailDeliveryLog.create({
            data: {
              userId: user.id,
              toEmail: email,
              templateKey: 'bounce',
              subject: 'Bounce',
              category: 'system',
              status: 'SKIPPED',
              provider: 'webhook',
              providerMessageId: event.message_id,
              errorMessage: `Soft bounce: ${event.diagnostic_code || 'unknown'}`,
              payload: { ...event, softBounceCount: count },
            },
          });
        }
      } else if (event.type === 'complaint' || event.type === 'spam') {
        await prisma.user.update({
          where: { id: user.id },
          data: { emailBounced: true },
        });
        await prisma.emailDeliveryLog.create({
          data: {
            userId: user.id,
            toEmail: email,
            templateKey: 'complaint',
            subject: 'Complaint',
            category: 'system',
            status: 'SKIPPED',
            provider: 'webhook',
            providerMessageId: event.message_id,
            errorMessage: 'Spam complaint received',
            payload: event,
          },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
