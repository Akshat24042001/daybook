/**
 * Your own fields, for anything the built-in ones do not cover: defined once in Sales settings > Fields, then shown on
 * every deal (or company, or person), in the pipeline columns, and, when marked, in the Won checklist.
 */
import { one, q, UserError } from "../db";
import type { FieldDef, FieldType } from "./fields";

export type Scope = "deal" | "company" | "person";
export type CustomType = "text" | "long_text" | "number" | "money" | "date" | "select" | "multi_select" | "checkbox" | "url" | "phone" | "email";
export const CUSTOM_TYPES: [CustomType, string][] = [
  ["text", "Short text"], ["long_text", "Long text"], ["number", "Number"], ["money", "Amount"], ["date", "Date"],
  ["select", "Pick one"], ["multi_select", "Pick several"], ["checkbox", "Yes / no"], ["url", "Link"], ["phone", "Phone"], ["email", "Email"],
];

export interface CustomField {
  id: number;
  scope: Scope;
  key: string;
  label: string;
  type: CustomType;
  options: string[];
  help: string | null;
  required_to_win: boolean;
  sort: number;
  active: boolean;
}

export async function listCustomFields(scope?: Scope, includeInactive = false): Promise<CustomField[]> {
  return q<CustomField>(
    `select id, scope, key, label, type, options, help, required_to_win, sort, active from sales_custom_fields
     where ($1::text is null or scope = $1) and ($2 or active) order by scope, sort, id`,
    [scope ?? null, includeInactive],
  ).catch(() => []);
}

/** As field definitions, for the forms and columns. */
export function asFieldDefs(list: CustomField[]): FieldDef[] {
  return list.filter((c) => c.active).map((c) => ({
    key: `custom.${c.key}`, label: c.label, group: "Your fields", type: c.type as FieldType, hint: c.help ?? undefined,
    options: c.options, custom: true, required_to_win: c.required_to_win,
  }));
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export async function saveCustomField(f: { id?: number; scope?: Scope; label: string; type: CustomType; options?: string[] | string; help?: string | null; required_to_win?: boolean; sort?: number; active?: boolean }): Promise<number> {
  const label = f.label?.trim();
  if (!label) throw new UserError("Give the field a name.");
  if (!CUSTOM_TYPES.some(([t]) => t === f.type)) throw new UserError("Pick a field type.");
  const options = [...new Set((Array.isArray(f.options) ? f.options : String(f.options ?? "").split(/[\n,]/)).map((o) => o.trim()).filter(Boolean))].slice(0, 60);
  if ((f.type === "select" || f.type === "multi_select") && !options.length) throw new UserError("List the choices, one per line or comma separated.");
  if (f.id) {
    // the key never changes, so saved values keep working after a rename
    await q(
      "update sales_custom_fields set label = $2, type = $3, options = $4, help = $5, required_to_win = $6, sort = coalesce($7, sort), active = coalesce($8, active) where id = $1",
      [f.id, label, f.type, options, f.help?.trim() || null, !!f.required_to_win, f.sort ?? null, f.active ?? null],
    );
    return f.id;
  }
  const scope = f.scope ?? "deal";
  const base = slug(label) || "field";
  let key = base;
  for (let i = 2; await one("select 1 from sales_custom_fields where scope = $1 and key = $2", [scope, key]); i++) key = `${base}_${i}`;
  const row = await one<{ id: number }>(
    `insert into sales_custom_fields (scope, key, label, type, options, help, required_to_win, sort)
     values ($1,$2,$3,$4,$5,$6,$7,coalesce($8,(select coalesce(max(sort),0)+10 from sales_custom_fields where scope = $1))) returning id`,
    [scope, key, label, f.type, options, f.help?.trim() || null, !!f.required_to_win, f.sort ?? null],
  );
  return row!.id;
}

/** Hides a field (its saved values stay on the records, so turning it back on brings them back). */
export async function setCustomFieldActive(id: number, active: boolean): Promise<void> {
  await q("update sales_custom_fields set active = $2 where id = $1", [id, active]);
}

/** Checks and converts values for a record's custom fields. Unknown keys are refused; empty values clear the field. */
export async function cleanCustom(scope: Scope, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const defs = new Map((await listCustomFields(scope, true)).map((d) => [d.key, d]));
  const out: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(input ?? {})) {
    const d = defs.get(k);
    if (!d) throw new UserError(`There is no field "${k}". Add it in Sales settings > Fields.`);
    out[k] = cleanValue(d, raw);
  }
  return out;
}

export function cleanValue(d: Pick<CustomField, "label" | "type" | "options">, raw: unknown): unknown {
  if (raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && !raw.length)) return null;
  const s = String(raw).trim();
  switch (d.type) {
    case "number":
    case "money": {
      const n = Number(s.replace(/[,\s₹$]/g, ""));
      if (!Number.isFinite(n)) throw new UserError(`${d.label} needs a number.`);
      return n;
    }
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new UserError(`${d.label} needs a date.`);
      return s;
    case "checkbox":
      return raw === true || s === "true" || s === "yes" || s === "1";
    case "select":
      if (!d.options.includes(s)) throw new UserError(`${d.label}: pick one of the choices.`);
      return s;
    case "multi_select": {
      const vals = (Array.isArray(raw) ? raw : s.split(",")).map((x) => String(x).trim()).filter(Boolean);
      const bad = vals.find((v) => !d.options.includes(v));
      if (bad) throw new UserError(`${d.label}: "${bad}" is not one of the choices.`);
      return vals;
    }
    case "url":
      if (!/^https?:\/\/\S+$/i.test(s)) throw new UserError(`${d.label} needs a full link starting with https://`);
      return s;
    case "email":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new UserError(`${d.label} needs an email address.`);
      return s.toLowerCase();
    default:
      return s.slice(0, d.type === "long_text" ? 10_000 : 500);
  }
}
