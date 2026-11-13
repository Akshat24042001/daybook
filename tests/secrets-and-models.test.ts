// Adding AUTH_SECRET must not break what was made before it; Gemini models come from Google's live list.
import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verify, sign } from "@/lib/sales/links";
import { decryptSecret, encryptSecret } from "@/lib/team/credentials";
import { makeToken, verifyToken } from "@/lib/session-token";
import { geminiModels, pickGeminiModels } from "@/lib/sales/gemini-models";
import { llm } from "@/lib/sales/llm";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  (globalThis as unknown as { __geminiModels?: unknown }).__geminiModels = null;
  (globalThis as unknown as { __llmCool?: Map<string, number> }).__llmCool?.clear();
});

describe("after AUTH_SECRET is added", () => {
  it("go links signed earlier with CRON_SECRET still open; forged ones do not", () => {
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("CRON_SECRET", "old-cron-secret");
    const old = sign("12.whatsapp");
    vi.stubEnv("AUTH_SECRET", "brand-new-auth-secret-0123456789");
    expect(sign("12.whatsapp")).not.toBe(old);
    expect(verify("12.whatsapp", old)).toBe(true);
    expect(verify("12.whatsapp", sign("12.whatsapp"))).toBe(true);
    expect(verify("13.whatsapp", old)).toBe(false);
    expect(verify("12.whatsapp", "AAAAAAAAAAAAAAAAAAAAAA")).toBe(false);
    const forged = createHmac("sha256", "guess").update("12.whatsapp").digest("base64url").slice(0, 22);
    expect(verify("12.whatsapp", forged)).toBe(false);
  });

  it("sales team passwords saved before can still be shown; new ones use the new key", () => {
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("CREDENTIALS_KEY", "");
    vi.stubEnv("ADMIN_PASSWORD", "owner-pw");
    const before = encryptSecret("riya2026sales");
    vi.stubEnv("AUTH_SECRET", "brand-new-auth-secret-0123456789");
    expect(decryptSecret(before)).toBe("riya2026sales");
    const after = encryptSecret("arjun2026sales");
    expect(decryptSecret(after)).toBe("arjun2026sales");
    // a copy locked with some other key stays unreadable
    const k = createHash("sha256").update("something else").digest();
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", k, iv);
    const ct = Buffer.concat([c.update("x"), c.final()]);
    expect(decryptSecret(`gcm1$${iv.toString("base64")}$${c.getAuthTag().toString("base64")}$${ct.toString("base64")}`)).toBeNull();
  });

  it("Telegram open links from before keep working for their two weeks; old sessions do not", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("ADMIN_PASSWORD", "owner-pw");
    const link = await makeToken("link", 3600);
    const session = await makeToken("session", 3600);
    vi.stubEnv("AUTH_SECRET", "brand-new-auth-secret-0123456789");
    expect(await verifyToken("link", link)).toBe(true);
    expect(await verifyToken("session", session)).toBe(false);
    expect(await verifyToken("session", await makeToken("session", 3600))).toBe(true);
  });
});

describe("Gemini models", () => {
  it("picks stable Flash models, newest first, then Flash-Lite; never preview, Pro, image or speech", () => {
    const list = [
      "models/gemini-2.0-flash", "models/gemini-2.5-flash", "models/gemini-3.0-flash", "models/gemini-2.5-flash-lite",
      "models/gemini-2.5-pro", "models/gemini-3.0-flash-preview-09", "models/gemini-2.5-flash-image", "models/gemini-2.5-flash-preview-tts",
      "models/text-embedding-004",
    ].map((name) => ({ name, supportedGenerationMethods: ["generateContent"] }));
    expect(pickGeminiModels(list)).toEqual(["gemini-3.0-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"]);
    expect(pickGeminiModels([{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["embedContent"] }])).toEqual([]);
  });

  it("uses Google's list for the key, and a safe fallback when it cannot be read", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("GEMINI_MODELS", "");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] }))));
    expect(await geminiModels()).toEqual(["gemini-2.5-flash"]);
    (globalThis as unknown as { __geminiModels?: unknown }).__geminiModels = null;
    vi.resetModules();
    const fresh = await import("@/lib/sales/gemini-models");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    expect((await fresh.geminiModels()).length).toBeGreaterThan(0);
    vi.stubEnv("GEMINI_MODELS", "my-model");
    expect(await fresh.geminiModels()).toEqual(["my-model"]);
  });

  it("asks Gemini to think briefly and leaves room for the thinking", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("GEMINI_MODELS", "gemini-2.5-flash");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    }));
    await llm([{ role: "user", content: "hi" }], { maxTokens: 500 });
    expect(bodies[0]).toMatchObject({ model: "gemini-2.5-flash", reasoning_effort: "low", max_tokens: 2548 });
  });
});
