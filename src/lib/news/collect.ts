/**
 * Reading the news: each source that is due is read, every story is kept once (the same story from five outlets is one
 * story), and only what is recent (the last day and a half) is kept. Then each new story is scored by the AI for how
 * much it matters to the owner, with one line on why and, when there is one, what to do about it.
 */
import { createHash } from "node:crypto";
import { one, q } from "../db";
import { salesConfig } from "../sales/config";
import { llmConfigured, llmJson } from "../sales/llm";
import { feedWithRelay } from "../sales/radar-fetch";
import { noDashes } from "../text/no-dashes";
import { gnewsUrl, seedNewsSources, TOPICS, type Topic } from "./sources";

export interface SourceRow { id: number; key: string; name: string; kind: "gnews" | "rss" | "hn"; config: Record<string, unknown>; topic: string | null; enabled: boolean; last_run_at: string | null; last_ok_at: string | null; last_error: string | null; items_found: number; custom: boolean }
export interface Story { title: string; url: string; summary: string; published_at: string | null; outlet: string | null }

const hash = (s: string) => createHash("sha1").update(s).digest("hex");

/** "Nvidia beats estimates - Reuters" into the title and the outlet. Pure. */
export function splitOutlet(title: string): { title: string; outlet: string | null } {
  const m = title.match(/^(.*\S)\s+[-|–—]\s+([^-|–—]{2,60})$/);
  return m ? { title: m[1].trim(), outlet: m[2].trim() } : { title: title.trim(), outlet: null };
}

/** The key two outlets' versions of one story share: the title's words, lowercased. Pure. */
export function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter((w) => w.length > 2).slice(0, 12).join(" ");
}

/** Recent enough to be news: published in the last `hours` (undated stories are kept). Pure. */
export function isRecent(published: string | null, now: number, hours = 36): boolean {
  if (!published) return true;
  const t = new Date(published).getTime();
  return Number.isNaN(t) || now - t <= hours * 3_600_000;
}

async function readSource(s: SourceRow): Promise<Story[]> {
  if (s.kind === "hn") {
    const res = await fetch("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=40", { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HN ${res.status}`);
    const j = (await res.json()) as { hits: { title: string; url: string | null; objectID: string; created_at: string; points: number }[] };
    return j.hits.filter((h) => h.points >= 80).map((h) => ({ title: h.title, url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`, summary: `${h.points} points on Hacker News`, published_at: h.created_at, outlet: "Hacker News" }));
  }
  const url = s.kind === "gnews" ? gnewsUrl(String(s.config.q), s.config.ed === "IN" ? "IN" : "US") : String(s.config.url);
  const items = await feedWithRelay(url);
  return items.map((x) => {
    const sp = s.kind === "gnews" ? splitOutlet(x.title) : { title: x.title, outlet: s.name.replace(/\s*\(.*\)$/, "") };
    return { title: sp.title, url: x.url, summary: x.body.replace(/\s+/g, " ").slice(0, 600), published_at: x.date, outlet: sp.outlet };
  });
}

/** Reads the sources that are due (every `everyHours`), within a time budget. Returns how many new stories were kept. */
export async function collectNews(budgetMs = 40_000, o: { force?: boolean; everyHours?: number } = {}): Promise<{ read: number; added: number }> {
  await seedNewsSources();
  const deadline = Date.now() + budgetMs;
  const due = await q<SourceRow>(
    `select * from news_sources where enabled and ($1 or last_run_at is null or last_run_at < now() - make_interval(hours => $2)) order by last_run_at nulls first limit 40`,
    [!!o.force, o.everyHours ?? 3],
  );
  let read = 0;
  let added = 0;
  const now = Date.now();
  for (let i = 0; i < due.length && Date.now() < deadline - 6_000; i += 5) {
    const batch = due.slice(i, i + 5);
    await Promise.all(batch.map(async (s) => {
      await q("update news_sources set last_run_at = now() where id = $1", [s.id]);
      try {
        const stories = (await readSource(s)).filter((x) => x.title && /^https?:\/\//.test(x.url) && isRecent(x.published_at, now));
        let n = 0;
        for (const x of stories.slice(0, 30)) {
          const key = titleKey(x.title);
          if (!key) continue;
          // the same story from another outlet, already kept in the last three days
          if (await one("select 1 from news_items where title_key = $1 and found_at > now() - interval '3 days'", [key])) continue;
          const row = await one<{ id: number }>(
            `insert into news_items (source_id, url, url_hash, title_key, title, outlet, summary, published_at, topic)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (url_hash) do nothing returning id`,
            [s.id, x.url, hash(x.url.replace(/[?#].*$/, "")), key, x.title.slice(0, 400), x.outlet, x.summary || null, x.published_at && !Number.isNaN(new Date(x.published_at).getTime()) ? new Date(x.published_at) : null, s.topic],
          );
          if (row) n += 1;
        }
        added += n;
        await q("update news_sources set last_ok_at = now(), last_error = null, items_found = items_found + $2 where id = $1", [s.id, n]);
      } catch (e) {
        await q("update news_sources set last_error = $2 where id = $1", [s.id, (e as Error).message.slice(0, 300)]);
      }
      read += 1;
    }));
  }
  return { read, added };
}

/** Who the news is for, in the words the scorer and the writer need. */
export async function ownerBrief(): Promise<string> {
  const cfg = await salesConfig();
  const extra = (await one<{ extra_interests: string }>("select extra_interests from news_settings where id = 1"))?.extra_interests ?? "";
  return `${cfg.owner.name}, ${cfg.owner.title} of ${cfg.owner.company} (${cfg.owner.website}), an AI agency based in India.
WHAT THEY SELL: ${cfg.offers.join("; ")}.
CLIENT COUNTRIES: ${cfg.countries.join(", ")}. CLIENT INDUSTRIES: ${cfg.industries.join(", ")}.
WHAT THEY ARE BUILDING AND USING: AI sales tools (lead finding, enrichment, outreach drafts, a sales CRM), voice agents for calls (they run a voice AI platform),
WhatsApp automation, AI agents, computer vision and robotics for factories and retail. They pay for AI APIs (Gemini, OpenRouter and others) and care about
price and limits. They invest attention in the Indian stock market and the Indian economy; a weaker or stronger rupee changes what foreign clients pay them.${extra.trim() ? `\nALSO WATCHING: ${extra.trim()}` : ""}`;
}

interface Verdict { i: number; score: number; topic?: string; why?: string; action?: string | null }

/** Scores new stories in batches, within a time budget. */
export async function scoreNews(budgetMs = 40_000): Promise<number> {
  if (!llmConfigured()) return 0;
  const deadline = Date.now() + budgetMs;
  const who = await ownerBrief();
  const topics = Object.keys(TOPICS).join("|");
  let done = 0;
  while (Date.now() < deadline - 15_000) {
    const batch = await q<{ id: number; title: string; outlet: string | null; summary: string | null; topic: string | null }>(
      "select id, title, outlet, summary, topic from news_items where score is null and found_at > now() - interval '2 days' order by found_at desc, id limit 30");
    if (!batch.length) break;
    let out: Verdict[] = [];
    try {
      const r = await llmJson<Verdict[] | { items: Verdict[] }>(
        `You are the chief of staff and news editor for this person:
${who}

Score each story for how much THEY need to know it today, from the title and snippet only.
90 to 100: must know today: it directly changes their business, costs, clients or a tool they use or should adopt now; a big move in Indian markets,
  the rupee or RBI; a major AI model or tool release they can use or sell; a big shift in their client countries or industries.
70 to 89: important for their work or money. 50 to 69: useful context. Under 50: skip it.
Score low: celebrity, sports, crime, local politics with no business effect, listicles, how-to guides, opinion with no news, sponsored posts,
rehashes of old news, stock tips about single small companies.
Return a JSON array: {"i": story number, "score": 0 to 100, "topic": one of ${topics},
"why": one short line on why it matters to THEM specifically (name the offer, client market, tool or cost it touches), never generic,
"action": one short line on what to do (try it, pitch it to a kind of client, change a price, watch it) or null}.
Use only what the title and snippet say. Never invent numbers or facts. No dashes as punctuation.`,
        batch.map((b, i) => `#${i + 1} ${b.title}${b.outlet ? ` (${b.outlet})` : ""}\n${(b.summary ?? "").slice(0, 300)}`).join("\n\n"),
        { maxTokens: 3500, totalMs: Math.max(15_000, Math.min(40_000, deadline - Date.now() - 3_000)) },
      );
      out = Array.isArray(r) ? r : r.items ?? [];
    } catch (e) {
      console.warn("[news] scoring failed:", (e as Error).message);
      break;
    }
    for (let k = 0; k < batch.length; k++) {
      const v = out.find((x) => Number(x.i) === k + 1);
      const topic = v?.topic && v.topic in TOPICS ? (v.topic as Topic) : batch[k].topic ?? "other";
      await q("update news_items set score = $2, topic = $3, why = $4, action = $5, scored_at = now() where id = $1",
        [batch[k].id, v ? Math.max(0, Math.min(100, Math.round(Number(v.score) || 0))) : 0, topic, v?.why ? noDashes(String(v.why)).slice(0, 300) : null, v?.action ? noDashes(String(v.action)).slice(0, 200) : null]);
      done += 1;
    }
  }
  return done;
}
