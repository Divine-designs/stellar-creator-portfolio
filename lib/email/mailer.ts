import fs from "node:fs";
import path from "node:path";

import Handlebars from "handlebars";

export type MailProvider = "resend" | "ses" | "smtp" | "console";

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
}

export interface SendMailResult {
  ok: boolean;
  provider: MailProvider;
  id?: string;
  error?: string;
}

export interface RenderTemplateOptions {
  template: string;
  context?: Record<string, unknown>;
}

const TEMPLATES_DIR = path.join(process.cwd(), "lib", "email", "templates");

const templateCache = new Map<string, Handlebars.TemplateDelegate>();

function resolveProvider(): MailProvider {
  const explicit = process.env.EMAIL_PROVIDER?.toLowerCase();
  if (explicit === "resend" || explicit === "ses" || explicit === "smtp" || explicit === "console") {
    return explicit;
  }
  if (process.env.NODE_ENV !== "production") {
    return "console";
  }
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.AWS_SES_REGION || process.env.SES_REGION) return "ses";
  if (process.env.SMTP_HOST) return "smtp";
  return "console";
}

function loadTemplate(template: string): Handlebars.TemplateDelegate {
  const cached = templateCache.get(template);
  if (cached) return cached;

  const safeName = template.replace(/\.hbs$/, "");
  const filePath = path.join(TEMPLATES_DIR, `${safeName}.hbs`);
  const source = fs.readFileSync(filePath, "utf8");
  const compiled = Handlebars.compile(source);
  templateCache.set(template, compiled);
  return compiled;
}

export function renderTemplate({ template, context = {} }: RenderTemplateOptions): string {
  return loadTemplate(template)(context);
}

function normalizeRecipients(to: string | string[]): string[] {
  return Array.isArray(to) ? to : [to];
}

async function sendWithResend(options: SendMailOptions): Promise<SendMailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, provider: "resend", error: "RESEND_API_KEY is not set" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "no-reply@localhost",
      to: normalizeRecipients(options.to),
      subject: options.subject,
      html: options.html,
      text: options.text,
      headers: options.headers,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { ok: false, provider: "resend", error: detail || `Resend responded ${response.status}` };
  }

  const data = (await response.json().catch(() => ({}))) as { id?: string };
  return { ok: true, provider: "resend", id: data.id };
}

async function sendWithSes(options: SendMailOptions): Promise<SendMailResult> {
  const region = process.env.AWS_SES_REGION ?? process.env.SES_REGION;
  if (!region) {
    return { ok: false, provider: "ses", error: "AWS_SES_REGION is not set" };
  }

  const { SESClient, SendEmailCommand } = await import("@aws-sdk/client-ses");
  const client = new SESClient({ region });

  const command = new SendEmailCommand({
    Source: process.env.EMAIL_FROM ?? "no-reply@localhost",
    Destination: { ToAddresses: normalizeRecipients(options.to) },
    Message: {
      Subject: { Data: options.subject },
      Body: {
        ...(options.html ? { Html: { Data: options.html } } : {}),
        ...(options.text ? { Text: { Data: options.text } } : {}),
      },
    },
  });

  const result = await client.send(command);
  return { ok: true, provider: "ses", id: result.MessageId };
}

async function sendWithSmtp(options: SendMailOptions): Promise<SendMailResult> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    return { ok: false, provider: "smtp", error: "SMTP_HOST is not set" };
  }

  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });

  const info = await transport.sendMail({
    from: process.env.EMAIL_FROM ?? "no-reply@localhost",
    to: normalizeRecipients(options.to),
    subject: options.subject,
    html: options.html,
    text: options.text,
    headers: options.headers,
  });

  return { ok: true, provider: "smtp", id: info.messageId };
}

function sendWithConsole(options: SendMailOptions): SendMailResult {
  // eslint-disable-next-line no-console
  console.info("[email:console]", {
    to: normalizeRecipients(options.to),
    subject: options.subject,
    text: options.text,
    html: options.html,
    headers: options.headers,
  });
  return { ok: true, provider: "console" };
}

export async function sendMail(options: SendMailOptions): Promise<SendMailResult> {
  const provider = resolveProvider();

  try {
    switch (provider) {
      case "resend":
        return await sendWithResend(options);
      case "ses":
        return await sendWithSes(options);
      case "smtp":
        return await sendWithSmtp(options);
      case "console":
      default:
        return sendWithConsole(options);
    }
  } catch (error) {
    return {
      ok: false,
      provider,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
