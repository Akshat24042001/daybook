/** Editing a company or a person: every field, checked, with your own fields merged in. */
import { one, q, UserError } from "../db";
import { cleanCustom } from "./custom-fields";
import { COMPANY_EDIT_FIELDS, PERSON_EDIT_FIELDS, PREFERRED_CHANNELS, SENIORITY } from "./fields";
import { addIdentities } from "./identity";

const list = (v: unknown) => [...new Set((Array.isArray(v) ? v : String(v ?? "").split(",")).map((x) => String(x).trim()).filter(Boolean))].slice(0, 20);

function cleanText(label: string, v: unknown, type: string): unknown {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  if (type === "url" && !/^https?:\/\/\S+$/i.test(s) && !/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s)) throw new UserError(`${label} needs a web address.`);
  if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new UserError(`${label} needs an email address.`);
  if (type === "number") {
    const n = Number(s.replace(/[,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0) throw new UserError(`${label} needs a number.`);
    return Math.round(n);
  }
  return s.slice(0, type === "long_text" ? 10_000 : 500);
}

export async function updateCompany(id: number, patch: Record<string, unknown>): Promise<void> {
  if (!(await one("select 1 from sales_companies where id = $1", [id]))) throw new UserError("That company no longer exists.");
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const f of COMPANY_EDIT_FIELDS) {
    if (!(f.key in patch)) continue;
    const v = cleanText(f.label, patch[f.key], f.type);
    if (f.key === "name" && !v) throw new UserError("A company needs a name.");
    params.push(v);
    sets.push(`${f.key} = $${params.length}`);
  }
  if (patch.website) {
    const host = String(patch.website).replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
    params.push(host);
    sets.push(`domain = $${params.length}`);
  }
  if (patch.custom && typeof patch.custom === "object") {
    params.push(JSON.stringify(await cleanCustom("company", patch.custom as Record<string, unknown>)));
    sets.push(`custom = jsonb_strip_nulls(coalesce(custom, '{}'::jsonb) || $${params.length}::jsonb)`);
  }
  if (sets.length) await q(`update sales_companies set ${sets.join(", ")}, updated_at = now() where id = $1`, params);
}

export async function updatePerson(id: number, patch: Record<string, unknown>): Promise<void> {
  if (!(await one("select 1 from sales_people where id = $1", [id]))) throw new UserError("That person no longer exists.");
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const f of PERSON_EDIT_FIELDS) {
    if (!(f.key in patch)) continue;
    let v: unknown;
    if (f.type === "tags") v = list(patch[f.key]);
    else if (f.type === "checkbox") v = patch[f.key] === null || patch[f.key] === "" ? null : patch[f.key] === true || patch[f.key] === "true";
    else v = cleanText(f.label, patch[f.key], f.type);
    if (f.key === "full_name" && !v) throw new UserError("A person needs a name.");
    if (f.key === "relationship") v = ["cold", "warm", "referral", "partner", "client"].includes(String(v)) ? v : "cold";
    if (f.key === "seniority" && v && !SENIORITY.includes(String(v))) throw new UserError("Pick a seniority from the list.");
    if (f.key === "preferred_channel" && v && !PREFERRED_CHANNELS.includes(String(v))) throw new UserError("Pick a channel from the list.");
    params.push(v);
    sets.push(`${f.key} = $${params.length}`);
  }
  if (patch.custom && typeof patch.custom === "object") {
    params.push(JSON.stringify(await cleanCustom("person", patch.custom as Record<string, unknown>)));
    sets.push(`custom = jsonb_strip_nulls(coalesce(custom, '{}'::jsonb) || $${params.length}::jsonb)`);
  }
  if (sets.length) await q(`update sales_people set ${sets.join(", ")}, updated_at = now() where id = $1`, params);
  // new emails, phones and LinkedIn become identities, so their messages find this person
  for (const e of "emails" in patch ? list(patch.emails) : []) await addIdentities(id, { email: e });
  for (const p of "phones" in patch ? list(patch.phones) : []) await addIdentities(id, { phone: p });
  if (patch.whatsapp) await addIdentities(id, { phone: String(patch.whatsapp) });
  if (patch.linkedin) await addIdentities(id, { linkedin: String(patch.linkedin) });
}
