// The news: read from many sources, each story kept once, scored for the owner; a morning brief written only from
// those stories (no link that is not one of them), kept by date, sent to Telegram with a PDF at the hour set.
import { beforeEach, describe, expect, it, vi } from "vitest";

const feeds = vi.hoisted(() => ({ byUrl: {} as Record<string, { title: string; url: string; body: string; date: string | null; author: string | null }[]> }));
vi.mock("@/lib/sales/radar-fetch", async (orig) => ({
  ...(await orig<typeof import("@/lib/sales/radar-fetch")>()),
  feedWithRelay: vi.fn(async (url: string) => {
    const hit = Object.entries(feeds.byUrl).find(([k]) => url.includes(k));
    if (!hit) throw new Error("feed 404");
    return hit[1];
  }),
}));
const ai = vi.hoisted(() => ({ scores: [] as unknown[], text: "" }));
vi.mock("@/lib/sales/llm", async (orig) => ({
  ...(await orig<typeof import("@/lib/sales/llm")>()),
  llmConfigured: () => true,
  llmJson: vi.fn(async () => ai.scores),
  llm: vi.fn(async () => ({ text: ai.text, model: "test" })),
}));
const pushed = vi.hoisted(() => ({ texts: [] as string[] }));
vi.mock("@/lib/sales/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/sales/notify")>()), push: vi.fn(async (t: string) => { pushed.texts.push(t); return 1; }), ownerChat: vi.fn(async () => null) }));

import { one, q } from "@/lib/db";
import { collectNews, isRecent, scoreNews, splitOutlet, titleKey } from "@/lib/news/collect";
import { keepKnownLinks, scheduleEdition, sectionPoints, sendEdition, writeEdition } from "@/lib/news/edition";
import { editionPdf, runsOf } from "@/lib/news/pdf";

beforeEach(async () => {
  await q("truncate news_items, news_editions, news_sources restart identity cascade");
  await q("update news_settings set enabled = true, send_hour = 8, telegram = true, pdf = true, extra_interests = '' where id = 1");
  feeds.byUrl = {};
  ai.scores = [];
  ai.text = "";
  pushed.texts = [];
});

const now = new Date().toUTCString();

describe("pure parts", () => {
  it("splits the outlet off a Google News title, and two outlets' versions of a story share a key", () => {
    expect(splitOutlet("Gemini 3 cuts API prices by half - The Verge")).toEqual({ title: "Gemini 3 cuts API prices by half", outlet: "The Verge" });
    expect(splitOutlet("No outlet here")).toEqual({ title: "No outlet here", outlet: null });
    expect(titleKey("Gemini 3 cuts API prices by half")).toBe(titleKey("GEMINI 3 cuts API prices, by half!"));
    expect(isRecent(new Date(Date.now() - 50 * 3_600_000).toISOString(), Date.now())).toBe(false);
    expect(isRecent(null, Date.now())).toBe(true);
  });

  it("keeps only links to the stories read; reads a section's points for Telegram", () => {
    const md = "## The 60-second brief\n- **Gemini** cut prices [Verge](https://v.com/a)\n- Made up [Fake](https://fake.example/x)\n## Do today\n- Try it";
    const kept = keepKnownLinks(md, ["https://v.com/a"]);
    expect(kept).toContain("[Verge](https://v.com/a)");
    expect(kept).not.toContain("fake.example");
    expect(kept).toContain("Made up Fake");
    expect(sectionPoints(kept, /60-second/)).toEqual(["Gemini cut prices Verge", "Made up Fake"]);
    expect(sectionPoints(kept, /do today/i)).toEqual(["Try it"]);
    expect(runsOf("**Nvidia** beat estimates [Reuters](https://r.com/1)")).toEqual([
      { text: "Nvidia", bold: true, url: null }, { text: " beat estimates ", bold: false, url: null }, { text: "Reuters", bold: false, url: "https://r.com/1" },
    ]);
  });

  it("makes a real PDF, even with a rupee sign and an emoji", async () => {
    const pdf = await editionPdf({ title: "Aivaura Morning Brief, Sat 21 Nov", date: "2026-11-21", markdown: "# T\n## The 60-second brief\n- **Rupee** at ₹84 🚀 [ET](https://et.com/a)\n" + "- long point ".repeat(200) });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
    expect(Buffer.from(pdf).toString("latin1")).toContain("/URI (https://et.com/a)");
  });
});

describe("reading and scoring", () => {
  it("reads the sources, keeps each story once across outlets, drops old ones, and records failing sources", async () => {
    feeds.byUrl = {
      "news.google.com": [
        { title: "OpenAI launches agent builder - TechCrunch", url: "https://tc.com/a", body: "OpenAI launched...", date: now, author: null },
        { title: "OpenAI launches agent builder - The Verge", url: "https://verge.com/a", body: "same story", date: now, author: null },
        { title: "Old news - Mint", url: "https://mint.com/old", body: "", date: new Date(Date.now() - 4 * 86_400_000).toUTCString(), author: null },
      ],
    };
    const r = await collectNews(60_000, { force: true });
    expect(r.read).toBeGreaterThan(20);
    const items = await q<{ title: string; outlet: string }>("select title, outlet from news_items");
    expect(items).toEqual([{ title: "OpenAI launches agent builder", outlet: "TechCrunch" }]);
    const failing = await one<{ n: number }>("select count(*)::int as n from news_sources where last_error is not null");
    expect(failing!.n).toBeGreaterThan(0); // the feeds this test does not serve: shown as failing, not hidden
  });

  it("scores stories with why they matter to the owner", async () => {
    await q("insert into news_items (url, url_hash, title_key, title, topic) values ('https://a.com/1', 'h1', 'k1', 'Gemini cuts API prices', 'ai_models'), ('https://a.com/2', 'h2', 'k2', 'Celebrity wedding', 'other')");
    ai.scores = [{ i: 1, score: 92, topic: "ai_models", why: "Cheaper Gemini lowers the cost of your voice agents", action: "Check your API bill" }, { i: 2, score: 5, topic: "other", why: "Not relevant" }];
    expect(await scoreNews(60_000)).toBe(2);
    const rows = await q<{ score: number; why: string }>("select score, why from news_items order by id");
    expect(rows.map((r) => r.score)).toEqual([92, 5]);
    expect(rows[0].why).toMatch(/voice agents/);
  });
});

describe("the morning brief", () => {
  const seed = () => q(`insert into news_items (url, url_hash, title_key, title, outlet, score, topic, why, scored_at) values
    ('https://v.com/gemini', 'h1', 'k1', 'Gemini cuts prices', 'The Verge', 92, 'ai_models', 'Cheaper voice agents', now()),
    ('https://et.com/rbi', 'h2', 'k2', 'RBI holds repo rate', 'ET', 80, 'india_economy', 'Loan costs unchanged', now()),
    ('https://x.com/low', 'h3', 'k3', 'Minor story', 'X', 20, 'other', null, now())`);

  it("is written from the stories that matter, with no invented link, and kept by date", async () => {
    await seed();
    ai.text = "# Aivaura Morning Brief, Sat 21 Nov\n## The 60-second brief\n- **Gemini** cut prices. [The Verge](https://v.com/gemini)\n- **RBI** held rates. [ET](https://et.com/rbi)\n- Invented point [Fake](https://made-up.example/x)\n## Do today\n- Check the API bill";
    const e = await writeEdition("2026-11-21");
    expect(e).toMatchObject({ date: "2026-11-21", stories: 2, title: "Aivaura Morning Brief, Sat 21 Nov" });
    expect(e!.markdown).not.toContain("made-up.example");
    expect(e!.markdown).toContain("[The Verge](https://v.com/gemini)");
    // the low-scored story was not given to the writer
    const { llm } = await import("@/lib/sales/llm");
    expect(JSON.stringify(vi.mocked(llm).mock.calls.at(-1))).not.toContain("Minor story");
  });

  it("is sent to Telegram with its brief and what to do, once written", async () => {
    await seed();
    ai.text = "# Brief\n## The 60-second brief\n- **Gemini** cut prices. [The Verge](https://v.com/gemini)\n## Do today\n- Check the API bill";
    await writeEdition("2026-11-21");
    expect(await sendEdition("2026-11-21")).toBe(true);
    expect(pushed.texts[0]).toMatch(/Gemini cut prices[\s\S]*Do today[\s\S]*Check the API bill/);
    expect((await one<{ sent_at: string | null }>("select sent_at from news_editions where date = '2026-11-21'"))!.sent_at).toBeTruthy();
  });

  it("is due once a day at or after the hour set, in the owner's time zone", async () => {
    const at = (iso: string) => new Date(iso);
    expect(await scheduleEdition(at("2026-11-21T01:00:00Z"))).toBeNull(); // 06:30 in India: too early
    expect(await scheduleEdition(at("2026-11-21T03:00:00Z"))).toBe("2026-11-21"); // 08:30 in India
    await q("insert into news_editions (date, title, markdown) values ('2026-11-21', 't', 'm')");
    expect(await scheduleEdition(at("2026-11-21T05:00:00Z"))).toBeNull(); // already written today
    await q("update news_settings set enabled = false where id = 1");
    expect(await scheduleEdition(at("2026-11-22T05:00:00Z"))).toBeNull();
  });
});
