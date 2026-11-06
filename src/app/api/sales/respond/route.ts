import { NextResponse } from "next/server";
import { acceptQuote, requestChanges } from "@/lib/sales/docs";

export const dynamic = "force-dynamic";

/** The client accepts a quote or asks for changes from the public page. */
export async function POST(req: Request) {
  const f = await req.formData();
  const slug = String(f.get("slug") ?? "");
  const name = String(f.get("name") ?? "").trim().slice(0, 120);
  const action = String(f.get("action") ?? "");
  const note = String(f.get("note") ?? "").trim();
  const back = new URL(`/q/${encodeURIComponent(slug)}`, req.url);
  if (!slug || !name) {
    back.searchParams.set("e", "name");
    return NextResponse.redirect(back, 303);
  }
  try {
    if (action === "accept") await acceptQuote(slug, name);
    else if (action === "changes" && note) await requestChanges(slug, name, note);
    back.searchParams.set("done", action);
  } catch {
    back.searchParams.set("e", "failed");
  }
  return NextResponse.redirect(back, 303);
}
