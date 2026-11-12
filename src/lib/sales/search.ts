/**
 * Web search and page reading, free tiers only. Providers are tried in order of what keys you set:
 *   Tavily (1,000 searches/month free), Serper (2,500 free), Brave (free plan), Jina (free key),
 *   then the keyless ones: Bing (RSS), DuckDuckGo (HTML and lite) and Mojeek.
 * Keyless engines often refuse cloud servers, so a refusal is reported as an error (never as "no results"), and
 * research asks all of them at once and merges what comes back ("wide"). With a free Gemini key, Google Search
 * itself is available through Gemini's grounding, used for deep research and as the last resort here.
 * A daily cap (Sales settings) protects the free quotas.
 */
import { NO_DASH_RULE, noDashes } from "../text/no-dashes";
import { one, q } from "../db";
import { salesConfig } from "./config";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  date?: string | null;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

async function used(): Promise<number> {
  const r = await one<{ n: number }>("select count(*)::int as n from sales_jobs where kind = '_search' and created_at > now() - interval '24 hours'");
  return r?.n ?? 0;
}

async function count(provider: string): Promise<void> {
  await q("insert into sales_jobs (kind, payload, status, done_at) values ('_search', $1, 'done', now())", [JSON.stringify({ provider })]);
}

export function searchConfigured(): string[] {
  return [
    process.env.TAVILY_API_KEY ? "tavily" : null,
    process.env.SERPER_API_KEY ? "serper" : null,
    process.env.BRAVE_API_KEY ? "brave" : null,
    process.env.JINA_API_KEY ? "jina" : null,
    process.env.GEMINI_API_KEY ? "google (via Gemini)" : null,
    "bing", "duckduckgo", "mojeek",
  ].filter((x): x is string => !!x);
}

async function tavily(query: string, n: number): Promise<SearchHit[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query, max_results: n, search_depth: "basic" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`tavily ${res.status}`);
  const j = (await res.json()) as { results?: { title: string; url: string; content: string; published_date?: string }[] };
  return (j.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content, date: r.published_date ?? null }));
}

async function serper(query: string, n: number): Promise<SearchHit[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "content-type": "application/json", "X-API-KEY": process.env.SERPER_API_KEY! },
    body: JSON.stringify({ q: query, num: n }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`serper ${res.status}`);
  const j = (await res.json()) as { organic?: { title: string; link: string; snippet: string; date?: string }[] };
  return (j.organic ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet ?? "", date: r.date ?? null }));
}

async function brave(query: string, n: number): Promise<SearchHit[]> {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${n}`, {
    headers: { accept: "application/json", "X-Subscription-Token": process.env.BRAVE_API_KEY! },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`brave ${res.status}`);
  const j = (await res.json()) as { web?: { results?: { title: string; url: string; description: string; age?: string }[] } };
  return (j.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: (r.description ?? "").replace(/<[^>]+>/g, ""), date: r.age ?? null }));
}

async function duckduckgo(query: string, n: number): Promise<SearchHit[]> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`duckduckgo ${res.status}`);
  const html = await res.text();
  if (/anomaly-modal|bots use DuckDuckGo too|challenge-form/i.test(html)) throw new Error("duckduckgo refused this server (bot check)");
  return parseDuckDuckGo(html, n);
}

/** Pure: results from DuckDuckGo's HTML page. */
export function parseDuckDuckGo(html: string, n: number): SearchHit[] {
  const out: SearchHit[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < n) {
    let url = m[1];
    const u = url.match(/uddg=([^&]+)/);
    if (u) url = decodeURIComponent(u[1]);
    out.push({ url, title: strip(m[2]), snippet: strip(m[3]) });
  }
  return out;
}

async function duckduckgoLite(query: string, n: number): Promise<SearchHit[]> {
  const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`duckduckgo lite ${res.status}`);
  const html = await res.text();
  if (/anomaly-modal|bots use DuckDuckGo too|challenge-form/i.test(html)) throw new Error("duckduckgo lite refused this server (bot check)");
  return parseDuckDuckGoLite(html, n);
}

/** Pure: results from DuckDuckGo's lite page (a table: link row, then snippet row). */
export function parseDuckDuckGoLite(html: string, n: number): SearchHit[] {
  const out: SearchHit[] = [];
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>|<a[^>]+class=['"]result-link['"][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const snippets = [...html.matchAll(/<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi)].map((m) => strip(m[1]));
  links.forEach((m, i) => {
    if (out.length >= n) return;
    let url = m[1] ?? m[3];
    const u = url.match(/uddg=([^&]+)/);
    if (u) url = decodeURIComponent(u[1]);
    if (!/^https?:/i.test(url)) return;
    out.push({ url, title: strip(m[2] ?? m[4] ?? ""), snippet: snippets[i] ?? "" });
  });
  return out;
}

async function bing(query: string, n: number): Promise<SearchHit[]> {
  const res = await fetch(`https://www.bing.com/search?format=rss&count=${Math.min(n * 2, 30)}&q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": UA, accept: "application/rss+xml,text/xml" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`bing ${res.status}`);
  const xml = await res.text();
  if (!/<rss|<channel/i.test(xml)) throw new Error("bing refused this server (no feed returned)");
  return parseBingRss(xml, n);
}

/** Pure: results from Bing's RSS output. */
export function parseBingRss(xml: string, n: number): SearchHit[] {
  const tag = (s: string, t: string) => (s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i"))?.[1] ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  return xml.split(/<item>/i).slice(1).map((it) => ({
    title: strip(tag(it, "title")), url: strip(tag(it, "link")), snippet: strip(tag(it, "description")), date: tag(it, "pubDate") || null,
  })).filter((h) => /^https?:/i.test(h.url)).slice(0, n);
}

async function mojeek(query: string, n: number): Promise<SearchHit[]> {
  const res = await fetch(`https://www.mojeek.com/search?q=${encodeURIComponent(query)}`, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`mojeek ${res.status}`);
  return parseMojeek(await res.text(), n);
}

/** Pure: results from Mojeek's results page. */
export function parseMojeek(html: string, n: number): SearchHit[] {
  const out: SearchHit[] = [];
  for (const block of html.split(/<li[^>]*>/i).slice(1)) {
    const a = block.match(/<a[^>]+class=["'][^"']*\btitle\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>|<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = a[1] ?? a[3];
    if (!/^https?:/i.test(url)) continue;
    out.push({ url, title: strip(a[2] ?? a[4] ?? ""), snippet: strip(block.match(/<p[^>]+class=["']s["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "") });
    if (out.length >= n) break;
  }
  return out;
}

async function jina(query: string, n: number): Promise<SearchHit[]> {
  const res = await fetch(`https://s.jina.ai/?q=${encodeURIComponent(query)}`, {
    headers: { accept: "application/json", authorization: `Bearer ${process.env.JINA_API_KEY}`, "X-Respond-With": "no-content" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`jina ${res.status}`);
  const j = (await res.json()) as { data?: { title: string; url: string; description?: string; content?: string; date?: string }[] };
  return (j.data ?? []).slice(0, n).map((r) => ({ title: r.title, url: r.url, snippet: (r.description || r.content || "").slice(0, 400), date: r.date ?? null }));
}

// ------------------------------------------------------------------ Google Search through Gemini (free key)

export interface Grounded {
  text: string;
  sources: { title: string; url: string; snippet: string }[];
  queries: string[];
}

// the free tier allows only a handful of requests a minute: calls wait their turn instead of failing
const gq = globalThis as unknown as { __geminiGround?: number[] };
async function geminiTurn(maxPerMin = 8): Promise<void> {
  const list = (gq.__geminiGround ??= []);
  for (let i = 0; i < 30; i++) {
    const now = Date.now();
    while (list.length && now - list[0] > 60_000) list.shift();
    if (list.length < maxPerMin) {
      list.push(now);
      return;
    }
    await new Promise((r) => setTimeout(r, Math.min(5_000, 60_000 - (now - list[0]) + 50)));
  }
  throw new Error("Gemini search is busy; try again in a minute");
}

/** Where a grounding link really points (Google hands out redirect links). */
async function realUrl(u: string): Promise<string> {
  if (!/grounding-api-redirect|vertexaisearch/.test(u)) return u;
  try {
    const res = await fetch(u, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(6_000) });
    return res.headers.get("location") ?? u;
  } catch {
    return u;
  }
}

/** Pure: the answer, its sources and the searches Google ran, from a Gemini grounded response. */
export function parseGrounded(j: unknown): { text: string; chunks: { title: string; uri: string; snippet: string }[]; queries: string[] } {
  const c = (j as { candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: Record<string, unknown> }[] })?.candidates?.[0];
  const text = (c?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  const gm = (c?.groundingMetadata ?? {}) as {
    groundingChunks?: { web?: { uri?: string; title?: string } }[];
    groundingSupports?: { segment?: { text?: string }; groundingChunkIndices?: number[] }[];
    webSearchQueries?: string[];
  };
  const chunks = (gm.groundingChunks ?? []).map((g) => ({ title: g.web?.title ?? "", uri: g.web?.uri ?? "", snippet: "" }));
  for (const s of gm.groundingSupports ?? []) {
    for (const i of s.groundingChunkIndices ?? []) {
      const ch = chunks[i];
      if (ch && s.segment?.text && ch.snippet.length < 600) ch.snippet = `${ch.snippet} ${s.segment.text}`.trim();
    }
  }
  return { text, chunks: chunks.filter((x) => x.uri), queries: gm.webSearchQueries ?? [] };
}

export function geminiSearchReady(): boolean {
  return !!process.env.GEMINI_API_KEY?.trim();
}

/** Asks Gemini to research with Google Search and report what it found. Free tier; waits for a free slot. */
export async function groundedResearch(prompt: string, o: { timeoutMs?: number; label?: string } = {}): Promise<Grounded> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("No GEMINI_API_KEY: Google search through Gemini is off");
  const models = (process.env.GEMINI_SEARCH_MODELS ?? "gemini-2.5-flash,gemini-2.0-flash").split(",").map((m) => m.trim()).filter(Boolean);
  let last: Error | null = null;
  for (const model of models) {
    try {
      await geminiTurn();
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${prompt}\n\n${NO_DASH_RULE}` }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.2, maxOutputTokens: 4096 } }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 45_000),
      });
      if (!res.ok) throw new Error(`${model} ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const g = parseGrounded(await res.json());
      const urls = await Promise.all(g.chunks.slice(0, 20).map((ch) => realUrl(ch.uri)));
      const out: Grounded = { text: noDashes(g.text), sources: g.chunks.slice(0, 20).map((ch, i) => ({ title: ch.title, url: urls[i], snippet: ch.snippet })), queries: g.queries };
      await logSearch("google (gemini)", g.queries.join(" | ") || prompt.slice(0, 200), out.sources.length, o.label);
      return out;
    } catch (e) {
      last = e as Error;
      await logSearch("google (gemini)", prompt.slice(0, 200), 0, o.label, last.message);
    }
  }
  throw last ?? new Error("Gemini search failed");
}

async function geminiSearch(query: string, n: number): Promise<SearchHit[]> {
  const g = await groundedResearch(`Search the web for: ${query}\nList the most relevant pages you found, one line each with what it says.`, { timeoutMs: 30_000 });
  return g.sources.slice(0, n).map((s) => ({ title: s.title, url: s.url, snippet: s.snippet }));
}

const normUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

/** Pure: several result lists into one, each page once, in the order they first appeared (round robin). */
export function mergeHits(lists: SearchHit[][], n: number): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (let i = 0; out.length < n && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const h = l[i];
      if (!h || out.length >= n) continue;
      const k = normUrl(h.url);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(h);
    }
  }
  return out;
}

async function logSearch(provider: string, query: string, hits: number, label?: string, error?: string): Promise<void> {
  await q("insert into sales_search_log (provider, query, hits, label, error) values ($1,$2,$3,$4,$5)", [provider, query.slice(0, 400), hits, label ?? null, error?.slice(0, 200) ?? null]).catch(() => {});
}

const KEYLESS: [string, (q: string, n: number) => Promise<SearchHit[]>][] = [["bing", bing], ["duckduckgo", duckduckgo], ["duckduckgo lite", duckduckgoLite], ["mojeek", mojeek]];

/**
 * One search. Paid tiers count against the daily cap; keyless engines do not. `label` says who asked (Radar > Plan).
 * wide: research mode. The keyless engines are all asked at once and their results merged, so one engine refusing
 * this server does not leave the research empty. Google (through Gemini) is the last resort when all come back empty.
 */
export async function webSearch(query: string, n = 8, label?: string, o: { wide?: boolean } = {}): Promise<SearchHit[]> {
  const cfg = await salesConfig();
  const paidLeft = (await used()) < cfg.radar.search_daily_cap;
  const paid: [string, (q: string, n: number) => Promise<SearchHit[]>][] = [];
  if (paidLeft && process.env.TAVILY_API_KEY) paid.push(["tavily", tavily]);
  if (paidLeft && process.env.SERPER_API_KEY) paid.push(["serper", serper]);
  if (paidLeft && process.env.BRAVE_API_KEY) paid.push(["brave", brave]);
  if (process.env.JINA_API_KEY) paid.push(["jina", jina]);
  const attempt = async (name: string, fn: (q: string, n: number) => Promise<SearchHit[]>): Promise<SearchHit[]> => {
    try {
      const hits = await fn(query, n);
      if (["tavily", "serper", "brave"].includes(name)) await count(name);
      await logSearch(name, query, hits.length, label);
      return hits;
    } catch (e) {
      await logSearch(name, query, 0, label, (e as Error).message);
      return [];
    }
  };
  let best: SearchHit[] = [];
  for (const [name, fn] of paid) {
    best = await attempt(name, fn);
    if (best.length) break;
  }
  if (o.wide) {
    const lists = await Promise.all(KEYLESS.map(([name, fn]) => attempt(name, fn)));
    best = mergeHits([best, ...lists], o.wide ? n * 2 : n);
  } else if (!best.length) {
    for (const [name, fn] of KEYLESS) {
      best = await attempt(name, fn);
      if (best.length) break;
    }
  }
  if (!best.length && geminiSearchReady()) best = await geminiSearch(query, n).catch(() => []);
  if (!best.length) console.warn("[search] nothing from any engine for:", query.slice(0, 80));
  return best;
}

export function strip(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

export interface Page {
  url: string;
  status: number;
  html: string;
  text: string;
  title: string;
}

/** Fetches a page directly; falls back to the free Jina reader for sites that only render with JavaScript. */
export async function fetchPage(url: string, o: { maxChars?: number; reader?: boolean } = {}): Promise<Page | null> {
  const max = o.maxChars ?? 8000;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(12_000) });
    const html = (await res.text()).slice(0, 600_000);
    const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const text = strip(html);
    if (res.ok && text.length > 400) return { url: res.url || url, status: res.status, html, text: text.slice(0, max), title };
    if (o.reader === false) return res.ok ? { url, status: res.status, html, text: text.slice(0, max), title } : null;
  } catch {
    if (o.reader === false) return null;
  }
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { accept: "text/plain", ...(process.env.JINA_API_KEY ? { authorization: `Bearer ${process.env.JINA_API_KEY}` } : {}) },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const text = (await res.text()).replace(/\s+/g, " ").trim();
    return { url, status: res.status, html: "", text: text.slice(0, max), title: text.match(/Title:\s*(.+?)\s+URL/)?.[1] ?? "" };
  } catch {
    return null;
  }
}

/** Reads an RSS or Atom feed. */
export async function fetchFeed(url: string): Promise<{ title: string; url: string; body: string; date: string | null; author: string | null }[]> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/rss+xml,application/atom+xml,text/xml" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  const xml = await res.text();
  const items = xml.split(/<item[\s>]|<entry[\s>]/i).slice(1);
  const tag = (s: string, t: string) => {
    const m = s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i"));
    return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : "";
  };
  return items.slice(0, 50).map((it) => {
    const link = tag(it, "link") || it.match(/<link[^>]+href="([^"]+)"/i)?.[1] || tag(it, "guid");
    return {
      title: strip(tag(it, "title")),
      url: strip(link),
      body: strip(tag(it, "description") || tag(it, "content:encoded") || tag(it, "summary") || tag(it, "content")).slice(0, 3000),
      date: tag(it, "pubDate") || tag(it, "updated") || tag(it, "published") || null,
      author: strip(tag(it, "dc:creator") || tag(it, "author")) || null,
    };
  });
}
