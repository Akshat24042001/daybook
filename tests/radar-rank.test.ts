// Which radar lead to work first, duplicates shown once, contacts you can use, and the plain-language brief.
import { beforeEach, describe, expect, it, vi } from "vitest";

const ai: { answer: unknown; calls: number } = { answer: null, calls: 0 };
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return { ...real, llmConfigured: () => true, llmJson: vi.fn(async () => { ai.calls += 1; return ai.answer; }) };
});

import { one, q } from "@/lib/db";
import { markRadarSeen, radarBrief } from "@/lib/sales/radar-brief";
import { contactsOf, dedupeKey, isPaid, priority, type RankItem } from "@/lib/sales/radar-rank";

const NOW = new Date("2026-11-14T12:00:00Z").getTime();
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const item = (o: Partial<RankItem>): RankItem => ({ id: 1, title: "x", body: null, url: "https://www.reddit.com/r/forhire/x", score: 70, posted_at: ago(2), found_at: ago(2), fit: null, ...o });

describe("do first", () => {
  it("a fresh lead beats a slightly better one from two days ago", () => {
    expect(priority(item({ score: 75, posted_at: ago(1) }), NOW).value).toBeGreaterThan(priority(item({ score: 85, posted_at: ago(50) }), NOW).value);
  });

  it("being able to reach them directly lifts a lead; a paid site with no contact drops it", () => {
    const paid = item({ url: "https://www.freelancer.com/projects/a", score: 80 });
    const reachable = { ...paid, identity: { status: "found", emails: ["owner@acme.in"], phones: [], linkedin: null } };
    expect(priority(reachable, NOW).value - priority(paid, NOW).value).toBe(20);
    expect(priority(reachable, NOW).reasons).toContain("You can reach them directly");
    expect(priority(item({ url: "https://www.reddit.com/r/x" }), NOW).reasons.some((r) => r.startsWith("Free to reply on Reddit"))).toBe(true);
  });

  it("says why, and an urgent need or an unread one goes higher", () => {
    const p = priority(item({ score: 88, posted_at: ago(3), fit: { urgency: "high" } }), NOW);
    expect(p.reasons).toEqual(expect.arrayContaining(["Posted in the last 6 hours", "Strong fit (88)", "They need it soon"]));
    expect(priority(item({}), NOW).value).toBeGreaterThan(priority(item({ seen_at: ago(1) }), NOW).value);
    // no posted date: uses when it was found
    expect(priority(item({ posted_at: null, found_at: ago(1) }), NOW).reasons).toContain("Posted in the last 6 hours");
  });

  it("knows the paid sites", () => {
    expect(isPaid("https://www.upwork.com/jobs/x")).toBe(true);
    expect(isPaid("https://www.fiverr.com/x")).toBe(true);
    expect(isPaid("https://news.ycombinator.com/item?id=1")).toBe(false);
  });
});

describe("one row per requirement", () => {
  it("the same title with a different budget, case or punctuation is the same requirement", () => {
    expect(dedupeKey(item({ title: "Need a WhatsApp bot for my salon (USD 200)" }))).toBe(dedupeKey(item({ title: "need a whatsapp bot, for my salon (USD 300)" })));
    expect(dedupeKey(item({ title: "Need a WhatsApp bot for my salon" }))).not.toBe(dedupeKey(item({ title: "Need a WhatsApp bot for my gym" })));
  });
});

describe("contacts you can use", () => {
  it("joins what was found behind the post with what the post itself gives", () => {
    const c = contactsOf(item({
      body: "Mail me at ravi@shahdental.in or call +91 98200 11111",
      identity: { status: "found", emails: ["contact@shahdental.in"], phones: ["+91 98200 11111"], linkedin: "https://linkedin.com/in/ravi", person: "Dr Ravi Shah" },
    }));
    expect(c.emails).toEqual(["contact@shahdental.in", "ravi@shahdental.in"]);
    expect(c.phones).toHaveLength(1);
    expect(c).toMatchObject({ linkedin: "https://linkedin.com/in/ravi", name: "Dr Ravi Shah" });
    // a search still running gives nothing yet
    expect(contactsOf(item({ identity: { status: "running", emails: ["a@b.in"], phones: [] } })).emails).toEqual([]);
  });
});

describe("the brief", () => {
  beforeEach(async () => {
    await q("truncate sales_radar_items restart identity cascade");
    ai.calls = 0;
  });

  it("is made once, cleaned, kept, and remade only when asked", async () => {
    const it0 = (await one<{ id: number }>("insert into sales_radar_items (url, url_hash, title, body, status) values ('https://e/1', 'h1', 'Inventory app', 'We run 6 pharmacy stores.', 'qualified') returning id"))!;
    ai.answer = {
      need: "A pharmacy chain wants stock tracked across 6 stores.", deliverables: ["Live stock", "Alerts", "", "Reorders", "Reports", "Extra", "Too many"],
      help: ["Pilot in one store"], offers: ["Custom software"], questions: ["Which billing software?"], opener: "Saw your post about stock.", size: "huge", budget: "null", timing: "within a month", watch_out: "",
    };
    const b = await radarBrief(it0.id);
    expect(b).toMatchObject({ need: "A pharmacy chain wants stock tracked across 6 stores.", size: null, budget: null, timing: "within a month", watch_out: null });
    expect(b.deliverables).toEqual(["Live stock", "Alerts", "Reorders", "Reports", "Extra"]);
    await radarBrief(it0.id);
    expect(ai.calls).toBe(1); // kept, not asked again
    await radarBrief(it0.id, true);
    expect(ai.calls).toBe(2);
    expect((await one<{ brief: { need: string } }>("select brief from sales_radar_items where id = $1", [it0.id]))!.brief.need).toContain("pharmacy");
  });

  it("opening a lead marks it read, once", async () => {
    const it0 = (await one<{ id: number }>("insert into sales_radar_items (url, url_hash, title, status) values ('https://e/2', 'h2', 'X', 'qualified') returning id"))!;
    await markRadarSeen([it0.id]);
    const first = (await one<{ seen_at: Date }>("select seen_at from sales_radar_items where id = $1", [it0.id]))!.seen_at;
    await new Promise((r) => setTimeout(r, 20));
    await markRadarSeen([it0.id]);
    expect((await one<{ seen_at: Date }>("select seen_at from sales_radar_items where id = $1", [it0.id]))!.seen_at).toEqual(first);
  });
});
