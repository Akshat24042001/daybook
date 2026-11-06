import { NextResponse } from "next/server";
import { addViewSeconds } from "@/lib/sales/docs";
import { verify } from "@/lib/sales/links";

export const dynamic = "force-dynamic";

/** Time-on-page beacon from a tracked document. */
export async function POST(req: Request) {
  try {
    const b = JSON.parse(await req.text()) as { v?: number; s?: number; k?: string };
    if (b.v && verify(`view.${b.v}`, b.k)) await addViewSeconds(Number(b.v), Number(b.s) || 0);
  } catch {
    /* beacons are best effort */
  }
  return new NextResponse(null, { status: 204 });
}
