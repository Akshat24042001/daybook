/**
 * Fetching radar sources that block cloud servers.
 *
 * Reddit refuses most requests from cloud servers such as Vercel (403) and rate-limits the rest (429). So a subreddit
 * is read through the first route that works:
 *   1. Reddit's API with an app key (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET), when set
 *   2. Reddit's JSON, with the identifying user agent Reddit asks for
 *   3. old.reddit.com's RSS
 *   4. PullPush, a free public Reddit archive that works from servers
 *   5. the Jina reader as a relay (JINA_API_KEY), which fetches from its own servers
 * After a 429 Reddit is left alone for a while instead of being asked again and again. Other feeds and APIs that
 * answer 403 or 429 get one more try through the Jina relay.
 */
import { fetchFeed } from "./search";

export interface FeedItem { title: string; url: string | null; body: string; author?: string | null; posted_at?: string | Date | null }

const UA_REDDIT = "web:daybook-radar:1.2 (lead finder; contact via the site)";
const cool = ((globalThis as unknown as { __redditCool?: { until: number } }).__redditCool ??= { until: 0 });

class HttpError extends Error {
  constructor(public status: number, host: string, public retryAfter: number | null = null) { super(`${host} ${status}`); }
}

async function get(url: string, accept: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA_REDDIT, accept, ...headers }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new HttpError(res.status, new URL(url).hostname, Number(res.headers.get("retry-after")) || null);
  return res.text();
}

/** Through the Jina reader: it fetches the page from its own servers and hands the text back. */
export async function viaJina(url: string): Promise<string> {
  const key = process.env.JINA_API_KEY?.trim();
  if (!key) throw new Error("no JINA_API_KEY for the relay");
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { authorization: `Bearer ${key}`, accept: "text/plain", "x-return-format": "html", "x-no-cache": "true" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`relay ${res.status}`);
  return res.text();
}

/** Pulls posts out of Reddit's listing JSON. Pure. */
export function parseRedditJson(text: string): FeedItem[] {
  const start = text.indexOf("{");
  if (start < 0) return [];
  const j = JSON.parse(text.slice(start, text.lastIndexOf("}") + 1)) as { data?: { children?: { data: { title: string; selftext?: string; permalink: string; author: string; created_utc: number; link_flair_text?: string } }[] } };
  return (j.data?.children ?? []).map(({ data: p }) => ({
    title: `${p.link_flair_text ? `[${p.link_flair_text}] ` : ""}${p.title}`, url: `https://www.reddit.com${p.permalink}`,
    body: (p.selftext ?? "").slice(0, 3000), author: `u/${p.author}`, posted_at: new Date(p.created_utc * 1000),
  }));
}

/** Pulls posts out of a PullPush answer. Pure. */
export function parsePullPush(text: string): FeedItem[] {
  const j = JSON.parse(text) as { data?: { title: string; selftext?: string; permalink?: string; id: string; subreddit: string; author: string; created_utc: number; link_flair_text?: string }[] };
  return (j.data ?? []).map((p) => ({
    title: `${p.link_flair_text ? `[${p.link_flair_text}] ` : ""}${p.title}`,
    url: `https://www.reddit.com${p.permalink ?? `/r/${p.subreddit}/comments/${p.id}/`}`,
    body: (p.selftext ?? "").replace(/^\[removed\]$|^\[deleted\]$/, "").slice(0, 3000), author: `u/${p.author}`, posted_at: new Date(p.created_utc * 1000),
  }));
}

/** The words of a search like `(hire OR "looking for") developer` as one test. Pure. */
export function queryTest(q: string | null): (text: string) => boolean {
  if (!q) return () => true;
  const words = [...q.matchAll(/"([^"]+)"|([a-z0-9.+#-]{3,})/gi)].map((m) => (m[1] ?? m[2]).toLowerCase()).filter((w) => !["and", "not"].includes(w) && w !== "or");
  if (!words.length) return () => true;
  return (text) => {
    const t = text.toLowerCase();
    return words.some((w) => t.includes(w));
  };
}

export interface RedditRead { items: FeedItem[]; route: string; tried: string[] }

/** A subreddit's newest posts (optionally matching a search), through the first route that works. */
export async function readSubreddit(sub: string, query: string | null, token: string | null): Promise<RedditRead> {
  const tried: string[] = [];
  const matches = queryTest(query);
  const keep = (items: FeedItem[]) => items.filter((i) => matches(`${i.title}\n${i.body}`));
  const q = query ? encodeURIComponent(query) : "";
  const listing = query ? `/r/${sub}/search.json?q=${q}&restrict_sr=1&sort=new&t=week&limit=25&raw_json=1` : `/r/${sub}/new.json?limit=25&raw_json=1`;

  if (token) {
    try {
      return { items: parseRedditJson(await get(`https://oauth.reddit.com${listing.replace(".json", "")}`, "application/json", { authorization: `Bearer ${token}` })), route: "Reddit API", tried };
    } catch (e) { tried.push(`API: ${(e as Error).message}`); }
  }
  if (Date.now() > cool.until) {
    try {
      return { items: parseRedditJson(await get(`https://www.reddit.com${listing}`, "application/json")), route: "Reddit JSON", tried };
    } catch (e) {
      tried.push(`JSON: ${(e as Error).message}`);
      if (e instanceof HttpError && e.status === 429) cool.until = Date.now() + Math.max(10 * 60_000, (e.retryAfter ?? 0) * 1000);
    }
    if (Date.now() > cool.until) {
      try {
        const rss = query ? `https://old.reddit.com/r/${sub}/search.rss?q=${q}&restrict_sr=1&sort=new&t=week` : `https://old.reddit.com/r/${sub}/new.rss`;
        const items = (await fetchFeed(rss)).map((x) => ({ title: x.title, url: x.url, body: x.body, author: x.author, posted_at: x.date }));
        return { items, route: "Reddit RSS", tried };
      } catch (e) {
        tried.push(`RSS: ${(e as Error).message}`);
        if (/\b429\b/.test((e as Error).message)) cool.until = Date.now() + 10 * 60_000;
      }
    }
  } else {
    tried.push("Reddit asked us to slow down: resting");
  }
  try {
    const text = await get(`https://api.pullpush.io/reddit/search/submission/?subreddit=${encodeURIComponent(sub)}&size=40&sort=desc&sort_type=created_utc`, "application/json");
    return { items: keep(parsePullPush(text)), route: "PullPush archive", tried };
  } catch (e) { tried.push(`PullPush: ${(e as Error).message}`); }
  try {
    return { items: keep(parseRedditJson(await viaJina(`https://www.reddit.com/r/${sub}/new.json?limit=25&raw_json=1`))), route: "Jina relay", tried };
  } catch (e) { tried.push(`relay: ${(e as Error).message}`); }
  throw new Error(`Reddit blocks cloud servers; every route failed (${tried.join("; ")})`);
}

/** A feed, and on 403 or 429 the same feed through the Jina relay. */
export async function feedWithRelay(url: string): Promise<{ title: string; url: string; body: string; date: string | null; author: string | null }[]> {
  try {
    return await fetchFeed(url);
  } catch (e) {
    if (!/\b(403|429|451)\b/.test((e as Error).message) || !process.env.JINA_API_KEY) throw e;
    const text = await viaJina(url);
    if (!/<item[\s>]|<entry[\s>]/i.test(text)) throw e;
    const { parseFeed } = await import("./search");
    return parseFeed(text);
  }
}

/** JSON, and on 403 or 429 the same through the Jina relay. */
export async function jsonWithRelay<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { "user-agent": UA_REDDIT, accept: "application/json", ...headers }, signal: AbortSignal.timeout(15_000) });
  if (res.ok) return (await res.json()) as T;
  const err = new Error(`${new URL(url).hostname} ${res.status}`);
  if (![403, 429, 451].includes(res.status) || !process.env.JINA_API_KEY) throw err;
  const text = await viaJina(url);
  const s = text.indexOf("{") >= 0 && (text.indexOf("[") < 0 || text.indexOf("{") < text.indexOf("[")) ? text.indexOf("{") : text.indexOf("[");
  if (s < 0) throw err;
  return JSON.parse(text.slice(s)) as T;
}

// ------------------------------------------------------------------ Discourse forums (n8n, Make, Bubble, ...)

/** Topics from a Discourse forum's search, newest first. Pure. */
export function parseDiscourse(base: string, j: { topics?: { id: number; title: string; slug: string; created_at?: string; category_id?: number }[]; posts?: { topic_id: number; blurb?: string; username?: string; created_at?: string }[] }): FeedItem[] {
  const posts = new Map((j.posts ?? []).map((p) => [p.topic_id, p]));
  return (j.topics ?? []).map((t) => {
    const p = posts.get(t.id);
    return { title: t.title, url: `${base.replace(/\/$/, "")}/t/${t.slug}/${t.id}`, body: (p?.blurb ?? "").replace(/\s+/g, " ").slice(0, 2000), author: p?.username ?? null, posted_at: t.created_at ?? p?.created_at ?? null };
  });
}

/** A Discourse forum: each search, newest first, merged. */
export async function readDiscourse(base: string, queries: string[]): Promise<FeedItem[]> {
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  let lastErr: Error | null = null;
  for (const q of queries.slice(0, 4)) {
    try {
      const j = await jsonWithRelay<Parameters<typeof parseDiscourse>[1]>(`${base.replace(/\/$/, "")}/search.json?q=${encodeURIComponent(`${q} order:latest`)}`);
      for (const it of parseDiscourse(base, j)) if (it.url && !seen.has(it.url)) { seen.add(it.url); out.push(it); }
    } catch (e) { lastErr = e as Error; }
  }
  if (!out.length && lastErr) throw lastErr;
  return out;
}

/** Turns a raw fetch error into a plain reason for the Sources tab. Pure. */
export function plainSourceError(msg: string): string {
  if (/Reddit blocks cloud servers/.test(msg)) return msg;
  if (/\b429\b/.test(msg)) return `Too many requests (429): the site asked us to slow down; it is tried again later. ${msg}`;
  if (/\b403\b/.test(msg)) return `Refused (403): the site blocks requests from cloud servers. ${msg}`;
  if (/\b404\b/.test(msg)) return `Not found (404): the feed moved or no longer exists. ${msg}`;
  if (/timeout|aborted/i.test(msg)) return `No answer in time: the site is slow or down. ${msg}`;
  return msg;
}
