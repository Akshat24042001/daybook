import { NextResponse, type NextRequest } from "next/server";
import {
  LINK_PARAM, SESSION_COOKIE, SESSION_TTL_SEC, makeToken, sessionCookieOptions, verifyToken,
} from "@/lib/session-token";

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/telegram" ||
    // MCP: no browser session; the route checks its own bearer token (MCP_TOKEN)
    pathname === "/api/mcp" ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/auth/") ||
    // Sales: client-facing documents and links (no password for clients), and token/secret-checked webhooks
    pathname.startsWith("/q/") ||
    pathname.startsWith("/l/") ||
    pathname === "/api/sales/capture" ||
    pathname === "/api/sales/google" ||
    pathname === "/api/sales/go" ||
    pathname === "/api/sales/view" ||
    pathname === "/api/sales/respond" ||
    pathname.startsWith("/api/sales/file/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/offline.html" ||
    /^\/icon-\d+\.png$/.test(pathname) ||
    pathname === "/favicon.ico"
  );
}

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // Telegram buttons carry a signed, expiring link token (never the password). Swap it for a session
  // cookie and drop it from the address so it does not linger in history.
  const link = searchParams.get(LINK_PARAM);
  if (link !== null) {
    const dest = req.nextUrl.clone();
    dest.searchParams.delete(LINK_PARAM);
    dest.searchParams.delete("auth"); // links from before this change
    const res = NextResponse.redirect(dest);
    if (await verifyToken("link", link)) {
      const session = await makeToken("session", SESSION_TTL_SEC);
      if (session) res.cookies.set(SESSION_COOKIE, session, sessionCookieOptions);
    }
    return res;
  }
  // Old links put the password in the URL. Never honour them; just strip it.
  if (searchParams.has("auth")) {
    const dest = req.nextUrl.clone();
    dest.searchParams.delete("auth");
    return NextResponse.redirect(dest);
  }

  if (isPublicPath(pathname)) return NextResponse.next();

  if (!(await verifyToken("session", req.cookies.get(SESSION_COOKIE)?.value))) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const login = new URL("/login", req.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
