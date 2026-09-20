import { cookies } from "next/headers";
import { safeEqual } from "@/lib/clock";

const SESSION_COOKIE = "daybook_session";
const SESSION_VALUE = "authenticated";

export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/telegram" ||
    pathname.startsWith("/api/cron/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/offline.html" ||
    /^\/icon-\d+\.png$/.test(pathname) ||
    pathname === "/favicon.ico"
  );
}

export function adminPassword(): string | null {
  return process.env.ADMIN_PASSWORD?.trim() || null;
}

export async function isAuthenticated(): Promise<boolean> {
  const jar = await cookies();
  const val = jar.get(SESSION_COOKIE)?.value ?? "";
  const expected = `${SESSION_VALUE}:${adminPassword()}`;
  return safeEqual(val, expected);
}

export async function createSession(): Promise<{ name: string; value: string; options: object }> {
  return {
    name: SESSION_COOKIE,
    value: `${SESSION_VALUE}:${adminPassword()}`,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 90, // 90 days
    },
  };
}

export async function clearSession(): Promise<{ name: string; value: string; options: object }> {
  return {
    name: SESSION_COOKIE,
    value: "",
    options: { httpOnly: true, path: "/", maxAge: 0 },
  };
}
