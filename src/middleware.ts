import { NextResponse, type NextRequest } from "next/server";
import {
  LINK_PARAM, SESSION_COOKIE, SESSION_TTL_SEC, makeToken, sessionCookieOptions, verifyToken,
} from "@/lib/session-token";
import { REP_COOKIE, readRepToken } from "@/lib/team/rep-token";

/** The sales team's area: its own login, pages under /team and its own API under /api/team. Nothing else. */
const isTeamPath = (p: string) => p === "/team" || p.startsWith("/team/") || p.startsWith("/api/team/");
const isTeamPublic = (p: string) => p === "/team/login" || p === "/api/team/login";

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
    pathname === "/logo.svg" ||
    pathname === "/favicon.svg" ||
    pathname === "/apple-touch-icon.png" ||
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

  const owner = await verifyToken("session", req.cookies.get(SESSION_COOKIE)?.value);

  // Server actions are addressed by id, not by page: one could be posted to any URL, a public one included. So
  // every server action needs the owner's session, whatever the path. (The team area uses /api/team only.)
  if (req.headers.has("next-action") && !owner) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // the sales team area: a valid salesperson session (checked again against the database by every handler)
  if (isTeamPath(pathname)) {
    if (isTeamPublic(pathname)) return NextResponse.next();
    if (await readRepToken(req.cookies.get(REP_COOKIE)?.value)) return NextResponse.next();
    if (pathname.startsWith("/api/")) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/team/login", req.url));
  }

  if (isPublicPath(pathname)) return NextResponse.next();

  if (!owner) {
    // a salesperson who wanders outside their area goes back to it; nothing of the owner's app is served
    if (await readRepToken(req.cookies.get(REP_COOKIE)?.value)) {
      if (pathname.startsWith("/api/")) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
      return NextResponse.redirect(new URL("/team", req.url));
    }
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
