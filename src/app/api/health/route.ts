import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const STALE_TICK_SECONDS = 10 * 60;

/** Used by the red "scheduler stopped" banner. Behind the login like every other page. */
export async function GET() {
  try {
    const s = await getSettings();
    const last = s.last_tick_at;
    const ageSec = last ? Math.round((Date.now() - last.getTime()) / 1000) : null;
    return NextResponse.json({
      ok: true,
      lastTickAt: last?.toISOString() ?? null,
      ageSec,
      stale: ageSec === null || ageSec > STALE_TICK_SECONDS,
    });
  } catch {
    return NextResponse.json({ ok: false, stale: true, lastTickAt: null, ageSec: null }, { status: 503 });
  }
}
