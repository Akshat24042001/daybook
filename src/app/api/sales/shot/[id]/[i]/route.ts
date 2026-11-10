import { NextResponse } from "next/server";
import { shotFile } from "@/lib/sales/shots";

export const dynamic = "force-dynamic";

/** A screenshot you shared, for your own eyes only (this path is behind the login, like the rest of the app). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; i: string }> }) {
  const { id, i } = await params;
  const f = await shotFile(Number(id), Number(i)).catch(() => null);
  if (!f) return new NextResponse("Not found", { status: 404 });
  if ("redirect" in f) return NextResponse.redirect(f.redirect, 302);
  return new NextResponse(Buffer.from(f.data), { headers: { "content-type": f.mime, "cache-control": "private, max-age=86400" } });
}
