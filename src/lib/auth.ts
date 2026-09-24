import { cookies } from "next/headers";
import {
  SESSION_COOKIE, SESSION_TTL_SEC, makeToken, sessionCookieOptions, verifyToken,
} from "@/lib/session-token";

export function adminPassword(): string | null {
  return process.env.ADMIN_PASSWORD?.trim() || null;
}

export async function isAuthenticated(): Promise<boolean> {
  const jar = await cookies();
  return verifyToken("session", jar.get(SESSION_COOKIE)?.value);
}

/** A signed, expiring session cookie. It does not contain the password. */
export async function createSession(): Promise<{ name: string; value: string; options: object }> {
  const value = await makeToken("session", SESSION_TTL_SEC);
  if (!value) throw new Error("ADMIN_PASSWORD is not set");
  return { name: SESSION_COOKIE, value, options: sessionCookieOptions };
}

export async function clearSession(): Promise<{ name: string; value: string; options: object }> {
  return {
    name: SESSION_COOKIE,
    value: "",
    options: { httpOnly: true, path: "/", maxAge: 0 },
  };
}
