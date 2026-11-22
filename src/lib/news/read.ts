/**
 * Reading the stories that matter in full, so the paper can tell the whole story instead of a headline.
 *
 * Each important story (score 55 or more) is opened once: its article text, its main picture, its writer and its real
 * address are kept. Publisher links are read directly; Google News links (which only redirect in a browser) and pages
 * that will not answer a server are read through the Jina reader. Then the AI writes each one up in detail, from the
 * article text only: what happened, who it hits (which businesses, sectors, countries, markets), and what it means for
 * the owner. When the article could not be read, the write-up says less, never more.
 */
import { one, q } from "../db";
import { llmConfigured, llmJson } from "../sales/llm";
import { strip } from "../sales/search";
import { noDashes } from "../text/no-dashes";
import { ownerBrief } from "./collect";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

export interface Article { text: string; image: string | null; url: string | null; author: string | null }

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
const meta = (html: string, names: string[]): string | null => {
  for (const n of names) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${n}["']`, "i");
    const m = html.match(re1) ?? html.match(re2);
    if (m?.[1]) return decode(m[1]);
  }
  return null;
};
const absolute = (u: string | null, base: string): string | null => {
  if (!u) return null;
  try { const x = new URL(u, base); return /^https?:$/.test(x.protocol) ? x.toString() : null; } catch { return null; }
};
/** Not a real picture of the story: logos, icons, tracking pixels, placeholders. Pure. */
export const junkImage = (u: string) => /logo|icon|sprite|favicon|placeholder|default[-_]?(?:image|og)|blank|pixel|avatar|\.svg(\?|$)|\.gif(\?|$)/i.test(u);

/** The article in a publisher's page: its paragraphs, picture, canonical address and writer. Pure. */
export function extractArticle(html: string, url: string): Article {
  const scope = html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html;
  const paras = [...scope.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => strip(m[1]))
    .filter((t) => t.length > 60 && !/cookie|subscribe|sign up|newsletter|all rights reserved|advertisement|javascript/i.test(t));
  const img = absolute(meta(html, ["og:image", "og:image:url", "twitter:image", "twitter:image:src"]), url);
  const canon = absolute(meta(html, ["og:url"]) ?? html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? null, url);
  const author = meta(html, ["author", "article:author", "parsely-author", "sailthru.author"]);
  return {
    text: [...new Set(paras)].join("\n\n").slice(0, 6000),
    image: img && !junkImage(img) ? img : null,
    url: canon ?? url,
    author: author && !/^https?:/.test(author) && author.length < 80 ? author : null,
  };
}

/** The article in a Jina reader answer (Title, URL Source, Markdown Content). Pure. */
export function parseReader(text: string): Article {
  const src = text.match(/^URL Source:\s*(\S+)/m)?.[1] ?? null;
  const body = text.split(/^Markdown Content:\s*$/m)[1] ?? text;
  const image = [...body.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]).find((u) => !junkImage(u) && /\.(jpe?g|png|webp)|image|img|photo|media/i.test(u)) ?? null;
  const paras = body.split(/\n{2,}/)
    .map((p) => p.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#*_>`]+/g, "").replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 60 && !/cookie|subscribe|sign up|newsletter|all rights reserved|advertisement/i.test(p));
  return { text: [...new Set(paras)].join("\n\n").slice(0, 6000), image, url: src, author: null };
}

const isGoogle = (u: string) => /^https?:\/\/news\.google\.com\//.test(u);

async function direct(url: string): Promise<Article | null> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const html = (await res.text()).slice(0, 800_000);
  return extractArticle(html, res.url || url);
}

async function reader(url: string): Promise<Article | null> {
  const key = process.env.JINA_API_KEY?.trim();
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { accept: "text/plain", "x-with-images-summary": "false", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const a = parseReader(await res.text());
  // still on Google News: the redirect did not happen, there is no article here
  if (a.url && isGoogle(a.url)) return { ...a, text: "", url: null };
  return a;
}

/** Reads one story's article: directly, then through the reader. */
export async function readArticle(url: string): Promise<Article | null> {
  let a: Article | null = null;
  if (!isGoogle(url)) a = await direct(url).catch(() => null);
  if (!a || a.text.length < 400) {
    const r = await reader(url).catch(() => null);
    if (r && r.text.length > (a?.text.length ?? 0)) a = { text: r.text, image: r.image ?? a?.image ?? null, url: r.url ?? a?.url ?? null, author: a?.author ?? null };
    else if (a && !a.image && r?.image) a = { ...a, image: r.image };
  }
  return a;
}

/** Opens the most important stories not read yet, within a time budget. Returns how many were read. */
export async function readStories(budgetMs = 25_000, min = 55): Promise<number> {
  const deadline = Date.now() + budgetMs;
  let n = 0;
  while (Date.now() < deadline - 12_000) {
    const batch = await q<{ id: number; url: string; image_url: string | null }>(
      "select id, url, image_url from news_items where read_at is null and score >= $1 and found_at > now() - interval '2 days' order by score desc, id limit 6", [min]);
    if (!batch.length) break;
    await Promise.all(batch.map(async (s) => {
      try {
        const a = await readArticle(s.url);
        await q(`update news_items set read_at = now(), body = $2, image_url = coalesce(image_url, $3), real_url = $4, author = coalesce(author, $5), read_error = $6 where id = $1`,
          [s.id, a?.text ? a.text : null, a?.image ?? null, a?.url && !isGoogle(a.url) ? a.url : null, a?.author ?? null, a?.text ? null : "the article could not be read"]);
      } catch (e) {
        await q("update news_items set read_at = now(), read_error = $2 where id = $1", [s.id, (e as Error).message.slice(0, 200)]);
      }
      n += 1;
    }));
  }
  return n;
}

interface Write { i: number; detail?: string; affects?: string; impact?: string; for_you?: string }

/** Writes up the read stories in detail, within a time budget. Returns how many were written. */
export async function detailStories(budgetMs = 30_000, min = 55): Promise<number> {
  if (!llmConfigured()) return 0;
  const deadline = Date.now() + budgetMs;
  const who = await ownerBrief();
  let n = 0;
  while (Date.now() < deadline - 18_000) {
    // read first (or tried an hour ago and failed), then written up
    const batch = await q<{ id: number; title: string; outlet: string | null; summary: string | null; body: string | null; why: string | null }>(
      `select id, title, outlet, summary, body, why from news_items
       where detailed_at is null and score >= $1 and found_at > now() - interval '2 days' and (read_at is not null or found_at < now() - interval '1 hour')
       order by score desc, id limit 6`, [min]);
    if (!batch.length) break;
    let out: Write[] = [];
    try {
      const r = await llmJson<Write[] | { items: Write[] }>(
        `You are a senior business journalist writing a private newspaper for one reader:
${who}

For each story write, from its ARTICLE (or, when there is no article, its SNIPPET) only:
"detail": the story told properly in 90 to 160 words, like a good newspaper report: what happened, who did it, the numbers and dates the
  article gives, the background, what happens next. Plain sentences. Only facts in the text. Never invent numbers, names, quotes or dates.
  If there is only a snippet, write 30 to 60 words and stop: say less, never more.
"affects": who this hits or helps, in one or two lines: which businesses, sectors, countries, markets, prices, and whether it pushes demand
  or supply up or down. Reason from the facts; say "likely" when it is your reading, not the article's.
"impact": "up" if it is good for business conditions it touches, "down" if bad, "mixed", or "none".
"for_you": one or two sentences on what it means for THIS reader (their offers, clients and their countries, costs, tools, investments),
  or "" when it does not touch them. Concrete, never generic.
Return a JSON array of {"i", "detail", "affects", "impact", "for_you"}. No dashes as punctuation.`,
        batch.map((b, i) => `#${i + 1} ${b.title}${b.outlet ? ` (${b.outlet})` : ""}\n${b.body ? `ARTICLE:\n${b.body.slice(0, 3500)}` : `SNIPPET: ${(b.summary ?? "").slice(0, 600)}`}`).join("\n\n---\n\n"),
        { maxTokens: 4000, totalMs: Math.max(18_000, Math.min(45_000, deadline - Date.now() - 3_000)) },
      );
      out = Array.isArray(r) ? r : r.items ?? [];
    } catch (e) {
      console.warn("[news] write-up failed:", (e as Error).message);
      break;
    }
    for (let k = 0; k < batch.length; k++) {
      const v = out.find((x) => Number(x.i) === k + 1);
      const clean = (s: unknown, max: number) => (typeof s === "string" && s.trim() ? noDashes(s.trim()).slice(0, max) : null);
      await q("update news_items set detail = $2, affects = $3, impact = $4, for_you = $5, detailed_at = now() where id = $1", [
        batch[k].id, clean(v?.detail, 1600), clean(v?.affects, 400),
        ["up", "down", "mixed", "none"].includes(String(v?.impact)) ? String(v?.impact) : null, clean(v?.for_you, 400),
      ]);
      n += 1;
    }
  }
  return n;
}

/** Whether there is reading or writing up waiting (for the tick). */
export async function newsWorkWaiting(): Promise<boolean> {
  return !!(await one(
    `select 1 from news_items where score >= 55 and found_at > now() - interval '2 days'
     and (read_at is null or (detailed_at is null and $1)) limit 1`, [llmConfigured()]));
}
