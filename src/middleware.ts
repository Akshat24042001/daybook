import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/auth";

const SESSION_COOKIE = "daybook_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const session = req.cookies.get(SESSION_COOKIE)?.value ?? "";
  const password = process.env.ADMIN_PASSWORD?.trim() ?? "";

  // Simple check: session must contain the password (set by the login action)
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
