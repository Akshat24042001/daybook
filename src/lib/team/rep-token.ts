/**
 * The salesperson's session cookie: an encrypted token (AES-256-GCM), not just a signed one, so its contents
 * (who, which session version, until when) cannot be read or forged. Web Crypto only: the edge middleware checks
 * it before any page or API runs, and the server checks it again together with the database (active, version).
 */
import { tokenSecret } from "../session-token";

export const REP_COOKIE = "daybook_team";
export const REP_TTL_SEC = 60 * 60 * 12; // a working day; they sign in again tomorrow

export interface RepClaims {
  u: number; // sales_users.id
  v: number; // session_version when it was issued
  exp: number; // unix seconds
}

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64 = (s: string): Uint8Array => {
  const t = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
};

async function key(): Promise<CryptoKey | null> {
  const secret = tokenSecret();
  if (!secret) return null;
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`daybook-team-session-v1:${secret}`));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function makeRepToken(userId: number, version: number, nowMs = Date.now()): Promise<string | null> {
  const k = await key();
  if (!k) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const claims: RepClaims = { u: userId, v: version, exp: Math.floor(nowMs / 1000) + REP_TTL_SEC };
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(JSON.stringify(claims))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64(out);
}

/** The claims of a valid, unexpired token; null for anything else (tampered, expired, wrong key, garbage). */
export async function readRepToken(token: string | null | undefined, nowMs = Date.now()): Promise<RepClaims | null> {
  if (!token || token.length > 400) return null;
  try {
    const k = await key();
    if (!k) return null;
    const all = unb64(token);
    if (all.length < 29) return null;
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, k, all.slice(12));
    const c = JSON.parse(new TextDecoder().decode(pt)) as RepClaims;
    if (!Number.isInteger(c.u) || !Number.isInteger(c.v) || !Number.isInteger(c.exp) || c.exp * 1000 < nowMs) return null;
    return c;
  } catch {
    return null;
  }
}

export const repCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: REP_TTL_SEC,
};
