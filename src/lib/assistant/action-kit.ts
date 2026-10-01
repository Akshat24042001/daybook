/**
 * Shared pieces for assistant actions: argument readers, date/time parsing, and the snapshots that make every
 * change exactly undoable. Used by actions.ts (the original set) and actions-more.ts (everything else).
 */
import { q, UserError, type Db } from "../db";
import type { Ctx } from "../settings";
import { addDays, fmtDay, zonedInstant, type DateStr } from "../time";

export const s = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
export const int = (v: unknown) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
};
export const num = (v: unknown) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
export const bool = (v: unknown): boolean | null =>
  v === true || v === "true" || v === 1 ? true : v === false || v === "false" || v === 0 ? false : null;
/** a list of short strings: ["a","b"] or "a, b" */
export const strList = (v: unknown, max = 20): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [])
    .map((x) => s(x, 200))
    .filter(Boolean)
    .slice(0, max);
export const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
export const quote = (t: string, max = 60) => `“${t.length > max ? `${t.slice(0, max - 1)}…` : t}”`;
export const isClear = (v: unknown) => v === null || /^(clear|none|null|reset|remove|delete|off)$/i.test(s(v, 10));
export const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

/** "today", "tomorrow", "yesterday" or YYYY-MM-DD. */
export function dateArg(ctx: Ctx, v: unknown, fallback: DateStr = ctx.today): DateStr {
  const t = s(v, 20).toLowerCase();
  if (!t || t === "today") return fallback;
  if (t === "tomorrow") return addDays(ctx.today, 1);
  if (t === "yesterday") return addDays(ctx.today, -1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  throw new UserError(`"${t}" is not a date.`);
}

export const dayName = (ctx: Ctx, d: DateStr) =>
  d === ctx.today ? "today" : d === addDays(ctx.today, 1) ? "tomorrow" : d === addDays(ctx.today, -1) ? "yesterday" : fmtDay(d, ctx.today);

/** "15:50" on the given logical date, or "YYYY-MM-DD 15:50". Times before the day boundary fall on the next calendar day. */
export function localTime(ctx: Ctx, v: unknown, date: DateStr): Date {
  const t = s(v, 40);
  // an exact instant (how a prepared action stores it)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(t)) return new Date(t);
  const full = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/.exec(t);
  if (full) return zonedInstant(full[1], +full[2], +full[3], ctx.tz);
  const hm = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!hm || +hm[1] > 23 || +hm[2] > 59) throw new UserError(`"${t}" is not a time.`);
  const min = +hm[1] * 60 + +hm[2];
  return zonedInstant(min < ctx.boundaryMin ? addDays(date, 1) : date, +hm[1], +hm[2], ctx.tz);
}

/** Loads one row by id or fails with a message the model can act on. */
export async function rowOr<T>(table: string, id: number | null, what: string, cols = "*"): Promise<T> {
  const r = id === null ? [] : await q<T>(`select ${cols} from ${table} where id = $1`, [id]);
  if (!r[0]) throw new UserError(`That ${what} does not exist (id ${id ?? "missing"}). Query for the right id.`);
  return r[0];
}

// ---------------------------------------------------------------- snapshots

export interface Scope { table: string; key: string; where: string; params: unknown[] }
export interface Snapshot { scopes: (Scope & { rows: Record<string, unknown>[] })[]; created: { table: string; id: number }[] }

/** Tables an action may touch, parents before children (restore order). Key "a,b" = composite key. */
const ORDER = [
  "settings", "projects", "people", "tasks", "day_entries", "time_logs", "task_remarks", "work_segments", "days",
  "exercise_types", "exercise_logs", "contacts", "contact_touches", "refs", "diary_entries", "diary_summaries",
  "scratch_items", "reviews",
];
const TABLES = new Set(ORDER);
const CREATED_TABLES = new Set([
  "tasks", "diary_entries", "scratch_items", "contact_touches", "task_remarks", "time_logs", "projects", "people",
  "contacts", "refs", "exercise_types", "exercise_logs", "work_segments",
]);

export const taskScopes = (taskId: number): Scope[] => [
  { table: "tasks", key: "id", where: "id = $1", params: [taskId] },
  { table: "day_entries", key: "id", where: "task_id = $1", params: [taskId] },
  { table: "time_logs", key: "id", where: "task_id = $1", params: [taskId] },
  { table: "task_remarks", key: "id", where: "task_id = $1", params: [taskId] },
];
export const dayScope = (date: DateStr): Scope => ({ table: "days", key: "date", where: "date = $1", params: [date] });
export const segmentScope = (from: DateStr, to: DateStr): Scope => ({
  table: "work_segments", key: "id", where: "(date between $1 and $2) or end_at is null", params: [from, to],
});
export const rowScope = (table: string, id: number): Scope => ({ table, key: "id", where: "id = $1", params: [id] });

export async function takeSnapshot(scopes: Scope[], db: Db): Promise<Snapshot> {
  const out: Snapshot = { scopes: [], created: [] };
  for (const sc of scopes) {
    if (!TABLES.has(sc.table)) throw new Error(`no snapshots for ${sc.table}`);
    const rows = await q<Record<string, unknown>>(`select * from ${sc.table} where ${sc.where}`, sc.params, db);
    out.scopes.push({ ...sc, rows });
  }
  return out;
}

/** json/jsonb columns per table: their values go back as JSON text; Postgres arrays go back as arrays. */
async function jsonCols(table: string, db: Db): Promise<Set<string>> {
  const rows = await q<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema = current_schema() and table_name = $1 and data_type in ('json','jsonb')",
    [table],
    db,
  );
  return new Set(rows.map((r) => r.column_name));
}

/** Puts every snapshotted row back exactly and removes what the action created. */
export async function restore(snap: Snapshot, db: Db): Promise<void> {
  for (const c of [...snap.created].reverse()) {
    if (!CREATED_TABLES.has(c.table)) continue;
    await db.query(`delete from ${c.table} where id = $1`, [c.id]);
  }
  const scopes = [...snap.scopes].filter((sc) => TABLES.has(sc.table)).sort((a, b) => ORDER.indexOf(a.table) - ORDER.indexOf(b.table));
  // children before parents on delete
  for (const sc of [...scopes].reverse()) {
    if (sc.key.includes(",")) {
      // composite key (reviews): replace the whole scope
      await db.query(`delete from ${sc.table} where ${sc.where}`, sc.params);
      continue;
    }
    const keys = sc.rows.map((r) => r[sc.key]);
    const n = sc.params.length;
    await db.query(`delete from ${sc.table} where (${sc.where}) and not (${sc.key} = any($${n + 1}))`, [...sc.params, keys]);
  }
  // parents before children on insert
  for (const sc of scopes) {
    const json = sc.rows.length ? await jsonCols(sc.table, db) : new Set<string>();
    for (const row of sc.rows) {
      const cols = Object.keys(row).filter((c) => /^[a-z_]+$/.test(c));
      const vals = cols.map((c) => (json.has(c) && row[c] !== null ? JSON.stringify(row[c]) : row[c]));
      const conflict = sc.key.includes(",") ? "" : `on conflict (${sc.key}) do update set ${cols.filter((c) => c !== sc.key).map((c) => `${c} = excluded.${c}`).join(", ")}`;
      await db.query(
        `insert into ${sc.table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) ${conflict}`,
        vals,
      );
    }
  }
}
