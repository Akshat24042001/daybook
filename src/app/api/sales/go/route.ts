import { NextResponse } from "next/server";
import { completeMove, openUrlFor } from "@/lib/sales/act";
import { verify, type GoChannel } from "@/lib/sales/links";
import { getMove } from "@/lib/sales/moves";

export const dynamic = "force-dynamic";

const CHANNELS = new Set(["whatsapp", "email", "linkedin", "instagram", "call", "sms"]);

/** One-tap send: logs the touch (marked "sent from Daybook link"), closes the move, opens the app with the draft ready. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = Number(u.searchParams.get("m"));
  const c = u.searchParams.get("c") ?? "";
  if (!id || !CHANNELS.has(c) || !verify(`${id}.${c}`, u.searchParams.get("s"))) return new NextResponse("This link is not valid.", { status: 403 });
  const m = await getMove(id);
  if (!m) return new NextResponse("That move no longer exists.", { status: 404 });
  const target = openUrlFor(m, c as GoChannel);
  // previews (Telegram, WhatsApp) fetch links too: only a real tap logs it
  const ua = req.headers.get("user-agent") ?? "";
  if (!/bot|preview|telegram|whatsapp|facebookexternalhit|slack/i.test(ua)) await completeMove(id, c as GoChannel, { assumed: true });
  if (!target) return NextResponse.redirect(new URL(`/sales?m=${id}`, u.origin));
  return NextResponse.redirect(target, 302);
}
