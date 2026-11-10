import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { docBySlug, recordView } from "@/lib/sales/docs";
import { isOwnerRequest, visitorId } from "@/lib/sales/visitor";

export const dynamic = "force-dynamic";

/** A tracked link: records the open, then forwards to the real URL (Loom, Drive, a case study...). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = await docBySlug(slug);
  if (!doc?.target_url || (doc as { internal?: boolean }).internal) return new NextResponse("This link has expired.", { status: 404 });
  const h = await headers();
  if (!(await isOwnerRequest())) {
    await recordView(doc, { ua: h.get("user-agent") ?? "", visitor: visitorId(h), country: h.get("x-vercel-ip-country"), city: decodeURIComponent(h.get("x-vercel-ip-city") ?? "") || null }).catch(() => null);
  }
  return NextResponse.redirect(doc.target_url, 302);
}
