import { after, NextResponse } from "next/server";
import { safeEqual } from "@/lib/clock";
import { salesRow } from "@/lib/sales/config";
import { capture } from "@/lib/sales/ingest";
import { ownerChat } from "@/lib/sales/notify";
import { processAndReport } from "@/lib/sales/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, x-capture-token" };

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Capture endpoint for the bookmarklet (LinkedIn, Instagram web, any page) and the iPhone Shortcut (share sheet).
 * Body (JSON, sent as text/plain to skip CORS preflight): { token, text, url?, title?, images?: [data URLs], channel?, direction? }
 */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    body = raw.trim().startsWith("{") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
  } catch {
    return NextResponse.json({ ok: false, error: "bad body" }, { status: 400, headers: CORS });
  }
  const token = String(body.token ?? req.headers.get("x-capture-token") ?? new URL(req.url).searchParams.get("token") ?? "");
  const row = await salesRow();
  if (!safeEqual(token, row.capture_token)) return NextResponse.json({ ok: false, error: "bad token" }, { status: 403, headers: CORS });
  const text = String(body.text ?? "").slice(0, 60_000);
  const images = Array.isArray(body.images) ? (body.images as unknown[]).filter((x): x is string => typeof x === "string" && x.startsWith("data:image/")).slice(0, 4) : [];
  if (!text.trim() && !images.length) return NextResponse.json({ ok: false, error: "nothing to capture" }, { status: 400, headers: CORS });
  const chat = await ownerChat();
  const id = await capture(
    {
      source: String(body.source ?? "bookmarklet").slice(0, 30),
      channel: body.channel ? String(body.channel) : /linkedin\.com/.test(String(body.url ?? "")) ? "linkedin" : /instagram\.com/.test(String(body.url ?? "")) ? "instagram" : null,
      text,
      images,
      hints: { ...(body.url ? { url: String(body.url).slice(0, 500) } : {}), ...(body.title ? { page_title: String(body.title).slice(0, 300) } : {}), ...(body.direction ? { direction: body.direction } : {}) } as never,
      tg_chat: chat,
    },
    { now: true },
  );
  after(() => processAndReport(id));
  return NextResponse.json({ ok: true, id, message: "Got it. Logging to Sales, check Telegram." }, { headers: CORS });
}
