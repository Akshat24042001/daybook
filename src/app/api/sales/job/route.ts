import { after, NextResponse } from "next/server";
import { safeEqual } from "@/lib/clock";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Runs one queued sales job right away, in its own slot (see kickJob). Same secret as the scheduler. */
export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!expected || !safeEqual(given, expected)) return new NextResponse("forbidden", { status: 403 });
  const { id } = (await req.json().catch(() => ({}))) as { id?: unknown };
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) return NextResponse.json({ ok: false, error: "no job" }, { status: 400 });
  after(async () => {
    const [{ runJobNow }, { HANDLERS }] = await Promise.all([import("@/lib/sales/jobs"), import("@/lib/sales/run")]);
    await runJobNow(jobId, HANDLERS).catch((e: Error) => console.warn("[sales] job now:", e.message));
  });
  return NextResponse.json({ ok: true });
}
