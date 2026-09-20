import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "daybook_session";

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/telegram" ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/offline.html" ||
    /^\/icon-\d+\.png$/.test(pathname) ||
    pathname === "/favicon.ico"
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const password = process.env.ADMIN_PASSWORD ?? "";
  const session = req.cookies.get(SESSION_COOKIE)?.value ?? "";

  // ?auth=<password> in URL — used by Telegram deep links to auto-authenticate
  // in Telegram's WebView where the session cookie doesn't exist.
  const authParam = req.nextUrl.searchParams.get("auth");
  if (authParam && password && authParam === password) {
    const dest = req.nextUrl.clone();
    dest.searchParams.delete("auth");
    const res = NextResponse.redirect(dest);
    res.cookies.set(SESSION_COOKIE, password, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });
    return res;
  }

  if (!password || !session.includes(password)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
