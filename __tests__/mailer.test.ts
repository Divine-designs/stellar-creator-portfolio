import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { renderTemplate, sendMail } from "../lib/email/mailer";

describe("mailer", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses the console transport in development", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.EMAIL_PROVIDER;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await sendMail({ to: "user@example.com", subject: "Hi", text: "Hello" });

    expect(result).toEqual({ ok: true, provider: "console" });
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("sends via Resend when configured", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "test-key";
    process.env.EMAIL_FROM = "no-reply@example.com";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "email_123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendMail({ to: "user@example.com", subject: "Hi", html: "<p>Hello</p>" });

    expect(result).toEqual({ ok: true, provider: "resend", id: "email_123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({
      from: "no-reply@example.com",
      to: ["user@example.com"],
      subject: "Hi",
    });
  });

  it("returns an error result when Resend fails", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "test-key";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }),
    );

    const result = await sendMail({ to: "user@example.com", subject: "Hi", text: "Hello" });

    expect(result.ok).toBe(false);
    expect(result.provider).toBe("resend");
    expect(result.error).toBe("boom");
  });

  it("renders templates from lib/email/templates", () => {
    const html = renderTemplate({
      template: "welcome",
      context: { name: "Ada" },
    });

    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });
});
