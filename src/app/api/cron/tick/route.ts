import { after, NextResponse } from "next/server";
import { safeEqual } from "@/lib/clock";
import { runNightlyDiary, runNightlyReview, runTick } from "@/lib/telegram/tick";
import { runSalesTick } from "@/lib/sales/run";
import { inBackground } from "@/lib/ai-quota";

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
    // everything the tick does on its own is background work: it never uses the AI allowance kept for you
    const report = await inBackground(() => runTick());
    // The nightly diary summary can take up to a minute with free AI models: do it after answering the cron call.
    // Sales: jobs (AI capture, enrichment, radar), briefs, digests. Runs in its own background slot.
    after(async () => {
      const r = await inBackground(() => runSalesTick()).catch((e: Error) => `failed: ${e.message}`);
      if (r.startsWith("failed")) console.warn("[sales] tick:", r);
    });
    after(async () => {
      const quiet = ["not-yet", "not-today", "done-already", "ai-off"];
      const r = await inBackground(() => runNightlyDiary()).catch((e: Error) => `failed: ${e.message}`);
      if (!quiet.includes(r)) console.log("[diary] nightly:", r);
      const rv = await inBackground(() => runNightlyReview()).catch((e: Error) => `failed: ${e.message}`);
      if (!quiet.includes(rv)) console.log("[review] nightly:", rv);
    });
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    console.error("[tick] failed:", (e as Error).name, (e as Error).message);
    return NextResponse.json({ ok: false, error: "tick failed" }, { status: 500 });
  }
}
