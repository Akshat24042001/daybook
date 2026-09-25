import { Download, FileJson, Sheet } from "lucide-react";
import { EXPORT_TABLES } from "@/lib/services/export";

/** "Your data": everything as one JSON file, or any table as CSV for a spreadsheet. */
export function ExportCard() {
  return (
    <section id="export" aria-label="Your data" className="scroll-mt-24 space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">Your data</h2>
        <p className="text-xs text-subtle">It is yours. Download all of it any time, for a backup or to analyse elsewhere.</p>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)]">
        <a
          href="/api/export"
          download
          className="flex items-center gap-3 rounded-xl bg-accent px-4 py-3 text-accent-fg shadow-[0_2px_10px_hsl(var(--accent)/0.3)] transition-opacity hover:opacity-90"
        >
          <FileJson className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Download everything</span>
            <span className="block text-xs opacity-80">One JSON file with every table</span>
          </span>
          <Download className="h-4 w-4 shrink-0" />
        </a>
        <p className="mb-2 mt-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
          <Sheet className="h-3.5 w-3.5" /> Or one table as CSV (opens in Excel / Sheets)
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {EXPORT_TABLES.map((t) => (
            <a
              key={t.name}
              href={`/api/export?table=${t.name}`}
              download
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-accent/40 hover:bg-muted"
            >
              <Download className="h-3.5 w-3.5 shrink-0 text-subtle" />
              <span className="truncate">{t.label}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
