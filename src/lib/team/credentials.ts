/**
 * Salesperson passwords (server only).
 *   pass_hash  salted scrypt: how a sign-in is checked; cannot be turned back into the password
 *   pass_enc   AES-256-GCM encrypted copy, so the owner can read it back in Sales settings
 * The encryption key comes from CREDENTIALS_KEY when set, else from AUTH_SECRET (or the admin password). If that
 * secret changes, the readable copy cannot be opened any more (sign-ins still work); set a new password then.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { tokenSecret } from "../session-token";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, 32, PARAMS);
  return `scrypt$${salt.toString("base64")}$${h.toString("base64")}`;
}

export async function checkPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, h] = stored.split("$");
  if (alg !== "scrypt" || !s || !h) return false;
  const want = Buffer.from(h, "base64");
  const got = await scrypt(pw, Buffer.from(s, "base64"), want.length, PARAMS);
  return got.length === want.length && timingSafeEqual(got, want);
}

function encKey(): Buffer {
  const secret = process.env.CREDENTIALS_KEY?.trim() || tokenSecret();
  if (!secret) throw new Error("Set AUTH_SECRET (or CREDENTIALS_KEY) to store sales team passwords.");
  return createHash("sha256").update(`daybook-team-credentials-v1:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `gcm1$${iv.toString("base64")}$${c.getAuthTag().toString("base64")}$${ct.toString("base64")}`;
}

export function decryptSecret(stored: string): string | null {
  try {
    const [v, iv, tag, ct] = stored.split("$");
    if (v !== "gcm1") return null;
    const d = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Rules for what the owner types: usernames are simple and unique; passwords long enough to resist guessing. */
export function checkUsername(u: string): string | null {
  const t = u.trim();
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(t)) return "A username is 3 to 40 letters, numbers, dots, dashes or underscores.";
  return null;
}

export function checkNewPassword(p: string): string | null {
  if (p.length < 10) return "Use at least 10 characters.";
  if (p.length > 128) return "Keep it under 128 characters.";
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) return "Mix letters and numbers.";
  return null;
}
