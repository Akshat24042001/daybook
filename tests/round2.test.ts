import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sales/notify", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/notify")>();
  return { ...real, push: vi.fn(async () => 1) };
});
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return { ...real, llmConfigured: () => false, llmJson: vi.fn(async () => { throw new Error("no AI"); }), llm: vi.fn(async () => { throw new Error("no AI"); }) };
});

import { one, q } from "@/lib/db";
import { bulkDeals, exportDeals, importDeals } from "@/lib/sales/bulk";
import { guessMapping, parseCsv, toCsv } from "@/lib/sales/csv";
import { createDeal, updateDeal } from "@/lib/sales/deals";
import { fitScore, serviceHints, type FitContext } from "@/lib/sales/fit-calc";
import { fitForDeals } from "@/lib/sales/fit";
import { ensureCompany, upsertPerson } from "@/lib/sales/identity";
import { applyItemTotals, itemTotals, lineAmounts, listItems, saveItem } from "@/lib/sales/items";
import { refreshMoves } from "@/lib/sales/moves";
import { defaultPipelineId, listPipelines, listTeam, saveMember, savePipeline } from "@/lib/sales/org";
import { DEFAULT_PLAYBOOK, playFor } from "@/lib/sales/playbook-stages";
import { recurringSummary, stageReport, stageRows } from "@/lib/sales/stage-report";
import { moveDeal } from "@/lib/sales/stages";

async function resetSales() {
  await q(`truncate sales_companies, sales_people, sales_identities, sales_deals, sales_deal_people, sales_deal_events, sales_captures,
           sales_interactions, sales_seen, sales_commitments, sales_moves, sales_meetings, sales_docs, sales_quote_revisions, sales_doc_views,
           sales_payments, sales_radar_items, sales_jobs, sales_tg_prompts, sales_calls, sales_focus, sales_blocklist, sales_offers,
           sales_proofs, sales_objections, sales_deal_objections, sales_custom_fields, sales_deal_items, sales_team restart identity cascade`);
  await q("delete from sales_pipelines where id <> (select min(id) from sales_pipelines)");
  await q("update sales_pipelines set name = 'Sales', stage_ids = '{}', active = true");
  await q("update sales_settings set config = '{}'::jsonb");
}
beforeEach(resetSales);
const stage = async (role: string) => (await one<{ id: number }>("select id from sales_stages where role = $1", [role]))!.id;

// ---------------------------------------------------------------- fit
const offers = [
  { id: 1, name: "AI agents", summary: "WhatsApp and website assistants that answer and book", keywords: ["chatbot"] },
  { id: 2, name: "Voice agents", summary: "Answer every call, book appointments", keywords: [] },
  { id: 3, name: "Websites that convert", summary: null, keywords: [] },
  { id: 4, name: "Computer vision", summary: "Safety, quality checks, counting on cameras", keywords: [] },
  { id: 5, name: "Workflow automation", summary: "Connect the tools they use", keywords: [] },
  { id: 6, name: "Growth systems", summary: "Lead capture, CRM, follow-ups", keywords: [] },
];
const ctx: FitContext = {
  homeCountry: "India", countries: ["United Arab Emirates", "United States"], industries: ["healthcare clinics", "manufacturing", "logistics"],
  industryStats: [{ value: "healthcare clinics", qualified: 4, conversations: 2, won: 1, turns: 0, last: null, points: 20, score: 1 }],
  countryStats: [], offers, avgWonUsd: 3000,
};

describe("fit score", () => {
  it("scores a clinic in India that asked about missed calls, through a referral, with the owner, as an A, and says why", () => {
    const f = fitScore({ industry: "Dental clinic", country: "India", employees: 25, source: "referral", value_usd: 3600, decision_maker: true, has_contact: true, services: [], text: "Front desk misses about 30 calls a day" }, ctx);
    expect(f.grade).toBe("A");
    expect(f.score).toBeGreaterThanOrEqual(90);
    expect(f.plus).toEqual(expect.arrayContaining(["Dental clinic: an industry you target", "you have won 1 deal in healthcare clinics", "India: your home market", "what they need matches Voice agents", "you are talking to who decides", "Source: came by referral"]));
    expect(f.hints[0]).toMatchObject({ offer: "Voice agents" });
    expect(f.hints[0].why[0]).toMatch(/^they mention calls going unanswered \("[^"]+"\)$/);
  });

  it("scores an unknown cold lead low and lists what is missing", () => {
    const f = fitScore({ source: "outbound" }, ctx);
    expect(f.grade).toBe("D");
    expect(f.minus).toEqual(expect.arrayContaining(["Industry not known yet", "Country not known yet", "Company size not known", "No budget or value yet", "No contact person yet", "Source: cold outreach"]));
    expect(f.hints).toEqual([]);
  });

  it("hints come only from the record, point at your own offers, and say when they already bought it", () => {
    const h = serviceHints({ industry: "Steel manufacturing", text: "Data entry is done in Excel; we need safety checks on CCTV", services: ["website"], bought: ["Websites that convert"] }, offers);
    const names = h.map((x) => x.offer);
    expect(names).toEqual(expect.arrayContaining(["Computer vision", "Workflow automation", "Websites that convert"]));
    expect(h.find((x) => x.offer === "Websites that convert")!.already).toBe(true);
    expect(h.find((x) => x.offer === "Computer vision")!.why.join(" ")).toMatch(/cctv|safety/i);
    // nothing you do not sell is ever suggested
    expect(serviceHints({ industry: "Dental clinic", text: "missed calls" }, [{ name: "Websites that convert" }]).map((x) => x.offer)).toEqual([]);
  });

  it("points at the right one of your actual offers", async () => {
    const { DEFAULT_CONFIG } = await import("@/lib/sales/config");
    const mine = DEFAULT_CONFIG.offers.map((name) => ({ name }));
    const pick = (text: string) => serviceHints({ text }, mine)[0]?.offer;
    expect(pick("everything is typed into Excel by hand")).toMatch(/^Workflow automation/);
    expect(pick("customers ask on WhatsApp all day")).toMatch(/^AI agents/);
    expect(pick("we miss calls at the front desk")).toMatch(/^Voice agents/);
    expect(pick("our website gets no traffic")).toMatch(/^Websites/);
    expect(pick("safety checks on CCTV")).toMatch(/^Computer vision/);
    expect(pick("we lose leads, no follow-up")).toMatch(/^Business growth systems/);
    expect(pick("we need a mobile app for our customers")).toMatch(/^Mobile applications/);
    expect(pick("we want a custom portal for dealers")).toMatch(/^Custom software/);
  });

  it("scores real deals from their records and research", async () => {
    const co = (await ensureCompany("Shah Dental"))!;
    await q("update sales_companies set employees = 30, industry = 'Dental clinics', audit = $2 where id = $1", [co, JSON.stringify({ summary: "Calls go unanswered at lunch", opportunities: [{ title: "Voice booking", problem: "missed calls" }] })]);
    const p = await upsertPerson({ name: "Dr Shah", company_id: co });
    await q("update sales_people set is_decision_maker = true where id = $1", [p]);
    const id = await createDeal({ title: "Shah Dental", company_id: co, person_id: p, source: "inbound" });
    await updateDeal(id, { country: "India" });
    const f = (await fitForDeals([id])).get(id)!;
    expect(f.plus).toEqual(expect.arrayContaining(["India: your home market", "you are talking to who decides", "Source: they came to you"]));
    expect(f.hints.length).toBeGreaterThan(0);
    expect(f.hints[0].why.join(" ")).toMatch(/call/i);
  });
});

// ---------------------------------------------------------------- items and recurring
describe("line items", () => {
  it("works out discount, GST and totals; recurring per month", () => {
    expect(lineAmounts({ qty: 2, unit_price: 50000, discount_pct: 10, tax_pct: 18 })).toEqual({ gross: 100000, discount: 10000, tax: 16200, total: 106200 });
    const t = itemTotals([
      { qty: 1, unit_price: 200000, discount_pct: 0, tax_pct: 18, billing: "one_time" },
      { qty: 1, unit_price: 15000, discount_pct: 0, tax_pct: 18, billing: "monthly" },
      { qty: 1, unit_price: 120000, discount_pct: 0, tax_pct: 0, billing: "yearly" },
    ]);
    expect(t.one_time.total).toBe(236000);
    expect(t.monthly.total).toBe(27700);
  });

  it("are checked, and their totals set the deal value and recurring amount, recorded in history", async () => {
    const id = await createDeal({ title: "Items" });
    await expect(saveItem(id, { name: "" })).rejects.toThrow(/name/);
    await expect(saveItem(id, { name: "Bot", unit_price: "abc" })).rejects.toThrow(/Price needs a number/);
    await expect(saveItem(id, { name: "Bot", unit_price: 1, discount_pct: 120 })).rejects.toThrow(/over 100/);
    await saveItem(id, { name: "WhatsApp bot", unit_price: "1,00,000", tax_pct: 18 });
    await saveItem(id, { name: "Support", unit_price: 10000, tax_pct: 18, billing: "monthly" });
    expect((await listItems(id)).map((i) => i.name)).toEqual(["WhatsApp bot", "Support"]);
    await applyItemTotals(id);
    const d = (await one<{ value_amount: number; recurring_amount: number; billing_cycle: string }>("select value_amount, recurring_amount, billing_cycle from sales_deals where id = $1", [id]))!;
    expect(d).toEqual({ value_amount: 118000, recurring_amount: 11800, billing_cycle: "monthly" });
    expect((await q<{ field: string }>("select field from sales_deal_events where deal_id = $1 and kind = 'field'", [id])).map((e) => e.field)).toEqual(expect.arrayContaining(["value_amount", "recurring_amount"]));
  });
});

describe("recurring revenue and renewals", () => {
  it("adds up monthly revenue across currencies and cycles, and raises a renewal move before a contract ends", async () => {
    const a = await createDeal({ title: "Retainer A", stage_role: "negotiation" });
    const b = await createDeal({ title: "Retainer B", stage_role: "negotiation" });
    for (const id of [a, b]) await moveDeal(id, await stage("won"), { cause: "telegram", force: true });
    const soon = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    await updateDeal(a, { recurring_amount: 30000, billing_cycle: "monthly", contract_end: soon, renewal_notice_days: 30 });
    await updateDeal(b, { recurring_amount: 1200, billing_cycle: "yearly", currency: "USD" });
    const r = await recurringSummary();
    // ₹30,000 + $100 a month (= ₹8,333 at 0.012)
    expect(r).toMatchObject({ currency: "INR", mrr: 38333, clients: 2 });
    expect(r.renewals.map((x) => x.title)).toEqual(["Retainer A"]);
    await refreshMoves();
    const m = (await one<{ kind: string; title: string }>("select kind, title from sales_moves where deal_id = $1 and kind = 'renewal'", [a]))!;
    expect(m.title).toMatch(/^Renewal: .*contract ends in (19|20) days/);
    expect(await one("select 1 as x from sales_moves where deal_id = $1 and kind = 'renewal'", [b])).toBeNull();
  });
});

// ---------------------------------------------------------------- pipelines and team
describe("pipelines and team", () => {
  it("new deals go to the first pipeline; a pipeline turned off hands its deals back; one always stays on", async () => {
    const first = (await defaultPipelineId())!;
    expect((await one<{ pipeline_id: number }>("select pipeline_id from sales_deals where id = $1", [await createDeal({ title: "A" })]))!.pipeline_id).toBe(first);
    const ret = await savePipeline({ name: "Retainers", stage_ids: [await stage("won"), await stage("active")] });
    const d = await createDeal({ title: "B", pipeline_id: ret });
    expect((await listPipelines()).map((p) => [p.name, p.deals])).toEqual([["Sales", 1], ["Retainers", 1]]);
    await expect(savePipeline({ name: "X", stage_ids: [999999] })).rejects.toThrow(/no longer exists/);
    await savePipeline({ id: ret, name: "Retainers", active: false });
    expect((await one<{ pipeline_id: number }>("select pipeline_id from sales_deals where id = $1", [d]))!.pipeline_id).toBe(first);
    await expect(savePipeline({ id: first, name: "Sales", active: false })).rejects.toThrow(/at least one/);
  });

  it("owners come from your team, and a change of owner is in the history by name", async () => {
    const riya = await saveMember({ name: "Riya", role: "Sales" });
    await expect(saveMember({ name: "X", email: "nope" })).rejects.toThrow(/email/);
    const id = await createDeal({ title: "Owned" });
    await updateDeal(id, { owner_id: riya });
    expect((await one<{ new_value: string }>("select new_value from sales_deal_events where deal_id = $1 and field = 'owner_id'", [id]))!.new_value).toBe("Riya");
    await expect(updateDeal(id, { owner_id: 999 })).rejects.toThrow(/team member/);
    expect((await listTeam())[0]).toMatchObject({ name: "Riya", deals: 1 });
  });
});

// ---------------------------------------------------------------- bulk, import, export
describe("bulk changes", () => {
  it("sets fields and tags on many deals, moves them along open stages, and refuses closing moves", async () => {
    const a = await createDeal({ title: "A" });
    const b = await createDeal({ title: "B" });
    let r = await bulkDeals([a, b], { set: { city: "Pune", deal_type: "upsell" }, add_tags: ["hot"] });
    expect(r).toEqual({ done: 2, failed: [] });
    expect(await q("select city, deal_type, tags from sales_deals order by id")).toEqual([{ city: "Pune", deal_type: "upsell", tags: ["hot"] }, { city: "Pune", deal_type: "upsell", tags: ["hot"] }]);
    r = await bulkDeals([a, b], { stage_id: await stage("contacted") });
    expect(r.done).toBe(2);
    r = await bulkDeals([a], { stage_id: await stage("lost") });
    expect(r.failed[0].error).toMatch(/asks for details: do it on the deal/);
    await expect(bulkDeals([a], { set: { value_amount: 5 } })).rejects.toThrow(/cannot be changed in bulk/);
    r = await bulkDeals([a, b], { delete: true });
    expect(r.done).toBe(2);
    expect((await one<{ n: number }>("select count(*)::int as n from sales_deals"))!.n).toBe(0);
  });
});

describe("CSV", () => {
  it("parses quoted fields, commas and line breaks; writes them back safely", () => {
    expect(parseCsv('Name,Notes\r\n"Shah, Dental","Line 1\nLine ""2"""\r\n\r\nB,x')).toEqual([["Name", "Notes"], ["Shah, Dental", 'Line 1\nLine "2"'], ["B", "x"]]);
    expect(toCsv(["a", "b"], [["=SUM(A1)", "x,y"]])).toBe('a,b\r\n\'=SUM(A1),"x,y"\r\n');
    expect(guessMapping(["Company Name", "Contact", "Mobile", "Deal Value", "City", "Whatever"])).toEqual(["company", "person", "phone", "value_amount", "city", ""]);
  });

  it("imports rows, skips bad ones with the row number, and refuses closing stages", async () => {
    const r = await importDeals([
      { company: "Shah Dental", person: "Dr Shah", phone: "+91 98200 00000", value_amount: "2,40,000", city: "Pune", stage: "Contacted", services: "Voice agents, Website" },
      { company: "Lost Co", stage: "Lost" },
      { city: "Nowhere" },
      { title: "Bad value", value_amount: "lots" },
    ]);
    expect(r.created).toBe(1);
    expect(r.failed.map((f) => f.row)).toEqual([3, 4, 5]);
    expect(r.failed[0].error).toMatch(/closing stage/);
    expect(r.failed[1].error).toMatch(/at least a deal name/);
    expect(r.failed[2].error).toMatch(/Value needs a number/);
    expect(await q("select title, city, value_amount, services from sales_deals")).toEqual([{ title: "Shah Dental", city: "Pune", value_amount: 240000, services: ["Voice agents", "Website"] }]);
    expect((await one<{ role: string }>("select s.role from sales_deals d join sales_stages s on s.id = d.stage_id"))!.role).toBe("contacted");
  });

  it("exports every deal with every field, people and pipelines by name", async () => {
    const riya = await saveMember({ name: "Riya" });
    const id = await createDeal({ title: "Export me" });
    await updateDeal(id, { owner_id: riya, city: "Pune" });
    const { header, rows } = await exportDeals();
    const row = rows[0];
    expect(row[header.indexOf("Deal name")]).toBe("Export me");
    expect(row[header.indexOf("Owner")]).toBe("Riya");
    expect(row[header.indexOf("City")]).toBe("Pune");
    expect(row[header.indexOf("Pipeline")]).toBe("Sales");
  });
});

// ---------------------------------------------------------------- playbooks and stage report
describe("stage playbooks", () => {
  it("uses your edits, else the default for the stage's role", () => {
    expect(playFor({ role: "discovery" }, {}).questions.length).toBe(12);
    expect(playFor({ role: "discovery" }, { discovery: { questions: ["Mine?"], checklist: [] } }).questions).toEqual(["Mine?"]);
    expect(playFor({ role: null, key: "custom_stage" }, {})).toEqual({ questions: [], checklist: [] });
    expect(DEFAULT_PLAYBOOK.won.checklist).toContain("Fill the closing record");
  });
});

describe("stage by stage report", () => {
  it("counts where deals went from each stage and how long they stayed", () => {
    const st = [{ id: 1, name: "New", sort: 10, category: "open" }, { id: 2, name: "Proposal", sort: 50, category: "open" }, { id: 3, name: "Won", sort: 70, category: "won" }, { id: 4, name: "Lost", sort: 140, category: "lost" }];
    const now = Date.parse("2026-11-10T00:00:00Z");
    const at = (d: number) => new Date(now - d * 86_400_000).toISOString();
    const rows = stageRows([
      { deal_id: 1, stage_id: 1, at: at(20) }, { deal_id: 1, stage_id: 1, at: at(20) }, { deal_id: 1, stage_id: 2, at: at(10) }, { deal_id: 1, stage_id: 3, at: at(4) },
      { deal_id: 2, stage_id: 1, at: at(15) }, { deal_id: 2, stage_id: 2, at: at(9) }, { deal_id: 2, stage_id: 1, at: at(6) },
      { deal_id: 3, stage_id: 1, at: at(3) }, { deal_id: 3, stage_id: 4, at: at(1) },
    ], st, now - 90 * 86_400_000, now);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.New).toMatchObject({ entered: 4, forward: 2, lost: 1, still: 1, pass_rate: 67 });
    expect(by.Proposal).toMatchObject({ entered: 2, won: 1, back: 1, pass_rate: 50, median_days: 4.5 });
  });

  it("reads real moves", async () => {
    const id = await createDeal({ title: "Report" });
    await moveDeal(id, await stage("contacted"));
    const rows = await stageReport(30);
    expect(rows.find((r) => r.name === "New")).toMatchObject({ entered: 1, forward: 1 });
    expect(rows.find((r) => r.name === "Contacted")).toMatchObject({ entered: 1, still: 1 });
  });
});
