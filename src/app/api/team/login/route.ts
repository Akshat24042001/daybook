import { NextResponse } from "next/server";
import { REP_COOKIE, repCookieOptions } from "@/lib/team/rep-token";
import { signIn } from "@/lib/team/users";

export const dynamic = "force-dynamic";

/** Salesperson sign-in. JSON only, over HTTPS; the answer never says whether the username exists. */
export async function POST(req: Request) {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
  const r = await signIn(typeof body.username === "string" ? body.username : "", typeof body.password === "string" ? body.password : "");
  if ("error" in r) {
    await new Promise((res) => setTimeout(res, 600));
    return NextResponse.json({ ok: false, error: r.error }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(REP_COOKIE, r.token, repCookieOptions);
  return res;
}
