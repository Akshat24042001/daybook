// Reddit read past cloud blocks, tool forums, the relay, possible businesses behind a post, and the lead chat.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { one, q } from "@/lib/db";
import { groundCandidates, groundIdentity } from "@/lib/sales/behind-post";
import { cleanFocus, focusContext } from "@/lib/sales/chat-focus";
import { CATALOG } from "@/lib/sales/radar-catalog";
import { feedWithRelay, parseDiscourse, parsePullPush, parseRedditJson, plainSourceError, queryTest, readDiscourse, readSubreddit } from "@/lib/sales/radar-fetch";

const redditJson = JSON.stringify({ data: { children: [{ data: { title: "Need a WhatsApp bot", selftext: "Budget 500 USD", permalink: "/r/forhire/comments/a/x/", author: "acme", created_utc: 1_763_000_000, link_flair_text: "Hiring" } }] } });
const pullpush = JSON.stringify({ data: [
  { id: "b1", subreddit: "forhire", title: "[Hiring] App developer for a clinic", selftext: "Looking for an app developer", author: "drk", created_utc: 1_763_000_100, permalink: "/r/forhire/comments/b1/app/" },
  { id: "b2", subreddit: "forhire", title: "Cat pictures", selftext: "", author: "x", created_utc: 1_763_000_200 },
] });
const ok = (body: string) => new Response(body, { status: 200 });
const no = (status: number, headers: Record<string, string> = {}) => new Response("blocked", { status, headers });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  (globalThis as unknown as { __redditCool?: { until: number } }).__redditCool!.until = 0;
});

describe("reading Reddit from a cloud server", () => {
  it("uses Reddit's JSON when it answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (u.startsWith("https://www.reddit.com/r/forhire/new.json") ? ok(redditJson) : no(500))));
    const r = await readSubreddit("forhire", null, null);
    expect(r.route).toBe("Reddit JSON");
    expect(r.items[0]).toMatchObject({ title: "[Hiring] Need a WhatsApp bot", url: "https://www.reddit.com/r/forhire/comments/a/x/", author: "u/acme" });
  });

  it("blocked (403) and rate-limited (429): falls through to the PullPush archive, filters by the search, and rests Reddit", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      seen.push(new URL(u).hostname);
      if (u.includes("www.reddit.com")) return no(429, { "retry-after": "60" });
      if (u.includes("old.reddit.com")) return no(403);
      if (u.includes("api.pullpush.io")) return ok(pullpush);
      return no(500);
    }));
    const r = await readSubreddit("forhire", '(hire OR "app developer")', null);
    expect(r.route).toBe("PullPush archive");
    expect(r.items.map((i) => i.title)).toEqual(["[Hiring] App developer for a clinic"]); // the cat post does not match
    expect(r.tried.join(" ")).toMatch(/429/);
    // Reddit said 429: the next read does not ask it again for a while
    seen.length = 0;
    await readSubreddit("forhire", null, null);
    expect(seen).not.toContain("www.reddit.com");
  });

  it("every route failing says so plainly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => no(403)));
    await expect(readSubreddit("forhire", null, null)).rejects.toThrow(/Reddit blocks cloud servers; every route failed/);
    expect(plainSourceError("feed 403")).toMatch(/blocks requests from cloud servers/);
    expect(plainSourceError("feed 429")).toMatch(/asked us to slow down/);
  });

  it("the relay (Jina) is tried for a blocked feed when a key is set", async () => {
    vi.stubEnv("JINA_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (u.startsWith("https://r.jina.ai/") ? ok("<rss><item><title>Need an n8n expert</title><link>https://x.com/1</link></item></rss>") : no(403))));
    const items = await feedWithRelay("https://blocked.example/feed.xml");
    expect(items[0]).toMatchObject({ title: "Need an n8n expert", url: "https://x.com/1" });
  });

  it("parses Reddit JSON and PullPush answers, and turns a search into a word test", () => {
    expect(parseRedditJson(`junk ${redditJson} junk`)).toHaveLength(1);
    expect(parsePullPush(pullpush)[1].url).toBe("https://www.reddit.com/r/forhire/comments/b2/");
    const t = queryTest('(hire OR hiring OR "looking for") developer');
    expect(t("We are LOOKING FOR help")).toBe(true);
    expect(t("cat pictures")).toBe(false);
    expect(queryTest(null)("anything")).toBe(true);
  });
});

describe("tool forums (n8n, Make, Bubble...)", () => {
  it("reads each search, newest first, merged without repeats", async () => {
    const answer = { topics: [{ id: 7, title: "Hiring: n8n expert for CRM sync", slug: "hiring-n8n-expert", created_at: "2026-11-13T10:00:00Z" }], posts: [{ topic_id: 7, blurb: "Paid project, about 40 hours", username: "acme_ops" }] };
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => { urls.push(decodeURIComponent(u)); return ok(JSON.stringify(answer)); }));
    const items = await readDiscourse("https://community.n8n.io", ["hiring", "paid project"]);
    expect(items).toEqual([{ title: "Hiring: n8n expert for CRM sync", url: "https://community.n8n.io/t/hiring-n8n-expert/7", body: "Paid project, about 40 hours", author: "acme_ops", posted_at: "2026-11-13T10:00:00Z" }]);
    expect(urls[0]).toContain("search.json?q=hiring order:latest");
    expect(parseDiscourse("https://f.io/", {})).toEqual([]);
  });

  it("the catalogue has many more free places, each with a unique key", () => {
    const keys = CATALOG.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(CATALOG.filter((s) => s.kind === "discourse").length).toBeGreaterThanOrEqual(9);
    expect(CATALOG.length).toBeGreaterThanOrEqual(120);
    for (const k of ["json_hn_jobs", "json_themuse", "json_workingnomads", "json_worldbank_sw", "forum_n8n", "forum_bubble", "reddit_webdeveloperjobs", "search_twine"]) expect(keys).toContain(k);
  });
});

describe("possible businesses behind a post", () => {
  const hay = "Shah Dental Clinics, Kothrud, Pune: shahdental.in. Smile Care Pune (smilecarepune.com), Baner. Dr Neha Joshi runs Smile Care.";
  it("keeps only candidates the evidence names, never the main one twice", () => {
    const c = groundCandidates([
      { company: "Smile Care Pune", website: "smilecarepune.com", location: "Baner, Pune", person: "Dr Neha Joshi", why: "Also 3 clinics in Pune", confidence: "medium" },
      { company: "Shah Dental Clinics", why: "same as main" },
      { company: "Invented Dental Co", website: "invented.in", confidence: "high" },
      { company: "Smile Care Pune", website: "made-up.com", person: "Dr Ghost", confidence: "high" },
    ], hay, "Shah Dental Clinics");
    expect(c).toEqual([
      { company: "Smile Care Pune", website: "https://smilecarepune.com", location: "Baner, Pune", person: "Dr Neha Joshi", why: "Also 3 clinics in Pune", confidence: "medium", evidence_url: null },
    ]);
  });
  it("travel with the main finding", () => {
    const id = groundIdentity({ company: "Shah Dental Clinics", confidence: "high", candidates: [{ company: "Smile Care Pune", confidence: "low" }] }, hay);
    expect(id.candidates?.map((c) => c.company)).toEqual(["Smile Care Pune"]);
  });
});

describe("chatting about a radar lead", () => {
  beforeEach(async () => {
    await q("truncate sales_radar_items, sales_moves restart identity cascade");
  });
  it("gives the assistant the post, the profile, the business, the brief and the draft, and tells it not to guess", async () => {
    const it0 = (await one<{ id: number }>(
      `insert into sales_radar_items (url, url_hash, title, body, status, score, poster, identity, brief) values ('https://www.freelancer.com/projects/x', 'h', 'Booking bot for clinics', 'Our 3 clinics miss calls.', 'qualified', 80,
        '{"name":"Ravi S.","city":"Pune"}', '{"status":"found","company":"Shah Dental Clinics","emails":["ravi@shahdental.in"],"phones":[],"evidence":[],"note":"n","checked_at":"x"}', '{"need":"WhatsApp booking for 3 clinics"}') returning id`))!;
    await q("insert into sales_moves (radar_item_id, kind, title, dedupe_key, draft, channel) values ($1, 'radar', 'x', $2, 'Hi Ravi, about your clinics', 'email')", [it0.id, `radar:${it0.id}`]);
    expect(cleanFocus({ radar_item_id: it0.id })).toEqual({ radar_item_id: it0.id });
    expect(cleanFocus({ radar_item_id: "x" })).toBeNull();
    const ctx = await focusContext({ radar_item_id: it0.id });
    for (const s of ["ONE RADAR LEAD", "Our 3 clinics miss calls.", "Ravi S.", "Shah Dental Clinics", "ravi@shahdental.in", "WhatsApp booking for 3 clinics", "Hi Ravi, about your clinics", "never guess"]) expect(ctx).toContain(s);
  });
});
