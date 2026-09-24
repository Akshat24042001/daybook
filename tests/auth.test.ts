import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LINK_TTL_SEC, SESSION_TTL_SEC, makeToken, verifyToken } from "@/lib/session-token";
import { appUrl, linkToken } from "@/lib/telegram/ui";

const saved = { pw: process.env.ADMIN_PASSWORD, secret: process.env.AUTH_SECRET, base: process.env.APP_BASE_URL };

describe("login tokens never expose the password", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "hunter2-super-secret";
    delete process.env.AUTH_SECRET;
    process.env.APP_BASE_URL = "https://daybook.example.test";
  });
  afterEach(() => {
    // assigning undefined to process.env stores the string "undefined", so delete instead
    const restore = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
    restore("ADMIN_PASSWORD", saved.pw);
    restore("AUTH_SECRET", saved.secret);
    restore("APP_BASE_URL", saved.base);
  });

  it("session tokens verify, and do not contain the password", async () => {
    const t = await makeToken("session", SESSION_TTL_SEC);
    expect(t).toBeTruthy();
    expect(t).not.toContain("hunter2");
    expect(await verifyToken("session", t)).toBe(true);
  });

  it("rejects expired, tampered, wrong-kind and empty tokens", async () => {
    const t = (await makeToken("session", 60))!;
    expect(await verifyToken("session", t, Date.now() + 61_000)).toBe(false);
    expect(await verifyToken("session", `${t}x`)).toBe(false);
    const [exp, sig] = t.split(".");
    expect(await verifyToken("session", `${Number(exp) + 1000}.${sig}`)).toBe(false);
    expect(await verifyToken("link", t)).toBe(false);
    expect(await verifyToken("session", "")).toBe(false);
    expect(await verifyToken("session", "authenticated:hunter2-super-secret")).toBe(false); // the old cookie format
  });

  it("changing the password signs out old sessions and links", async () => {
    const t = (await makeToken("session", SESSION_TTL_SEC))!;
    process.env.ADMIN_PASSWORD = "a-new-password";
    expect(await verifyToken("session", t)).toBe(false);
  });

  it("Telegram links carry a two-week link token made by Node crypto that the edge check accepts", async () => {
    const url = appUrl("/today", true);
    expect(url).not.toContain("hunter2");
    expect(url).not.toContain("auth=");
    const token = new URL(url).searchParams.get("t");
    expect(await verifyToken("link", token)).toBe(true);
    expect(await verifyToken("session", token)).toBe(false);
    const exp = Number(linkToken()!.split(".")[0]);
    expect(exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(LINK_TTL_SEC);
  });

  it("no password configured means no tokens at all", async () => {
    delete process.env.ADMIN_PASSWORD;
    expect(await makeToken("session", 60)).toBeNull();
    expect(appUrl("/today", true)).toBe("https://daybook.example.test/today");
  });
});
