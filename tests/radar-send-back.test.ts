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
import { createDeal, logInteraction } from "@/lib/sales/deals";
import { ensureCompany } from "@/lib/sales/identity";
import { refreshMoves } from "@/lib/sales/moves";
import { radarToDeal, sendBackToRadar } from "@/lib/sales/radar";

async function resetSales() {
  await q(`truncate sales_companies, sales_people, sales_identities, sales_deals, sales_deal_people, sales_deal_events, sales_captures,
           sales_interactions, sales_seen, sales_commitments, sales_moves, sales_meetings, sales_docs, sales_quote_revisions, sales_doc_views,
           sales_payments, sales_radar_items, sales_jobs, sales_tg_prompts, sales_calls, sales_focus, sales_blocklist, sales_offers,
           sales_proofs, sales_objections, sales_deal_objections restart identity cascade`);
  await q("delete from sales_radar_sources");
  await q("update sales_settings set config = '{}'::jsonb");
}
beforeEach(resetSales);

/** A qualified radar lead naming a company and a person, from a source, found `daysAgo` days ago. */
async function lead(hash: string, daysAgo = 0): Promise<number> {
  const src = (await one<{ id: number }>("insert into sales_radar_sources (key, name, kind, category) values ($1, $1, 'rss', 'requirement') returning id", [`src-${hash}`]))!.id;
  return (await one<{ id: number }>(
    `insert into sales_radar_items (url_hash, title, url, status, score, source_id, found_at, fit)
     values ($1, $2, 'https://reddit.com/r/x/1', 'qualified', 88, $3, now() - ($4 || ' days')::interval, $5) returning id`,
    [hash, `Need a booking bot (${hash})`, src, String(daysAgo), JSON.stringify({ company: `Clinic ${hash}`, contact: `Dr ${hash} Rao`, services: ["Voice agents"], why: "fit" })],
  ))!.id;
}

describe("send a radar lead back to the radar", () => {
  it("undoes a mistaken tap: the deal, the logged message and the people made for it go; the lead is new again", async () => {
    const id = await lead("a");
    await refreshMoves();
    expect((await one<{ status: string }>("select status from sales_moves where dedupe_key = $1", [`radar:${id}`]))!.status).toBe("open");
    const deal = await radarToDeal(id);
    await logInteraction({ deal_id: deal, channel: "linkedin", direction: "out", body: "Hi, saw your post", source: "web" });
    await refreshMoves();
    const before = (await one<{ deals_created: number }>("select deals_created from sales_radar_sources s join sales_radar_items r on r.source_id = s.id where r.id = $1", [id]))!;
    expect(before.deals_created).toBe(1);

    const dry = await sendBackToRadar(deal, { dryRun: true });
    expect(dry).toMatchObject({ ok: true, radar_item_id: id, messages: 1 });
    expect(await one("select 1 as x from sales_deals where id = $1", [deal])).toBeTruthy();

    const res = await sendBackToRadar(deal);
    expect(res.ok).toBe(true);
    expect(await one("select 1 as x from sales_deals where id = $1", [deal])).toBeNull();
    expect((await one<{ n: number }>("select count(*)::int as n from sales_interactions"))!.n).toBe(0);
    expect((await one<{ n: number }>("select count(*)::int as n from sales_people"))!.n).toBe(0);
    expect((await one<{ n: number }>("select count(*)::int as n from sales_companies"))!.n).toBe(0);
    const item = (await one<{ status: string; deal_id: number | null; sent_back: boolean; deals_created: number }>(
      "select r.status, r.deal_id, r.sent_back_at is not null as sent_back, s.deals_created from sales_radar_items r join sales_radar_sources s on s.id = r.source_id where r.id = $1", [id],
    ))!;
    expect(item).toEqual({ status: "qualified", deal_id: null, sent_back: true, deals_created: 0 });
    await refreshMoves();
    expect((await one<{ status: string }>("select status from sales_moves where dedupe_key = $1", [`radar:${id}`]))!.status).toBe("open");
    // no pending enrichment left for records that no longer exist
    expect((await one<{ n: number }>("select count(*)::int as n from sales_jobs where status = 'queued' and kind like 'enrich_%'"))!.n).toBe(0);
  });

  it("brings back an older lead too, on Radar and as a move", async () => {
    const id = await lead("old", 12);
    const deal = await radarToDeal(id);
    await sendBackToRadar(deal);
    await refreshMoves();
    expect((await one<{ status: string }>("select status from sales_moves where dedupe_key = $1", [`radar:${id}`]))!.status).toBe("open");
    const shown = await one("select 1 as x from sales_radar_items r where r.id = $1 and (r.found_at > now() - interval '10 days' or r.sent_back_at > now() - interval '10 days')", [id]);
    expect(shown).toBeTruthy();
  });

  it("keeps a company that existed before the deal (researched earlier)", async () => {
    const co = await ensureCompany("Clinic b", { website: "clinicb.in" });
    await q("update sales_companies set created_at = now() - interval '3 days' where id = $1", [co]);
    const id = await lead("b");
    const deal = await radarToDeal(id);
    expect((await one<{ company_id: number }>("select company_id from sales_deals where id = $1", [deal]))!.company_id).toBe(co);
    await sendBackToRadar(deal);
    expect(await one("select 1 as x from sales_companies where id = $1", [co])).toBeTruthy();
  });

  it("refuses once they have written back: then it is a real deal", async () => {
    const id = await lead("c");
    const deal = await radarToDeal(id);
    await logInteraction({ deal_id: deal, channel: "email", direction: "in", body: "Sounds good, tell me more", source: "web" });
    const res = await sendBackToRadar(deal);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/real conversation \(1 message from them\)/);
    expect(await one("select 1 as x from sales_deals where id = $1", [deal])).toBeTruthy();
    expect((await one<{ deal_id: number }>("select deal_id from sales_radar_items where id = $1", [id]))!.deal_id).toBe(deal);
  });

  it("refuses for a deal that never came from the radar", async () => {
    const deal = await createDeal({ title: "Referral" });
    const res = await sendBackToRadar(deal);
    expect(res).toMatchObject({ ok: false, radar_item_id: null });
    expect(res.reason).toMatch(/not made from a radar lead/);
  });
});
