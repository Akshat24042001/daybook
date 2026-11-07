import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sales/notify", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/notify")>();
  return { ...real, push: vi.fn(async () => 1) };
});
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return { ...real, llmConfigured: () => false, llmJson: vi.fn(async () => { throw new Error("no AI"); }), llm: vi.fn(async () => { throw new Error("no AI"); }) };
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { one, q } from "@/lib/db";
import { currencyLabel, currencySymbol, fromUsd, money, toUsd } from "@/components/sales/format";
import { reportMoney, salesConfig, updateSalesConfig } from "@/lib/sales/config";
import { createDeal } from "@/lib/sales/deals";
import { salesDaily } from "@/lib/sales/activity";
import { forecast, sizeBand, sizeBands, winLoss } from "@/lib/sales/insights";
import { packageTotal, saveOffer, listOffers } from "@/lib/sales/offers";
import { weeklyReview, reviewMessage } from "@/lib/sales/review";
import { calendarDate } from "@/lib/time";
import { ownerTz } from "@/lib/sales/learning";

async function resetSales() {
  await q(`truncate sales_companies, sales_people, sales_identities, sales_deals, sales_deal_people, sales_deal_events, sales_captures,
           sales_interactions, sales_seen, sales_commitments, sales_moves, sales_meetings, sales_docs, sales_quote_revisions, sales_doc_views,
           sales_payments, sales_radar_items, sales_jobs, sales_tg_prompts, sales_calls, sales_focus, sales_blocklist, sales_offers,
           sales_proofs, sales_objections, sales_deal_objections restart identity cascade`);
  await q("update sales_settings set config = '{}'::jsonb");
}
beforeEach(resetSales);

async function win(id: number) {
  const st = (await one<{ id: number }>("select id from sales_stages where role = 'won'"))!.id;
  await q("update sales_deals set stage_id = $2 where id = $1", [id, st]);
  await q("insert into sales_deal_events (deal_id, kind, to_stage) values ($1,'stage',$2)", [id, st]);
}

describe("formatting", () => {
  it("shows rupees with Indian digit grouping, and other currencies with their symbol", () => {
    expect(money(1_250_000)).toBe("₹12,50,000");
    expect(money(1_250_000, "INR")).toBe("₹12,50,000");
    expect(money(4200, "USD")).toBe("$4,200");
    expect(money(null)).toBe("");
    expect(money(5000, "inr")).toBe("₹5,000");
    expect(currencySymbol("INR")).toBe("₹");
    expect(currencySymbol(undefined)).toBe("₹");
    expect(currencySymbol("AED")).toBe("AED");
    expect(currencyLabel("INR")).toBe("₹ INR");
    expect(currencyLabel("USD")).toBe("$ USD");
    expect(currencyLabel("AED")).toBe("AED");
  });
  it("converts through USD at the saved rates", () => {
    const fx = { USD: 1, INR: 0.012, AED: 0.2723 };
    expect(toUsd(100_000, "INR", fx)).toBeCloseTo(1200);
    expect(fromUsd(1200, "INR", fx)).toBeCloseTo(100_000);
    expect(fromUsd(1200, "XYZ", fx)).toBe(1200);
  });
  it("bands deal sizes in lakhs for INR and thousands otherwise", () => {
    expect(sizeBands("INR").map((b) => b.label)).toEqual(["Under ₹1L", "₹1L to ₹5L", "₹5L to ₹20L", "₹20L and up"]);
    expect(sizeBands("USD").map((b) => b.label)).toEqual(["Under $1k", "$1k to $5k", "$5k to $20k", "$20k and up"]);
    expect(sizeBand(250_000, "INR")).toBe("₹1L to ₹5L");
    expect(sizeBand(2_000_000, "INR")).toBe("₹20L and up");
    expect(sizeBand(null, "INR")).toBe("Value not set");
  });
});

describe("INR is the default", () => {
  it("for settings, new deals, payments and offer packages", async () => {
    const cfg = await salesConfig();
    expect(cfg.default_currency).toBe("INR");
    expect(reportMoney(cfg).cur).toBe("INR");
    const d = await createDeal({ title: "Default", value_amount: 200_000 });
    const row = (await one<{ currency: string; value_usd: number }>("select currency, value_usd::float from sales_deals where id = $1", [d]))!;
    expect(row).toEqual({ currency: "INR", value_usd: 2400 });
    // the database default too, for any insert that leaves currency out
    const raw = (await one<{ id: number }>("insert into sales_deals (title, stage_id) values ('raw', (select id from sales_stages where role = 'new')) returning id"))!.id;
    expect((await one<{ currency: string }>("select currency from sales_deals where id = $1", [raw]))!.currency).toBe("INR");
    await saveOffer({ name: "Websites", packages: [{ name: "Basic", items: [{ name: "Site", qty: 1, unit_price: 50_000 }] }] });
    const [o] = await listOffers();
    expect(o.packages[0].currency).toBe("INR");
    expect(packageTotal(o.packages[0])).toBe(50_000);
  });

  it("still lets a deal be in USD, and adds it to rupee totals at the rate", async () => {
    const usd = await createDeal({ title: "US client", value_amount: 1000, currency: "USD" });
    const inr = await createDeal({ title: "Indian client", value_amount: 100_000 });
    await win(usd);
    await win(inr);
    const f = await forecast();
    // $1,000 = ₹83,333 at 0.012, plus ₹1,00,000
    expect(f.currency).toBe("INR");
    expect(f.won).toBe(183_333);
    const tz = await ownerTz();
    const today = calendarDate(new Date(), tz);
    const days = await salesDaily(today, today, tz);
    expect(Math.round(days[0].won)).toBe(183_333);
  });
});

describe("the target is in the report currency", () => {
  it("drives the forecast, verdict and plan in rupees", async () => {
    await updateSalesConfig({ targets: { monthly_revenue: 500_000, weekly_conversations: 15, daily_outreach: 5 } });
    const d = await createDeal({ title: "Won", value_amount: 150_000 });
    await win(d);
    const f = await forecast();
    expect(f).toMatchObject({ currency: "INR", target: 500_000, won: 150_000, gap: 350_000 });
    expect(f.verdict).toContain("₹1,50,000 won");
    expect(f.need_this_month?.deals).toBeGreaterThan(0);
  });

  it("converts an old USD target once, at the saved INR rate", async () => {
    await q(`update sales_settings set config = '{"targets": {"monthly_revenue_usd": 6000}}'::jsonb`);
    expect((await salesConfig()).targets.monthly_revenue).toBe(500_000);
  });

  it("the 037 migration moves stored USD defaults and the USD target to INR, once", async () => {
    const sql = readFileSync(path.join(__dirname, "..", "db", "migrations", "037_inr_default.sql"), "utf8");
    const update = sql.slice(sql.indexOf("update sales_settings"));
    await q(`update sales_settings set config = '{"default_currency": "USD", "fx": {"INR": 0.0125}, "targets": {"monthly_revenue_usd": 10000, "daily_outreach": 7}}'::jsonb`);
    await q(update);
    const c = (await one<{ config: Record<string, unknown> & { targets: Record<string, number> } }>("select config from sales_settings where id = 1"))!.config;
    expect(c.default_currency).toBe("INR");
    expect(c.report_currency).toBe("INR");
    expect(c.targets).toEqual({ monthly_revenue: 800_000, daily_outreach: 7 });
    // running it again changes nothing (a later choice of USD stays)
    await updateSalesConfig({ report_currency: "USD" });
    await q(update);
    expect((await salesConfig()).report_currency).toBe("USD");
  });

  it("rejects a currency that is not a three-letter code", async () => {
    await expect(updateSalesConfig({ default_currency: "rupees" })).rejects.toThrow(/three-letter/);
    await updateSalesConfig({ default_currency: "usd" });
    expect((await salesConfig()).default_currency).toBe("USD");
  });
});

describe("reports follow the report currency", () => {
  it("the weekly review and segments speak rupees, and switch to USD when chosen", async () => {
    const d = await createDeal({ title: "Won", value_amount: 240_000, services: ["Websites"] });
    await win(d);
    let r = await weeklyReview(7);
    expect(r).toMatchObject({ currency: "INR", won_value: 240_000 });
    expect(reviewMessage(r)).toContain("(₹2,40,000)");
    const wl = await winLoss(180);
    expect(wl.currency).toBe("INR");
    expect(wl.by_service[0].won_value).toBe(240_000);
    expect(wl.by_size.map((s) => s.key)).toEqual(["₹1L to ₹5L"]);

    await updateSalesConfig({ report_currency: "USD" });
    r = await weeklyReview(7);
    expect(r).toMatchObject({ currency: "USD", won_value: 2880 });
    expect(reviewMessage(r)).toContain("($2,880)");
  });
});
