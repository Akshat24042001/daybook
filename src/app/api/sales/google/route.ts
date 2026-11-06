import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/clock";
import { salesRow } from "@/lib/sales/config";
import { alertDomains, ingestCalendar, ingestGmail, ingestTranscripts, type CalEvent, type GmailMsg, type Transcript } from "@/lib/sales/google";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Pushed by the Apps Script in your Google account (integrations/daybook-sales.gs). */
export async function POST(req: Request) {
  let body: { secret?: string; kind?: string; items?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  const row = await salesRow();
  if (!safeEqual(body.secret ?? "", row.google_secret)) return NextResponse.json({ ok: false, error: "bad secret" }, { status: 403 });
  const items = Array.isArray(body.items) ? body.items : [];
  switch (body.kind) {
    case "config":
      return NextResponse.json({ ok: true, domains: await alertDomains() });
    case "gmail":
      return NextResponse.json({ ok: true, ...(await ingestGmail(items as GmailMsg[])) });
    case "calendar":
      return NextResponse.json({ ok: true, events: await ingestCalendar(items as CalEvent[]) });
    case "transcript":
      return NextResponse.json({ ok: true, transcripts: await ingestTranscripts(items as Transcript[]) });
    default:
      return NextResponse.json({ ok: false, error: "unknown kind" }, { status: 400 });
  }
}
