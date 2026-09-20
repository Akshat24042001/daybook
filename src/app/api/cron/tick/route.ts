import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/clock";
import { runTick } from "@/lib/telegram/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Called every minute by Vercel Cron with the CRON_SECRET in the Authorization header. */
export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  // Vercel Cron sends: Authorization: Bearer <CRON_SECRET>
  // Legacy / manual calls may use: x-cron-secret: <CRON_SECRET>
  const given =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.headers.get("x-cron-secret");
  if (!expected || !safeEqual(given, expected)) {
    return new NextResponse("forbidden", { status: 403 });
  }
  try {
    const report = await runTick();
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    console.error("[tick] failed:", (e as Error).name, (e as Error).message);
    return NextResponse.json({ ok: false, error: "tick failed" }, { status: 500 });
  }
}
