/**
 * Web search and page reading, free tiers only. Providers are tried in order of what keys you set:
 *   Tavily (1,000 searches/month free), Serper (2,500 free), Brave (free plan), then keyless DuckDuckGo HTML.
 * A daily cap (Sales settings) protects the free quotas.
 */
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
    "duckduckgo",
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

async function logSearch(provider: string, query: string, hits: number, label?: string, error?: string): Promise<void> {
  await q("insert into sales_search_log (provider, query, hits, label, error) values ($1,$2,$3,$4,$5)", [provider, query.slice(0, 400), hits, label ?? null, error?.slice(0, 200) ?? null]).catch(() => {});
}

/** One search. Counts against the daily cap except for the keyless fallback. `label` says who asked (shown on Radar > Plan). */
export async function webSearch(query: string, n = 8, label?: string): Promise<SearchHit[]> {
  const cfg = await salesConfig();
  const paidLeft = (await used()) < cfg.radar.search_daily_cap;
  const chain: [string, (q: string, n: number) => Promise<SearchHit[]>][] = [];
  if (paidLeft && process.env.TAVILY_API_KEY) chain.push(["tavily", tavily]);
  if (paidLeft && process.env.SERPER_API_KEY) chain.push(["serper", serper]);
  if (paidLeft && process.env.BRAVE_API_KEY) chain.push(["brave", brave]);
  chain.push(["duckduckgo", duckduckgo]);
  let last: Error | null = null;
  for (const [name, fn] of chain) {
    try {
      const hits = await fn(query, n);
      if (name !== "duckduckgo") await count(name);
      await logSearch(name, query, hits.length, label);
      if (hits.length || name === "duckduckgo") return hits;
    } catch (e) {
      last = e as Error;
      await logSearch(name, query, 0, label, last.message);
    }
  }
  if (last) console.warn("[search] all providers failed:", last.message);
  return [];
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
