import { NextResponse } from "next/server";
import { exportAll, isExportTable, tableRows, toCsv } from "@/lib/services/export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/export            -> everything as one JSON file
 * GET /api/export?table=tasks -> that table as CSV
 * Behind the login like every /api route.
 */
export async function GET(req: Request) {
  const table = new URL(req.url).searchParams.get("table");
  const day = new Date().toISOString().slice(0, 10);
  try {
    if (table) {
      if (!isExportTable(table)) return NextResponse.json({ ok: false, error: "unknown table" }, { status: 400 });
      const rows = (await tableRows(table)) ?? [];
      return new NextResponse("﻿" + toCsv(rows), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="daybook-${table}-${day}.csv"`,
          "cache-control": "no-store",
        },
      });
    }
    const all = await exportAll();
    return new NextResponse(JSON.stringify(all, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="daybook-export-${day}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    console.error("[export] failed:", (e as Error).name, (e as Error).message);
    return NextResponse.json({ ok: false, error: "export failed" }, { status: 500 });
  }
}
