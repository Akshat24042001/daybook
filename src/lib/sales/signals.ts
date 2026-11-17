/**
 * Hidden needs: businesses that never posted a requirement but are showing, in public, that they need what we sell.
 *
 * Every few hours one country and one industry from your Sales settings are picked (your best ones more often), and
 * two buying signals are searched there:
 *   sales_hiring      hiring SDRs, BDRs, inside sales, appointment setters: they are paying people to do outreach and
 *                     follow up by hand, which an AI sales agent and automated follow ups do faster and cheaper
 *   front_desk        hiring receptionists, call centre or customer service agents: calls and enquiries pile up
 *   new_sales_leader  a new Head of Sales, VP Sales, CRO or RevOps lead: new leaders review the stack in their first months
 *   funding           a fresh round: they must grow fast without growing headcount at the same pace
 *   expansion         a new branch, location or market: more enquiries, more bookings, the same team
 *   slow_response     public reviews about nobody answering, missed calls, no follow up
 * The AI may only name companies the search results really name, with the page that shows the signal, so every lead
 * is grounded: no evidence page, no lead. Recruiters and job boards posting for someone else are dropped. Each lead
 * carries why they likely need it (tied to that evidence), which offer fits, who decides, and an opener. From there it
 * is a radar lead like any other: scored, researched (the company, the decision maker, their direct contacts) and a
 * message written, all on its own.
 */
import { q } from "../db";
import { salesConfig } from "./config";
import { currentFocus } from "./focus";
import { llmConfigured, llmJson } from "./llm";
import { storeItems } from "./radar";
import { geminiSearchReady, groundedResearch, webSearch, type SearchHit } from "./search";
import { groundProspects } from "./targets";

export const SIGNAL_KINDS = ["sales_hiring", "front_desk", "new_sales_leader", "funding", "expansion", "slow_response"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const SIGNAL_INFO: Record<SignalKind, { label: string; means: string; offer: string; who: string }> = {
  sales_hiring: {
    label: "Hiring salespeople",
    means: "is hiring SDRs, BDRs, inside sales or appointment setters, so outreach, lead qualification and follow ups are done by hand",
    offer: "an AI sales agent that qualifies leads, follows up on WhatsApp and email, and books meetings, plus a CRM that keeps score",
    who: "Founder, CEO, Head of Sales or VP Sales",
  },
  front_desk: {
    label: "Hiring front desk or call staff",
    means: "is hiring receptionists, call centre or customer service agents, so calls and enquiries are more than the team can answer",
    offer: "a voice agent that answers every call and books appointments, and a WhatsApp agent that replies in seconds",
    who: "Founder, owner, General Manager or Head of Operations",
  },
  new_sales_leader: {
    label: "New sales leader",
    means: "just appointed a new Head of Sales, VP Sales, CRO or RevOps lead; new leaders review tools and process in their first 90 days",
    offer: "a sales growth system: lead capture, CRM, reporting and AI follow ups, set up in weeks",
    who: "the new sales leader by name",
  },
  funding: {
    label: "Just raised money",
    means: "just raised funding and must grow fast without growing the team at the same pace",
    offer: "AI agents and automation for sales, support and operations, so growth does not need the same growth in headcount",
    who: "Founder or CEO",
  },
  expansion: {
    label: "Expanding",
    means: "is opening a new branch, location or market, so enquiries and bookings grow while the team stays the same",
    offer: "lead capture, a booking and WhatsApp agent, and a voice agent for the new location",
    who: "Founder, owner or the person leading the expansion",
  },
  slow_response: {
    label: "Customers complain about slow replies",
    means: "has public reviews about nobody answering, missed calls or no follow up, which loses them customers every week",
    offer: "a voice agent and a WhatsApp agent that answer every enquiry in seconds, day and night",
    who: "Owner, founder or General Manager",
  },
};

/** The searches for one signal in one country and industry. Pure. */
export function signalQueries(kind: SignalKind, country: string, industry: string, year: number): string[] {
  switch (kind) {
    case "sales_hiring":
      return [
        `${industry} company ${country} hiring "sales development representative" OR "business development representative" OR "inside sales" ${year}`,
        `${industry} ${country} job "appointment setter" OR "telesales" OR "lead generation executive" ${year}`,
      ];
    case "front_desk":
      return [
        `${industry} ${country} hiring receptionist OR "front desk" OR "call centre agent" OR "customer service representative" ${year}`,
        `${industry} ${country} job "answer calls" "book appointments" ${year}`,
      ];
    case "new_sales_leader":
      return [
        `${industry} ${country} appoints "head of sales" OR "vice president of sales" OR "chief revenue officer" ${year}`,
        `${industry} ${country} "joins as" "head of sales" OR "sales director" OR "revenue operations" ${year}`,
      ];
    case "funding":
      return [
        `${industry} startup ${country} raises seed OR "series a" OR "series b" ${year}`,
        `${industry} company ${country} secures funding to expand ${year}`,
      ];
    case "expansion":
      return [
        `${industry} ${country} "opens new" OR "new location" OR "new branch" OR "expands to" ${year}`,
        `${industry} business ${country} expansion new office OR showroom OR clinic ${year}`,
      ];
    case "slow_response":
      return [
        `${industry} ${country} reviews "never called back" OR "no one answers" OR "no response" OR "slow to respond"`,
        `${industry} ${country} complaint "didn't call back" OR "never replied" OR "impossible to reach"`,
      ];
  }
}

/** Which country, industry and signals a run looks at: the focus half the time, the rest of your list the rest. Pure. */
export function pickSignalRun(countries: string[], industries: string[], focus: { country: string; industry: string }, salt: number): { country: string; industry: string; kinds: SignalKind[] } {
  const cs = countries.length ? countries : [focus.country];
  const is = industries.length ? industries : [focus.industry];
  const country = salt % 2 === 0 ? focus.country : cs[(salt >> 1) % cs.length];
  const industry = salt % 3 === 0 ? focus.industry : is[(salt * 7) % is.length];
  const a = SIGNAL_KINDS[salt % SIGNAL_KINDS.length];
  const b = SIGNAL_KINDS[(salt + 3) % SIGNAL_KINDS.length];
  return { country, industry, kinds: [a, b] };
}

export interface SignalLead {
  company: string;
  website: string | null;
  signal: SignalKind;
  evidence_url: string;
  evidence: string;
  need: string;
  offer: string;
  who: string;
  opener: string;
  city: string | null;
  industry: string | null;
}

// recruiters, staffing firms and job boards post for someone else: the buyer is not them
const MIDDLEMAN = /\b(recruit\w*|staffing|talent (?:solutions|partners|hunters?)|headhunt\w*|manpower|placements?|job boards?|jobs? portal|outsourc\w*|bpo)\b/i;
const BOARD = /(indeed|glassdoor|ziprecruiter|monster|reed\.co|seek\.com|naukri|bayt|gulftalent|totaljobs|careerbuilder|simplyhired|jooble|adzuna|crunchbase|techcrunch|prnewswire|businesswire|globenewswire|trustpilot|yelp|tripadvisor|google\.)/i;

/**
 * Keeps only companies the results really name, with the evidence page and their own website only when it appears in
 * the results; drops recruiters and anything already on the radar. Pure.
 */
export function groundSignals(list: Partial<SignalLead>[], hits: SearchHit[], known: string[] = []): SignalLead[] {
  const usable = list.filter((x) => x.company && !MIDDLEMAN.test(String(x.company)) && SIGNAL_KINDS.includes(x.signal as SignalKind));
  const grounded = groundProspects(usable.map((x) => ({ company: x.company, website: x.website, evidence_url: x.evidence_url, why: x.need, industry: x.industry })), hits, known);
  return grounded.flatMap((g) => {
    const x = usable.find((u) => String(u.company).trim().toLowerCase() === g.company.toLowerCase());
    if (!x) return [];
    const website = g.website && !BOARD.test(g.website) ? g.website : null;
    const info = SIGNAL_INFO[x.signal as SignalKind];
    return [{
      company: g.company, website, signal: x.signal as SignalKind, evidence_url: g.evidence_url, evidence: g.evidence,
      need: String(x.need ?? "").slice(0, 400) || `${g.company} ${info.means}.`,
      offer: String(x.offer ?? "").slice(0, 300) || info.offer,
      who: String(x.who ?? "").slice(0, 120) || info.who,
      opener: String(x.opener ?? "").slice(0, 400),
      city: x.city ? String(x.city).slice(0, 60) : null,
      industry: g.industry,
    }];
  });
}

/** The text a signal lead is stored with: the facts first, then the reasoning, each labelled. Pure. */
export function signalBody(l: SignalLead, country: string): string {
  const info = SIGNAL_INFO[l.signal];
  return [
    `[hidden need: ${info.label}] ${l.company}${l.city ? `, ${l.city}` : ""}, ${country}. Nobody posted this: we found a public signal.`,
    `Signal: ${l.evidence} (${l.evidence_url})`,
    l.website ? `Website: ${l.website}` : "",
    `Why they likely need it: ${l.need}`,
    `What fits: ${l.offer}`,
    `Who decides: ${l.who}`,
    l.opener ? `Opener idea: ${l.opener}` : "",
  ].filter(Boolean).join("\n");
}

/** One run: two signals in one country and industry, grounded leads stored on the radar as hidden needs. */
export async function huntSignals(budgetMs = 45_000, salt?: number): Promise<{ added: number; country: string; industry: string; kinds: SignalKind[] }> {
  const started = Date.now();
  const cfg = await salesConfig();
  const focus = await currentFocus(cfg);
  const n = salt ?? ((await q<{ n: number }>("select count(*)::int as n from sales_jobs where kind = 'signal_hunt' and status = 'done'"))[0]?.n ?? 0);
  const run = pickSignalRun(cfg.countries, cfg.industries, focus, n);
  const year = new Date().getUTCFullYear();
  const queries = run.kinds.flatMap((k) => signalQueries(k, run.country, run.industry, year));
  const lists = await Promise.allSettled(queries.map((x) => webSearch(x, 10, `hidden need: ${run.industry}, ${run.country}`)));
  const hits: SearchHit[] = lists.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (geminiSearchReady() && Date.now() - started < budgetMs - 30_000) {
    const g = await groundedResearch(
      `Find up to 10 real, independent ${run.industry} companies in ${run.country} that, in the last 90 days, ${run.kinds.map((k) => SIGNAL_INFO[k].means.replace(/^is /, "are ").replace(/^has /, "have ").replace(/^just /, "")).join("; or ")}.
For each: the exact company name, its own website, the city, and the URL of the page that shows it (job post, news, press release or review page). Only companies the search shows; no recruiters or staffing agencies.`,
      { timeoutMs: Math.min(30_000, budgetMs - (Date.now() - started) - 18_000), label: `hidden need: ${run.industry}, ${run.country}` },
    ).catch(() => null);
    if (g) hits.push({ title: "Research notes", url: "", snippet: g.text.slice(0, 1500) }, ...g.sources.map((s) => ({ title: s.title, url: s.url, snippet: s.snippet })));
  }
  const real = hits.filter((h) => h.url);
  if (!real.length || !llmConfigured()) return { added: 0, ...run };
  const known = (await q<{ t: string }>("select coalesce(poster->>'name', title) as t from sales_radar_items where lead_kind = 'signal' and found_at > now() - interval '120 days'")).map((r) => r.t);
  const out = await llmJson<{ companies?: Partial<SignalLead>[] } | Partial<SignalLead>[]>(
    `You find businesses that need what ${cfg.owner.company} sells but have not asked for it. ${cfg.owner.company} is an AI agency (offers: ${cfg.offers.join("; ")}).
From the SEARCH RESULTS ONLY, list companies in ${run.country} (industry: ${run.industry}, or close to it) that show one of these signals:
${run.kinds.map((k) => `- "${k}": the company ${SIGNAL_INFO[k].means}. Fits: ${SIGNAL_INFO[k].offer}. Decides: ${SIGNAL_INFO[k].who}.`).join("\n")}
Rules, all strict:
- The company is the employer or the business itself, named exactly as the results write it. Never a recruiter, staffing agency, job board, news site or directory.
- "evidence_url" is the result URL that shows the signal for that company. No URL in the results, no company.
- "website" only when the company's own site appears in the results, else null.
- "need": two plain sentences tying the signal to a problem they likely have, with the reasoning shown (e.g. "Hiring 3 SDRs means outreach and follow up are manual; each SDR costs about X a year"). Say "likely", never claim facts the results do not show.
- "offer": which of the offers fits and what it would do for them, one sentence.
- "who": the job title (or name, when the results name the person) of who decides.
- "opener": one specific first line that mentions the signal, value first, no hype, no dashes.
- "city": the city when the results say it, else null.
- Skip big enterprises (over about 2,000 staff) and government bodies: they buy through procurement, not from a message.
- Never invent anything. Fewer, real companies beat many guesses. Return {"companies": []} when none qualify.
Return {"companies": [{"company","website","signal","evidence_url","need","offer","who","opener","city","industry"}]} with at most 8.`,
    hits.slice(0, 40).map((x, i) => `#${i + 1} ${x.title}\n${x.url}\n${x.snippet}`).join("\n\n"),
    { maxTokens: 2600, totalMs: Math.max(12_000, Math.min(35_000, budgetMs - (Date.now() - started) - 4_000)) },
  ).catch(() => [] as Partial<SignalLead>[]);
  const leads = groundSignals(Array.isArray(out) ? out : out.companies ?? [], real, known);
  const added = await storeItems(null, leads.map((l) => ({
    title: `${l.company}${l.city ? `, ${l.city}` : ""}, ${run.country}: ${SIGNAL_INFO[l.signal].label.toLowerCase()}`,
    url: l.website ?? l.evidence_url,
    key: `signal:${l.company.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
    body: signalBody(l, run.country),
    poster: { name: l.company, city: l.city, country: run.country, profile_url: l.website },
  })), { kind: "signal" });
  return { added, ...run };
}
