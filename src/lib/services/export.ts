/**
 * Export everything you have put into Daybook: one JSON file with every table, or one CSV per table.
 * Internal bookkeeping (notification ledger, Telegram update ids, pending quick-adds) is left out.
 */
import { q } from "../db";

export const EXPORT_TABLES = [
  { name: "tasks", label: "Tasks" },
  { name: "day_entries", label: "Daily plan entries" },
  { name: "time_logs", label: "Time logged on tasks" },
  { name: "work_segments", label: "Work segments" },
  { name: "days", label: "Days (score, steps, sleep)" },
  { name: "task_remarks", label: "Task notes" },
  { name: "projects", label: "Projects" },
  { name: "people", label: "People on tasks" },
  { name: "exercise_types", label: "Exercise types" },
  { name: "exercise_logs", label: "Exercise log" },
  { name: "contacts", label: "Contacts" },
  { name: "contact_touches", label: "Contact touches" },
  { name: "refs", label: "References" },
  { name: "diary_entries", label: "Diary notes" },
  { name: "diary_summaries", label: "Diary summaries" },
  { name: "reviews", label: "Reviews and intentions" },
  { name: "settings", label: "Settings" },
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number]["name"];

export function isExportTable(name: string): name is ExportTable {
  return EXPORT_TABLES.some((t) => t.name === name);
}

/** Rows of one table, or null when the table does not exist yet (a feature never used). Names come from the allow-list only. */
export async function tableRows(name: ExportTable): Promise<Record<string, unknown>[] | null> {
  const exists = await q<{ t: string | null }>("select to_regclass($1)::text as t", [`public.${name}`]);
  if (!exists[0]?.t) return null;
  const order = name === "settings" ? "" : " order by 1";
  return q<Record<string, unknown>>(`select * from ${name}${order}`);
}

export async function exportAll(): Promise<{ exported_at: string; app: string; tables: Record<string, Record<string, unknown>[]> }> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of EXPORT_TABLES) {
    const rows = await tableRows(t.name);
    if (rows) tables[t.name] = rows;
  }
  return { exported_at: new Date().toISOString(), app: "Daybook", tables };
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  // quote when needed; neutralise spreadsheet formulas (a cell starting with = + - @)
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}
