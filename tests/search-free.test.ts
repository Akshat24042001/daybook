import { describe, expect, it } from "vitest";
import { domainGuesses, nameWords } from "@/lib/sales/enrich";
import { companyBrief } from "@/lib/sales/research";
import { mergeHits, parseBingRss, parseDuckDuckGo, parseDuckDuckGoLite, parseGrounded, parseMojeek } from "@/lib/sales/search";

describe("keyless search engines", () => {
  it("reads Bing's RSS", () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>Bing</title><item><title>Glowyug Skincare</title><link>https://glowyug.in/</link><description>Clean &amp; simple skincare from Pune</description><pubDate>Tue, 10 Nov 2026</pubDate></item><item><title>Glowyug on Instagram</title><link>https://www.instagram.com/glowyug/</link><description>12k followers</description></item></channel></rss>`;
    const h = parseBingRss(xml, 5);
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ title: "Glowyug Skincare", url: "https://glowyug.in/", snippet: "Clean & simple skincare from Pune" });
  });
  it("reads DuckDuckGo HTML and lite", () => {
    const html = `<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fglowyug.in%2Fabout&rut=x">About <b>Glowyug</b></a><a class="result__snippet" href="x">Founded in 2021 by Riya Shah</a>`;
    expect(parseDuckDuckGo(html, 5)[0]).toMatchObject({ url: "https://glowyug.in/about", title: "About Glowyug", snippet: "Founded in 2021 by Riya Shah" });
    const lite = `<table><tr><td><a rel="nofollow" href="https://glowyug.in/" class='result-link'>Glowyug</a></td></tr><tr><td class='result-snippet'>Skincare brand</td></tr></table>`;
    expect(parseDuckDuckGoLite(lite, 5)[0]).toMatchObject({ url: "https://glowyug.in/", title: "Glowyug", snippet: "Skincare brand" });
  });
  it("reads Mojeek", () => {
    const html = `<ul class="results-standard"><li><a class="ob" href="https://glowyug.in/">x</a><h2><a class="title" href="https://glowyug.in/">Glowyug | Skincare</a></h2><p class="s">Pune based brand</p></li></ul>`;
    expect(parseMojeek(html, 5)[0]).toMatchObject({ url: "https://glowyug.in/", title: "Glowyug | Skincare", snippet: "Pune based brand" });
  });
  it("merges engines, each page once, alternating so every engine contributes", () => {
    const a = [{ title: "A1", url: "https://x.com/1", snippet: "" }, { title: "A2", url: "https://x.com/2", snippet: "" }];
    const b = [{ title: "B1", url: "https://www.x.com/1/", snippet: "" }, { title: "B2", url: "https://y.com", snippet: "" }];
    expect(mergeHits([a, b], 10).map((h) => h.title)).toEqual(["A1", "A2", "B2"]);
  });
});

describe("Google search through Gemini", () => {
  it("reads the answer, its sources with what each supports, and the searches run", () => {
    const g = parseGrounded({
      candidates: [{
        content: { parts: [{ text: "Glowyug was founded in 2021 by Riya Shah. " }, { text: "It has 25 employees." }] },
        groundingMetadata: {
          webSearchQueries: ["glowyug founder", "glowyug employees"],
          groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "glowyug.in" } }, { web: { uri: "https://in.linkedin.com/company/glowyug", title: "linkedin.com" } }],
          groundingSupports: [{ segment: { text: "Glowyug was founded in 2021 by Riya Shah." }, groundingChunkIndices: [0] }, { segment: { text: "It has 25 employees." }, groundingChunkIndices: [1] }],
        },
      }],
    });
    expect(g.text).toBe("Glowyug was founded in 2021 by Riya Shah. It has 25 employees.");
    expect(g.queries).toEqual(["glowyug founder", "glowyug employees"]);
    expect(g.chunks[1]).toEqual({ title: "linkedin.com", uri: "https://in.linkedin.com/company/glowyug", snippet: "It has 25 employees." });
  });
  it("survives an answer without grounding", () => {
    expect(parseGrounded({ candidates: [{ content: { parts: [{ text: "not found" }] } }] })).toEqual({ text: "not found", chunks: [], queries: [] });
    expect(parseGrounded({})).toEqual({ text: "", chunks: [], queries: [] });
  });
  it("asks for the facts a seller needs, about this company only", () => {
    const b = companyBrief("Glowyug", { website: "https://glowyug.in", country: "India", year: 2026 });
    expect(b).toMatch(/LinkedIn profile URL/);
    expect(b).toMatch(/namesakes/);
    expect(b).toMatch(/Never guess/);
  });
});

describe("finding their website without a search engine", () => {
  it("knows the distinctive words of a name", () => {
    expect(nameWords("Glowyug Skincare Pvt. Ltd.")).toEqual(["glowyug", "skincare"]);
    expect(nameWords("The Shah & Sons Company")).toEqual(["shah", "and", "sons"]);
  });
  it("guesses Indian endings first for an Indian company", () => {
    const g = domainGuesses("Glowyug Skincare Pvt Ltd", "India");
    expect(g[0]).toBe("glowyugskincare.in");
    expect(g).toContain("glowyug.in");
    expect(g).toContain("glowyug.com");
    expect(domainGuesses("Acme Corp", "USA")[0]).toBe("acme.com");
  });
});

describe("groundedResearch end to end (Gemini answer simulated)", () => {
  it("returns the write-up with real source links (Google's redirect links followed)", async () => {
    const { vi } = await import("vitest");
    const { groundedResearch } = await import("@/lib/sales/search");
    const old = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-key";
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).includes("grounding-api-redirect")) return new Response(null, { status: 302, headers: { location: "https://glowyug.in/about" } });
      expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
      expect(JSON.parse(String(init?.body)).tools).toEqual([{ google_search: {} }]);
      return new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text: "Founded 2021 by Riya Shah (glowyug.in)." }] },
          groundingMetadata: { webSearchQueries: ["glowyug founder"], groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x", title: "glowyug.in" } }], groundingSupports: [{ segment: { text: "Founded 2021 by Riya Shah" }, groundingChunkIndices: [0] }] },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    try {
      const g = await groundedResearch("Research Glowyug");
      expect(g.text).toMatch(/Riya Shah/);
      expect(g.sources).toEqual([{ title: "glowyug.in", url: "https://glowyug.in/about", snippet: "Founded 2021 by Riya Shah" }]);
      expect(g.queries).toEqual(["glowyug founder"]);
      expect(calls[0]).toContain("gemini-2.5-flash:generateContent");
    } finally {
      vi.unstubAllGlobals();
      if (old === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = old;
    }
  });
});
