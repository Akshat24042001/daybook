"use client";

import { Download, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { importDealsAction } from "@/app/sales-actions";
import { Button, Select, Sheet } from "@/components/ui";
import { useToast } from "@/components/toast";
import { guessMapping, IMPORT_FIELDS, parseCsv } from "@/lib/sales/csv";

/** Export every deal as CSV; import deals from a CSV with column matching and a preview. */
export function ImportExport({ pipelineId }: { pipelineId: number | null }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<string[]>([]);
  const [result, setResult] = useState<{ created: number; failed: { row: number; error: string }[] } | null>(null);
  const [busy, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const router = useRouter();
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const read = (f: File) => {
    if (f.size > 5 * 1024 * 1024) return toast("Keep the file under 5 MB (about 2,000 rows).", "error");
    void f.text().then((t) => {
      const r = parseCsv(t);
      if (r.length < 2) return toast("That file has a header but no rows.", "error");
      setRows(r);
      setMap(guessMapping(r[0]));
      setResult(null);
      setOpen(true);
    });
  };
  const mapped = () => body.map((r) => Object.fromEntries(map.map((k, i) => [k, r[i] ?? ""]).filter(([k]) => k)));
  const usable = map.some((k) => ["title", "company", "person", "email", "phone"].includes(k));
  return (
    <>
      <a href="/api/sales/export" download className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:bg-muted"><Download className="h-3.5 w-3.5" /> Export CSV</a>
      <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload className="h-3.5 w-3.5" /> Import CSV</Button>
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden aria-label="Choose a CSV file" onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ""; }} />
      <Sheet open={open} onOpenChange={setOpen} title="Import deals from CSV" description={`${body.length} row${body.length === 1 ? "" : "s"}. Match each column to a field, or skip it.`} wide>
        {result ? (
          <div className="space-y-3 text-sm">
            <p className="font-medium">{result.created} deal{result.created === 1 ? "" : "s"} imported{result.failed.length ? `, ${result.failed.length} skipped` : ""}.</p>
            {result.failed.length ? (
              <ul className="max-h-64 space-y-1 overflow-auto rounded-lg bg-muted p-2 text-xs">{result.failed.map((f) => <li key={f.row}>Row {f.row}: {f.error}</li>)}</ul>
            ) : null}
            <div className="flex justify-end"><Button variant="primary" onClick={() => setOpen(false)}>Done</Button></div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-left text-subtle"><tr><th className="p-2">Column in your file</th><th className="p-2">Goes to</th><th className="p-2">First rows</th></tr></thead>
                <tbody>
                  {header.map((h, i) => (
                    <tr key={i} className="border-t border-border align-top">
                      <td className="p-2 font-medium">{h || `(column ${i + 1})`}</td>
                      <td className="p-2">
                        <Select value={map[i] ?? ""} onChange={(e) => setMap((m) => m.map((x, j) => (j === i ? e.target.value : x === e.target.value && e.target.value ? "" : x)))} aria-label={`Field for ${h}`} className="h-8 w-48 text-xs">
                          <option value="">Skip</option>
                          {IMPORT_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </Select>
                      </td>
                      <td className="p-2 text-subtle">{body.slice(0, 3).map((r) => r[i]).filter(Boolean).join(" · ").slice(0, 120)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-subtle">Deals are created in this pipeline. A stage must be an open stage (New, Contacted…): close won or lost deals on the deal, so the closing record and reason are captured. Rows with a problem are skipped and listed; the rest are imported.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" disabled={busy || !usable} onClick={() => start(async () => {
                const r = await importDealsAction(mapped(), pipelineId);
                if (!r.ok) return toast(r.error, "error");
                setResult(r.result);
                router.refresh();
              })}>{usable ? `Import ${body.length}` : "Match a name, company or contact column"}</Button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
