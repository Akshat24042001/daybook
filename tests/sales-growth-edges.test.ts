import { beforeEach, describe, expect, it, vi } from "vitest";

// Telegram is captured instead of sent, and the AI is off: the no-AI paths are the ones under test here.
const sent: string[] = [];
vi.mock("@/lib/sales/notify", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/notify")>();
  return { ...real, push: vi.fn(async (text: string) => { sent.push(text); return 1; }) };
});
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return { ...real, llmConfigured: () => false, llmJson: vi.fn(async () => { throw new Error("no AI"); }), llm: vi.fn(async () => { throw new Error("no AI"); }) };
});

import { one, q } from "@/lib/db";
import { updateSalesConfig } from "@/lib/sales/config";
import { createDeal } from "@/lib/sales/deals";
import { ensureCompany } from "@/lib/sales/identity";
import { forecast, speed, winLoss } from "@/lib/sales/insights";
import { messagePerformance } from "@/lib/sales/learning";
import { alertItem } from "@/lib/sales/radar";
import { screenRadarItem } from "@/lib/sales/blocklist";
import { reviewInsights } from "@/lib/sales/review";
import { draftProof } from "@/lib/sales/proofs";
import { syncObjections } from "@/lib/sales/objections";

async function resetSales() {
  await q(`truncate sales_companies, sales_people, sales_identities, sales_deals, sales_deal_people, sales_deal_events, sales_captures,
           sales_interactions, sales_seen, sales_commitments, sales_moves, sales_meetings, sales_docs, sales_quote_revisions, sales_doc_views,
           sales_payments, sales_radar_items, sales_jobs, sales_tg_prompts, sales_calls, sales_focus, sales_blocklist, sales_offers,
           sales_proofs, sales_objections, sales_deal_objections restart identity cascade`);
  await q("delete from sales_radar_sources");
  await q("update sales_settings set config = '{}'::jsonb");
}

beforeEach(async () => {
  await resetSales();
  sent.length = 0;
});

const clean = (x: unknown) => !/NaN|Infinity|undefined/.test(JSON.stringify(x));

describe("a brand-new account (no data at all)", () => {
  it("Insights, the forecast and speed give clean empty answers, never NaN", async () => {
    const [f, w, m, s] = await Promise.all([forecast(), winLoss(90), messagePerformance(90), speed(90)]);
    expect(clean(f) && clean(w) && clean(m) && clean(s)).toBe(true);
    expect(f).toMatchObject({ won_usd: 0, projected_usd: 0, need_per_week: null });
    expect(w.funnel.every((x) => x.n === 0)).toBe(true);
    expect(m).toMatchObject({ sent: 0, rate: null, findings: [] });
    expect(s.first_touch).toMatchObject({ leads: 0, median_h: null });
  });

  it("the Sunday summary is empty rather than wrong", async () => {
    expect(await reviewInsights()).toBe("");
  });
});

describe("the Sunday summary with a target", () => {
  it("states the month against target and the weekly rhythm", async () => {
    await updateSalesConfig({ targets: { monthly_revenue_usd: 12000, weekly_conversations: 15, daily_outreach: 5 } });
    const d = await createDeal({ title: "Won", value_amount: 3000, currency: "USD" });
    const st = (await one<{ id: number }>("select id from sales_stages where role = 'won'"))!.id;
    await q("update sales_deals set stage_id = $2 where id = $1", [d, st]);
    await q("insert into sales_deal_events (deal_id, kind, to_stage) values ($1,'stage',$2)", [d, st]);
    const text = await reviewInsights();
    expect(text).toContain("<b>This month</b>: $3,000 won of $12,000");
    expect(text).toMatch(/Steady rhythm for the target: \d+ people contacted, \d+ conversations, \d+ proposals a week/);
  });
});

describe("Telegram alert for a hot lead you already know", () => {
  it("says so, with the deal and its stage", async () => {
    const co = await ensureCompany("Kilo Ltd", { website: "kilo.io" });
    await createDeal({ title: "Kilo app", company_id: co });
    await q(`insert into sales_radar_items (url_hash, title, status, score, fit) values ('k','Kilo needs a CRM','qualified',92,'{"website":"kilo.io","why":"fit"}')`);
    const id = (await one<{ id: number }>("select id from sales_radar_items where url_hash = 'k'"))!.id;
    await screenRadarItem(id);
    await alertItem(id);
    expect(sent[0]).toContain("You already know them");
    expect(sent[0]).toContain("Kilo app");
  });

  it("never alerts a blocked lead", async () => {
    await q("insert into sales_blocklist (kind, value) values ('domain','lima.io')");
    await q(`insert into sales_radar_items (url_hash, title, status, score, fit) values ('l','Lima needs a bot','qualified',95,'{"website":"lima.io"}')`);
    const id = (await one<{ id: number }>("select id from sales_radar_items where url_hash = 'l'"))!.id;
    await screenRadarItem(id);
    await alertItem(id);
    expect(sent).toEqual([]);
  });
});

describe("without an AI key", () => {
  it("objections still group by their exact words and case studies still draft from the deal, with no invented result", async () => {
    const d = await createDeal({ title: "Mike", services: ["Websites"], requirements: "Their site loads in 9 seconds" });
    await q("update sales_deals set objections = '{\"too slow to start\"}' where id = $1", [d]);
    expect(await syncObjections()).toBe(1);
    const id = await draftProof(d);
    const p = (await one<{ title: string; problem: string; result: string | null }>("select title, problem, result from sales_proofs where id = $1", [id]))!;
    expect(p).toEqual({ title: "Websites for Mike", problem: "Their site loads in 9 seconds", result: null });
  });
});
