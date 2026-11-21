// The newsletter of one day as a PDF (the owner's session is checked by the middleware for every /api route).
import { getEdition } from "@/lib/news/edition";
import { editionPdf } from "@/lib/news/pdf";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response("Bad date", { status: 400 });
  const e = await getEdition(date);
  if (!e) return new Response("No newsletter for that day", { status: 404 });
  const pdf = await editionPdf(e);
  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="morning-brief-${date}.pdf"`, "cache-control": "private, no-store" },
  });
}
