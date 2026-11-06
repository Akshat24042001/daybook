/**
 * The lead radar: crawls the catalogue, scores every item against your offers with AI, alerts on hot ones within minutes,
 * and guarantees at least `daily_min` qualified opportunities a day: when the feeds are dry it hunts with intent-signal
 * searches for this week's country and today's industry, and if even that comes up short it says so honestly and shows
 * the best of what it found.
 */
import { createHash } from "node:crypto";
import { one, q } from "../db";
import { esc } from "../telegram/api";
import { focusFor, salesConfig, type SalesConfig } from "./config";
import { createDeal } from "./deals";
import { ensureCompany, upsertPerson } from "./identity";
import { enqueue } from "./jobs";
import { baseUrl } from "./links";
import { llmJson } from "./llm";
import { push } from "./notify";
import { CATALOG, type CatalogSource } from "./radar-catalog";
import { fetchFeed, strip, webSearch } from "./search";

const UA = "Mozilla/5.0 (compatible; DaybookRadar/1.0)";

interface SourceRow {
  id: number;
  key: string;
  name: string;
  kind: string;
  category: string;
  config: Record<string, unknown>;
  enabled: boolean;
  interval_hours: number;
  last_run_at: string | null;
}

export interface RawItem {
  title: string;
  url: string | null;
  body: string;
  author?: string | null;
  posted_at?: string | Date | null;
}

/** Keeps the database catalogue in step with the code. Your on/off switches and stats are never touched. */
export async function syncCatalog(db: { query: (sql: string, params?: unknown[]) => Promise<unknown> }): Promise<void> {
  for (const s of CATALOG) {
    await db.query(
      `insert into sales_radar_sources (key, name, kind, category, config, enabled, interval_hours, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (key) do update set name = excluded.name, kind = excluded.kind, category = excluded.category,
         config = excluded.config, interval_hours = excluded.interval_hours, note = excluded.note
       where sales_radar_sources.managed`,
      [s.key, s.name, s.kind, s.category, JSON.stringify(s.config), s.enabled ?? true, s.interval_hours, s.note ?? null],
    );
  }
}

function fill(template: string, focus: { country: string; industry: string }): string {
  return template.replace(/\{country\}/g, focus.country).replace(/\{industry\}/g, focus.industry).replace(/\{year\}/g, String(new Date().getUTCFullYear()));
}

const GNEWS_ED: Record<string, string> = {
  "United States": "hl=en-US&gl=US&ceid=US:en", "United Kingdom": "hl=en-GB&gl=GB&ceid=GB:en", Canada: "hl=en-CA&gl=CA&ceid=CA:en",
  Australia: "hl=en-AU&gl=AU&ceid=AU:en", Singapore: "hl=en-SG&gl=SG&ceid=SG:en", India: "hl=en-IN&gl=IN&ceid=IN:en",
};
const ADZUNA_CC: Record<string, string> = {
  "United States": "us", "United Kingdom": "gb", Canada: "ca", Australia: "au", Singapore: "sg", Germany: "de", Netherlands: "nl", India: "in",
};

let redditToken: { token: string; exp: number } | null = null;
async function redditAuth(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (redditToken && redditToken.exp > Date.now() + 60_000) return redditToken.token;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded", "user-agent": "daybook-radar/1.0" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) return null;
  redditToken = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return redditToken.token;
}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json", ...headers }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return (await res.json()) as T;
}

const DEV_RE = /\b(ai|a\.i\.|automation|automate|developer|engineer|app|software|full.?stack|react|node|python|n8n|zapier|make\.com|chatbot|agent|llm|gpt|vision|website|web|mobile|ios|android|flutter|integration|crm|data entry|support|operations|backend|frontend|saas|mvp)\b/i;

async function fetchSource(s: SourceRow, focus: { country: string; industry: string }): Promise<RawItem[]> {
  const c = s.config;
  switch (s.kind) {
    case "reddit": {
      const sub = String(c.sub);
      const query = c.q ? fill(String(c.q), focus) : null;
      const token = await redditAuth();
      let items: RawItem[];
      if (token) {
        const path = query ? `/r/${sub}/search?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&t=week&limit=25` : `/r/${sub}/new?limit=25`;
        const j = await getJson<{ data: { children: { data: { title: string; selftext: string; permalink: string; author: string; created_utc: number; link_flair_text?: string } }[] } }>(
          `https://oauth.reddit.com${path}`, { authorization: `Bearer ${token}`, "user-agent": "daybook-radar/1.0" },
        );
        items = j.data.children.map(({ data: p }) => ({ title: `${p.link_flair_text ? `[${p.link_flair_text}] ` : ""}${p.title}`, url: `https://www.reddit.com${p.permalink}`, body: p.selftext.slice(0, 3000), author: `u/${p.author}`, posted_at: new Date(p.created_utc * 1000) }));
      } else {
        const url = query ? `https://www.reddit.com/r/${sub}/search.rss?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&t=week` : `https://www.reddit.com/r/${sub}/new.rss`;
        items = (await fetchFeed(url)).map((x) => ({ title: x.title, url: x.url, body: x.body, author: x.author, posted_at: x.date }));
      }
      // people offering their services are not leads
      return items.filter((i) => !/\[\s*for\s*hire\s*\]|\bfor hire\b|\[offer\]/i.test(i.title));
    }
    case "hn": {
      const since = Math.floor(Date.now() / 1000) - 3 * 86_400;
      const j = await getJson<{ hits: { objectID: string; title?: string; story_title?: string; comment_text?: string; story_text?: string; author: string; created_at: string }[] }>(
        `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(String(c.q ?? ""))}&tags=${encodeURIComponent(String(c.tags ?? "story"))}&numericFilters=created_at_i>${since}&hitsPerPage=30`,
      );
      return j.hits.map((h) => ({ title: (h.title ?? h.story_title ?? "HN comment").slice(0, 200), url: `https://news.ycombinator.com/item?id=${h.objectID}`, body: strip(h.comment_text ?? h.story_text ?? "").slice(0, 3000), author: h.author, posted_at: h.created_at }));
    }
    case "hn_freelancer": {
      const s1 = await getJson<{ hits: { objectID: string }[] }>(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent("Freelancer? Seeking freelancer?")}&tags=story,author_whoishiring&hitsPerPage=1`);
      const id = s1.hits[0]?.objectID;
      if (!id) return [];
      const thread = await getJson<{ children: { id: number; text: string | null; author: string; created_at: string }[] }>(`https://hn.algolia.com/api/v1/items/${id}`);
      return thread.children
        .filter((k) => k.text && /seeking\s+freelancer/i.test(k.text))
        .slice(0, 60)
        .map((k) => ({ title: strip(k.text!).slice(0, 120), url: `https://news.ycombinator.com/item?id=${k.id}`, body: strip(k.text!).slice(0, 3000), author: k.author, posted_at: k.created_at }));
    }
    case "rss":
      return (await fetchFeed(fill(String(c.url), focus))).map((x) => ({ title: x.title, url: x.url, body: x.body, author: x.author, posted_at: x.date }));
    case "gnews": {
      const ed = GNEWS_ED[focus.country] ?? GNEWS_ED["United States"];
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${fill(String(c.q), focus)} when:3d`)}&${ed}`;
      return (await fetchFeed(url)).slice(0, 20).map((x) => ({ title: x.title, url: x.url, body: x.body, author: x.author, posted_at: x.date }));
    }
    case "search": {
      const hits = await webSearch(fill(String(c.q), focus), 8);
      return hits.map((h) => ({ title: h.title, url: h.url, body: h.snippet, posted_at: h.date ?? null }));
    }
    case "json":
      return fetchApi(String(c.api), c, focus);
    default:
      return [];
  }
}

async function fetchApi(api: string, c: Record<string, unknown>, focus: { country: string; industry: string }): Promise<RawItem[]> {
  switch (api) {
    case "remoteok": {
      const j = await getJson<{ position?: string; company?: string; description?: string; url?: string; date?: string; tags?: string[] }[]>("https://remoteok.com/api");
      return j.filter((x) => x.position && x.url && DEV_RE.test(`${x.position} ${(x.tags ?? []).join(" ")}`)).slice(0, 40)
        .map((x) => ({ title: `${x.position} at ${x.company}`, url: x.url!, body: strip(x.description ?? "").slice(0, 2500), author: x.company, posted_at: x.date }));
    }
    case "remotive": {
      const j = await getJson<{ jobs: { title: string; company_name: string; url: string; description: string; publication_date: string; job_type: string; candidate_required_location: string }[] }>("https://remotive.com/api/remote-jobs?category=software-dev&limit=60");
      return j.jobs.filter((x) => /contract|freelance|part/i.test(x.job_type) || /\b(ai|automation|agent)\b/i.test(x.title))
        .map((x) => ({ title: `${x.title} at ${x.company_name} (${x.job_type}, ${x.candidate_required_location})`, url: x.url, body: strip(x.description).slice(0, 2500), author: x.company_name, posted_at: x.publication_date }));
    }
    case "arbeitnow": {
      const j = await getJson<{ data: { title: string; company_name: string; url: string; description: string; created_at: number; location: string }[] }>("https://www.arbeitnow.com/api/job-board-api");
      return j.data.filter((x) => DEV_RE.test(x.title)).slice(0, 40)
        .map((x) => ({ title: `${x.title} at ${x.company_name} (${x.location})`, url: x.url, body: strip(x.description).slice(0, 2500), author: x.company_name, posted_at: new Date(x.created_at * 1000) }));
    }
    case "jobicy": {
      const j = await getJson<{ jobs: { jobTitle: string; companyName: string; url: string; jobExcerpt: string; pubDate: string; jobType: string[] | string; jobGeo: string }[] }>("https://jobicy.com/api/v2/remote-jobs?count=50&tag=developer");
      return j.jobs.map((x) => ({ title: `${x.jobTitle} at ${x.companyName} (${Array.isArray(x.jobType) ? x.jobType.join("/") : x.jobType}, ${x.jobGeo})`, url: x.url, body: strip(x.jobExcerpt ?? "").slice(0, 2000), author: x.companyName, posted_at: x.pubDate }));
    }
    case "himalayas": {
      const j = await getJson<{ jobs: { title: string; companyName: string; applicationLink: string; excerpt: string; pubDate: number }[] }>("https://himalayas.app/jobs/api?limit=60");
      return j.jobs.filter((x) => DEV_RE.test(x.title)).map((x) => ({ title: `${x.title} at ${x.companyName}`, url: x.applicationLink, body: strip(x.excerpt ?? "").slice(0, 2000), author: x.companyName, posted_at: new Date(x.pubDate * 1000) }));
    }
    case "freelancer": {
      const j = await getJson<{ result: { projects: { id: number; title: string; seo_url: string; preview_description?: string; description?: string; time_submitted: number; budget?: { minimum?: number; maximum?: number }; currency?: { code?: string } }[] } }>(
        `https://www.freelancer.com/api/projects/0.1/projects/active/?query=${encodeURIComponent(String(c.q ?? "AI automation"))}&limit=30&full_description=true&compact=true`,
      );
      return j.result.projects.map((p) => ({
        title: `${p.title}${p.budget?.maximum ? ` (${p.currency?.code ?? ""} ${p.budget.minimum ?? 0} to ${p.budget.maximum})` : ""}`,
        url: `https://www.freelancer.com/projects/${p.seo_url}`, body: (p.description ?? p.preview_description ?? "").slice(0, 2500), posted_at: new Date(p.time_submitted * 1000),
      }));
    }
    case "adzuna": {
      const id = process.env.ADZUNA_APP_ID;
      const key = process.env.ADZUNA_APP_KEY;
      const cc = ADZUNA_CC[focus.country];
      if (!id || !key || !cc) return [];
      const j = await getJson<{ results: { title: string; company?: { display_name?: string }; redirect_url: string; description: string; created: string; location?: { display_name?: string } }[] }>(
        `https://api.adzuna.com/v1/api/jobs/${cc}/search/1?app_id=${id}&app_key=${key}&results_per_page=20&max_days_old=3&what=${encodeURIComponent(`${String(c.q)} ${focus.industry}`)}&content-type=application/json`,
      );
      return j.results.map((x) => ({ title: `${x.title} at ${x.company?.display_name ?? "?"} (${x.location?.display_name ?? focus.country})`, url: x.redirect_url, body: x.description.slice(0, 2000), author: x.company?.display_name ?? null, posted_at: x.created }));
    }
    default:
      return [];
  }
}

const urlHash = (s: string) => createHash("sha1").update(s.toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "")).digest("hex");

export async function storeItems(sourceId: number | null, items: RawItem[]): Promise<number> {
  let added = 0;
  const weekAgo = Date.now() - 7 * 86_400_000;
  for (const it of items) {
    if (!it.title) continue;
    const posted = it.posted_at ? new Date(it.posted_at) : null;
    if (posted && !Number.isNaN(posted.getTime()) && posted.getTime() < weekAgo) continue;
    const key = it.url ? urlHash(it.url) : urlHash(`${it.title}|${it.body.slice(0, 200)}`);
    const row = await one<{ id: number }>(
      `insert into sales_radar_items (source_id, url, url_hash, title, body, author, posted_at) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (url_hash) do nothing returning id`,
      [sourceId, it.url, key, it.title.slice(0, 400), it.body?.slice(0, 6000) ?? null, it.author ?? null, posted && !Number.isNaN(posted.getTime()) ? posted : null],
    );
    if (row) added += 1;
  }
  if (sourceId && added) await q("update sales_radar_sources set items_found = items_found + $2 where id = $1", [sourceId, added]);
  return added;
}

/** Runs the sources that are due, within a time budget. */
export async function runRadar(budgetMs = 40_000, opts: { force?: boolean; categories?: string[] } = {}): Promise<{ ran: number; added: number }> {
  const cfg = await salesConfig();
  const focus = focusFor(cfg, new Date());
  const due = await q<SourceRow>(
    `select * from sales_radar_sources where enabled and kind <> 'email'
       and ($1 or last_run_at is null or last_run_at < now() - (interval_hours || ' hours')::interval)
       and ($2::text[] is null or category = any($2))
     order by last_run_at nulls first limit 12`,
    [!!opts.force, opts.categories ?? null],
  );
  const deadline = Date.now() + budgetMs;
  let ran = 0;
  let added = 0;
  for (const s of due) {
    if (Date.now() > deadline - 8_000) break;
    await q("update sales_radar_sources set last_run_at = now() where id = $1", [s.id]);
    try {
      const items = await fetchSource(s, focus);
      added += await storeItems(s.id, items);
      await q("update sales_radar_sources set last_ok_at = now(), last_error = null where id = $1", [s.id]);
    } catch (e) {
      await q("update sales_radar_sources set last_error = $2 where id = $1", [s.id, (e as Error).message.slice(0, 300)]);
    }
    ran += 1;
  }
  if (added) await enqueue("radar_qualify", {}, { dedupeKey: "radar_qualify" });
  return { ran, added };
}

interface Verdict {
  i: number;
  score: number;
  buyer: "direct_client" | "agency" | "job_full_time" | "signal" | "candidate" | "spam" | "other";
  country?: string | null;
  industry?: string | null;
  company?: string | null;
  contact?: string | null;
  website?: string | null;
  services?: string[];
  budget?: string | null;
  urgency?: "high" | "medium" | "low";
  why: string;
  angle: string;
  money_leak?: string | null;
}

function qualifySystem(cfg: SalesConfig, focus: { country: string; industry: string }): string {
  return `You qualify sales leads for ${cfg.owner.company}, an AI agency in India run by ${cfg.owner.name}. The goal is to give real value to businesses.
OFFERS: ${cfg.offers.join("; ")}.
THIS WEEK'S FOCUS: ${focus.country}; today's industry: ${focus.industry} (a bonus, not a filter).
Each item has a CATEGORY that changes how to score it:
- requirement: someone posted a need. 75 to 100 when a business or founder needs something the offers cover and it is fresh and concrete;
  50 to 75 for agencies subcontracting or vague needs; under 30 for full-time employment ads, people offering services, students, spam.
- hiring: a company hiring for repetitive manual work (data entry, support, coordinators, receptionists, inspectors) or its first developer.
  Score the automation opportunity: bigger repetitive team, clearer process, reachable company = higher. Estimate the yearly cost they could save.
- funding / launch: fresh money or a new venture that will need systems now. Score by fit and reachability.
- review: public complaints that show a broken process (no replies, missed calls, lost orders). Score by how directly an offer fixes it.
- tender: a public RFP; score by fit and whether a small agency can bid.
Return a JSON array, one object per item: {"i": item number, "score": 0-100, "buyer": "direct_client|agency|job_full_time|signal|candidate|spam|other",
"country", "industry", "company", "contact" (person name if visible), "website" (if visible), "services": [matching offers, short],
"budget" (if stated), "urgency": "high|medium|low", "why": one line on the fit, "angle": the specific value-first opener idea in one line,
"money_leak": for signals, one honest line estimating what the problem costs them per year with the assumption stated, else null}.
Be strict and honest. Never inflate a score to fill a quota.`;
}

/** Scores unscored items in batches. */
export async function qualifyPending(budgetMs = 45_000): Promise<number> {
  const cfg = await salesConfig();
  const focus = focusFor(cfg, new Date());
  const deadline = Date.now() + budgetMs;
  let done = 0;
  while (Date.now() < deadline - 15_000) {
    const batch = await q<{ id: number; title: string; body: string | null; url: string | null; category: string; source: string; posted_at: string | null }>(
      `select r.id, r.title, r.body, r.url, coalesce(s.category, 'requirement') as category, coalesce(s.name, 'manual') as source, r.posted_at
       from sales_radar_items r left join sales_radar_sources s on s.id = r.source_id
       where r.status = 'new' and r.score is null order by r.found_at desc limit 8`,
    );
    if (!batch.length) break;
    const text = batch.map((b, i) => `#${i + 1} CATEGORY: ${b.category} | SOURCE: ${b.source}${b.posted_at ? ` | POSTED: ${new Date(b.posted_at).toISOString().slice(0, 10)}` : ""}\nTITLE: ${b.title}\nURL: ${b.url ?? ""}\n${(b.body ?? "").slice(0, 1200)}`).join("\n\n");
    let verdicts: Verdict[] = [];
    try {
      const out = await llmJson<Verdict[] | { items: Verdict[] }>(qualifySystem(cfg, focus), text, { maxTokens: 2500, totalMs: Math.max(20_000, deadline - Date.now() - 5_000) });
      verdicts = Array.isArray(out) ? out : out.items ?? [];
    } catch (e) {
      console.warn("[radar] qualify failed:", (e as Error).message);
      // mark as scored-but-unknown so a broken batch cannot block the queue forever
      await q("update sales_radar_items set score = 0, status = 'rejected', fit = '{\"why\":\"AI could not score this batch\"}' where id = any($1) and score is null", [batch.map((b) => b.id)]).catch(() => {});
      break;
    }
    for (let i = 0; i < batch.length; i++) {
      const v = verdicts.find((x) => Number(x.i) === i + 1) ?? verdicts[i];
      const b = batch[i];
      if (!v) {
        await q("update sales_radar_items set score = 0, status = 'rejected' where id = $1", [b.id]);
        continue;
      }
      const score = Math.max(0, Math.min(100, Math.round(Number(v.score) || 0)));
      const status = score >= cfg.radar.min_score && !["candidate", "spam"].includes(v.buyer) ? "qualified" : "rejected";
      await q("update sales_radar_items set score = $2, status = $3, fit = $4, angle = $5 where id = $1", [b.id, score, status, JSON.stringify(v), v.angle ?? null]);
      if (status === "qualified") {
        await q("update sales_radar_sources set items_qualified = items_qualified + 1 where id = (select source_id from sales_radar_items where id = $1)", [b.id]);
        const fresh = !b.posted_at || Date.now() - new Date(b.posted_at).getTime() < 12 * 3_600_000;
        if (score >= cfg.radar.alert_score && fresh) await alertItem(b.id);
      }
      done += 1;
    }
  }
  return done;
}

export async function alertItem(id: number): Promise<void> {
  const it = await one<{ id: number; title: string; url: string | null; score: number; fit: Verdict | null; alerted_at: string | null; source: string | null }>(
    "select r.*, s.name as source from sales_radar_items r left join sales_radar_sources s on s.id = r.source_id where r.id = $1",
    [id],
  );
  if (!it || it.alerted_at) return;
  await q("update sales_radar_items set alerted_at = now() where id = $1", [id]);
  const f = it.fit;
  const text = `🎯 <b>Hot lead ${it.score}/100</b>${it.source ? ` · ${esc(it.source)}` : ""}\n<b>${esc(it.title.slice(0, 200))}</b>\n${f?.why ? `${esc(f.why)}\n` : ""}${f?.angle ? `💡 ${esc(f.angle)}` : ""}`;
  const row = [{ text: "✍️ Draft reply", callback_data: `zs:rd:${id}` }, { text: "➕ Lead", callback_data: `zs:rl:${id}` }, { text: "Skip", callback_data: `zs:rs:${id}` }];
  await push(text, { inline_keyboard: [row, ...(it.url?.startsWith("http") ? [[{ text: "Open post", url: it.url }]] : [])] });
}

/** Turns a radar item into a company, a person (when named) and a New deal with a first-touch move. */
export async function radarToDeal(id: number): Promise<number> {
  const it = await one<{ id: number; title: string; body: string | null; url: string | null; author: string | null; fit: Verdict | null; deal_id: number | null; source_id: number | null }>("select * from sales_radar_items where id = $1", [id]);
  if (!it) throw new Error("radar item missing");
  if (it.deal_id) return it.deal_id;
  const f = it.fit ?? ({} as Verdict);
  const companyId = f.company || f.website ? await ensureCompany(f.company ?? null, { website: f.website ?? null, country: f.country ?? null, industry: f.industry ?? null }) : null;
  const personName = f.contact || it.author;
  const personId = personName ? await upsertPerson({ name: personName, company_id: companyId, country: f.country ?? null }) : null;
  const dealId = await createDeal({
    title: f.company ? `${f.company}: ${it.title.slice(0, 60)}` : it.title.slice(0, 90),
    company_id: companyId,
    person_id: personId,
    source: "radar",
    source_detail: it.url ?? undefined,
    services: f.services ?? [],
    country: f.country ?? null,
    requirements: [it.title, (it.body ?? "").slice(0, 1500), f.money_leak ? `Money leak: ${f.money_leak}` : ""].filter(Boolean).join("\n"),
    radar_item_id: id,
  });
  await q("update sales_radar_items set deal_id = $2, status = 'converted' where id = $1", [id, dealId]);
  await q("update sales_moves set status = 'done', done_at = now() where dedupe_key = $1", [`radar:${id}`]);
  if (it.source_id) await q("update sales_radar_sources set deals_created = deals_created + 1 where id = $1", [it.source_id]);
  if (companyId) {
    await enqueue("enrich_company", { id: companyId }, { dedupeKey: `enrich_company:${companyId}` });
    if (f.website) await enqueue("audit_website", { id: companyId }, { dedupeKey: `audit:${companyId}` });
  }
  if (personId) await enqueue("enrich_person", { id: personId }, { dedupeKey: `enrich_person:${personId}` });
  await enqueue("refresh_moves", { deal_id: dealId }, { dedupeKey: `refresh_moves:${dealId}` });
  return dealId;
}

export async function setRadarStatus(id: number, status: "skipped" | "rejected" | "new"): Promise<void> {
  await q("update sales_radar_items set status = $2 where id = $1", [id, status]);
  await q("update sales_moves set status = 'skipped', done_at = now() where dedupe_key = $1 and status = 'open'", [`radar:${id}`]);
}

/** Intent-signal hunt for this week's country and today's industry, used when the feeds are dry. */
export async function hunt(budgetMs = 45_000): Promise<number> {
  const cfg = await salesConfig();
  const focus = focusFor(cfg, new Date());
  const year = new Date().getUTCFullYear();
  const queries = [
    `"looking for" (developer OR agency OR "automation expert") ${focus.industry} ${focus.country}`,
    `${focus.industry} company ${focus.country} hiring ("data entry" OR "customer support" OR "operations coordinator") ${year}`,
    `${focus.industry} ${focus.country} raises funding OR expands ${year}`,
    `${focus.industry} ${focus.country} reviews ("no response" OR "never called back" OR "slow delivery")`,
  ];
  const deadline = Date.now() + budgetMs;
  let added = 0;
  for (const query of queries) {
    if (Date.now() > deadline - 10_000) break;
    const hits = await webSearch(query, 8).catch(() => []);
    added += await storeItems(null, hits.map((h) => ({ title: h.title, url: h.url, body: `[hunt: ${focus.industry} / ${focus.country}] ${h.snippet}`, posted_at: h.date ?? null })));
  }
  if (Date.now() < deadline - 15_000) await runRadar(Math.max(10_000, deadline - Date.now() - 20_000), { force: true, categories: ["hiring", "review", "funding"] });
  return added;
}

/** The daily digest. Hunts until the minimum is met; never pads the list with junk, says so when it falls short. */
export async function dailyDigest(budgetMs = 50_000): Promise<string> {
  const cfg = await salesConfig();
  const deadline = Date.now() + budgetMs;
  const countQualified = async () =>
    (await one<{ n: number }>("select count(*)::int as n from sales_radar_items where status = 'qualified' and found_at > now() - interval '24 hours'"))?.n ?? 0;
  let n = await countQualified();
  let rounds = 0;
  while (n < cfg.radar.daily_min && rounds < 2 && Date.now() < deadline - 20_000) {
    await hunt(Math.min(25_000, deadline - Date.now() - 15_000));
    await qualifyPending(Math.min(25_000, deadline - Date.now() - 5_000));
    n = await countQualified();
    rounds += 1;
  }
  const top = await q<{ id: number; title: string; url: string | null; score: number; fit: Verdict | null; status: string }>(
    `select id, title, url, score, fit, status from sales_radar_items
     where found_at > now() - interval '48 hours' and digest_sent_at is null and (status = 'qualified' or (status = 'rejected' and score >= 40))
     order by (status = 'qualified') desc, score desc limit 8`,
  );
  const good = top.filter((t) => t.status === "qualified");
  const list = good.length >= cfg.radar.daily_min ? good : top.slice(0, Math.max(cfg.radar.daily_min, good.length));
  if (!list.length) {
    // the honest case: still keep hunting in the background through the day
    await enqueue("radar_hunt", {}, { dedupeKey: "radar_hunt", runAfter: new Date(Date.now() + 2 * 3_600_000) });
    await push("🎯 <b>Radar</b>: nothing worth your time in the last 24 hours, even after hunting. I'll keep searching today and ping you the moment something real shows up.");
    return "none";
  }
  const focus = focusFor(cfg, new Date());
  const lines = list.map((t, i) => `${i + 1}. <b>${t.score}</b> ${esc(t.title.slice(0, 120))}${t.fit?.angle ? `\n   💡 ${esc(t.fit.angle.slice(0, 160))}` : ""}${t.status !== "qualified" ? " <i>(below your bar)</i>" : ""}`);
  const kb = list.slice(0, 6).map((t, i) => [
    { text: `${i + 1}. ✍️ Draft`, callback_data: `zs:rd:${t.id}` },
    { text: "➕ Lead", callback_data: `zs:rl:${t.id}` },
    { text: "Skip", callback_data: `zs:rs:${t.id}` },
    ...(t.url?.startsWith("http") ? [{ text: "Open", url: t.url }] : []),
  ]);
  kb.push([{ text: "Open radar", url: `${baseUrl()}/sales/radar` }]);
  await push(`🎯 <b>Today's opportunities</b> · focus ${esc(focus.country)}, ${esc(focus.industry)}\n${good.length < cfg.radar.daily_min ? "Feeds were thin; this includes the best of the hunt.\n" : ""}\n${lines.join("\n")}`, { inline_keyboard: kb });
  await q("update sales_radar_items set digest_sent_at = now() where id = any($1)", [list.map((t) => t.id)]);
  return `sent ${list.length}`;
}

/** Alert emails (Upwork, tenders, Google Alerts...) become radar items. Returns true when the sender is a radar source. */
export async function emailToRadar(from: string, subject: string, body: string, messageId: string): Promise<boolean> {
  const domain = (from.match(/@([a-z0-9.-]+)/i)?.[1] ?? "").toLowerCase();
  if (!domain) return false;
  const src = await one<{ id: number; config: { domains?: string[] }; enabled: boolean }>(
    `select id, config, enabled from sales_radar_sources where kind = 'email' and exists (
       select 1 from jsonb_array_elements_text(config->'domains') d where $1 = d or $1 like '%.' || d)`,
    [domain],
  );
  if (!src) return false;
  // a LinkedIn notification about a message is a conversation, not an alert
  if (domain.endsWith("linkedin.com") && !/job|alert|hiring/i.test(subject)) return false;
  if (!src.enabled) return true;
  await storeItems(src.id, [{ title: subject.slice(0, 300), url: `mail:${messageId}`, body: body.slice(0, 6000) }]);
  await enqueue("radar_qualify", {}, { dedupeKey: "radar_qualify" });
  return true;
}
