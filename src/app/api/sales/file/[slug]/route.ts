import { NextResponse } from "next/server";
import { docBySlug } from "@/lib/sales/docs";
import { isOwnerRequest } from "@/lib/sales/visitor";
import { fileStore } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Download for a tracked file: a short-lived signed link, so the file itself is never public. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = await docBySlug(slug);
  if (!doc?.file_path) return new NextResponse("Not found", { status: 404 });
  // internal papers (a signed contract, a PO) are only for you
  if ((doc as { internal?: boolean }).internal && !(await isOwnerRequest())) return new NextResponse("Not found", { status: 404 });
  // ?dl=1 saves the file; without it, it opens (and shows on the document page)
  const save = new URL(req.url).searchParams.get("dl") === "1";
  const urls = await fileStore().signDownloads([doc.file_path], 600, save ? (doc.file_name ?? "document") : undefined);
  const u = urls.get(doc.file_path);
  if (!u) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(u, 302);
}
