import { NextResponse } from "next/server";
import { REP_COOKIE, repCookieOptions } from "@/lib/team/rep-token";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(REP_COOKIE, "", { ...repCookieOptions, maxAge: 0 });
  return res;
}
