import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { shotFile } from "@/lib/sales/shots";
import { currentRep, NotSignedIn } from "@/lib/team/users";

export const dynamic = "force-dynamic";

/** A screenshot on one of their leads, only if they took it or it was shared with them. Anything else: not found. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; i: string }> }) {
  let rep;
  try {
    rep = await currentRep();
  } catch (e) {
    if (e instanceof NotSignedIn) return new NextResponse("Not found", { status: 404 });
    throw e;
  }
  const { id, i } = await params;
  const ok = await one(
    `select 1 from sales_captures c join sales_deal_access a on a.deal_id = c.deal_id and a.user_id = $2
     where c.id = $1 and c.status <> 'ignored' and (c.author_user = $2 or $2 = any(c.shared_with))`,
    [Number(id), rep.id],
  ).catch(() => null);
  if (!ok) return new NextResponse("Not found", { status: 404 });
  const f = await shotFile(Number(id), Number(i)).catch(() => null);
  if (!f) return new NextResponse("Not found", { status: 404 });
  if ("redirect" in f) return NextResponse.redirect(f.redirect, 302);
  return new NextResponse(Buffer.from(f.data), { headers: { "content-type": f.mime, "cache-control": "private, max-age=3600" } });
}
