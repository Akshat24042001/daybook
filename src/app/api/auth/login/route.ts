import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/clock";
import { createSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { password } = await req.json() as { password?: string };
  const expected = process.env.ADMIN_PASSWORD?.trim() ?? "";
  if (!expected || !safeEqual(password ?? "", expected)) {
    // slow down guessing
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const cookie = await createSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookie.name, cookie.value, cookie.options as Parameters<typeof res.cookies.set>[2]);
  return res;
}
