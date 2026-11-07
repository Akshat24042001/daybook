import { NextResponse } from "next/server";
import { markOpened, targetsFor } from "@/lib/sales/act";
import { verify } from "@/lib/sales/links";
import { getMove } from "@/lib/sales/moves";

export const dynamic = "force-dynamic";

/**
 * One-tap link from Telegram: opens the real destination (WhatsApp with the text, their LinkedIn, the Reddit post...).
 * It does NOT log anything as sent: it only remembers which channel you opened, so the "Sent it" button can log it
 * once you confirm.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = Number(u.searchParams.get("m"));
  const t = u.searchParams.get("c") ?? "";
  if (!id || !/^[a-z_]{2,20}$/.test(t) || !verify(`${id}.${t}`, u.searchParams.get("s"))) return new NextResponse("This link is not valid.", { status: 403 });
  const m = await getMove(id);
  if (!m) return new NextResponse("That move no longer exists.", { status: 404 });
  const target = targetsFor(m, false).find((x) => x.id === t && x.url);
  if (!target?.url) return NextResponse.redirect(new URL(m.deal_id ? `/sales/deal/${m.deal_id}` : "/sales", u.origin));
  // link previews (Telegram, WhatsApp) fetch links too: only a real tap counts as opening
  const ua = req.headers.get("user-agent") ?? "";
  if (!/bot|preview|telegram|whatsapp|facebookexternalhit|slack/i.test(ua) && target.log) await markOpened(id, t);
  return NextResponse.redirect(target.url, 302);
}
