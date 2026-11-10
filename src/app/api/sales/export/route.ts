import { NextResponse } from "next/server";
import { exportDeals } from "@/lib/sales/bulk";
import { toCsv } from "@/lib/sales/csv";
import { isOwnerRequest } from "@/lib/sales/visitor";

export const dynamic = "force-dynamic";

/** Every deal and every field as a CSV file (signed-in owner only). */
export async function GET() {
  if (!(await isOwnerRequest())) return new NextResponse("Sign in first.", { status: 401 });
  const { header, rows } = await exportDeals();
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(header, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="daybook-deals-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}
