import { NextResponse } from "next/server";
import { UserError } from "@/lib/db";
import { acceptQuote, requestChanges } from "@/lib/sales/docs";

export const dynamic = "force-dynamic";

/** The client accepts a quote or asks for changes from the public page. */
export async function POST(req: Request) {
  const f = await req.formData();
  const slug = String(f.get("slug") ?? "");
  const name = String(f.get("name") ?? "").trim().slice(0, 120);
  const action = String(f.get("action") ?? "");
  const note = String(f.get("note") ?? "").trim().slice(0, 2000);
  const rev = Number(f.get("rev")) || null;
  const back = new URL(`/q/${encodeURIComponent(slug)}`, req.url);
  if (!slug || !name) {
    back.searchParams.set("e", "name");
    return NextResponse.redirect(back, 303);
  }
  try {
    if (action === "accept") await acceptQuote(slug, name, rev);
    else if (action === "changes" && note) await requestChanges(slug, name, note);
    back.searchParams.set("done", action);
  } catch (e) {
    // a stale or expired proposal says so; anything else is a generic failure
    back.searchParams.set("e", e instanceof UserError ? "stale" : "failed");
  }
  return NextResponse.redirect(back, 303);
}
