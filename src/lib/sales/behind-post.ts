/**
 * Who is behind a posted requirement (a Freelancer, Upwork or Reddit post, a job ad): the business, the person who
 * decides, and the contact details that business publishes, so you can reach them directly instead of bidding.
 *
 * Rules it keeps:
 * - Businesses only. When the post reads like a private person's one-off job, it says so and stops: it does not try to
 *   unmask a private individual or dig up personal contact details.
 * - Nothing invented. A company, website or person is kept only when the evidence that was read names it, and an email
 *   or phone number only when it literally appears in that evidence (the post, search results, pages read).
 * - Every finding comes with where it was seen.
 */
import { one, q, UserError } from "../db";
import { domainOf } from "./identity";
import { llmConfigured, llmJson } from "./llm";
import { extractEmails, extractPhones } from "./research-extract";
import { seenIn } from "./research";
import { fetchPage, geminiSearchReady, groundedResearch, webSearch, type SearchHit } from "./search";
import type { Poster } from "./radar";

export interface Identity {
  status: "found" | "partial" | "not_found" | "private" | "running" | "error";
  company?: string | null;
  website?: string | null;
  person?: string | null;
  title?: string | null;
  linkedin?: string | null;
  emails: string[];
  phones: string[];
  confidence?: "high" | "medium" | "low" | null;
  evidence: { url: string; says: string }[];
  note: string;
  checked_at: string;
}

/** Marketplaces where answering costs credits, bids or connects. */
export const PAID_MARKETPLACE = /(^|\.)(freelancer\.[a-z.]+|upwork\.com|peopleperhour\.com|guru\.com|fiverr\.com|truelancer\.com|workana\.com)$/i;
/** Sites that are where a lead was posted, never the business behind it. */
const PLATFORM = /(^|\.)(reddit|linkedin|upwork|freelancer|facebook|instagram|twitter|x|youtube|tiktok|medium|quora|google|bing|duckduckgo|ycombinator|producthunt|github|glassdoor|indeed|trustpilot|yelp|crunchbase|wikipedia|bark|clutch|peopleperhour|guru|contra|fiverr|remoteok|remotive|weworkremotely|arbeitnow|jobicy|himalayas|adzuna|truelancer|workana|t\.me|wa\.me|bit\.ly|imgur|dropbox|drive\.google|docs\.google|figma|loom|canva|notion|calendly|zoom)\.[a-z.]+$/i;

/** Free mailbox providers: an address there says nothing about which business it is. */
const FREE_MAIL = /(^|\.)(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|aol|proton|protonmail|zoho|gmx|mail|yandex|rediffmail)\.[a-z.]+$/i;

export interface Clues {
  websites: string[];
  emails: string[];
  phones: string[];
  handles: string[];
  /** a distinctive sentence from the post, for finding the same need posted elsewhere under the business's name */
  phrase: string | null;
  poster: Poster | null;
}

/** What the post itself gives away: sites, emails, phones, handles and a phrase to search for. Pure. */
export function postClues(item: { title: string; body: string | null; poster?: Poster | null }): Clues {
  const text = `${item.title}\n${item.body ?? ""}`;
  const websites = [...new Set([...text.matchAll(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|co|io|ai|net|org|app|dev|store|shop|biz|us|uk|ae|sa|au|ca|de|fr|sg|co\.uk|co\.in|com\.au))\b(?:\/[^\s)]*)?/gi)]
    .map((m) => m[1].toLowerCase())
    .filter((d) => !PLATFORM.test(d) && !FREE_MAIL.test(d) && !/\.(png|jpe?g|gif|pdf|docx?|xlsx?|zip)$/i.test(d)))]
    .slice(0, 4);
  const emails = extractEmails(text, "post").map((e) => e.email).slice(0, 4);
  const phones = extractPhones(text).slice(0, 3);
  const handles = [...new Set([...text.matchAll(/(?:^|\s)@([a-z0-9_.]{3,30})\b/gi)].map((m) => m[1]))].slice(0, 3);
  const sentences = (item.body ?? "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.trim())
    .filter((s) => s.split(" ").length >= 8 && s.split(" ").length <= 30 && !/\b(i am looking for|we are looking for|please|bid|budget|deadline|thank)/i.test(s));
  const phrase = sentences.sort((a, b) => b.length - a.length)[0]?.split(" ").slice(0, 12).join(" ") ?? null;
  return { websites, emails, phones, handles, phrase, poster: item.poster ?? null };
}

/** The searches worth running for one post, most telling first. Pure. */
export function behindQueries(item: { title: string }, c: Clues, fit: { company?: string | null; industry?: string | null; country?: string | null } | null): string[] {
  const out: string[] = [];
  const where = [c.poster?.city, c.poster?.country ?? fit?.country].filter(Boolean).join(" ");
  if (fit?.company) out.push(`"${fit.company}" ${where} contact`);
  for (const w of c.websites) out.push(`site:${w} contact OR about`);
  if (c.phrase) out.push(`"${c.phrase.replace(/"/g, "")}"`);
  if (c.poster?.username && c.poster.username.length >= 4) out.push(`"${c.poster.username}" -site:freelancer.com -site:upwork.com`);
  const name = c.poster?.name?.replace(/\.$/, "");
  if (name && /\s/.test(name)) out.push(`"${name}" ${where} ${fit?.industry ?? ""} founder OR owner OR director`.replace(/\s+/g, " ").trim());
  for (const h of c.handles) out.push(`"@${h}"`);
  return [...new Set(out)].slice(0, 5);
}

const SYSTEM = `You find the business behind a posted requirement so a small agency can contact the decision maker directly.
You get the post, the poster's public profile, and EVIDENCE (search results and pages). Return JSON:
{
 "kind": "business" (the post is for a company or a business owner's venture) | "private" (a private person's personal or student job) | "unclear",
 "company": the business's name exactly as the evidence writes it, or null,
 "website": the business's own website (a domain that appears in the evidence), or null,
 "person": the decision maker's full name (owner, founder, director or the poster) exactly as the evidence writes it, or null,
 "title": their role, or null,
 "linkedin": their LinkedIn URL only if it appears in the evidence, else null,
 "emails": business emails that appear in the evidence, [],
 "phones": business phone numbers that appear in the evidence, [],
 "confidence": "high" (the evidence clearly ties this business to this post: same details, same site, same name and place) | "medium" (likely) | "low" (a guess),
 "evidence": [{"url": a URL from the evidence, "says": "what it shows, one line"}],
 "note": "one or two plain lines: what you found and how sure you are, or why nothing could be tied to the post"
}
Rules: only businesses. If the post is a private person's personal job, kind "private" and every other field null or empty.
Never guess an email or phone pattern. Never use details of a different business with a similar name.
If nothing in the evidence ties a business to this post, say so with confidence "low" and nulls.`;

const blank = (note: string, status: Identity["status"]): Identity => ({ status, emails: [], phones: [], evidence: [], note, checked_at: new Date().toISOString() });

/**
 * Looks for the business behind one radar lead and saves what it finds on the lead. When a business is found with
 * at least medium confidence it is returned so the full company research (decision makers, every contact) can follow.
 */
export async function findBehindPost(itemId: number, budgetMs = 45_000): Promise<Identity> {
  const deadline = Date.now() + budgetMs;
  const it = await one<{ id: number; title: string; body: string | null; url: string | null; poster: Poster | null; fit: { company?: string | null; website?: string | null; industry?: string | null; country?: string | null } | null }>(
    "select id, title, body, url, poster, fit from sales_radar_items where id = $1", [itemId]);
  if (!it) throw new UserError("That lead no longer exists.");
  if (!llmConfigured()) throw new UserError("Finding who is behind a post needs an AI key: add GEMINI_API_KEY.");
  await q("update sales_radar_items set identity = $2 where id = $1", [itemId, JSON.stringify(blank("Looking for the business behind this post…", "running"))]);
  try {
    const id = await investigate(it, deadline);
    await q("update sales_radar_items set identity = $2 where id = $1", [itemId, JSON.stringify(id)]);
    return id;
  } catch (e) {
    const id = blank(e instanceof UserError ? e.message : `The search could not finish: ${(e as Error).message.slice(0, 160)}. Try again.`, "error");
    await q("update sales_radar_items set identity = $2 where id = $1", [itemId, JSON.stringify(id)]);
    return id;
  }
}

async function investigate(
  it: { title: string; body: string | null; url: string | null; poster: Poster | null; fit: { company?: string | null; website?: string | null; industry?: string | null; country?: string | null } | null },
  deadline: number,
): Promise<Identity> {
  const clues = postClues(it);
  const post = `${it.title}\n${it.body ?? ""}`;
  const evidence: { url: string; text: string }[] = [{ url: it.url ?? "the post", text: post }];
  if (it.poster) evidence.push({ url: it.poster.profile_url ?? "poster profile", text: `Poster's public profile: ${JSON.stringify(it.poster)}` });

  // 1. the business's own site, when the post names it
  const site = it.fit?.website ? domainOf(it.fit.website) : clues.websites[0] ?? null;
  if (site && !PLATFORM.test(site) && Date.now() < deadline - 25_000) {
    for (const path of ["", "/contact", "/about"]) {
      const page = await fetchPage(`https://${site}${path}`, { maxChars: 5000 }).catch(() => null);
      if (page?.text) evidence.push({ url: page.url, text: `${page.title}\n${page.text}\n${page.html ? extractPhones(page.html).join(" ") : ""}` });
      if (Date.now() > deadline - 25_000) break;
    }
  }

  // 2. the web: the same need posted elsewhere, the poster's username, the named company
  const hits: SearchHit[] = [];
  for (const query of behindQueries(it, clues, it.fit)) {
    if (Date.now() > deadline - 22_000) break;
    hits.push(...(await webSearch(query, 6, "radar: who is behind").catch(() => [])));
  }
  for (const h of hits.slice(0, 18)) evidence.push({ url: h.url, text: `${h.title}\n${h.snippet}` });

  // 3. Google through Gemini, asked the same question, when there is time
  if (geminiSearchReady() && Date.now() < deadline - 20_000) {
    const g = await groundedResearch(
      `A requirement was posted on ${(it.url && domainOf(it.url)) || "a job site"}. Find the business that posted it, its owner or decision maker, and the contact details the business publishes (website, business email, business phone, LinkedIn). ` +
      `Only report what you can tie to this post. If it is a private person's personal job, say so and stop.\n\nPOST:\n${post.slice(0, 2500)}\n\nPOSTER: ${JSON.stringify(it.poster ?? {})}`,
      { timeoutMs: Math.min(30_000, deadline - Date.now() - 12_000), label: "radar: who is behind" },
    ).catch(() => null);
    if (g?.text) evidence.push({ url: "Google search (Gemini)", text: `${g.text}\n${g.sources.map((s) => `${s.title} ${s.url} ${s.snippet}`).join("\n")}` });
  }

  const hay = evidence.map((e) => `${e.url}\n${e.text}`).join("\n\n");
  const out = await llmJson<{
    kind?: string; company?: string | null; website?: string | null; person?: string | null; title?: string | null; linkedin?: string | null;
    emails?: string[]; phones?: string[]; confidence?: string; evidence?: { url: string; says: string }[]; note?: string;
  }>(SYSTEM, `POST (${it.url ?? ""}):\n${post.slice(0, 3000)}\n\nPOSTER: ${JSON.stringify(it.poster ?? {})}\n\nEVIDENCE:\n${evidence.slice(1).map((e, i) => `[${i + 1}] ${e.url}\n${e.text.slice(0, 1800)}`).join("\n\n").slice(0, 24_000)}`,
  { maxTokens: 1500, totalMs: Math.max(12_000, deadline - Date.now()) });

  if (out.kind === "private") return { ...blank(out.note || "This reads like a private person's own job, not a business. Reply on the platform instead.", "private") };
  return groundIdentity(out, hay);
}

/** Keeps only what the evidence shows: names and sites it mentions, emails and phones it literally contains. Pure. */
export function groundIdentity(
  out: { company?: string | null; website?: string | null; person?: string | null; title?: string | null; linkedin?: string | null; emails?: string[]; phones?: string[]; confidence?: string; evidence?: { url: string; says: string }[]; note?: string },
  hay: string,
): Identity {
  const low = hay.toLowerCase();
  const inHay = (v: string | null | undefined) => (v && v.trim().length >= 2 && low.includes(v.trim().toLowerCase()) ? v.trim() : null);
  const dom = out.website ? domainOf(/^https?:/i.test(out.website) ? out.website : `https://${out.website}`) : null;
  const website = dom && !PLATFORM.test(dom) && low.includes(dom) ? `https://${dom}` : null;
  const digits = (s: string) => s.replace(/\D/g, "");
  const hayDigits = hay.replace(/\D/g, "");
  const emails = [...new Set((out.emails ?? []).map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && low.includes(e)))].slice(0, 5);
  const phones = [...new Set((out.phones ?? []).map(String).filter((p) => digits(p).length >= 8 && hayDigits.includes(digits(p))))].slice(0, 4);
  const linkedin = out.linkedin && seenIn(hay, out.linkedin) ? out.linkedin : null;
  const company = inHay(out.company);
  const person = inHay(out.person);
  const confidence = (["high", "medium", "low"].includes(String(out.confidence)) ? out.confidence : "low") as Identity["confidence"];
  const found = !!(company || website) && confidence !== "low";
  const direct = emails.length || phones.length || linkedin;
  return {
    status: found && (direct || person) ? "found" : found || direct ? "partial" : "not_found",
    company, website, person, title: person ? out.title ?? null : null, linkedin, emails, phones, confidence,
    evidence: (out.evidence ?? []).filter((e) => e?.url && (low.includes(String(e.url).toLowerCase()) || /gemini/i.test(String(e.url)))).slice(0, 6).map((e) => ({ url: String(e.url), says: String(e.says ?? "").slice(0, 200) })),
    note: String(out.note ?? "").slice(0, 400) || (found ? "Business identified from the evidence." : "Nothing in the evidence ties a business to this post."),
    checked_at: new Date().toISOString(),
  };
}

/** For a lead whose business was found: the company research follows with it (decision makers, every contact). */
export async function behindThenResearch(itemId: number, trigger = "auto", budgetMs = 45_000): Promise<Identity> {
  const id = await findBehindPost(itemId, budgetMs);
  if ((id.status === "found" || id.status === "partial") && (id.company || id.website) && id.confidence !== "low") {
    const { researchRadarItem } = await import("./research");
    await researchRadarItem(itemId, { company: id.company ?? null, website: id.website ?? null }, trigger).catch(() => {});
    // the person they found becomes the contact on the lead
    if (id.person) {
      const fit = (await one<{ fit: Record<string, unknown> | null }>("select fit from sales_radar_items where id = $1", [itemId]))?.fit ?? {};
      await q("update sales_radar_items set fit = $2 where id = $1", [itemId, JSON.stringify({ ...fit, contact: fit.contact ?? id.person, company: fit.company ?? id.company, website: fit.website ?? id.website })]);
    }
  }
  return id;
}

/**
 * Research for a radar lead from start to finish: when the post names no business (most marketplace posts), first find
 * who is behind it, then research that business. Returns the research run, or null when no business could be tied to it.
 */
export async function researchLeadFully(itemId: number, trigger = "auto", budgetMs = 45_000): Promise<number | null> {
  const { identifyLead, researchRadarItem } = await import("./research");
  const it = await one<{ url: string | null; fit: Parameters<typeof identifyLead>[0]["fit"]; company_id: number | null }>("select url, fit, company_id from sales_radar_items where id = $1", [itemId]);
  if (!it) throw new UserError("That lead no longer exists.");
  const known = identifyLead(it);
  if (known.name || known.website || it.company_id) return researchRadarItem(itemId, {}, trigger);
  await behindThenResearch(itemId, trigger, budgetMs);
  return (await one<{ id: number }>("select id from sales_research_runs where radar_item_id = $1 order by id desc limit 1", [itemId]))?.id ?? null;
}

/** True when the lead came from a marketplace where replying costs credits. */
export function isPaidMarketplace(url: string | null | undefined): boolean {
  const d = url ? domainOf(url) : null;
  return !!d && PAID_MARKETPLACE.test(d);
}

