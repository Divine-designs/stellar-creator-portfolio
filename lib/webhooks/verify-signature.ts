import crypto from "crypto";

export type WebhookProvider = "ses" | "resend" | "postmark";

export interface VerifyResult {
  ok: boolean;
  provider?: WebhookProvider;
  reason?: string;
}

const MAX_SKEW_SECONDS = 5 * 60;

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function hmacHex(secret: string, payload: string, algo: string): string {
  return crypto.createHmac(algo, secret).update(payload, "utf8").digest("hex");
}

function hmacBase64(secret: string, payload: string, algo: string): string {
  return crypto.createHmac(algo, secret).update(payload, "utf8").digest("base64");
}

function verifyResend(headers: Headers, rawBody: string): VerifyResult {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: "missing_resend_secret" };

  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return { ok: false, reason: "missing_svix_headers" };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid_timestamp" };
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "expired_timestamp" };
  }

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const key = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice("whsec_".length), "base64")
    : Buffer.from(secret, "utf8");
  const expected = crypto
    .createHmac("sha256", key)
    .update(signedContent, "utf8")
    .digest("base64");

  const provided = signature
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1,"))
    .map((part) => part.slice(3));

  if (provided.length === 0) return { ok: false, reason: "missing_signature" };
  const matched = provided.some((sig) => timingSafeEqual(sig, expected));
  return matched ? { ok: true, provider: "resend" } : { ok: false, reason: "invalid_signature" };
}

function verifyPostmark(headers: Headers, rawBody: string): VerifyResult {
  const secret = process.env.POSTMARK_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: "missing_postmark_secret" };

  const signature = headers.get("x-postmark-signature");
  if (!signature) return { ok: false, reason: "missing_signature" };

  const expected = hmacBase64(secret, rawBody, "sha256");
  return timingSafeEqual(signature, expected)
    ? { ok: true, provider: "postmark" }
    : { ok: false, reason: "invalid_signature" };
}

function verifySes(headers: Headers, rawBody: string): VerifyResult {
  const topicArn = process.env.SES_SNS_TOPIC_ARN;
  if (!topicArn) return { ok: false, reason: "missing_sns_topic" };

  const signature = headers.get("x-amz-sns-signature");
  const signatureVersion = headers.get("x-amz-sns-signature-version");
  if (!signature || !signatureVersion) {
    return { ok: false, reason: "missing_sns_signature" };
  }

  let message: Record<string, unknown>;
  try {
    message = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  if (message.TopicArn !== topicArn) {
    return { ok: false, reason: "unexpected_topic" };
  }

  const type = message.Type;
  if (type !== "Notification" && type !== "SubscriptionConfirmation") {
    return { ok: false, reason: "unsupported_sns_type" };
  }

  const canonicalFields = [
    "Message",
    "MessageId",
    type === "SubscriptionConfirmation" ? "SubscribeURL" : null,
    "Timestamp",
    "TopicArn",
    "Type",
  ].filter((field): field is string => field !== null);

  const canonical = canonicalFields
    .map((field) => `${field}\n${String(message[field] ?? "")}\n`)
    .join("");

  const algo = signatureVersion === "2" ? "sha256" : "sha1";
  const expected = crypto
    .createHmac(algo, process.env.AWS_SECRET_ACCESS_KEY ?? "")
    .update(canonical, "utf8")
    .digest("base64");

  if (!process.env.AWS_SECRET_ACCESS_KEY) {
    return { ok: false, reason: "missing_aws_secret" };
  }

  return timingSafeEqual(signature, expected)
    ? { ok: true, provider: "ses" }
    : { ok: false, reason: "invalid_signature" };
}

function detectProvider(headers: Headers): WebhookProvider | null {
  if (headers.get("x-amz-sns-message-type") || headers.get("x-amz-sns-signature")) {
    return "ses";
  }
  if (headers.get("svix-signature") || headers.get("svix-id")) {
    return "resend";
  }
  if (headers.get("x-postmark-signature")) {
    return "postmark";
  }
  return null;
}

export function verifyWebhookSignature(
  headers: Headers,
  rawBody: string,
): VerifyResult {
  const provider = detectProvider(headers);
  if (!provider) return { ok: false, reason: "unknown_provider" };

  switch (provider) {
    case "ses":
      return verifySes(headers, rawBody);
    case "resend":
      return verifyResend(headers, rawBody);
    case "postmark":
      return verifyPostmark(headers, rawBody);
    default:
      return { ok: false, reason: "unknown_provider" };
  }
}
