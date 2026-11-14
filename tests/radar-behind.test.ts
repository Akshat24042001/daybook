// Radar: who posted it, who is behind it (only what the evidence shows), and dates you can read.
import { beforeEach, describe, expect, it, vi } from "vitest";

const ai: { answer: unknown; prompts: string[] } = { answer: null, prompts: [] };
vi.mock("@/lib/sales/llm", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/llm")>();
  return { ...real, llmConfigured: () => true, llmJson: vi.fn(async (_s: string, user: string) => { ai.prompts.push(String(user)); return ai.answer; }) };
});
const web: { hits: Record<string, { title: string; url: string; snippet: string }[]>; queries: string[] } = { hits: {}, queries: [] };
vi.mock("@/lib/sales/search", async (orig) => {
  const real = await orig<typeof import("@/lib/sales/search")>();
  return {
    ...real,
    webSearch: vi.fn(async (query: string) => { web.queries.push(query); return Object.entries(web.hits).find(([k]) => query.includes(k))?.[1] ?? []; }),
    geminiSearchReady: () => false,
    fetchPage: vi.fn(async () => null),
  };
});

import { one, q } from "@/lib/db";
import { behindQueries, findBehindPost, groundIdentity, isPaidMarketplace, postClues } from "@/lib/sales/behind-post";
import { freelancerProjects, radarToDeal } from "@/lib/sales/radar";
import { dayHeader, whenLabel } from "@/components/sales/radar-who";

beforeEach(async () => {
  await q("truncate sales_radar_items, sales_moves, sales_people, sales_companies, sales_identities, sales_deals, sales_deal_people restart identity cascade");
  ai.answer = null;
  ai.prompts = [];
  web.hits = {};
  web.queries = [];
});

const post = (body: string, extra: Record<string, unknown> = {}) =>
  one<{ id: number }>("insert into sales_radar_items (url, url_hash, title, body, status, score, poster, fit) values ($1, md5($1), $2, $3, 'qualified', 80, $4, $5) returning id",
    [`https://www.freelancer.com/projects/x-${Math.random()}`, "WhatsApp booking bot for our dental clinics", body, JSON.stringify(extra.poster ?? { name: "Ravi S.", username: "ravidental", city: "Pune", country: "India" }), JSON.stringify(extra.fit ?? { country: "India", industry: "dental" })]);

describe("who posted it", () => {
  it("reads the client's public profile from Freelancer.com", () => {
    const items = freelancerProjects({
      result: {
        projects: [{ id: 1, title: "Booking bot", seo_url: "python/booking-bot", owner_id: 77, description: "Need a bot", time_submitted: 1_763_000_000, budget: { minimum: 250, maximum: 750 }, currency: { code: "USD" } }],
        users: { 77: { username: "ravidental", public_name: "Ravi S.", registration_date: 1_600_000_000, location: { city: "Pune", country: { name: "India" } }, employer_reputation: { entire_history: { complete: 12, reviews: 9 } } } },
      },
    });
    expect(items[0]).toMatchObject({ title: "Booking bot (USD 250 to 750)", author: "Ravi S.", url: "https://www.freelancer.com/projects/python/booking-bot" });
    expect(items[0].poster).toMatchObject({ name: "Ravi S.", username: "ravidental", city: "Pune", country: "India", profile_url: "https://www.freelancer.com/u/ravidental", history: "12 projects completed, 9 reviews" });
    // no user details returned: still a lead, just without a profile
    expect(freelancerProjects({ result: { projects: [{ id: 2, title: "X", seo_url: "x", time_submitted: 1_763_000_000 }] } })[0].poster).toBeNull();
  });

  it("knows which sites cost credits to reply on", () => {
    expect(isPaidMarketplace("https://www.freelancer.com/projects/x")).toBe(true);
    expect(isPaidMarketplace("https://www.upwork.com/freelance-jobs/apply/x")).toBe(true);
    expect(isPaidMarketplace("https://www.reddit.com/r/forhire/x")).toBe(false);
  });
});

describe("clues in the post", () => {
  it("finds sites, emails and phones it gives away, never the platform or a free mailbox", () => {
    const c = postClues({ title: "Bot", body: "We run shahdental.in (3 branches). Mail ravi@shahdental.in or ravi.shah@gmail.com, call +91 98200 11111. See freelancer.com/u/x and imgur.com/a.", poster: null });
    expect(c.websites).toEqual(["shahdental.in"]);
    expect(c.emails).toEqual(expect.arrayContaining(["ravi@shahdental.in", "ravi.shah@gmail.com"]));
    expect(c.phones.join(" ")).toContain("98200");
  });

  it("searches the company, the post's own words and the username", () => {
    const c = postClues({ title: "Bot", body: "Our three dental clinics in Kothrud miss around thirty calls every single day during peak hours.", poster: { name: "Ravi Shah", username: "ravidental", city: "Pune", country: "India" } });
    const qs = behindQueries({ title: "Bot" }, c, { industry: "dental" });
    expect(qs.some((x) => x.startsWith('"Our three dental clinics'))).toBe(true);
    expect(qs.some((x) => x.includes('"ravidental"') && x.includes("-site:freelancer.com"))).toBe(true);
    expect(qs.some((x) => x.includes('"Ravi Shah" Pune India dental'))).toBe(true);
  });
});

describe("only what the evidence shows", () => {
  it("drops an email, phone, site or name the evidence does not contain", () => {
    const hay = "Shah Dental Clinics, Pune. Dr Ravi Shah, founder. contact@shahdental.in, +91 98200 11111. https://shahdental.in";
    const id = groundIdentity({
      company: "Shah Dental Clinics", website: "shahdental.in", person: "Dr Ravi Shah", title: "Founder",
      emails: ["contact@shahdental.in", "ravi@shahdental.in"], phones: ["+91 98200 11111", "+91 90000 00000"], linkedin: "https://linkedin.com/in/ravishah",
      confidence: "high", evidence: [{ url: "https://shahdental.in", says: "their site" }, { url: "https://made-up.example", says: "x" }],
    }, hay);
    expect(id).toMatchObject({ status: "found", company: "Shah Dental Clinics", website: "https://shahdental.in", person: "Dr Ravi Shah", emails: ["contact@shahdental.in"], phones: ["+91 98200 11111"], linkedin: null });
    expect(id.evidence).toEqual([{ url: "https://shahdental.in", says: "their site" }]);
    const none = groundIdentity({ company: "Invented Corp", website: "invented.io", confidence: "high" }, hay);
    expect(none).toMatchObject({ status: "not_found", company: null, website: null });
  });

  it("a low-confidence guess is never called found", () => {
    expect(groundIdentity({ company: "Shah Dental", confidence: "low" }, "Shah Dental").status).toBe("not_found");
  });
});

describe("finding the business behind a post", () => {
  it("searches, keeps what is backed by evidence, saves it on the lead, and the lead carries it", async () => {
    const it0 = (await post("Our three dental clinics in Kothrud miss around thirty calls every single day during peak hours."))!;
    web.hits = { "Our three dental clinics": [{ title: "Shah Dental Clinics Kothrud: WhatsApp booking wanted", url: "https://www.linkedin.com/posts/ravishah_x", snippet: "Dr Ravi Shah, founder of Shah Dental Clinics (shahdental.in). Call +91 98200 11111 or contact@shahdental.in" }] };
    ai.answer = { kind: "business", company: "Shah Dental Clinics", website: "shahdental.in", person: "Dr Ravi Shah", title: "Founder", emails: ["contact@shahdental.in", "guess@shahdental.in"], phones: ["+91 98200 11111"], confidence: "high", evidence: [{ url: "https://www.linkedin.com/posts/ravishah_x", says: "same clinics, same need" }], note: "Same post on LinkedIn by the founder." };
    const id = await findBehindPost(it0.id);
    expect(id).toMatchObject({ status: "found", person: "Dr Ravi Shah", emails: ["contact@shahdental.in"], phones: ["+91 98200 11111"] });
    expect(ai.prompts[0]).toContain("ravidental");
    const saved = (await one<{ identity: { status: string } }>("select identity from sales_radar_items where id = $1", [it0.id]))!;
    expect(saved.identity.status).toBe("found");
    // making it a lead uses the business and the person, with their email and phone
    const deal = await radarToDeal(it0.id);
    const d = (await one<{ title: string; person: string; emails: string[]; phones: string[] }>(
      "select d.title, p.full_name as person, p.emails, p.phones from sales_deals d join sales_people p on p.id = d.person_id where d.id = $1", [deal]))!;
    expect(d.title).toMatch(/^Shah Dental Clinics: /);
    expect(d.person).toBe("Dr Ravi Shah");
    expect(d.emails).toContain("contact@shahdental.in");
    expect(d.phones.join(" ")).toContain("98200");
  });

  it("stops at a private person's job and does not dig further", async () => {
    const it0 = (await post("I need someone to fix my personal blog theme, it is for my hobby page."))!;
    ai.answer = { kind: "private", note: "A personal hobby blog, not a business." };
    const id = await findBehindPost(it0.id);
    expect(id).toMatchObject({ status: "private", emails: [], phones: [] });
    expect(id.company).toBeUndefined();
  });

  it("an AI failure is saved as a message, never left spinning", async () => {
    const it0 = (await post("Our three dental clinics in Kothrud miss around thirty calls every single day during peak hours."))!;
    const { llmJson } = await import("@/lib/sales/llm");
    vi.mocked(llmJson).mockRejectedValueOnce(new Error("all models busy"));
    const id = await findBehindPost(it0.id);
    expect(id.status).toBe("error");
    expect(id.note).toMatch(/all models busy/);
  });
});

describe("dates you can read", () => {
  const now = new Date("2026-11-14T10:00:00Z"); // 15:30 in India
  it("says today, yesterday, or the day, in your time zone", () => {
    expect(whenLabel("2026-11-14T08:50:00Z", "Asia/Kolkata", now)).toMatch(/^Today, 2:20\s?pm$/i);
    expect(whenLabel("2026-11-13T03:35:00Z", "Asia/Kolkata", now)).toMatch(/^Yesterday, 9:05\s?am$/i);
    expect(whenLabel("2026-11-11T13:10:00Z", "Asia/Kolkata", now)).toMatch(/^Wed,? 11 Nov, 6:40\s?pm$/i);
    // 23:00 UTC on the 13th is already the 14th in India
    expect(dayHeader("2026-11-13T23:00:00Z", "Asia/Kolkata", now)).toBe("Today");
    expect(dayHeader("2026-11-12T10:00:00Z", "Asia/Kolkata", now)).toMatch(/Thursday,? 12 November/);
  });
});
