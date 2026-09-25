import { NextResponse } from "next/server";
import { searchAll } from "@/lib/services/search";

export const dynamic = "force-dynamic";

/** Command palette search. Behind the login like every other /api route. */
export async function GET(req: Request) {
  const query = new URL(req.url).searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ ok: true, hits: await searchAll(query) });
  } catch (e) {
    console.error("[search] failed:", (e as Error).name, (e as Error).message);
    return NextResponse.json({ ok: false, hits: [] }, { status: 500 });
  }
}
