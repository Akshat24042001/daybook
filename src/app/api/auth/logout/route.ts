import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cookie = await clearSession();
  // 303 turns the form POST into a GET of the login page; the URL must be absolute
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.set(cookie.name, cookie.value, cookie.options as Parameters<typeof res.cookies.set>[2]);
  return res;
}
