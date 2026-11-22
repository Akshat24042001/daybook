// The paper of one day as a PDF (the owner's session is checked by the middleware for every /api route).
import { editionPdfFor } from "@/lib/news/edition";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response("Bad date", { status: 400 });
  const made = await editionPdfFor(date, { images: new URL(req.url).searchParams.get("images") !== "0" });
  if (!made) return new Response("No paper for that day", { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(made.pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `${download ? "attachment" : "inline"}; filename="daybook-daily-${date}.pdf"`, "cache-control": "private, no-store" },
  });
}
