/**
 * Signed, expiring tokens for the login cookie and for Telegram deep links. They never contain the password.
 *
 * token = "<expiry unix seconds>.<HMAC-SHA256(secret, kind.expiry) as base64url>"
 * The secret is AUTH_SECRET when set, otherwise derived from ADMIN_PASSWORD, so changing the password
 * signs out every session and kills every old link.
 *
 * Uses Web Crypto only, so the same code runs in the edge middleware and on the Node server.
 */

export const SESSION_COOKIE = "daybook_session";
export const LINK_PARAM = "t";
export const SESSION_TTL_SEC = 60 * 60 * 24 * 90; // 90 days
export const LINK_TTL_SEC = 60 * 60 * 24 * 14; // Telegram links stay usable for two weeks

export type TokenKind = "session" | "link";

export function tokenSecret(): string | null {
  const explicit = process.env.AUTH_SECRET?.trim();
  if (explicit) return explicit;
  const pw = process.env.ADMIN_PASSWORD?.trim();
  return pw ? `daybook-auth-v1:${pw}` : null;
}

function base64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(kind: TokenKind, exp: number, key: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(await crypto.subtle.sign("HMAC", k, enc.encode(`${kind}.${exp}`)));
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function makeToken(kind: TokenKind, ttlSec: number, nowMs = Date.now()): Promise<string | null> {
  const key = tokenSecret();
  if (!key) return null;
  const exp = Math.floor(nowMs / 1000) + ttlSec;
  return `${exp}.${await sign(kind, exp, key)}`;
}

export async function verifyToken(kind: TokenKind, token: string | null | undefined, nowMs = Date.now()): Promise<boolean> {
  const key = tokenSecret();
  if (!key || !token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isInteger(exp) || exp * 1000 < nowMs) return false;
  return sameString(token.slice(dot + 1), await sign(kind, exp, key));
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SEC,
};
