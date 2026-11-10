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
import { closeDeal, closingGaps } from "@/lib/sales/closing";
import { updateSalesConfig, salesConfig } from "@/lib/sales/config";
import { cleanCustom, listCustomFields, saveCustomField, setCustomFieldActive } from "@/lib/sales/custom-fields";
import { createDeal, editInteraction, logActivity, updateDeal } from "@/lib/sales/deals";
import { closeKind, DEFAULT_REASONS, needsDetails, qualification } from "@/lib/sales/fields";
import { ensureCompany, upsertPerson } from "@/lib/sales/identity";
import { updateCompany, updatePerson } from "@/lib/sales/records";
import { moveDeal } from "@/lib/sales/stages";
import { winLoss } from "@/lib/sales/insights";

async function resetSales() {
  await q(`truncate sales_companies, sales_people, sales_identities, sales_deals, sales_deal_people, sales_deal_events, sales_captures,
           sales_interactions, sales_seen, sales_commitments, sales_moves, sales_meetings, sales_docs, sales_quote_revisions, sales_doc_views,
           sales_payments, sales_radar_items, sales_jobs, sales_tg_prompts, sales_calls, sales_focus, sales_blocklist, sales_offers,
           sales_proofs, sales_objections, sales_deal_objections, sales_custom_fields restart identity cascade`);
  await q("update sales_settings set config = '{}'::jsonb");
}
beforeEach(resetSales);

const stage = async (role: string) => (await one<{ id: number }>("select id from sales_stages where role = $1", [role]))!.id;
const deal = (id: number) => one<Record<string, unknown>>("select * from sales_deals where id = $1", [id]);
const fieldEvents = (id: number) => q<{ field: string; old_value: string | null; new_value: string | null; cause: string }>(
  "select field, old_value, new_value, cause from sales_deal_events where deal_id = $1 and kind = 'field' order by id", [id],
);

describe("deal fields are checked", () => {
  it("refuses values that are not what the field holds, with a plain reason", async () => {
    const id = await createDeal({ title: "Checks" });
    await expect(updateDeal(id, { value_amount: "two lakh" })).rejects.toThrow("Value needs a number.");
    await expect(updateDeal(id, { probability: 140 })).rejects.toThrow(/0 to 100/);
    await expect(updateDeal(id, { delivery_date: "next week" })).rejects.toThrow("Delivery date needs a date.");
    await expect(updateDeal(id, { deal_type: "mystery" })).rejects.toThrow(/deal type/);
    await expect(updateDeal(id, { title: "  " })).rejects.toThrow(/needs a name/);
  });

  it("stores lists from comma separated text, and amounts written with commas and ₹", async () => {
    const id = await createDeal({ title: "Lists" });
    await updateDeal(id, { competitors: "Zoho, in-house team, Zoho", value_amount: "₹1,50,000", city: " Pune ", deal_type: "upsell" });
    expect(await deal(id)).toMatchObject({ competitors: ["Zoho", "in-house team"], city: "Pune", deal_type: "upsell" });
    expect(Number((await deal(id))!.value_amount)).toBe(150000);
  });
});

describe("every change is in the deal's history", () => {
  it("records old and new values in words, who made the change, and nothing when a value did not change", async () => {
    const id = await createDeal({ title: "History", value_amount: 100000 });
    const p = await upsertPerson({ name: "Meera Iyer" });
    await updateDeal(id, { budget: "2 lakh", value_amount: 150000, economic_buyer_id: p, city: "Pune" });
    await updateDeal(id, { budget: "2 lakh", city: "Pune" }); // no change, no history
    await updateDeal(id, { budget: "3 lakh" }, { cause: "ai" });
    await updateDeal(id, { summary: "running notes" }); // the running summary is not tracked
    const ev = await fieldEvents(id);
    expect(ev).toEqual([
      { field: "budget", old_value: null, new_value: "2 lakh", cause: "manual" },
      { field: "value_amount", old_value: "₹1,00,000", new_value: "₹1,50,000", cause: "manual" },
      { field: "economic_buyer_id", old_value: null, new_value: "Meera Iyer", cause: "manual" },
      { field: "city", old_value: null, new_value: "Pune", cause: "manual" },
      { field: "budget", old_value: "2 lakh", new_value: "3 lakh", cause: "ai" },
    ]);
  });

  it("records a cleared value", async () => {
    const id = await createDeal({ title: "Clear" });
    await updateDeal(id, { pain: "Missed calls" });
    await updateDeal(id, { pain: "" });
    expect((await fieldEvents(id)).at(-1)).toMatchObject({ field: "pain", old_value: "Missed calls", new_value: null });
    expect((await deal(id))!.pain).toBeNull();
  });
});

describe("your own fields", () => {
  it("gets a stable key, checks values by type, merges into the deal, and records the change", async () => {
    const gst = await saveCustomField({ label: "GST number", type: "text" });
    const size = await saveCustomField({ label: "Branches", type: "number" });
    await saveCustomField({ label: "Plan", type: "select", options: "Basic\nPro" });
    expect((await saveCustomField({ label: "GST number", type: "text" }).then(() => listCustomFields("deal"))).map((f) => f.key)).toEqual(["gst_number", "branches", "plan", "gst_number_2"]);
    await expect(cleanCustom("deal", { branches: "many" })).rejects.toThrow("Branches needs a number.");
    await expect(cleanCustom("deal", { plan: "Gold" })).rejects.toThrow(/pick one of the choices/);
    await expect(cleanCustom("deal", { nope: 1 })).rejects.toThrow(/There is no field "nope"/);
    await expect(saveCustomField({ label: "Tier", type: "select" })).rejects.toThrow(/List the choices/);

    const id = await createDeal({ title: "Custom" });
    await updateDeal(id, { custom: { gst_number: "27ABCDE1234F1Z5", branches: "4", plan: "Pro" } });
    await updateDeal(id, { custom: { branches: "5" } });
    expect((await deal(id))!.custom).toEqual({ gst_number: "27ABCDE1234F1Z5", branches: 5, plan: "Pro" });
    await updateDeal(id, { custom: { plan: "" } }); // empty clears it
    expect((await deal(id))!.custom).toEqual({ gst_number: "27ABCDE1234F1Z5", branches: 5 });
    const ev = await fieldEvents(id);
    expect(ev.map((e) => [e.field, e.old_value, e.new_value])).toContainEqual(["custom.branches", "4", "5"]);
    // renaming keeps the key, so values keep working; hiding keeps them too
    await saveCustomField({ id: gst, label: "GSTIN", type: "text" });
    await setCustomFieldActive(size, false);
    expect((await listCustomFields("deal")).map((f) => f.label)).toEqual(["GSTIN", "Plan", "GST number"]);
    expect((await listCustomFields("deal", true)).find((f) => f.id === gst)!.key).toBe("gst_number");
  });
});

describe("the activity log", () => {
  it("logs a back-dated call with duration and outcome, and the deal's clocks follow", async () => {
    const id = await createDeal({ title: "Calls" });
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const iid = await logActivity(id, { type: "call", direction: "out", occurred_at: at, duration_min: "25", outcome: "Connected", subject: "Pricing call", body: "Discussed 3 packages\nThey want WhatsApp too", next_step: "Send revised quote", next_step_at: new Date(Date.now() + 86_400_000).toISOString() });
    const row = (await one<Record<string, unknown>>("select channel, direction, occurred_at, duration_min, outcome, subject, body, source from sales_interactions where id = $1", [iid]))!;
    expect(row).toMatchObject({ channel: "call", direction: "out", duration_min: 25, outcome: "Connected", subject: "Pricing call", source: "manual" });
    expect(new Date(row.occurred_at as string).toISOString()).toBe(at);
    const d = (await deal(id))!;
    expect(new Date(d.last_touch_at as string).toISOString()).toBe(at);
    expect(d.next_action).toBe("Send revised quote");
  });

  it("keeps a remark internal: it is logged but is not a touch", async () => {
    const id = await createDeal({ title: "Remark" });
    await logActivity(id, { type: "note", subject: "Prefers calls after 6 pm" });
    expect((await one<{ direction: string; channel: string }>("select direction, channel from sales_interactions where deal_id = $1", [id]))).toEqual({ direction: "internal", channel: "note" });
    expect((await deal(id))!.last_touch_at).toBeNull();
  });

  it("refuses the future, empty entries and silly durations", async () => {
    const id = await createDeal({ title: "Refuse" });
    await expect(logActivity(id, { type: "call", body: "x", occurred_at: new Date(Date.now() + 5 * 3_600_000).toISOString() })).rejects.toThrow(/future/);
    await expect(logActivity(id, { type: "call" })).rejects.toThrow(/Write what happened/);
    await expect(logActivity(id, { type: "call", body: "x", duration_min: 5000 })).rejects.toThrow(/up to 1440/);
    await expect(logActivity(id, { type: "carrier pigeon", body: "x" })).rejects.toThrow(/what kind/);
  });

  it("corrects an entry's date and recomputes the deal's last touch", async () => {
    const id = await createDeal({ title: "Correct" });
    const iid = await logActivity(id, { type: "whatsapp", direction: "in", body: "Yes, interested" });
    const earlier = new Date(Date.now() - 10 * 86_400_000).toISOString();
    await editInteraction(iid, { occurred_at: earlier, outcome: "Interested" });
    const d = (await deal(id))!;
    expect(new Date(d.last_inbound_at as string).toISOString()).toBe(earlier);
    expect((await one<{ outcome: string; edited: boolean }>("select outcome, edited_at is not null as edited from sales_interactions where id = $1", [iid]))).toEqual({ outcome: "Interested", edited: true });
    await expect(editInteraction(iid, { channel: "fax" })).rejects.toThrow(/channel/);
  });
});

describe("closing a deal", () => {
  const won = (over: Record<string, unknown> = {}) => ({
    reason: DEFAULT_REASONS.won[0], poc_new: { name: "Ravi Shah", phone: "+91 98200 00000", title: "Operations head" }, final_amount: "2,40,000",
    currency: "INR", delivery_date: "2026-12-20", scope: "WhatsApp booking bot, 3 flows, admin panel. Not included: payments.", payment_terms: "50% advance, 50% on handover",
    advance_pct: 50, start_date: "2026-11-15", contract_ref: "PO-118", ...over,
  });

  it("will not close as won without the point of contact, amount, delivery, scope and reason", async () => {
    const id = await createDeal({ title: "Won?", stage_role: "negotiation" });
    const w = await stage("won");
    await expect(closeDeal(id, w, won({ poc_new: null }))).rejects.toThrow(/point of contact/);
    await expect(closeDeal(id, w, won({ final_amount: "" }))).rejects.toThrow(/final amount/);
    await expect(closeDeal(id, w, won({ delivery_date: "", delivery_duration: "" }))).rejects.toThrow(/delivered/);
    await expect(closeDeal(id, w, won({ scope: " " }))).rejects.toThrow(/scope of work/);
    await expect(closeDeal(id, w, won({ reason: "Because" }))).rejects.toThrow(/not on the list/);
    expect((await deal(id))!.stage_id).not.toBe(w);
  });

  it("refuses a move the flow does not allow, and writes nothing", async () => {
    const id = await createDeal({ title: "Straight to won" });
    await expect(closeDeal(id, await stage("won"), won())).rejects.toThrow(/cannot go from New/);
    expect((await deal(id))!.value_amount).toBeNull();
    expect((await one<{ n: number }>("select count(*)::int as n from sales_people"))!.n).toBe(0);
  });

  it("closes with the full record: contact on the deal, amount, dates, scope, payments planned, reason in the history", async () => {
    const id = await createDeal({ title: "Clinic bot", value_amount: 200000, stage_role: "negotiation" });
    await closeDeal(id, await stage("won"), won());
    const d = (await deal(id))!;
    expect(d).toMatchObject({ stage_id: await stage("won"), currency: "INR", scope: expect.stringContaining("Not included"), payment_terms: "50% advance, 50% on handover", contract_ref: "PO-118", won_reason: DEFAULT_REASONS.won[0] });
    expect(Number(d.value_amount)).toBe(240000);
    const poc = (await one<{ full_name: string; title: string }>("select full_name, title from sales_people where id = $1", [d.poc_id]))!;
    expect(poc).toEqual({ full_name: "Ravi Shah", title: "Operations head" });
    expect(await one("select 1 as x from sales_deal_people where deal_id = $1 and person_id = $2", [id, d.poc_id])).toBeTruthy();
    const pays = await q<{ label: string; amount: number; due_on: string }>("select label, amount::float, to_char(due_on, 'YYYY-MM-DD') as due_on from sales_payments where deal_id = $1 order by id", [id]);
    expect(pays).toEqual([{ label: "Advance (50%)", amount: 120000, due_on: "2026-11-15" }, { label: "Balance on delivery", amount: 120000, due_on: "2026-12-20" }]);
    const ev = (await one<{ detail: string; cause: string }>("select detail, cause from sales_deal_events where deal_id = $1 and kind = 'stage' order by id desc limit 1", [id]))!;
    expect(ev).toEqual({ detail: DEFAULT_REASONS.won[0], cause: "manual" });
    expect(await closingGaps(id)).toEqual([]);
    // the value change is in the history too
    expect((await fieldEvents(id)).find((e) => e.field === "value_amount")).toMatchObject({ old_value: "₹2,00,000", new_value: "₹2,40,000" });
  });

  it("asks for your own fields marked as needed to win", async () => {
    await saveCustomField({ label: "Signed by", type: "text", required_to_win: true });
    const id = await createDeal({ title: "Custom win", stage_role: "negotiation" });
    await expect(closeDeal(id, await stage("won"), won())).rejects.toThrow("Signed by is needed to close as won.");
    await closeDeal(id, await stage("won"), won({ custom: { signed_by: "Director" } }));
    expect((await deal(id))!.custom).toEqual({ signed_by: "Director" });
  });

  it("a deal won outside the checklist (Telegram, a client accepting) lists what its record lacks, until completed", async () => {
    const id = await createDeal({ title: "Telegram win" });
    await moveDeal(id, await stage("won"), { cause: "telegram", force: true });
    expect(await closingGaps(id)).toEqual(["point of contact", "final amount", "delivery date or time", "scope of work", "why they chose you"]);
    await closeDeal(id, null, won({ advance_pct: null }), { complete: true });
    expect(await closingGaps(id)).toEqual([]);
    expect((await one<{ n: number }>("select count(*)::int as n from sales_payments where deal_id = $1", [id]))!.n).toBe(0);
    await expect(closeDeal(await createDeal({ title: "Open" }), null, won(), { complete: true })).rejects.toThrow(/Only a won deal/);
  });

  it("lost needs a reason from your list, and keeps who it went to, what happened, the lesson and a retry date", async () => {
    const id = await createDeal({ title: "Lost one" });
    const lost = await stage("lost");
    await expect(closeDeal(id, lost, {})).rejects.toThrow(/Pick why it was lost/);
    await closeDeal(id, lost, { reason: "Chose a competitor", lost_to: "Acme Digital", lost_detail: "They were ₹40k cheaper", lessons: "Lead with the case study", date: "2027-03-01" });
    expect(await deal(id)).toMatchObject({ lost_reason: "Chose a competitor", lost_to: "Acme Digital", lost_detail: "They were ₹40k cheaper", lessons: "Lead with the case study" });
    expect(String((await deal(id))!.revisit_on instanceof Date ? ((await deal(id))!.revisit_on as Date).toISOString() : (await deal(id))!.revisit_on)).toContain("2027-0");
    const ev = (await one<{ detail: string }>("select detail from sales_deal_events where deal_id = $1 and kind = 'stage' order by id desc limit 1", [id]))!;
    expect(ev.detail).toBe("Chose a competitor | lost to Acme Digital");
  });

  it("parking needs a reason and a date; reopening needs a reason; your edited lists are used", async () => {
    const id = await createDeal({ title: "Park" });
    await expect(closeDeal(id, await stage("nurture"), { reason: "Busy with other priorities" })).rejects.toThrow(/come back/);
    await closeDeal(id, await stage("nurture"), { reason: "Busy with other priorities", date: "2027-01-10" });
    await expect(closeDeal(id, await stage("engaged"), {})).rejects.toThrow(/Pick why it is reopened/);
    await updateSalesConfig({ reasons: { ...DEFAULT_REASONS, reopened: ["Budget approved"] } });
    await expect(closeDeal(id, await stage("engaged"), { reason: "They came back" })).rejects.toThrow(/not on the list/);
    await closeDeal(id, await stage("engaged"), { reason: "Budget approved" });
    expect((await deal(id))!.stage_id).toBe(await stage("engaged"));
    // an emptied list falls back to the defaults, so the form always has choices
    await updateSalesConfig({ reasons: { ...DEFAULT_REASONS, lost: [] } });
    expect((await salesConfig()).reasons.lost).toEqual(DEFAULT_REASONS.lost);
  });

  it("knows which moves need details", () => {
    const open = { category: "open" };
    expect(closeKind(open, { category: "won", role: "won" })).toBe("won");
    expect(closeKind({ category: "won" }, { category: "won", role: "paid" })).toBe("move");
    expect(closeKind(open, { category: "lost", role: "disqualified" })).toBe("disqualified");
    expect(closeKind({ category: "lost" }, { category: "open", role: "engaged" })).toBe("reopen");
    expect(needsDetails(open, { category: "open", role: "proposal" }, "none")).toBe(false);
    expect(needsDetails(open, { category: "open", role: "proposal" }, "quote")).toBe(true);
  });
});

describe("Insights counts why you win and lose", () => {
  it("groups closed deals by the reason picked, and names the biggest one once there are enough", async () => {
    for (let i = 0; i < 5; i++) {
      const id = await createDeal({ title: `L${i}` });
      await closeDeal(id, await stage("lost"), { reason: i < 3 ? "Price: our quote was too high for them" : "Stopped responding", lost_to: i === 0 ? "Acme Digital" : null });
    }
    const wl = await winLoss(180);
    expect(wl.reasons.lost).toEqual([{ reason: "Price: our quote was too high for them", n: 3 }, { reason: "Stopped responding", n: 2 }]);
    expect(wl.reasons.lost_to).toEqual([{ reason: "Acme Digital", n: 1 }]);
    expect(wl.findings).toContain('Most losses are "Price: our quote was too high for them" (3 of 5). That is the one thing to fix first.');
  });
});

describe("qualification", () => {
  it("counts what is answered, BANT and MEDDPICC style", () => {
    expect(qualification({}).done).toBe(0);
    const q2 = qualification({ requirements: "bot", budget: "2L", expected_close: "2026-12-01", economic_buyer_id: 3, competitors: ["Zoho"] });
    expect(q2.done).toBe(5);
    expect(q2.missing.map((m) => m.key)).toContain("champion_id");
  });
});

describe("companies and people", () => {
  it("keep location, GST and contact details, checked, with their own fields", async () => {
    const c = (await ensureCompany("Shah Clinics"))!;
    await updateCompany(c, { city: "Pune", region: "Maharashtra", postal_code: "411001", tax_id: "27ABCDE1234F1Z5", website: "https://www.shahclinics.in/about", employees: "40" });
    expect(await one("select city, region, postal_code, tax_id, domain, employees from sales_companies where id = $1", [c])).toEqual({ city: "Pune", region: "Maharashtra", postal_code: "411001", tax_id: "27ABCDE1234F1Z5", domain: "shahclinics.in", employees: 40 });
    await expect(updateCompany(c, { email: "not-an-email" })).rejects.toThrow(/email address/);
    await expect(updateCompany(c, { name: "" })).rejects.toThrow(/needs a name/);
    await saveCustomField({ scope: "company", label: "Branches", type: "number" });
    await updateCompany(c, { custom: { branches: "3" } });
    expect((await one<{ custom: unknown }>("select custom from sales_companies where id = $1", [c]))!.custom).toEqual({ branches: 3 });

    const p = await upsertPerson({ name: "Ravi Shah" });
    await updatePerson(p, { department: "Operations", seniority: "Manager", whatsapp: "+91 98200 11111", emails: "ravi@shahclinics.in, ravi@shahclinics.in", preferred_channel: "WhatsApp", is_decision_maker: true });
    expect(await one("select department, seniority, emails, preferred_channel, is_decision_maker from sales_people where id = $1", [p])).toEqual({ department: "Operations", seniority: "Manager", emails: ["ravi@shahclinics.in"], preferred_channel: "WhatsApp", is_decision_maker: true });
    expect((await one<{ n: number }>("select count(*)::int as n from sales_identities where person_id = $1", [p]))!.n).toBeGreaterThanOrEqual(2);
    await expect(updatePerson(p, { seniority: "Emperor" })).rejects.toThrow(/seniority/);
  });
});
