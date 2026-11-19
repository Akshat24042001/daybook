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
import { verifyEmails, verifyPhones, type Source, type VerifiedContact } from "./contact-verify";
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
  /** other businesses that could be behind it, when the evidence points to more than one; each grounded the same way */
  candidates?: Candidate[];
  /** while it runs: which step (planning, checking) */
  stage?: string;
  /** every phone and email kept, with the page that proves it and whether it is the person's own or the business's */
  verified?: VerifiedContact[];
  /** contacts from an older search that were never proven: kept for the record, never shown as a way to reach them */
  unverified?: { phones: string[]; emails: string[] };
}

export interface Candidate {
  company: string;
  website: string | null;
  location: string | null;
  person: string | null;
  why: string;
  confidence: "high" | "medium" | "low";
  evidence_url: string | null;
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
  // the place and the kind of business: the same need is often on the company's own site, a local listing or LinkedIn
  const words = item.title.replace(/\([^)]*\)/g, " ").replace(/\b(need|needed|looking|for|a|an|the|to|and|with|our|my|build|developer|expert|urgent|project)\b/gi, " ").replace(/\s+/g, " ").trim();
  if (where && words) out.push(`${words} ${where}`);
  if (where && fit?.industry) out.push(`${fit.industry} company ${where} hiring OR "looking for" developer OR automation`);
  return [...new Set(out)].slice(0, 7);
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
 "emails": emails written on a page (not your own guess) that is clearly about THIS business or person, [],
 "phones": phone numbers written on a page that is clearly about THIS business or person, copied exactly, [],
 "confidence": "high" (the evidence clearly ties this business to this post: same details, same site, same name and place) | "medium" (likely) | "low" (a guess),
 "evidence": [{"url": a URL from the evidence, "says": "what it shows, one line"}],
 "note": "one or two plain lines: what you found and how sure you are, or why nothing could be tied to the post",
 "candidates": when more than one business could be behind it, up to 3 OTHER possibilities (not the main one), each
   {"company": name exactly as the evidence writes it, "website": a domain in the evidence or null, "location": city and country,
    "person": a named owner or decision maker in the evidence or null, "why": "what ties it to this post, one line",
    "confidence": "high|medium|low", "evidence_url": a URL from the evidence or null}
}
Match the poster's city and country, the industry, the size and the exact details of the post: a business in another
country, or one whose details contradict the post, is not a match.
Rules: only businesses. If the post is a private person's personal job, kind "private" and every other field null or empty.
Never guess an email or phone pattern. Never use details of a different business with a similar name.
If nothing in the evidence ties a business to this post, say so with confidence "low" and nulls.
A wrong phone number or email is far worse than none: the owner will call a stranger. Leave a contact out unless you see it
written on a page about this exact business. What "Google search (Gemini)" wrote is a summary, not a page: it proves nothing.
Every contact is checked against the pages afterwards and dropped when it is not there.`;

const blank = (note: string, status: Identity["status"]): Identity => ({ status, emails: [], phones: [], evidence: [], note, checked_at: new Date().toISOString() });

type Item = { id: number; title: string; body: string | null; url: string | null; poster: Poster | null; fit: { company?: string | null; website?: string | null; industry?: string | null; country?: string | null; city?: string | null } | null };
type Draft = {
  kind?: string; company?: string | null; website?: string | null; person?: string | null; title?: string | null; linkedin?: string | null;
  emails?: string[]; phones?: string[]; confidence?: string; evidence?: { url: string; says: string }[]; note?: string; candidates?: unknown;
};
/** What round one leaves for round two: the evidence read and the first answer. */
export interface HuntWork { hay: string; evidence: { url: string; text: string; ai?: boolean }[]; draft: Draft; hooks: string[]; place: string | null }

const loadItem = (itemId: number) => one<Item>("select id, title, body, url, poster, fit from sales_radar_items where id = $1", [itemId]);
const saveIdentity = (itemId: number, id: Identity) => q("update sales_radar_items set identity = $2 where id = $1", [itemId, JSON.stringify(id)]);

const PLAN = `You plan how to find the business behind a posted requirement, like an expert open-source researcher. You get the post,
the poster's public profile and what is already known. Read every hint: brand, product, app or shop names; website fragments;
the exact unusual phrases; the place (city, area, currency, phone code, language, time zone); the kind of business and its size;
the poster's username (people reuse it on other sites); tools, platforms and partners named; dates and events.
Return JSON {"hooks": [the 3 to 8 strongest hints, short], "place": "city, country" or null, "business_type": "what kind of business" or null,
"queries": [up to 8 web search queries that would surface the business or its owner: exact phrases in quotes, the username on other sites,
brand or product names with the place, the kind of business with the place and the need]}.
Businesses only: if it reads like a private person's own job, return {"hooks": [], "queries": [], "private": true}. No dashes as punctuation.`;

/** Round one: plan from every hint, then search the web and Google together, and form a first answer. */
export async function huntRound1(it: Item, deadline: number): Promise<HuntWork | { private: true; note: string }> {
  const clues = postClues(it);
  const post = `${it.title}\n${it.body ?? ""}`;
  const known = `POST (${it.url ?? ""}):\n${post.slice(0, 3000)}\n\nPOSTER: ${JSON.stringify(it.poster ?? {})}\n\nKNOWN: ${JSON.stringify(it.fit ?? {})}`;
  const plan = await llmJson<{ hooks?: string[]; place?: string | null; queries?: string[]; private?: boolean }>(PLAN, known, { maxTokens: 900, totalMs: 15_000 })
    .catch(() => ({ hooks: [], queries: [] } as { hooks?: string[]; place?: string | null; queries?: string[]; private?: boolean }));
  if (plan.private) return { private: true, note: "This reads like a private person's own job, not a business. Reply on the platform instead." };
  const hooks = (plan.hooks ?? []).map(String).filter(Boolean).slice(0, 8);
  const place = plan.place ? String(plan.place).slice(0, 80) : [it.poster?.city, it.poster?.country ?? it.fit?.country].filter(Boolean).join(", ") || null;
  const queries = [...new Set([...behindQueries(it, clues, it.fit), ...(plan.queries ?? []).map((x) => String(x).trim()).filter((x) => x.length > 3)])].slice(0, 12);

  const evidence: { url: string; text: string; ai?: boolean }[] = [{ url: it.url ?? "the post", text: post }];
  if (it.poster) evidence.push({ url: it.poster.profile_url ?? "poster profile", text: `Poster's public profile: ${JSON.stringify(it.poster)}` });

  // the business's own site, when the post names it
  const site = it.fit?.website ? domainOf(it.fit.website) : clues.websites[0] ?? null;
  const sitePages = site && !PLATFORM.test(site)
    ? Promise.all(["", "/contact", "/about"].map((path) => fetchPage(`https://${site}${path}`, { maxChars: 5000 }).catch(() => null)))
    : Promise.resolve([]);
  // the web, four searches at a time, while Google (through Gemini) is asked the same question with every hint
  const webPass = (async () => {
    const hits: SearchHit[] = [];
    for (let i = 0; i < queries.length && Date.now() < deadline - 18_000; i += 4) {
      const got = await Promise.all(queries.slice(i, i + 4).map((qy) => webSearch(qy, 6, "radar: who is behind").catch(() => [] as SearchHit[])));
      hits.push(...got.flat());
    }
    return hits;
  })();
  const googlePass = geminiSearchReady() && Date.now() < deadline - 20_000
    ? groundedResearch(
      `Find the business that posted this requirement on ${(it.url && domainOf(it.url)) || "a job site"}, its owner or decision maker, and the contact details the business publishes (website, business email, business phone, LinkedIn).\n` +
      `Work like an investigator: search the exact phrases, the brand and product names, the poster's username on other sites, and the kind of business in the place.\n` +
      `HINTS: ${hooks.join("; ") || "none"}\nPLACE: ${place ?? "unknown"}\n` +
      `Only report what you can tie to this post, and how. If it is a private person's personal job, say so and stop.\n\nPOST:\n${post.slice(0, 2500)}\n\nPOSTER: ${JSON.stringify(it.poster ?? {})}`,
      { timeoutMs: Math.min(32_000, deadline - Date.now() - 12_000), label: "radar: who is behind", deep: true },
    ).catch(() => null)
    : Promise.resolve(null);
  const [pages, hits, g] = await Promise.all([sitePages, webPass, googlePass]);
  for (const page of pages) if (page?.text) evidence.push({ url: page.url, text: `${page.title}\n${page.text}\n${page.html ? extractPhones(page.html).join(" ") : ""}` });
  const seen = new Set<string>();
  for (const h of hits) {
    if (seen.has(h.url) || seen.size >= 30) continue;
    seen.add(h.url);
    evidence.push({ url: h.url, text: `${h.title}\n${h.snippet}` });
  }
  if (g?.text) {
    // what Google's AI wrote is a lead to follow, never proof; the pages it cites are evidence
    evidence.push({ url: "Google search (Gemini)", text: g.text, ai: true });
    for (const x of g.sources) evidence.push({ url: x.url, text: `${x.title}\n${x.snippet}` });
  }

  const draft = await llmJson<Draft>(SYSTEM, `${known}\n\nHINTS: ${hooks.join("; ")}\nPLACE: ${place ?? "unknown"}\n\nEVIDENCE:\n${evidence.slice(1).map((e, i) => `[${i + 1}] ${e.url}\n${e.text.slice(0, 1800)}`).join("\n\n").slice(0, 26_000)}`,
    { maxTokens: 1800, totalMs: Math.max(12_000, deadline - Date.now()), deep: true });
  if (draft.kind === "private") return { private: true, note: draft.note || "This reads like a private person's own job, not a business. Reply on the platform instead." };
  return { hay: evidence.map((e) => `${e.url}\n${e.text}`).join("\n\n").slice(0, 60_000), evidence, draft, hooks, place };
}

/**
 * Round two: every business round one named (the main answer and the other possibilities) is checked: its own
 * website's home, contact and about pages, and a search for it with the place. Then the answer is written again from
 * all of it, so the business that really matches wins and its published contacts are filled in.
 */
export async function huntRound2(it: Item, w: HuntWork, deadline: number): Promise<Identity> {
  const names: { company: string; website: string | null }[] = [];
  const add = (company: unknown, website: unknown) => {
    const c = typeof company === "string" ? company.trim() : "";
    if (c.length < 2 || names.some((n) => n.company.toLowerCase() === c.toLowerCase())) return;
    names.push({ company: c, website: typeof website === "string" && website ? website : null });
  };
  add(w.draft.company, w.draft.website);
  for (const c of Array.isArray(w.draft.candidates) ? w.draft.candidates : []) add((c as Record<string, unknown>)?.company, (c as Record<string, unknown>)?.website);
  if (!names.length) return groundIdentity(w.draft, w.hay, proofOf(it, w.evidence, w.place));
  const more: { url: string; text: string }[] = [];
  await Promise.all(names.slice(0, 4).map(async (n) => {
    if (Date.now() > deadline - 15_000) return;
    const dom = n.website ? domainOf(/^https?:/i.test(n.website) ? n.website : `https://${n.website}`) : null;
    if (dom && !PLATFORM.test(dom)) {
      const pages = await Promise.all(["", "/contact", "/contact-us", "/about"].map((path) => fetchPage(`https://${dom}${path}`, { maxChars: 4000 }).catch(() => null)));
      for (const page of pages) if (page?.text) more.push({ url: page.url, text: `${page.title}\n${page.text}\n${page.html ? `${extractPhones(page.html).join(" ")} ${extractEmails(page.html, page.url).map((e) => e.email).join(" ")}` : ""}` });
    }
    const hits = await webSearch(`"${n.company}"${w.place ? ` ${w.place}` : ""} contact OR owner OR founder`, 6, "radar: who is behind").catch(() => [] as SearchHit[]);
    for (const h of hits) more.push({ url: h.url, text: `${h.title}\n${h.snippet}` });
  }));
  const evidence = [...w.evidence, ...more];
  const hay = `${w.hay}\n\n${more.map((e) => `${e.url}\n${e.text}`).join("\n\n")}`;
  const post = `${it.title}\n${it.body ?? ""}`;
  const out = await llmJson<Draft>(`${SYSTEM}
This is the second, checking round: you also get FIRST ANSWER and what was found when each business it named was checked. Keep the business
whose details really match the post (place, kind of business, the exact need, the poster); demote or drop the others. Fill in the contacts
those businesses publish, only as they appear in the evidence.`,
  `POST (${it.url ?? ""}):\n${post.slice(0, 3000)}\n\nPOSTER: ${JSON.stringify(it.poster ?? {})}\nHINTS: ${w.hooks.join("; ")}\nPLACE: ${w.place ?? "unknown"}\n\nFIRST ANSWER: ${JSON.stringify(w.draft).slice(0, 3000)}\n\nEVIDENCE:\n${evidence.slice(1).map((e, i) => `[${i + 1}] ${e.url}\n${e.text.slice(0, 1500)}`).join("\n\n").slice(0, 30_000)}`,
  { maxTokens: 1800, totalMs: Math.max(12_000, deadline - Date.now()), deep: true }).catch(() => w.draft);
  if (out.kind === "private") return blank(out.note || "This reads like a private person's own job, not a business.", "private");
  return groundIdentity(out, hay, proofOf(it, evidence, w.place));
}

/**
 * Looks for the business behind one radar lead and saves what it finds on the lead (both rounds in one go, within the
 * time given: used by automatic preparation). The button runs the same two rounds as background steps (startFindBehind).
 */
export async function findBehindPost(itemId: number, budgetMs = 45_000): Promise<Identity> {
  const deadline = Date.now() + budgetMs;
  const it = await loadItem(itemId);
  if (!it) throw new UserError("That lead no longer exists.");
  if (!llmConfigured()) throw new UserError("Finding who is behind a post needs an AI key: add GEMINI_API_KEY.");
  await saveIdentity(itemId, blank("Looking for the business behind this post…", "running"));
  try {
    const w = await huntRound1(it, deadline - (budgetMs > 40_000 ? 15_000 : 0));
    const id = "private" in w ? blank(w.note, "private") : Date.now() < deadline - 15_000 ? await huntRound2(it, w, deadline) : groundIdentity(w.draft, w.hay, proofOf(it, w.evidence, w.place));
    await saveIdentity(itemId, id);
    return id;
  } catch (e) {
    const id = blank(e instanceof UserError ? e.message : `The search could not finish: ${(e as Error).message.slice(0, 160)}. Try again.`, "error");
    await saveIdentity(itemId, id);
    return id;
  }
}

/**
 * The "Find them directly" button: marks the lead as being searched and queues round one, which starts at once in the
 * background. The page is never held up, you can open other leads meanwhile, and coming back shows the progress.
 */
export async function startFindBehind(itemId: number, trigger = "manual"): Promise<number | null> {
  const it = await loadItem(itemId);
  if (!it) throw new UserError("That lead no longer exists.");
  if (!llmConfigured()) throw new UserError("Finding who is behind a post needs an AI key: add GEMINI_API_KEY.");
  await saveIdentity(itemId, { ...blank("Reading every hint in the post and planning the search…", "running"), stage: "planning" });
  const { enqueue } = await import("./jobs");
  return enqueue("find_behind", { id: itemId, round: 1, trigger }, { dedupeKey: `find_behind:${itemId}` });
}

/** The background steps of the button: round one, then round two in its own slot, then the company research. */
export async function findBehindStep(itemId: number, round: number, trigger = "manual"): Promise<void> {
  const it = await loadItem(itemId);
  if (!it) return;
  const { enqueue, kickJob } = await import("./jobs");
  try {
    if (round === 1) {
      const w = await huntRound1(it, Date.now() + 48_000);
      if ("private" in w) return void (await saveIdentity(itemId, blank(w.note, "private")));
      const named = [w.draft.company, ...(Array.isArray(w.draft.candidates) ? w.draft.candidates.map((c) => (c as Record<string, unknown>)?.company) : [])].filter(Boolean).length;
      await q("update sales_radar_items set hunt_work = $2 where id = $1", [itemId, JSON.stringify(w)]);
      await saveIdentity(itemId, { ...blank(named ? `Checking ${named} possible business${named === 1 ? "" : "es"}: their sites, contacts and place…` : "Writing up what was found…", "running"), stage: "checking" });
      const job = await enqueue("find_behind", { id: itemId, round: 2, trigger }, { dedupeKey: `find_behind:${itemId}:2` });
      await kickJob(job);
      return;
    }
    const work = (await one<{ w: HuntWork | null }>("select hunt_work as w from sales_radar_items where id = $1", [itemId]))?.w;
    if (!work) return void (await findBehindStep(itemId, 1, trigger));
    const id = await huntRound2(it, work, Date.now() + 48_000);
    await saveIdentity(itemId, id);
    await q("update sales_radar_items set hunt_work = null where id = $1", [itemId]);
    await afterFound(itemId, id, trigger);
  } catch (e) {
    await saveIdentity(itemId, blank(e instanceof UserError ? e.message : `The search could not finish: ${(e as Error).message.slice(0, 160)}. Try again.`, "error"));
  }
}

/** A business was found: the lead gets it, and the full company research follows (decision makers, every contact). */
async function afterFound(itemId: number, id: Identity, trigger: string): Promise<void> {
  if (!((id.status === "found" || id.status === "partial") && (id.company || id.website) && id.confidence !== "low")) return;
  const { researchRadarItem } = await import("./research");
  await researchRadarItem(itemId, { company: id.company ?? null, website: id.website ?? null }, trigger).catch(() => {});
  if (id.person) {
    const fit = (await one<{ fit: Record<string, unknown> | null }>("select fit from sales_radar_items where id = $1", [itemId]))?.fit ?? {};
    await q("update sales_radar_items set fit = $2 where id = $1", [itemId, JSON.stringify({ ...fit, contact: fit.contact ?? id.person, company: fit.company ?? id.company, website: fit.website ?? id.website })]);
  }
}

/** The pages read for a lead, the post itself, and the country it is in: what a contact is checked against. */
export interface Proof { sources: Source[]; post: { url: string; text: string }; country: string | null }

/** Builds the proof for groundIdentity from what a round read. Pure. */
export function proofOf(it: Pick<Item, "url" | "title" | "body" | "poster" | "fit">, evidence: { url: string; text: string; ai?: boolean }[], place: string | null): Proof {
  const country = it.poster?.country ?? it.fit?.country ?? (place ? place.split(",").pop()!.trim() : null);
  return { sources: evidence.map((e) => ({ url: e.url, text: e.text, ai: e.ai || !/^https?:\/\//i.test(e.url) })), post: { url: it.url ?? "the post", text: `${it.title}\n${it.body ?? ""}` }, country: country || null };
}

/** Keeps only what the evidence shows: names and sites it mentions, and contacts proven by contact-verify. Pure. */
export function groundIdentity(
  out: { company?: string | null; website?: string | null; person?: string | null; title?: string | null; linkedin?: string | null; emails?: string[]; phones?: string[]; confidence?: string; evidence?: { url: string; says: string }[]; note?: string; candidates?: unknown },
  hay: string,
  proof?: Proof,
): Identity {
  // only what real pages say counts: the AI's own summary is not a source for a name, a site or a contact
  const low = (proof ? [`${proof.post.url}\n${proof.post.text}`, ...proof.sources.filter((x) => !x.ai).map((x) => `${x.url}\n${x.text}`)].join("\n\n") : hay).toLowerCase();
  const inHay = (v: string | null | undefined) => (v && v.trim().length >= 2 && low.includes(v.trim().toLowerCase()) ? v.trim() : null);
  const dom = out.website ? domainOf(/^https?:/i.test(out.website) ? out.website : `https://${out.website}`) : null;
  const website = dom && !PLATFORM.test(dom) && low.includes(dom) ? `https://${dom}` : null;
  const digits = (s: string) => s.replace(/\D/g, "");
  const hayDigits = hay.replace(/\D/g, "");
  const company = inHay(out.company);
  const person = inHay(out.person);
  // a contact counts only with proof: on a real page about this business or person (contact-verify). With no pages to
  // check against, nothing is kept: no contact is better than someone else's.
  const verified: VerifiedContact[] = [];
  if (proof) {
    const subject = { company, domain: website ? domainOf(website) : null, person, country: proof.country };
    // what the poster wrote in their own post is theirs
    const postText = `${proof.post.text}`;
    for (const e of out.emails ?? []) if (postText.toLowerCase().includes(String(e).toLowerCase())) verified.push({ kind: "email", value: String(e).toLowerCase(), url: proof.post.url, owner: "person" });
    for (const p of out.phones ?? []) if (digits(p).length >= 8 && digits(postText).includes(digits(p).slice(-9))) verified.push({ kind: "phone", value: String(p), url: proof.post.url, owner: "person" });
    const others = proof.sources.filter((x) => x.url !== proof.post.url);
    for (const v of [...verifyEmails(out.emails ?? [], others, subject), ...verifyPhones(out.phones ?? [], others, subject)]) {
      if (!verified.some((x) => digits(x.value) === digits(v.value) && x.kind === v.kind && (v.kind === "phone" || x.value === v.value))) verified.push(v);
    }
  }
  void hayDigits;
  const emails = verified.filter((v) => v.kind === "email").map((v) => v.value).slice(0, 5);
  const phones = verified.filter((v) => v.kind === "phone").map((v) => v.value).slice(0, 4);
  const linkedin = out.linkedin && seenIn(low, out.linkedin) ? out.linkedin : null;
  const confidence = (["high", "medium", "low"].includes(String(out.confidence)) ? out.confidence : "low") as Identity["confidence"];
  const found = !!(company || website) && confidence !== "low";
  const direct = emails.length || phones.length || linkedin;
  return {
    status: found && (direct || person) ? "found" : found || direct ? "partial" : "not_found",
    company, website, person, title: person ? out.title ?? null : null, linkedin, emails, phones, confidence, verified,
    evidence: (out.evidence ?? []).filter((e) => e?.url && (low.includes(String(e.url).toLowerCase()) || /gemini/i.test(String(e.url)))).slice(0, 6).map((e) => ({ url: String(e.url), says: String(e.says ?? "").slice(0, 200) })),
    note: String(out.note ?? "").slice(0, 400) || (found ? "Business identified from the evidence." : "Nothing in the evidence ties a business to this post."),
    checked_at: new Date().toISOString(),
    candidates: groundCandidates(out.candidates, low, company),
  };
}

/** Other possible businesses, each kept only when the evidence names it; never the main one twice. Pure. */
export function groundCandidates(list: unknown, hay: string, main: string | null): Candidate[] {
  if (!Array.isArray(list)) return [];
  const low = hay.toLowerCase();
  const out: Candidate[] = [];
  for (const raw of list.slice(0, 5)) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const company = typeof c.company === "string" ? c.company.trim() : "";
    if (company.length < 2 || !low.includes(company.toLowerCase()) || company.toLowerCase() === main?.toLowerCase()) continue;
    if (out.some((x) => x.company.toLowerCase() === company.toLowerCase())) continue; // the same business twice
    const dom = typeof c.website === "string" && c.website ? domainOf(/^https?:/i.test(c.website) ? c.website : `https://${c.website}`) : null;
    const person = typeof c.person === "string" && c.person.trim().length >= 3 && low.includes(c.person.trim().toLowerCase()) ? c.person.trim() : null;
    const url = typeof c.evidence_url === "string" && low.includes(c.evidence_url.toLowerCase()) ? c.evidence_url : null;
    out.push({
      company, website: dom && !PLATFORM.test(dom) && low.includes(dom) ? `https://${dom}` : null,
      location: typeof c.location === "string" ? c.location.slice(0, 80) : null, person,
      why: typeof c.why === "string" ? c.why.slice(0, 200) : "", confidence: (["high", "medium", "low"].includes(String(c.confidence)) ? c.confidence : "low") as Candidate["confidence"],
      evidence_url: url,
    });
    if (out.length >= 3) break;
  }
  return out;
}

/** For a lead whose business was found: the company research follows with it (decision makers, every contact). */
export async function behindThenResearch(itemId: number, trigger = "auto", budgetMs = 45_000): Promise<Identity> {
  const id = await findBehindPost(itemId, budgetMs);
  await afterFound(itemId, id, trigger);
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
  if (trigger === "manual") {
    // from a button: the two rounds run in the background, the research follows them
    const { kickJob } = await import("./jobs");
    await kickJob(await startFindBehind(itemId, trigger));
    return null;
  }
  await behindThenResearch(itemId, trigger, budgetMs);
  return (await one<{ id: number }>("select id from sales_research_runs where radar_item_id = $1 order by id desc limit 1", [itemId]))?.id ?? null;
}

/** True when the lead came from a marketplace where replying costs credits. */
export function isPaidMarketplace(url: string | null | undefined): boolean {
  const d = url ? domainOf(url) : null;
  return !!d && PAID_MARKETPLACE.test(d);
}

