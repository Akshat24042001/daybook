import { beforeEach, describe, expect, it, vi } from "vitest";

// The AI is replaced by a scripted answer so the pipeline is tested, not the model.
const aiAnswer: { value: unknown; calls: { system: string; user: string }[] } = { value: null, calls: [] };
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return {
    ...real,
    llmJson: vi.fn(async (system: string, user: string) => {
      aiAnswer.calls.push({ system, user });
      return typeof aiAnswer.value === "function" ? (aiAnswer.value as (s: string, u: string) => unknown)(system, user) : aiAnswer.value;
    }),
    llm: vi.fn(async () => ({ text: "brief", model: "test" })),
    llmConfigured: () => true,
  };
});

import { one, q } from "@/lib/db";
import { completeMove } from "@/lib/sales/act";
import { createDeal, logInteraction } from "@/lib/sales/deals";
import { attributeReplies, bucketize, findings, purposeLabel, type Touch } from "@/lib/sales/learning-calc";
import { messagePerformance, winningMessages } from "@/lib/sales/learning";
import { draftForMove } from "@/lib/sales/moves";

export async function resetSales() {
  await q(`truncate sales_companies, sales_people, sales_identities, sales_deals, sales_deal_people, sales_deal_events, sales_captures,
           sales_interactions, sales_seen, sales_commitments, sales_moves, sales_meetings, sales_docs, sales_quote_revisions, sales_doc_views,
           sales_payments, sales_radar_items, sales_jobs, sales_tg_prompts, sales_calls, sales_focus, sales_blocklist, sales_offers,
           sales_proofs, sales_objections, sales_deal_objections restart identity cascade`);
  await q("delete from sales_radar_sources");
  await q("update sales_settings set config = '{}'::jsonb");
}

beforeEach(async () => {
  await resetSales();
  aiAnswer.value = null;
  aiAnswer.calls = [];
});

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.parse("2026-11-07T10:00:00Z");
let tid = 0;
const touch = (deal: number, at: number, dir: Touch["dir"], extra: Partial<Touch> = {}): Touch => ({
  id: ++tid, deal_id: deal, at, dir, channel: "whatsapp", move_kind: null, drafted: null, edited: null, body: "hello there", confidence: "sure", ...extra,
});

describe("which messages got a reply (the rules)", () => {
  it("credits a reply to the last message before it, not to earlier ones", () => {
    const s = attributeReplies([
      touch(1, NOW - 10 * D, "out", { move_kind: "first_touch" }),
      touch(1, NOW - 7 * D, "out", { move_kind: "follow_up:1" }),
      touch(1, NOW - 6 * D, "in"),
    ], NOW);
    const byKind = Object.fromEntries(s.map((x) => [x.move_kind, x]));
    expect(byKind.first_touch.replied).toBe(false);
    expect(byKind["follow_up:1"].replied).toBe(true);
    expect(byKind["follow_up:1"].reply_ms).toBe(D);
  });

  it("does not count a reply that comes more than 14 days later", () => {
    const [s] = attributeReplies([touch(1, NOW - 30 * D, "out"), touch(1, NOW - 15 * D, "in")], NOW);
    expect(s.replied).toBe(false);
    expect(s.pending).toBe(false);
  });

  it("leaves a fresh unanswered message out of the rates until it has had 3 days", () => {
    const sends = attributeReplies([touch(1, NOW - D, "out"), touch(2, NOW - 4 * D, "out")], NOW);
    expect(sends.find((x) => x.deal_id === 1)!.pending).toBe(true);
    expect(sends.find((x) => x.deal_id === 2)!.pending).toBe(false);
    const [b] = bucketize(sends, () => "all", () => "All");
    expect(b).toMatchObject({ sent: 1, replied: 0, rate: 0 });
  });

  it("treats a burst of messages (or the same message logged twice) as one send, keeping the move it came from", () => {
    const sends = attributeReplies([
      touch(1, NOW - 5 * D, "out", { move_kind: null, body: "from the export" }),
      touch(1, NOW - 5 * D + 5 * 60_000, "out", { move_kind: "first_touch", drafted: true, edited: false }),
      touch(1, NOW - 4 * D, "in"),
    ], NOW);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ move_kind: "first_touch", replied: true, drafted: true, edited: false });
  });

  it("counts a call or meeting with them as a response", () => {
    const [s] = attributeReplies([touch(1, NOW - 5 * D, "out"), touch(1, NOW - 4 * D, "both", { channel: "call" })], NOW);
    expect(s.replied).toBe(true);
  });

  it("only claims a winner with enough sends and a real gap", () => {
    const rows = [
      { key: "a", label: "A", sent: 10, replied: 6, rate: 60, median_reply_h: 2, thin: false },
      { key: "b", label: "B", sent: 10, replied: 2, rate: 20, median_reply_h: 5, thin: false },
      { key: "c", label: "C", sent: 2, replied: 2, rate: 100, median_reply_h: 1, thin: true },
    ];
    const f = findings([{ name: "Channel", rows }]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('"A" gets replies 60%');
    expect(findings([{ name: "Channel", rows: rows.map((r) => ({ ...r, rate: 40 })) }])).toEqual([]);
  });

  it("labels purposes in plain words", () => {
    expect(purposeLabel("follow_up:2")).toBe("Follow-up 2");
    expect(purposeLabel("manual")).toBe("Written outside a move");
  });
});

describe("message learning end to end", () => {
  async function dealWithMove(kind: string, title: string, draft: string | null) {
    const deal = await createDeal({ title: "Acme", source: "outbound" });
    const mv = (await one<{ id: number }>(
      "insert into sales_moves (deal_id, kind, title, draft, channel, created_by) values ($1,$2,$3,$4,'whatsapp','auto') returning id",
      [deal, kind, title, draft],
    ))!.id;
    return { deal, mv };
  }

  it("remembers which move a message came from and whether you edited the draft", async () => {
    const a = await dealWithMove("follow_up", "Follow-up 2 to Acme", "Draft text here");
    await completeMove(a.mv, "whatsapp", { text: "Draft  text HERE" });
    const b = await dealWithMove("first_touch", "First message to Acme", "Hi there, quick question");
    await completeMove(b.mv, "whatsapp", { text: "Something quite different" });
    const c = await dealWithMove("first_touch", "First message to Acme", "Tap draft");
    await completeMove(c.mv, "whatsapp", { assumed: true });
    const rows = await q<{ move_kind: string; drafted: boolean; edited: boolean | null }>("select move_kind, drafted, edited from sales_interactions order by id");
    expect(rows).toEqual([
      { move_kind: "follow_up:2", drafted: true, edited: false },
      { move_kind: "first_touch", drafted: true, edited: true },
      { move_kind: "first_touch", drafted: true, edited: null },
    ]);
  });

  it("reports reply rates by purpose and channel from what really happened", async () => {
    for (let i = 0; i < 6; i++) {
      const d = await createDeal({ title: `Lead ${i}` });
      await logInteraction({ deal_id: d, channel: i < 3 ? "email" : "whatsapp", direction: "out", source: "test", body: "a first message that is long enough", occurred_at: new Date(Date.now() - 10 * D), move_kind: "first_touch" });
      if (i >= 3) await logInteraction({ deal_id: d, channel: "whatsapp", direction: "in", source: "test", body: "yes", occurred_at: new Date(Date.now() - 9 * D) });
    }
    const p = await messagePerformance(30);
    expect(p).toMatchObject({ sent: 6, decided: 6, replied: 3, rate: 50 });
    expect(p.by_channel.find((b) => b.key === "whatsapp")).toMatchObject({ sent: 3, replied: 3, rate: 100 });
    expect(p.by_channel.find((b) => b.key === "email")).toMatchObject({ sent: 3, replied: 0, rate: 0 });
    expect(p.by_purpose[0]).toMatchObject({ key: "first_touch", label: "First message", sent: 6 });
    // three each is below the bar for calling a winner
    expect(p.findings).toEqual([]);
  });

  it("gives the drafts your real messages that got replies, closest kind first", async () => {
    const d1 = await createDeal({ title: "Won over" });
    await logInteraction({ deal_id: d1, channel: "whatsapp", direction: "out", source: "test", body: "Saw your post about missed calls, how many a day?", occurred_at: new Date(Date.now() - 20 * D), move_kind: "first_touch" });
    await logInteraction({ deal_id: d1, channel: "whatsapp", direction: "in", source: "test", body: "about 30", occurred_at: new Date(Date.now() - 19 * D) });
    const d2 = await createDeal({ title: "Silent" });
    await logInteraction({ deal_id: d2, channel: "whatsapp", direction: "out", source: "test", body: "Hello, we build AI agents for every business out there", occurred_at: new Date(Date.now() - 20 * D), move_kind: "first_touch" });
    expect(await winningMessages({ kind: "first_touch", channel: "whatsapp" })).toEqual(["Saw your post about missed calls, how many a day?"]);

    const { mv } = await dealWithMove("first_touch", "First message to Acme", null);
    aiAnswer.value = { subject: null, message: "hi" };
    await draftForMove(mv);
    const sys = aiAnswer.calls.at(-1)!.system;
    expect(sys).toContain("MESSAGES THAT GOT REPLIES");
    expect(sys).toContain("[W1] Saw your post about missed calls");
    // the one that got no reply is only a voice sample, never a "winner"
    expect(sys).not.toContain("[W2]");
  });
});

import { choose, sameCountry, sameIndustry, weigh, type Stat } from "@/lib/sales/focus-calc";
import { currentFocus, focusStats, periodKeys } from "@/lib/sales/focus";
import { salesConfig, updateSalesConfig } from "@/lib/sales/config";

describe("adaptive targeting (the rules)", () => {
  const stat = (value: string, o: Partial<Stat> = {}): Stat => ({ value, qualified: 0, conversations: 0, won: 0, turns: 0, last: null, ...o });

  it("understands how people and the AI write countries and industries", () => {
    expect(sameCountry("USA", "United States")).toBe(true);
    expect(sameCountry("Dubai, UAE", "United Arab Emirates")).toBe(true);
    expect(sameCountry("Indiana", "India")).toBe(false);
    expect(sameIndustry("Dental clinic", "healthcare clinics")).toBe(true);
    expect(sameIndustry("Restaurants", "food and beverage")).toBe(false);
    expect(sameIndustry("Accounting", "accounting firms")).toBe(true);
  });

  it("rotates evenly while there are no results at all", () => {
    const c = choose([stat("A"), stat("B"), stat("C")], "c:2026-W45", 20, 1);
    expect(c).toMatchObject({ value: "B", mode: "fixed" });
  });

  it("scores results per turn, so a market targeted ten times must earn it", () => {
    const w = weigh([stat("Busy", { qualified: 10, turns: 9 }), stat("Fresh", { qualified: 3, turns: 0 })]);
    expect(w.map((x) => [x.value, x.score])).toEqual([["Fresh", 3], ["Busy", 1]]);
  });

  it("gives the leader most turns, keeps some for exploring, and is the same answer for the same period", () => {
    const stats = [stat("Leader", { qualified: 20, conversations: 5, won: 1, turns: 2, last: "c:2026-W40" }), stat("Middling", { qualified: 2, turns: 2, last: "c:2026-W41" }), stat("Untried", { turns: 0 })];
    const picks = Array.from({ length: 400 }, (_, i) => choose(stats, `c:p${i}`, 20, 0));
    const share = (v: string) => picks.filter((p) => p.value === v).length / picks.length;
    expect(share("Leader")).toBeGreaterThan(0.6);
    const explore = picks.filter((p) => p.mode === "explore");
    expect(explore.length / picks.length).toBeGreaterThan(0.12);
    expect(explore.length / picks.length).toBeLessThan(0.28);
    expect(explore.every((p) => p.value === "Untried")).toBe(true);
    expect(choose(stats, "c:fixed", 20, 0)).toEqual(choose(stats, "c:fixed", 20, 0));
    const leader = picks.find((p) => p.mode === "exploit" && p.value === "Leader")!;
    expect(leader.reason).toContain("best results per turn");
  });
});

describe("adaptive targeting with real data", () => {
  it("counts leads, conversations and wins per country, and keeps a choice for its whole week", async () => {
    await updateSalesConfig({ countries: ["Singapore", "Germany"], industries: ["logistics", "retail"] });
    await q(`insert into sales_radar_items (url_hash, title, status, score, fit) values
      ('a','x','qualified',80,'{"country":"Singapore","industry":"Logistics"}'),
      ('b','y','qualified',75,'{"country":"SG","industry":"freight logistics"}'),
      ('c','z','rejected',20,'{"country":"Germany"}')`);
    const d = await createDeal({ title: "Talking", country: "Singapore" });
    await q("update sales_deals set last_inbound_at = now() where id = $1", [d]);
    const stats = await focusStats("country", ["Singapore", "Germany"]);
    expect(stats.find((s) => s.value === "Singapore")).toMatchObject({ qualified: 2, conversations: 1, won: 0 });
    expect(stats.find((s) => s.value === "Germany")).toMatchObject({ qualified: 0, conversations: 0 });

    const cfg = await salesConfig();
    const monday = new Date("2026-11-09T06:00:00Z");
    const first = await currentFocus(cfg, monday);
    expect(first.why.country.reason.length).toBeGreaterThan(10);
    // more results for the other country later in the week do not change this week's pick
    await q("insert into sales_radar_items (url_hash, title, status, score, fit) select 'g'||i, 't', 'qualified', 90, '{\"country\":\"Germany\"}' from generate_series(1,50) i");
    const later = await currentFocus(cfg, new Date("2026-11-12T06:00:00Z"));
    expect(later.country).toBe(first.country);
    expect(periodKeys(monday).country).toBe("c:2026-W46");
    const rows = await q<{ period: string; kind: string }>("select period, kind from sales_focus order by period");
    expect(rows.map((r) => r.kind).sort()).toEqual(["country", "industry", "industry"]);
  });

  it("uses the old even rotation when you choose it in settings", async () => {
    await updateSalesConfig({ countries: ["A", "B", "C"], radar: { targeting: "rotate" } as never });
    const f = await currentFocus(await salesConfig(), new Date("2026-11-09T06:00:00Z"));
    expect(f.why.country).toMatchObject({ mode: "fixed", reason: "Even rotation (chosen in Sales settings)." });
  });
});

import { forecast, funnelOf, segment, speed, speedBucket, winLoss } from "@/lib/sales/insights";

async function setRole(dealId: number, role: string, opts: { wonEvent?: boolean; at?: string } = {}) {
  const st = (await one<{ id: number }>("select id from sales_stages where role = $1", [role]))!;
  await q("update sales_deals set stage_id = $2, closed_at = case when $3 then coalesce($4::timestamptz, now()) else closed_at end where id = $1", [dealId, st.id, ["won", "lost", "paid", "delivered", "active"].includes(role), opts.at ?? null]);
  if (opts.wonEvent !== false) await q("insert into sales_deal_events (deal_id, kind, to_stage, created_at) values ($1,'stage',$2,coalesce($3::timestamptz, now()))", [dealId, st.id, opts.at ?? null]);
}

describe("funnel and win or loss by segment", () => {
  it("counts each step cumulatively", () => {
    const f = funnelOf([{ level: 2 }, { level: 3 }, { level: 6 }]);
    expect(f.map((s) => [s.key, s.n])).toEqual([["created", 3], ["contacted", 3], ["conversation", 2], ["meeting", 1], ["proposal", 1], ["won", 1]]);
    expect(f[2].from_prev).toBe(67);
  });

  it("works out win rate, value and cycle per segment, and marks thin ones", () => {
    const base = { created_at: "2026-10-01T00:00:00Z", appeared_at: "2026-10-01T00:00:00Z", source: "radar", country: null, role: null, probability: null, expected_close: null, first_out: null, last_inbound_at: null };
    const deals = [
      ...Array.from({ length: 4 }, (_, i) => ({ ...base, id: i, cat: "won", level: 6, services: ["AI agents"], value_usd: 1000 * (i + 1), won_at: "2026-10-11T00:00:00Z", closed_at: null })),
      { ...base, id: 9, cat: "lost", level: 5, services: ["AI agents"], value_usd: null, won_at: null, closed_at: "2026-10-05T00:00:00Z" },
      { ...base, id: 10, cat: "open", level: 3, services: [], value_usd: null, won_at: null, closed_at: null },
    ];
    const rows = segment(deals as never, (d) => ((d as { services: string[] }).services.length ? (d as { services: string[] }).services : ["Service not set"]));
    expect(rows[0]).toMatchObject({ key: "AI agents", deals: 5, closed: 5, won: 4, win_rate: 80, won_usd: 10000, avg_won_usd: 2500, median_days_to_close: 10, thin: false });
    expect(rows[1]).toMatchObject({ key: "Service not set", closed: 0, win_rate: null, thin: true });
  });

  it("reads the funnel and quotes from real deals", async () => {
    const a = await createDeal({ title: "Contacted only", services: ["Websites"] });
    await q("update sales_deals set last_outbound_at = now() where id = $1", [a]);
    const b = await createDeal({ title: "Talking", services: ["Websites"] });
    await q("update sales_deals set last_inbound_at = now(), last_outbound_at = now() where id = $1", [b]);
    const c = await createDeal({ title: "Won it", services: ["Websites"], value_amount: 3000, currency: "USD" });
    await setRole(c, "won");
    const w = await winLoss(180);
    expect(w.funnel.map((s) => s.n)).toEqual([3, 3, 2, 1, 1, 1]);
    expect(w.by_service[0]).toMatchObject({ key: "Websites", deals: 3, won: 1, closed: 1, win_rate: 100, thin: true });
    expect(w.findings).toEqual([]);
  });
});

describe("target, forecast and the activity it takes", () => {
  it("says what is won, what is likely, the gap, and the work needed, marking assumed rates", async () => {
    await updateSalesConfig({ targets: { monthly_revenue_usd: 10000, weekly_conversations: 15, daily_outreach: 5 } });
    const won = await createDeal({ title: "Won this month", value_amount: 4000, currency: "USD" });
    await setRole(won, "won");
    const prop = await createDeal({ title: "In proposal", value_amount: 5000, currency: "USD" });
    await setRole(prop, "proposal");
    const f = await forecast();
    expect(f).toMatchObject({ target_usd: 10000, won_usd: 4000, won_deals: 1, likely_this_month_usd: 2500, projected_usd: 6500, gap_usd: 6000 });
    expect(f.likely_deals.map((d) => d.title)).toEqual(["In proposal"]);
    expect(f.rates.avg_deal_usd).toMatchObject({ value: 5000, assumed: true });
    expect(f.rates.proposal_to_win.assumed).toBe(true);
    expect(f.need_this_month).toEqual({ deals: 2, proposals: 4, conversations: 12, outreach: 77 });
    expect(f.verdict).toMatch(/^Behind/);
  });

  it("asks for a target when none is set", async () => {
    const f = await forecast();
    expect(f.need_per_week).toBeNull();
    expect(f.verdict).toContain("Set a monthly revenue target");
  });
});

describe("speed", () => {
  it("buckets first-touch delays", () => {
    expect(speedBucket(30 * 60_000)).toBe("Within 1 hour");
    expect(speedBucket(5 * 3_600_000)).toBe("Within a day");
    expect(speedBucket(null)).toBe("Not contacted");
  });

  it("measures time to first touch for leads that came in, and your reply speed", async () => {
    const lead = await createDeal({ title: "Inbound lead", source: "inbound" });
    await q("update sales_deals set created_at = now() - interval '2 days' where id = $1", [lead]);
    await logInteraction({ deal_id: lead, channel: "whatsapp", direction: "out", source: "test", body: "hi", occurred_at: new Date(Date.now() - 2 * D + 30 * 60_000) });
    await logInteraction({ deal_id: lead, channel: "whatsapp", direction: "in", source: "test", body: "hello, need help", occurred_at: new Date(Date.now() - 30 * H) });
    await logInteraction({ deal_id: lead, channel: "whatsapp", direction: "in", source: "test", body: "are you there?", occurred_at: new Date(Date.now() - 29 * H) });
    await logInteraction({ deal_id: lead, channel: "whatsapp", direction: "out", source: "test", body: "yes", occurred_at: new Date(Date.now() - 28 * H) });
    // a deal that started with your own message is not a "lead waiting for you"
    const own = await createDeal({ title: "Cold outreach" });
    await logInteraction({ deal_id: own, channel: "email", direction: "out", source: "test", body: "hello" });
    const s = await speed(30);
    expect(s.first_touch).toMatchObject({ leads: 1, touched: 1, untouched: 0, median_h: 0.5, within_1h: 100 });
    expect(s.first_touch.by_bucket[0]).toMatchObject({ label: "Within 1 hour", leads: 1, conversations: 1 });
    // the clock starts at their first unanswered message (30h ago) and stops at your reply (28h ago)
    expect(s.reply).toMatchObject({ inbound: 1, answered: 1, waiting: 0, median_h: 2 });
  });
});

import { bookingRule } from "@/lib/sales/voice";

describe("booking link in drafts", () => {
  it("is offered when a call is the natural next step, never in a first message or a breakup", async () => {
    const cfg = await salesConfig();
    expect(bookingRule(cfg, "reply")).toBe("");
    await updateSalesConfig({ owner: { ...cfg.owner, booking_url: "https://cal.com/akshat/30min" } });
    const withLink = await salesConfig();
    expect(bookingRule(withLink, "reply")).toContain("https://cal.com/akshat/30min");
    expect(bookingRule(withLink, "follow_up:2")).toContain("BOOKING LINK");
    expect(bookingRule(withLink, "first_touch")).toBe("");
    expect(bookingRule(withLink, "breakup")).toBe("");
  });

  it("reaches the AI when drafting a reply", async () => {
    const cfg = await salesConfig();
    await updateSalesConfig({ owner: { ...cfg.owner, booking_url: "https://cal.com/akshat/30min" } });
    const deal = await createDeal({ title: "Acme" });
    const mv = (await one<{ id: number }>("insert into sales_moves (deal_id, kind, title, channel) values ($1,'reply','Reply to Acme','whatsapp') returning id", [deal]))!.id;
    aiAnswer.value = { subject: null, message: "ok" };
    await draftForMove(mv);
    expect(aiAnswer.calls.at(-1)!.system).toContain("BOOKING LINK: https://cal.com/akshat/30min");
  });
});
