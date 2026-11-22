// The news as a personal newspaper: read from many sources (each story kept once), scored for the owner, the important
// ones opened in full (text, picture, real address) and written up in detail, then a morning paper with a front page,
// a who-wins-who-loses board and sections, with no link that is not a story read; a newspaper PDF with pictures and
// clickable sources, sent to Telegram as the PDF itself.
import { deflateSync, crc32 } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const feeds = vi.hoisted(() => ({ byUrl: {} as Record<string, { title: string; url: string; body: string; date: string | null; author: string | null; image?: string | null }[]> }));
vi.mock("@/lib/sales/radar-fetch", async (orig) => ({
  ...(await orig<typeof import("@/lib/sales/radar-fetch")>()),
  feedWithRelay: vi.fn(async (url: string) => {
    const hit = Object.entries(feeds.byUrl).find(([k]) => url.includes(k));
    if (!hit) throw new Error("feed 404");
    return hit[1];
  }),
}));
const ai = vi.hoisted(() => ({ answer: [] as unknown }));
vi.mock("@/lib/sales/llm", async (orig) => ({
  ...(await orig<typeof import("@/lib/sales/llm")>()),
  llmConfigured: () => true,
  llmJson: vi.fn(async () => ai.answer),
}));
const tg = vi.hoisted(() => ({ texts: [] as string[], chat: null as number | null }));
vi.mock("@/lib/sales/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/sales/notify")>()), push: vi.fn(async (t: string) => { tg.texts.push(t); return 1; }), ownerChat: vi.fn(async () => tg.chat) }));

import { one, q } from "@/lib/db";
import { collectNews, isRecent, outletOf, scoreNews, splitOutlet, titleKey } from "@/lib/news/collect";
import { editionPdfFor, keepKnownLinks, loadPaper, scheduleEdition, sectionPoints, sendEdition, toLayout, writeEdition } from "@/lib/news/edition";
import { buildSections, type PaperStory } from "@/lib/news/paper";
import { fetchImages, paperPdf, runsOf } from "@/lib/news/pdf";
import { detailStories, extractArticle, parseReader, readStories } from "@/lib/news/read";
import { feedImage } from "@/lib/sales/search";

beforeEach(async () => {
  await q("truncate news_items, news_editions, news_sources restart identity cascade");
  await q("update news_settings set enabled = true, send_hour = 8, telegram = true, pdf = true, extra_interests = '' where id = 1");
  feeds.byUrl = {};
  ai.answer = [];
  tg.texts = [];
  tg.chat = null;
});
afterEach(() => vi.restoreAllMocks());

const now = new Date().toUTCString();

/** A real PNG picture (a 64 x 40 gradient), made here so the test needs no file. */
function png(w = 64, h = 40): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x * 4; raw[o + 1] = y * 6; raw[o + 2] = 200; }
  // a noisy picture, so it is over the minimum size a real picture has
  const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 0 })), chunk("IEND", Buffer.alloc(0))]);
  return new Uint8Array(big);
}

const story = (o: Partial<PaperStory> & { id: number }): PaperStory => ({
  title: `Story ${o.id}`, url: `https://news.google.com/rss/articles/${o.id}`, real_url: null, outlet: "Reuters", author: null, image_url: null, summary: "A snippet.",
  detail: null, affects: null, impact: null, for_you: null, score: 70, topic: "world", why: null, action: null, published_at: new Date().toISOString(), found_at: new Date().toISOString(), ...o,
});

describe("pure parts", () => {
  it("splits the outlet off a Google News title, names an outlet from its address, and two versions of a story share a key", () => {
    expect(splitOutlet("Gemini 3 cuts API prices by half - The Verge")).toEqual({ title: "Gemini 3 cuts API prices by half", outlet: "The Verge" });
    expect(splitOutlet("No outlet here")).toEqual({ title: "No outlet here", outlet: null });
    expect(titleKey("Gemini 3 cuts API prices by half")).toBe(titleKey("GEMINI 3 cuts API prices, by half!"));
    expect(isRecent(new Date(Date.now() - 50 * 3_600_000).toISOString(), Date.now())).toBe(false);
    expect(outletOf("https://www.reuters.com/world/x")).toBe("Reuters");
    expect(outletOf("https://economictimes.indiatimes.com/a")).toBe("Indiatimes");
    expect(outletOf("https://www.bbc.co.uk/news/1")).toBe("BBC");
  });

  it("keeps only links to the stories read; reads a section's points for Telegram", () => {
    const md = "## The 60-second brief\n- **Gemini** cut prices [Verge](https://v.com/a)\n- Made up [Fake](https://fake.example/x)\n## Do today\n- Try it";
    const kept = keepKnownLinks(md, ["https://v.com/a"]);
    expect(kept).not.toContain("fake.example");
    expect(sectionPoints(kept, /60-second/)).toEqual(["Gemini cut prices Verge", "Made up Fake"]);
    expect(runsOf("**Nvidia** beat [Reuters](https://r.com/1)")).toEqual([{ text: "Nvidia", bold: true, url: null }, { text: " beat ", bold: false, url: null }, { text: "Reuters", bold: false, url: "https://r.com/1" }]);
  });

  it("finds a story's picture in a feed item", () => {
    expect(feedImage('<title>x</title><media:thumbnail width="240" url="https://ichef.bbci.co.uk/a.jpg"/>')).toBe("https://ichef.bbci.co.uk/a.jpg");
    expect(feedImage('<media:content url="https://i.guim.co.uk/b.jpg?w=460&amp;q=55" medium="image"/>')).toBe("https://i.guim.co.uk/b.jpg?w=460&q=55");
    expect(feedImage('<enclosure url="https://x.com/c.png" type="image/png" length="1"/>')).toBe("https://x.com/c.png");
    expect(feedImage('<description>&lt;img src="https://x.com/d.jpg"&gt; text</description>')).toBe("https://x.com/d.jpg");
    expect(feedImage("<title>no picture</title>")).toBeNull();
  });

  it("reads an article out of a publisher's page and out of the reader, leaving logos and page furniture out", () => {
    const html = `<html><head><meta property="og:image" content="/img/oil.jpg"><link rel="canonical" href="https://pub.com/oil-story"><meta name="author" content="Jane Roe"></head>
      <body><p>Subscribe to our newsletter for more news every single morning of the week.</p><article><p>Brent crude rose 6 percent on Monday after attacks on tankers in the Red Sea disrupted shipping lanes.</p>
      <p>Freight rates for Asia to Europe routes doubled within a week, according to the shipping data the article cites.</p></article></body></html>`;
    const a = extractArticle(html, "https://pub.com/x?utm=1");
    expect(a.text).toContain("Brent crude rose 6 percent");
    expect(a.text).not.toContain("Subscribe");
    expect(a).toMatchObject({ image: "https://pub.com/img/oil.jpg", url: "https://pub.com/oil-story", author: "Jane Roe" });
    expect(extractArticle('<meta property="og:image" content="https://pub.com/logo.png"><p>' + "word ".repeat(30) + "</p>", "https://pub.com").image).toBeNull();
    const r = parseReader("Title: Oil jumps\n\nURL Source: https://pub.com/oil\n\nMarkdown Content:\n![logo](https://pub.com/logo.svg)\n\n![Tanker](https://cdn.pub.com/photo/tanker.jpg)\n\nBrent crude rose 6 percent on Monday after attacks on tankers disrupted shipping in the Red Sea.\n\nShort.");
    expect(r).toMatchObject({ url: "https://pub.com/oil", image: "https://cdn.pub.com/photo/tanker.jpg" });
    expect(r.text).toBe("Brent crude rose 6 percent on Monday after attacks on tankers disrupted shipping in the Red Sea.");
  });

  it("turns the editor's answer into a layout, dropping story numbers that point nowhere, and fills the sections by topic", () => {
    const stories = [story({ id: 11, score: 95, topic: "world" }), story({ id: 12, score: 80, topic: "markets_india" }), story({ id: 13, score: 60, topic: "ai_tools" }), story({ id: 14, score: 55, topic: "weird" })];
    const l = toLayout({
      headline: "Oil jumps \u2014 shipping hit", lead: 1, brief: [{ text: "Oil up", n: 1 }, { text: "Ghost", n: 99 }, { text: "" }],
      sectors: [{ name: "Shipping", move: "down", why: "Costs up", n: [1, 42] }, { name: "x", move: "sideways", why: "y" }], today: ["Call two exporters"],
    }, stories, "Fallback");
    expect(l.headline).toBe("Oil jumps, shipping hit");
    expect(l.lead).toBe(11);
    expect(l.brief).toEqual([{ text: "Oil up", id: 11 }, { text: "Ghost", id: null }]);
    expect(l.sectors).toEqual([{ name: "Shipping", move: "down", why: "Costs up", ids: [11] }, { name: "x", move: "mixed", why: "y", ids: [] }]);
    // the lead is on the front page, not again in its section; an unknown topic lands in "Also worth knowing"
    expect(l.sections.map((s) => [s.key, s.ids])).toEqual([["economy", [12]], ["ai", [13]], ["more", [14]]]);
    expect(buildSections(stories, null)[0]).toEqual({ key: "world", title: "World and geopolitics", ids: [11] });
  });
});

describe("the newspaper PDF", () => {
  it("is a multi-page paper with the masthead, pictures, every source clickable, and Western-only characters drawn safely", async () => {
    const stories = new Map<number, PaperStory>();
    for (let i = 1; i <= 24; i++) stories.set(i, story({
      id: i, title: `Headline number ${i} about markets and the rupee at ₹84 🚀`, real_url: `https://pub${i}.com/story`, author: i === 1 ? "Jane Roe" : null,
      detail: "Brent crude rose sharply on Monday after attacks on tankers. ".repeat(8), affects: "Shipping and exporters: costs up.", impact: i % 2 ? "down" : "up",
      for_you: "Your Gulf clients may delay spending.", topic: ["world", "markets_india", "ai_tools", "business"][i % 4], image_url: i <= 3 ? `https://img.test/${i}.png` : null,
    }));
    const layout = toLayout({
      headline: "Oil jumps as Red Sea attacks hit shipping", standfirst: "Costs rise for exporters.", lead: 1,
      brief: [1, 2, 3, 4, 5].map((n) => ({ text: `Point ${n} on what happened and why it matters.`, n })), glance: "The world today in five sentences. ".repeat(4),
      note: "Watch oil this week.", sectors: [{ name: "Shipping", move: "down", why: "Freight costs up.", n: [1] }, { name: "IT services", move: "up", why: "Rupee weaker.", n: [2] }],
      opportunities: [{ idea: "Pitch logistics firms a tracking bot.", n: 1 }], today: ["Call two exporters"],
    }, [...stories.values()], "x");
    const pic = png();
    const pdf = await paperPdf({
      title: "Aivaura Morning Brief, Sat 21 Nov", date: "2026-11-21", dayLine: "Saturday, 21 November 2026", edition: 3, owner: "Akshat Shah", company: "Aivaura", tz: "Asia/Kolkata",
      layout, markdown: "", stories, sources: 24, images: new Map([[1, { bytes: pic, kind: "png" }], [2, { bytes: pic, kind: "png" }]]),
    });
    const raw = Buffer.from(pdf).toString("latin1");
    expect(raw.startsWith("%PDF-")).toBe(true);
    expect((raw.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(3);
    expect(raw).toContain("/Subtype /Image");
    expect(raw).toContain("/URI (https://pub1.com/story)");
    expect(raw).toContain("/URI (https://pub24.com/story)");
  });

  it("sets an edition from before the newspaper layout from its Markdown", async () => {
    const pdf = await paperPdf({ title: "Old", date: "2026-11-20", dayLine: "Friday, 20 November 2026", edition: 1, owner: "A", company: "B", tz: "UTC", layout: null, markdown: "# T\n## Brief\n- **Rupee** at ₹84 [ET](https://et.com/a)", stories: new Map(), sources: 0 });
    expect(Buffer.from(pdf).toString("latin1")).toContain("/URI (https://et.com/a)");
  });

  it("fetches only real JPEG or PNG pictures", async () => {
    const pic = png();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u) => String(u).includes("good") ? new Response(Buffer.from(pic)) : new Response("<html>not a picture</html>".repeat(200)));
    const got = await fetchImages([story({ id: 1, image_url: "https://img.test/good.png" }), story({ id: 2, image_url: "https://img.test/page.html" }), story({ id: 3 })]);
    expect([...got.keys()]).toEqual([1]);
  });
});

describe("reading, scoring and writing up", () => {
  it("reads the sources, keeps each story once across outlets with its picture, drops old ones, records failing sources, and skips Tavily without a key", async () => {
    feeds.byUrl = {
      "news.google.com": [
        { title: "OpenAI launches agent builder - TechCrunch", url: "https://tc.com/a", body: "OpenAI launched...", date: now, author: null },
        { title: "OpenAI launches agent builder - The Verge", url: "https://verge.com/a", body: "same story", date: now, author: null },
        { title: "Old news - Mint", url: "https://mint.com/old", body: "", date: new Date(Date.now() - 4 * 86_400_000).toUTCString(), author: null },
      ],
      "feeds.bbci.co.uk/news/world": [{ title: "Ceasefire talks resume", url: "https://bbc.com/w1", body: "Talks resumed.", date: now, author: null, image: "https://ichef.bbci.co.uk/w1.jpg" }],
    };
    const r = await collectNews(60_000, { force: true });
    expect(r.read).toBeGreaterThan(40);
    const items = await q<{ title: string; outlet: string; image_url: string | null }>("select title, outlet, image_url from news_items order by id");
    expect(items).toContainEqual({ title: "OpenAI launches agent builder", outlet: "TechCrunch", image_url: null });
    expect(items).toContainEqual({ title: "Ceasefire talks resume", outlet: "BBC World", image_url: "https://ichef.bbci.co.uk/w1.jpg" });
    expect(items.filter((i) => /OpenAI/.test(i.title))).toHaveLength(1);
    expect((await one<{ n: number }>("select count(*)::int as n from news_sources where last_error is not null"))!.n).toBeGreaterThan(0);
    expect(await one("select 1 from news_sources where kind = 'tavily' and last_run_at is not null")).toBeNull();
  });

  it("scores stories with why they matter to the owner, counting indirect effects like wars", async () => {
    await q("insert into news_items (url, url_hash, title_key, title, topic) values ('https://a.com/1', 'h1', 'k1', 'Gemini cuts API prices', 'ai_models'), ('https://a.com/2', 'h2', 'k2', 'Celebrity wedding', 'other')");
    ai.answer = [{ i: 1, score: 92, topic: "ai_models", why: "Cheaper Gemini lowers the cost of your voice agents" }, { i: 2, score: 5, topic: "other", why: "Not relevant" }];
    expect(await scoreNews(60_000)).toBe(2);
    expect((await q<{ score: number }>("select score from news_items order by id")).map((r) => r.score)).toEqual([92, 5]);
    const { llmJson } = await import("@/lib/sales/llm");
    expect(String(vi.mocked(llmJson).mock.calls.at(-1)?.[0])).toMatch(/wars, conflicts and sanctions/);
  });

  it("opens the important stories in full: a publisher page directly, a Google News link through the reader", async () => {
    await q(`insert into news_items (url, url_hash, title_key, title, score, found_at) values
      ('https://pub.com/oil', 'h1', 'k1', 'Oil jumps', 90, now()), ('https://news.google.com/rss/articles/CB1', 'h2', 'k2', 'Rupee falls', 80, now()),
      ('https://pub.com/minor', 'h3', 'k3', 'Minor', 30, now())`);
    const fetched: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u) => {
      const url = String(u);
      fetched.push(url);
      if (url === "https://pub.com/oil") return new Response(`<meta property="og:image" content="https://pub.com/photo/oil.jpg"><article><p>${"Brent crude rose 6 percent on Monday after attacks on tankers in the Red Sea. ".repeat(8)}</p></article>`);
      if (url.startsWith("https://r.jina.ai/https://news.google.com")) return new Response(`Title: Rupee\n\nURL Source: https://mint.com/rupee\n\nMarkdown Content:\n![x](https://mint.com/img/rupee.jpg)\n\n${"The rupee fell to a record low against the dollar on Tuesday as oil rose. ".repeat(4)}`);
      return new Response("", { status: 404 });
    });
    expect(await readStories(60_000)).toBe(2);
    const rows = await q<{ title: string; body: string | null; image_url: string | null; real_url: string | null }>("select title, body, image_url, real_url from news_items where score >= 55 order by id");
    expect(rows[0]).toMatchObject({ image_url: "https://pub.com/photo/oil.jpg" });
    expect(rows[0].body).toContain("Brent crude");
    expect(rows[1]).toMatchObject({ image_url: "https://mint.com/img/rupee.jpg", real_url: "https://mint.com/rupee" });
    expect(fetched).not.toContain("https://pub.com/minor"); // only the stories that matter are opened
  });

  it("writes each one up in detail from the article only: what happened, who it hits, what it means for the owner", async () => {
    await q(`insert into news_items (url, url_hash, title_key, title, score, found_at, read_at, body) values ('https://pub.com/oil', 'h1', 'k1', 'Oil jumps', 90, now(), now(), 'Brent rose 6 percent.')`);
    ai.answer = [{ i: 1, detail: "Brent crude rose 6 percent on Monday \u2014 shipping was hit.", affects: "Shipping and airlines: costs up.", impact: "down", for_you: "Your Gulf clients may slow spending." }];
    expect(await detailStories(60_000)).toBe(1);
    const r = await one<{ detail: string; affects: string; impact: string; for_you: string }>("select detail, affects, impact, for_you from news_items");
    expect(r).toEqual({ detail: "Brent crude rose 6 percent on Monday, shipping was hit.", affects: "Shipping and airlines: costs up.", impact: "down", for_you: "Your Gulf clients may slow spending." });
    const { llmJson } = await import("@/lib/sales/llm");
    expect(String(vi.mocked(llmJson).mock.calls.at(-1)?.[1])).toContain("ARTICLE:\nBrent rose 6 percent.");
  });
});

describe("the morning paper", () => {
  const seed = () => q(`insert into news_items (url, url_hash, title_key, title, outlet, score, topic, why, scored_at, detail, real_url) values
    ('https://news.google.com/rss/articles/A', 'h1', 'k1', 'Oil jumps as Red Sea attacks hit shipping', 'Reuters', 95, 'world', 'Costs up', now(), 'Brent rose 6 percent on Monday.', 'https://reuters.com/oil'),
    ('https://et.com/rbi', 'h2', 'k2', 'RBI holds repo rate', 'ET', 80, 'india_economy', 'Loan costs unchanged', now(), null, null),
    ('https://x.com/low', 'h3', 'k3', 'Minor story', 'X', 20, 'other', null, now(), null, null)`);

  it("is laid out as a paper from the stories that matter, every link a story read, and kept by date", async () => {
    await seed();
    ai.answer = { headline: "Oil jumps, shipping hit", lead: 1, brief: [{ text: "Oil is up.", n: 1 }, { text: "RBI held.", n: 2 }], sectors: [{ name: "Shipping", move: "down", why: "Costs up", n: [1] }], today: ["Check fuel surcharges"] };
    const e = await writeEdition("2026-11-21");
    expect(e).toMatchObject({ date: "2026-11-21", stories: 2 });
    expect(e!.layout).toMatchObject({ headline: "Oil jumps, shipping hit", lead: 1, sections: [{ key: "economy", ids: [2] }] });
    expect(e!.markdown).toContain("[Reuters](https://reuters.com/oil)"); // the publisher's own page, not Google's redirect
    const { llmJson } = await import("@/lib/sales/llm");
    expect(JSON.stringify(vi.mocked(llmJson).mock.calls.at(-1))).not.toContain("Minor story");
    const paper = await loadPaper("2026-11-21");
    expect(paper).toMatchObject({ number: 1, dayLine: "Saturday, 21 November 2026", sources: 2 });
    expect(paper!.stories.size).toBe(2);
    const made = await editionPdfFor("2026-11-21", { images: false });
    expect(Buffer.from(made!.pdf).toString("latin1")).toContain("/URI (https://reuters.com/oil)");
  });

  it("is sent to Telegram as the PDF itself, with the headline and brief as its caption", async () => {
    await seed();
    ai.answer = { headline: "Oil jumps, shipping hit", lead: 1, brief: [{ text: "Oil is up.", n: 1 }], today: ["Check fuel surcharges"] };
    await writeEdition("2026-11-21");
    tg.chat = 42;
    process.env.TELEGRAM_BOT_TOKEN = "123:secret";
    process.env.TELEGRAM_API_BASE = "https://tg.test";
    let form: FormData | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u, init) => {
      if (String(u) === "https://tg.test/bot123:secret/sendDocument") { form = init!.body as FormData; return new Response('{"ok":true}'); }
      return new Response("", { status: 404 });
    });
    try {
      expect(await sendEdition("2026-11-21")).toBe(true);
    } finally {
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_API_BASE;
    }
    const f = form as FormData | null;
    expect(f!.get("chat_id")).toBe("42");
    expect((f!.get("document") as File).name).toBe("daybook-daily-2026-11-21.pdf");
    expect(String(f!.get("caption"))).toMatch(/Oil jumps, shipping hit[\s\S]*Oil is up[\s\S]*full paper is attached/);
    expect(tg.texts).toEqual([]); // the PDF carries it all; no second message
    expect((await one<{ sent_at: string | null }>("select sent_at from news_editions where date = '2026-11-21'"))!.sent_at).toBeTruthy();
  });

  it("when the PDF cannot be attached, sends the brief as a message and says why", async () => {
    await seed();
    ai.answer = { headline: "Oil jumps", lead: 1, brief: [{ text: "Oil is up.", n: 1 }], today: ["Check fuel surcharges"] };
    await writeEdition("2026-11-21");
    expect(await sendEdition("2026-11-21")).toBe(true);
    expect(tg.texts[0]).toMatch(/Oil is up[\s\S]*Do today[\s\S]*Check fuel surcharges[\s\S]*could not be attached \(no Telegram chat linked\)/);
  });

  it("is due once a day at or after the hour set, in the owner's time zone", async () => {
    const at = (iso: string) => new Date(iso);
    expect(await scheduleEdition(at("2026-11-21T01:00:00Z"))).toBeNull(); // 06:30 in India: too early
    expect(await scheduleEdition(at("2026-11-21T03:00:00Z"))).toBe("2026-11-21"); // 08:30 in India
    await q("insert into news_editions (date, title, markdown) values ('2026-11-21', 't', 'm')");
    expect(await scheduleEdition(at("2026-11-21T05:00:00Z"))).toBeNull();
    await q("update news_settings set enabled = false where id = 1");
    expect(await scheduleEdition(at("2026-11-22T05:00:00Z"))).toBeNull();
  });
});
