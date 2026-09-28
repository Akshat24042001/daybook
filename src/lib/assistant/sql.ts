/**
 * Runs the assistant's SQL safely. Layers, any one of which is enough to stop a write:
 *   1. text checks: one SELECT/WITH statement, no dollar quoting, no system or side-channel functions;
 *   2. EXPLAIN first, and every relation in the plan must be on the allow list (views expand to their tables);
 *   3. a READ ONLY transaction with a short statement timeout, always rolled back.
 * Results are capped and values turned into plain JSON (dates and times as the text Postgres prints, in the
 * owner's timezone).
 */
import pg from "pg";
import { getPool } from "../db";
import { ALLOWED_RELATIONS } from "./schema";

export const MAX_ROWS = 500;

export interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  ms: number;
}

export class SqlRejected extends Error {}

const FORBIDDEN: [RegExp, string][] = [
  [/\bpg_\w*/i, "system catalogs and pg_ functions are not available"],
  [/\binformation_schema\b/i, "information_schema is not available"],
  [/\b(dblink\w*|lo_\w+|query_to_\w+|table_to_\w+|cursor_to_\w+|schema_to_\w+|database_to_\w+)\s*\(/i, "that function is not available"],
  [/\b(set_config|current_setting|txid_\w+|nextval|setval|currval)\b/i, "that function is not available"],
  [/\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|vacuum|analyze|call|do|execute|prepare|listen|notify|lock|set|reset|discard)\b/i, "only reading is allowed"],
  [/\binto\b/i, "SELECT INTO is not allowed"],
  [/\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i, "row locks are not allowed"],
  [/\b(telegram_chat_id|owner_user_id)\b/i, "that column is private"],
];

/** Removes string literals and comments so the checks only see SQL, not the words inside quotes. */
function codeOnly(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"/g, "");
}

/** Throws SqlRejected with a message the model can act on. Returns the cleaned statement. */
export function checkSql(raw: string): string {
  const sql = raw.trim().replace(/;\s*$/, "").trim();
  if (!sql) throw new SqlRejected("empty query");
  if (sql.length > 8000) throw new SqlRejected("query is too long");
  if (/\$\w*\$/.test(sql)) throw new SqlRejected("dollar quoting is not allowed");
  const code = codeOnly(sql);
  if (code.includes(";")) throw new SqlRejected("send one statement at a time");
  if (!/^\s*\(?\s*(select|with)\b/i.test(code)) throw new SqlRejected("start with SELECT or WITH");
  for (const [re, why] of FORBIDDEN) {
    if (re.test(code)) throw new SqlRejected(why);
  }
  return sql;
}

type PlanNode = { "Relation Name"?: string; Schema?: string; "Function Name"?: string; Plans?: PlanNode[]; [k: string]: unknown };

function relationsIn(node: PlanNode, out: { rel: Set<string>; schemas: Set<string>; fns: Set<string> }) {
  if (node["Relation Name"]) out.rel.add(String(node["Relation Name"]));
  if (node.Schema) out.schemas.add(String(node.Schema));
  if (node["Function Name"]) out.fns.add(String(node["Function Name"]));
  for (const child of node.Plans ?? []) relationsIn(child, out);
  // InitPlans / SubPlans also live under Plans in JSON output
}

// Values Postgres prints are already right for the owner: keep dates, times and numerics as text or numbers.
const RAW_TEXT = new Set([1082, 1083, 1114, 1184, 1186, 1266]); // date, time, timestamp, timestamptz, interval, timetz
const NUMERIC = new Set([20, 21, 23, 700, 701, 1700]);
const types = {
  getTypeParser(oid: number, format?: string) {
    // "2026-09-28 15:52:08.12+05:30" -> "2026-09-28 15:52"; dates stay as they are
    if (RAW_TEXT.has(oid)) return (v: string) => v.replace(/(\d{2}:\d{2}):\d{2}(\.\d+)?/, "$1").replace(/(\d{2}:\d{2})[+-]\d{2}(:\d{2})?$/, "$1");
    if (NUMERIC.has(oid)) return (v: string) => Number(v);
    return pg.types.getTypeParser(oid, format as "text");
  },
};

export async function runReadOnlySql(raw: string, tz: string, db?: pg.PoolClient): Promise<SqlResult> {
  const sql = checkSql(raw);
  const wrapped = `select * from (\n${sql}\n) as _q limit ${MAX_ROWS + 1}`;
  const client = db ?? (await getPool().connect());
  const started = Date.now();
  try {
    await client.query("begin transaction read only");
    await client.query("set local statement_timeout = 8000");
    await client.query(`set local timezone = '${tz.replace(/'/g, "")}'`);
    await client.query("set local search_path = public");

    const plan = await client.query<{ "QUERY PLAN": { Plan: PlanNode }[] }>(`explain (format json) ${wrapped}`);
    const found = { rel: new Set<string>(), schemas: new Set<string>(), fns: new Set<string>() };
    relationsIn(plan.rows[0]["QUERY PLAN"][0].Plan, found);
    const badSchema = [...found.schemas].find((s) => s !== "public");
    if (badSchema) throw new SqlRejected(`schema ${badSchema} is not available`);
    const bad = [...found.rel].filter((r) => !ALLOWED_RELATIONS.has(r));
    if (bad.length) throw new SqlRejected(`not allowed to read: ${bad.join(", ")}`);

    const res = await client.query({ text: wrapped, types });
    const truncated = res.rows.length > MAX_ROWS;
    return {
      columns: res.fields.map((f) => f.name),
      rows: truncated ? res.rows.slice(0, MAX_ROWS) : res.rows,
      truncated,
      ms: Date.now() - started,
    };
  } finally {
    await client.query("rollback").catch(() => undefined);
    if (!db) client.release();
  }
}

/** Compact text for the model: header line, then one pipe-separated line per row, capped by characters. */
export function resultForModel(r: SqlResult, maxChars = 6000): string {
  if (!r.rows.length) return "(no rows)";
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "∅";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return s.replace(/\s+/g, " ").slice(0, 200);
  };
  const lines = [r.columns.join(" | ")];
  let size = lines[0].length;
  let shown = 0;
  for (const row of r.rows) {
    const line = r.columns.map((c) => cell(row[c])).join(" | ");
    if (size + line.length > maxChars) break;
    lines.push(line);
    size += line.length + 1;
    shown++;
  }
  const more = r.rows.length - shown + (r.truncated ? 1 : 0);
  if (more > 0) lines.push(`… ${r.truncated ? "more than " : ""}${r.rows.length - shown} more rows not shown (use aggregation or LIMIT)`);
  return lines.join("\n");
}
