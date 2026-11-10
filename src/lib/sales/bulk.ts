/** Many deals at once: bulk changes from the pipeline list, CSV import and CSV export. */
import { one, q, UserError } from "../db";
import { listCustomFields } from "./custom-fields";
import { createDeal, deleteDeal, updateDeal } from "./deals";
import { closeKind, DEAL_FIELDS, SOURCES } from "./fields";
import { ensureCompany, upsertPerson } from "./identity";
import { moveDeal } from "./stages";

export interface BulkOp {
  /** fields to set on every deal (only simple fields: pipeline, owner, source, type, city, state, country, industry, expected close) */
  set?: Record<string, unknown>;
  add_tags?: string[];
  stage_id?: number;
  delete?: boolean;
}
const BULK_FIELDS = new Set(["pipeline_id", "owner_id", "source", "deal_type", "city", "region", "country", "industry", "expected_close", "probability"]);

export async function bulkDeals(ids: number[], op: BulkOp): Promise<{ done: number; failed: { id: number; title: string; error: string }[] }> {
  const list = [...new Set(ids.map(Number).filter(Number.isInteger))].slice(0, 500);
  if (!list.length) throw new UserError("Select at least one deal.");
  const set = Object.fromEntries(Object.entries(op.set ?? {}).filter(([k]) => BULK_FIELDS.has(k)));
  if (op.set && Object.keys(op.set).length !== Object.keys(set).length) throw new UserError("That field cannot be changed in bulk. Open the deal to change it.");
  const failed: { id: number; title: string; error: string }[] = [];
  let done = 0;
  for (const id of list) {
    const d = await one<{ title: string }>("select title from sales_deals where id = $1", [id]);
    if (!d) continue;
    try {
      if (op.delete) await deleteDeal(id);
      else {
        if (Object.keys(set).length) await updateDeal(id, set);
        if (op.add_tags?.length) {
          const cur = (await one<{ tags: string[] }>("select tags from sales_deals where id = $1", [id]))!.tags;
          await updateDeal(id, { tags: [...cur, ...op.add_tags] });
        }
        // a move that needs details (won, lost, parked, reopened) is done on the deal, where its checklist is asked;
        // a reason, date or quote the flow requires is refused by moveDeal
        if (op.stage_id) {
          const st = await one<{ from_cat: string; to_cat: string; to_role: string | null; to_name: string }>(
            "select f.category as from_cat, t.category as to_cat, t.role as to_role, t.name as to_name from sales_deals d join sales_stages f on f.id = d.stage_id, sales_stages t where d.id = $1 and t.id = $2",
            [id, op.stage_id],
          );
          if (!st) throw new UserError("That stage does not exist.");
          if (closeKind({ category: st.from_cat }, { category: st.to_cat, role: st.to_role }) !== "move") throw new UserError(`Moving to ${st.to_name} asks for details: do it on the deal.`);
          await moveDeal(id, op.stage_id, { cause: "manual" });
        }
      }
      done++;
    } catch (e) {
      failed.push({ id, title: d.title, error: e instanceof UserError ? e.message : "Something went wrong" });
    }
  }
  return { done, failed };
}

/** Rows already mapped to import field keys (title, company, person, email, phone, stage, value_amount...). */
export async function importDeals(rows: Record<string, string>[], o: { pipeline_id?: number | null } = {}): Promise<{ created: number; failed: { row: number; error: string }[] }> {
  if (!rows.length) throw new UserError("The file has no rows.");
  if (rows.length > 2000) throw new UserError("Import up to 2,000 rows at a time.");
  const stages = await q<{ id: number; name: string; role: string | null; category: string }>("select id, name, role, category from sales_stages where active");
  const failed: { row: number; error: string }[] = [];
  let created = 0;
  for (const [i, r] of rows.entries()) {
    const v = (k: string) => (r[k] ?? "").trim();
    try {
      if (!v("title") && !v("company") && !v("person") && !v("email") && !v("phone")) throw new UserError("Needs at least a deal name, company or contact.");
      let stageRole: string | undefined;
      if (v("stage")) {
        const s = stages.find((x) => x.name.toLowerCase() === v("stage").toLowerCase() || x.role === v("stage").toLowerCase());
        if (!s) throw new UserError(`No stage called "${v("stage")}".`);
        // closed stages need their details: import those as open and close them on the deal
        if (s.category !== "open") throw new UserError(`"${s.name}" is a closing stage. Import it as an open stage, then close it on the deal so its reason or record is captured.`);
        stageRole = s.role ?? undefined;
      }
      const companyId = v("company") ? await ensureCompany(v("company"), { country: v("country") || null, industry: v("industry") || null }) : null;
      const personId = v("person") || v("email") || v("phone")
        ? await upsertPerson({ name: v("person") || undefined, email: v("email") || undefined, phone: v("phone") || undefined, title: v("title_role") || null, company_id: companyId })
        : null;
      const source = v("source").toLowerCase();
      const id = await createDeal({
        title: v("title") || undefined, company_id: companyId, person_id: personId, source: SOURCES.includes(source) ? source : "other",
        stage_role: stageRole, requirements: v("requirements") || null, pipeline_id: o.pipeline_id ?? null,
      });
      const patch: Record<string, unknown> = {};
      for (const k of ["city", "region", "country", "industry", "services", "expected_close", "tags", "budget", "value_amount", "currency"]) if (v(k)) patch[k] = v(k);
      if (patch.currency) patch.currency = String(patch.currency).toUpperCase().slice(0, 3);
      if (Object.keys(patch).length) {
        try {
          await updateDeal(id, patch);
        } catch (e) {
          await deleteDeal(id);
          throw e;
        }
      }
      created++;
    } catch (e) {
      failed.push({ row: i + 2, error: e instanceof UserError ? e.message : "Something went wrong" });
    }
  }
  return { created, failed };
}

/** Every deal with every field, your own fields included, for a spreadsheet. */
export async function exportDeals(): Promise<{ header: string[]; rows: unknown[][] }> {
  const custom = await listCustomFields("deal");
  const deals = await q<Record<string, unknown>>(
    `select d.*, s.name as stage_name, p.name as pipeline_name, t.name as owner_name, co.name as company_name, pe.full_name as person_name,
            pe.emails as person_emails, pe.phones as person_phones,
            (select full_name from sales_people where id = d.economic_buyer_id) as economic_buyer_name,
            (select full_name from sales_people where id = d.champion_id) as champion_name,
            (select full_name from sales_people where id = d.poc_id) as poc_name
     from sales_deals d join sales_stages s on s.id = d.stage_id left join sales_pipelines p on p.id = d.pipeline_id
     left join sales_team t on t.id = d.owner_id left join sales_companies co on co.id = d.company_id left join sales_people pe on pe.id = d.person_id
     order by d.id`,
  );
  const names: Record<string, string> = { economic_buyer_id: "economic_buyer_name", champion_id: "champion_name", poc_id: "poc_name", pipeline_id: "pipeline_name", owner_id: "owner_name" };
  const fields = DEAL_FIELDS.filter((f) => f.key !== "title");
  const header = ["ID", "Deal name", "Stage", "Company", "Contact", "Contact emails", "Contact phones", "Currency", ...fields.map((f) => f.label), ...custom.map((c) => c.label), "Created", "Last touch", "Closed"];
  const rows = deals.map((d) => [
    d.id, d.title, d.stage_name, d.company_name, d.person_name, d.person_emails, d.person_phones, d.currency,
    ...fields.map((f) => (names[f.key] ? d[names[f.key]] : d[f.key])),
    ...custom.map((c) => ((d.custom ?? {}) as Record<string, unknown>)[c.key]),
    d.created_at instanceof Date ? d.created_at.toISOString() : d.created_at, d.last_touch_at instanceof Date ? d.last_touch_at.toISOString() : d.last_touch_at,
    d.closed_at instanceof Date ? d.closed_at.toISOString() : d.closed_at,
  ]);
  return { header, rows };
}
