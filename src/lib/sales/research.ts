/**
 * Deep research on a lead's company and the people behind it. Public sources only, in stages so each one fits in a
 * serverless time slot and you can watch it work:
 *   1. site     read the company's own website (home plus about, team, contact, careers, services, pricing, news...),
 *               pull out emails, phones, socials and addresses, and read the domain's registration and email set-up;
 *   2. search   a dozen targeted web searches: money, size, leadership, reviews, hiring, news, competitors, people;
 *   3. synth    the AI writes the profile from that evidence only; contact and domain facts come straight from the pages
 *               and DNS, never from the AI; the people found are saved as contacts and each decision maker is researched;
 *   person      searches for the individual, adds the company context, and works out their likely work email.
 * Every run keeps a plain-language log and the list of sources it used, so you can see what was found and where.
 */
import { one, q, UserError } from "../db";
import { salesConfig } from "./config";
import {
  COMPANY_FIELDS, NOT_THEIR_SITE, PERSON_FIELDS, allKeys, domainGuesses, subLinks, techAudit, wikidata, type Enrichment, type Field,
} from "./enrich";
import {
  anchorLines, businessDomain, canDisambiguate, gatherAnchors, knownCountry, matchLead, nameKeyWords, normCountry, placeOf, placeTerm, type Anchors, type Match,
} from "./anchors";
import { domainOf, ensureCompany, upsertPerson } from "./identity";
import { verifyEmails, wrongCountry, type Source as ProofSource } from "./contact-verify";
import { enqueue } from "./jobs";
import { llmJson } from "./llm";
import {
  ageYears, classifyMx, extractContacts, guessEmail, learnEmailPattern, mergeContacts, parseRdap, parseSpf, type Contacts, type EmailPattern,
} from "./research-extract";
import { fetchPage, geminiSearchReady, groundedResearch, webSearch, type Grounded, type SearchHit } from "./search";
export { gatherAnchors } from "./anchors";

/**
 * A LinkedIn profile or email the AI reports is kept only if it literally appears in what was read (pages, search
 * results). A plausible-looking address the model made up never reaches your contacts.
 */
export function seenIn(text: string, value: string | null | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return false;
  const li = v.match(/linkedin\.com\/in\/([^/?#\s]+)/);
  const needle = li ? `linkedin.com/in/${decodeURIComponent(li[1])}` : v;
  const hay = text.toLowerCase();
  return hay.includes(needle) || (!!li && hay.includes(`linkedin.com/in/${li[1]}`));
}

export const STAGE_LABEL: Record<string, string> = {
  queued: "Waiting to start", site: "Reading their website", search: "Searching the web", deep: "Searching Google in depth", synth: "Writing the profile", people: "Finding the people", done: "Done",
};

export interface Source {
  label: string;
  url: string | null;
  kind: "website" | "search" | "domain" | "registry" | "you";
}
export interface RunRow {
  id: number;
  subject: "company" | "person";
  subject_id: number | null;
  radar_item_id: number | null;
  status: "queued" | "running" | "done" | "error";
  stage: string;
  trigger: string;
  log: string[];
  sources: Source[];
  error: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}
interface Evidence {
  site: string[];
  search: string[];
  wikidata: string | null;
  website: string | null;
  domain: string | null;
  contacts: Contacts;
  audit: unknown;
  intel: { registered: string | null; age: number | null; registrar: string | null; nameservers: string[]; mail: string | null; tools: string[] };
  pattern?: EmailPattern | null;
  /** how the website was proved to be the lead's (score and reasons), when it was */
  siteMatch?: { score: number; reasons: string[] } | null;
  /** Google research through Gemini: its write-up (read by the AI, but never proof of an email or profile link) */
  grounded?: string | null;
}

const UA = "Mozilla/5.0 (compatible; DaybookResearch/1.0)";
const EMPTY_CONTACTS: Contacts = { emails: [], phones: [], socials: {}, addresses: [], org: {} };

// ------------------------------------------------------------------ run bookkeeping

async function getRun(id: number): Promise<RunRow> {
  const r = await one<RunRow>("select * from sales_research_runs where id = $1", [id]);
  if (!r) throw new UserError("That research run no longer exists.");
  return r;
}
async function say(runId: number, line: string): Promise<void> {
  await q("update sales_research_runs set log = log || $2::text, updated_at = now() where id = $1", [runId, line]);
}
async function stage(runId: number, stg: string): Promise<void> {
  await q("update sales_research_runs set status = 'running', stage = $2, error = null, updated_at = now() where id = $1", [runId, stg]);
}
async function addSources(runId: number, list: Source[]): Promise<void> {
  const run = await getRun(runId);
  const seen = new Set(run.sources.map((s) => s.url ?? s.label));
  const fresh = list.filter((s) => !seen.has(s.url ?? s.label));
  if (fresh.length) await q("update sales_research_runs set sources = (sources || $2::jsonb) where id = $1", [runId, JSON.stringify(fresh.slice(0, 60))]);
}
async function failRun(runId: number, e: unknown): Promise<void> {
  await q("update sales_research_runs set status = 'error', error = $2, updated_at = now(), finished_at = now() where id = $1", [runId, (e as Error).message.slice(0, 300)]);
}

/** Starts (or joins) a research run. Returns the run id. A run already in flight for the same subject is reused. */
export async function startResearch(a: { subject: "company" | "person"; id: number | null; radarItemId?: number | null; trigger?: string }): Promise<number> {
  const live = await one<{ id: number }>(
    "select id from sales_research_runs where subject = $1 and subject_id is not distinct from $2 and status in ('queued','running') and updated_at > now() - interval '10 minutes' order by id desc limit 1",
    [a.subject, a.id],
  );
  if (live) return live.id;
  const run = await one<{ id: number }>(
    "insert into sales_research_runs (subject, subject_id, radar_item_id, trigger) values ($1,$2,$3,$4) returning id",
    [a.subject, a.id, a.radarItemId ?? null, a.trigger ?? "auto"],
  );
  await enqueue(a.subject === "company" ? "research_company" : "research_person", { runId: run!.id }, { dedupeKey: `research:${run!.id}` });
  return run!.id;
}

// ------------------------------------------------------------------ stage 1: their website and domain

const LINK_KINDS: RegExp[] = [
  /about|our-story|who-we-are|company|story/i, /team|leadership|people|management|founders|our-people/i, /contact|reach-us|get-in-touch|locations|find-us/i,
  /careers|jobs|join-us|work-with-us/i, /services|solutions|what-we-do|products|offerings/i, /pricing|plans|packages/i, /blog|news|press|media|insights/i,
];

/** The pages worth reading after the home page: at most one per kind, in order of how much they tell you. Pure. */
export function pickLinks(base: string, html: string, max = 9): string[] {
  const hrefs = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (domainOf(u.href) !== domainOf(base) || /\.(pdf|jpe?g|png|gif|svg|zip|mp4)$/i.test(u.pathname)) continue;
      hrefs.add(u.href.split("?")[0].replace(/\/+$/, ""));
    } catch {
      /* skip */
    }
  }
  const all = [...hrefs];
  const picked: string[] = [];
  for (const re of LINK_KINDS) {
    const hit = all.find((h) => re.test(new URL(h).pathname) && !picked.includes(h));
    if (hit) picked.push(hit);
  }
  for (const h of subLinks(base, html)) if (picked.length < max && !picked.includes(h.replace(/\/+$/, ""))) picked.push(h);
  return picked.slice(0, max);
}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, ...headers }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Registration date, registrar, nameservers (RDAP) and where their email lives (DNS over HTTPS). */
export async function domainIntel(domain: string): Promise<Evidence["intel"]> {
  const dns = (name: string, type: string) => getJson<{ Answer?: { data: string }[] }>(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { accept: "application/dns-json" });
  const [rdap, mx, txt] = await Promise.all([getJson<unknown>(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { accept: "application/rdap+json" }), dns(domain, "MX"), dns(domain, "TXT")]);
  const r = parseRdap(rdap);
  const hosts = (mx?.Answer ?? []).map((a) => a.data.split(/\s+/).pop() ?? "").filter(Boolean);
  return { registered: r.registered, age: ageYears(r.registered), registrar: r.registrar, nameservers: r.nameservers, mail: classifyMx(hosts), tools: parseSpf((txt?.Answer ?? []).map((a) => a.data)) };
}

export interface WebsitePick { url: string | null; page: Awaited<ReturnType<typeof fetchPage>>; match: Match | null; rejected: { url: string; why: string }[] }

/** Enough to accept a website: the owner's own, a decisive clue (email domain, phone, contact), or name plus place with nothing against it. Pure. */
export function acceptSite(m: Match, a: Anchors): boolean {
  if (m.conflict) return false;
  if (m.score >= 8) return true;
  const located = !!(a.country || a.city);
  return located ? m.score >= 4 && m.reasons.some((r) => r.startsWith("it is in") || r.includes("numbers are") || r.includes("address ends")) : m.score >= 2;
}

/**
 * Finds the lead's own website and proves it is theirs. Candidates, strongest clue first: the website you gave (taken
 * as is), your contact's business email domain, a website earlier research found, web results for the name with the
 * place, industry and phone, likely domains (the country's ending first), then Google through Gemini. Each candidate
 * page is read and scored against everything you entered; a namesake elsewhere is rejected and said so.
 */
export async function resolveWebsite(a: Anchors, opts: { skip?: string[] } = {}): Promise<WebsitePick> {
  const rejected: WebsitePick["rejected"] = [];
  const skip = new Set((opts.skip ?? []).map((u) => domainOf(u)).filter(Boolean) as string[]);
  const tried = new Set<string>();
  const check = async (url: string): Promise<WebsitePick | null> => {
    const d = domainOf(url);
    if (!d || tried.has(d) || skip.has(d) || NOT_THEIR_SITE.test(d)) return null;
    tried.add(d);
    const page = await fetchPage(/^https?:/i.test(url) ? url : `https://${url}`, { maxChars: 20_000, reader: false }).catch(() => null);
    if (!page) return null;
    const phones = page.html ? extractContacts(page.html, page.url).phones.join(" ") : "";
    let m = matchLead({ url: page.url, title: page.title, text: `${page.text} ${phones}` }, a);
    // the home page often does not say where they are, or prove it is them: the contact and about pages do
    if (m.score < 8 && !m.conflict && m.score >= 1 && page.html) {
      const more = pickLinks(page.url, page.html, 9).filter((l) => /contact|about|reach|find-us|locations|who-we-are|our-story|company/i.test(l)).slice(0, 2);
      const extra = (await Promise.all(more.map((l) => fetchPage(l, { maxChars: 12_000, reader: false }).catch(() => null)))).filter(Boolean);
      if (extra.length) {
        const text = extra.map((x) => `${x!.text} ${x!.html ? extractContacts(x!.html, x!.url).phones.join(" ") : ""}`).join(" ");
        m = matchLead({ url: page.url, title: page.title, text: `${page.text} ${phones} ${text}` }, a);
      }
    }
    if (acceptSite(m, a)) return { url: page.url, page, match: m, rejected };
    rejected.push({ url: d, why: m.reasons.filter((r) => r.includes("not ") || r.includes("numbers are") && m.conflict).join("; ") || "nothing on it matches what you entered" });
    return null;
  };
  const firstOk = async (urls: string[]) => {
    for (let i = 0; i < urls.length; i += 4) {
      const got = (await Promise.all(urls.slice(i, i + 4).map(check))).filter(Boolean) as WebsitePick[];
      if (got.length) return got.sort((x, y) => (y.match?.score ?? 0) - (x.match?.score ?? 0))[0];
    }
    return null;
  };

  // 1. yours: no second-guessing
  if (a.website && a.websiteSource !== "research" && a.websiteSource !== null && !skip.has(a.domain ?? "")) {
    const page = await fetchPage(a.website, { maxChars: 20_000 }).catch(() => null);
    return { url: page?.url ?? a.website, page, match: null, rejected };
  }
  // 2. the contact's business email domain, and a website stored earlier (checked like any other)
  const early = await firstOk([...a.emailDomains.map((d) => `https://${d}`), ...(a.website ? [a.website] : [])]);
  if (early) return early;

  // 3. the web, with the place, the industry, the phone and the people
  const place = placeTerm(a);
  const queries = [
    `"${a.name}"${place ? ` ${place}` : ""}${a.industry ? ` ${a.industry}` : ""}`,
    `${a.name}${place ? ` ${place}` : ""} official website`,
    ...a.people.slice(0, 1).map((p) => `"${p.name}" "${a.name}"`),
    ...a.phones.slice(0, 1).map((ph) => `"${ph.replace(/^\+/, "+").trim()}"`),
  ];
  const hits = (await Promise.all(queries.map((qy) => webSearch(qy, 8, `website: ${a.name}`, { wide: true }).catch(() => [] as SearchHit[])))).flat();
  // results that already look like them first
  const scored = hits.filter((h) => !NOT_THEIR_SITE.test(h.url))
    .map((h) => ({ h, m: matchLead({ url: h.url, title: h.title, text: `${h.title} ${h.snippet}` }, a) }));
  // a namesake is plain from its search result alone: say so, do not even open it
  for (const x of scored.filter((y) => y.m.conflict)) {
    const d = domainOf(x.h.url);
    if (d && !tried.has(d)) {
      tried.add(d);
      rejected.push({ url: d, why: x.m.reasons.filter((r) => r.includes("not ") || r.includes("numbers are")).join("; ") || "it is another business" });
    }
  }
  const ranked = scored.filter((x) => !x.m.conflict).sort((x, y) => y.m.score - x.m.score).map((x) => x.h.url);
  const fromWeb = await firstOk([...new Set(ranked)].slice(0, 8));
  if (fromWeb) return fromWeb;

  // 4. likely domains: the name with the country's ending and with the city
  const words = nameKeyWords(a.name);
  const stem = words.join("");
  const guesses = [...new Set([
    ...domainGuesses(a.name, a.country),
    ...(a.city && stem ? [`${stem}${a.city.toLowerCase().replace(/[^a-z]/g, "")}.com`] : []),
    ...(a.country === "United Arab Emirates" && stem ? [`${stem}.ae`, `${stem}uae.com`, `${stem}dubai.com`] : []),
  ])].slice(0, 12);
  const live: string[] = [];
  for (const g of guesses) if (await resolves(g)) live.push(`https://${g}`);
  const guessed = await firstOk(live);
  if (guessed) return guessed;

  // 5. Google through Gemini, told everything we know
  if (geminiSearchReady()) {
    try {
      const g = await groundedResearch(`Find the official website of this exact business. Use every detail to make sure it is the same business, not a namesake elsewhere.\n${anchorLines(a)}\nAnswer with the URL only, or "not found".`, { timeoutMs: 25_000, label: `website: ${a.name}`, deep: true });
      const cands = [g.text.match(/https?:\/\/[^\s)"'<>\]]+/)?.[0], ...g.sources.map((x) => x.url)].filter((u): u is string => !!u);
      const viaGoogle = await firstOk(cands.slice(0, 4));
      if (viaGoogle) return viaGoogle;
    } catch {
      /* nothing from Google either */
    }
  }
  return { url: null, page: null, match: null, rejected };
}

async function resolves(domain: string): Promise<boolean> {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5_000) });
    const j = (await res.json()) as { Answer?: unknown[] };
    return !!j.Answer?.length;
  } catch {
    return false;
  }
}

export async function siteStage(runId: number): Promise<void> {
  const run = await getRun(runId);
  try {
    await stage(runId, "site");
    const c = await one<{ id: number; name: string }>("select id, name from sales_companies where id = $1", [run.subject_id]);
    if (!c) throw new UserError("That company no longer exists.");
    const a = await gatherAnchors(c.id);
    if (!a) throw new UserError("That company no longer exists.");
    const where = placeOf(a);
    await say(runId, `Starting research on ${c.name}${where ? ` in ${where}` : ""}.`);
    const known = [where ? `location ${where}${a.countryFrom && a.countryFrom !== "you entered it" ? ` (${a.countryFrom})` : ""}` : null, a.industry ? `industry ${a.industry}` : null,
      a.people.length ? `contact ${a.people.map((p) => p.name).join(", ")}` : null, a.phones.length ? `phone ${a.phones.join(", ")}` : null,
      a.emailDomains.length ? `email domain ${a.emailDomains.join(", ")}` : null].filter(Boolean);
    await say(runId, known.length ? `Matching everything to what you entered: ${known.join("; ")}.` : "You have entered only the name, so namesakes cannot be ruled out. Add the city, a phone or the website for a sure match.");
    // the company's own record agrees with what you typed (an earlier run may have put a namesake's country there)
    const typed = a.countryFrom === "you entered it" || a.countryFrom?.startsWith("from the city") || a.countryFrom?.startsWith("from the phone");
    if (typed && a.country) await q("update sales_companies set country = $2, city = coalesce($3, city) where id = $1 and (country is null or country is distinct from $2)", [c.id, a.country, a.city]).catch(() => {});

    const pick = await resolveWebsite(a);
    for (const r of pick.rejected.slice(0, 4)) await say(runId, `Not their website: ${r.url} (${r.why}).`);
    if (a.website && a.websiteSource !== "you" && a.websiteSource !== "lead" && pick.url !== a.website && domainOf(pick.url) !== a.domain) {
      // the website stored earlier belongs to someone else: take it off the record
      if (pick.rejected.some((r) => r.url === a.domain)) {
        await q("update sales_companies set website = null, domain = null, website_source = null where id = $1 and website_source is distinct from 'you' and website_source is distinct from 'lead'", [c.id]).catch(() => {});
        await say(runId, `Removed the website an earlier run had picked (${a.domain}): it belongs to a different business.`);
      }
    }
    const website = pick.url;
    await say(runId, website ? `Their website: ${website}${pick.match?.reasons.length ? ` (${pick.match.reasons.slice(0, 3).join("; ")})` : ""}.` : "Could not find a website that is surely theirs. Continuing with web search, filtered to your lead.");
    const parts: string[] = [];
    const sources: Source[] = [];
    const contacts: Contacts[] = [];
    let audit: unknown = null;
    let finalUrl: string | null = null;
    if (website) {
      const home = pick.page && pick.page.text.length > 200 ? pick.page : await fetchPage(website, { maxChars: 6000 });
      if (home) {
        finalUrl = home.url;
        parts.push(`[website ${home.url}] ${home.title}\n${home.text.slice(0, 6000)}`);
        sources.push({ label: "Their website: home page", url: home.url, kind: "website" });
        if (home.html) {
          audit = techAudit(home.url, home.html);
          contacts.push(extractContacts(home.html, home.url));
        }
        const links = home.html ? pickLinks(home.url, home.html) : [];
        for (let i = 0; i < links.length; i += 3) {
          const pages = await Promise.all(links.slice(i, i + 3).map((l) => fetchPage(l, { maxChars: 2800, reader: false })));
          pages.forEach((p, j) => {
            if (!p) return;
            const url = links[i + j];
            parts.push(`[page ${url}] ${p.text}`);
            sources.push({ label: `Their website: ${new URL(url).pathname || "/"}`, url, kind: "website" });
            if (p.html) contacts.push(extractContacts(p.html, url));
          });
        }
        await say(runId, `Read ${sources.length} page${sources.length === 1 ? "" : "s"} of their website.`);
      } else {
        await say(runId, "Their website would not open (blocked or down).");
      }
    }
    const merged = contacts.length ? mergeContacts(contacts) : EMPTY_CONTACTS;
    if (merged.emails.length || merged.phones.length || Object.keys(merged.socials).length) {
      await say(runId, `Found ${merged.emails.length} email${merged.emails.length === 1 ? "" : "s"}, ${merged.phones.length} phone${merged.phones.length === 1 ? "" : "s"} and ${Object.keys(merged.socials).length} social profile${Object.keys(merged.socials).length === 1 ? "" : "s"} on the site.`);
    }
    const domain = domainOf(finalUrl ?? website);
    const [intel, wd] = await Promise.all([
      domain ? domainIntel(domain) : Promise.resolve({ registered: null, age: null, registrar: null, nameservers: [], mail: null, tools: [] } as Evidence["intel"]),
      wikidata(c.name, domain),
    ]);
    if (domain) {
      sources.push({ label: "Domain registration (RDAP)", url: `https://rdap.org/domain/${domain}`, kind: "registry" }, { label: "Email set-up (DNS)", url: null, kind: "domain" });
      await say(runId, intel.registered ? `The domain was registered ${intel.registered}${intel.age !== null ? ` (${intel.age} years ago)` : ""}${intel.mail ? `; their email runs on ${intel.mail}` : ""}.` : intel.mail ? `Their email runs on ${intel.mail}.` : "No domain registration details were published.");
    }
    if (wd) {
      parts.push(`[wikidata] ${wd}`);
      sources.push({ label: "Wikidata", url: null, kind: "registry" });
      await say(runId, "Found them on Wikidata (public company facts).");
    }
    const siteMatch = !website ? null : pick.match ? { score: pick.match.score, reasons: pick.match.reasons } : { score: 10, reasons: ["it is the website you gave"] };
    const evidence: Evidence = { site: parts, search: [], wikidata: wd, website: finalUrl ?? website, domain, contacts: merged, audit, intel, siteMatch };
    await q("update sales_research_runs set evidence = $2 where id = $1", [runId, JSON.stringify(evidence)]);
    await addSources(runId, sources);
    if (evidence.website) {
      await q("update sales_companies set website = coalesce(website, $2), domain = coalesce(domain, $3), website_source = coalesce(website_source, case when website is not null then 'you' else 'research' end) where id = $1", [c.id, evidence.website, domain]).catch(() => {});
    }
    await stage(runId, "search");
    await enqueue("research_search", { runId }, { dedupeKey: `research_search:${runId}` });
  } catch (e) {
    await failRun(runId, e);
    throw e;
  }
}

// ------------------------------------------------------------------ stage 2: the web

/**
 * The searches for a company. With anchors, every query carries the place, and the contact, phone, email domain and
 * website get searches of their own: that is what finds the right business and keeps namesakes out. Pure.
 */
export function companyQueries(name: string, year: number, a?: Anchors | null): string[] {
  if (a && canDisambiguate(a)) {
    const place = placeTerm(a);
    const n = `"${name}"${place ? ` ${place}` : ""}`;
    return [
      ...(a.domain ? [`site:${a.domain}`, `"${a.domain}"`] : []),
      ...a.emailDomains.filter((d) => d !== a.domain).slice(0, 1).map((d) => `"${d}"`),
      ...a.phones.slice(0, 2).map((ph) => `"${ph.trim()}"`),
      ...a.people.slice(0, 2).map((p) => `"${p.name}" ${place ?? ""} ${name}`.trim()),
      `${n}${a.industry ? ` ${a.industry}` : ""}`,
      `${n} owner OR founder OR CEO OR "managing director" OR manager`,
      `site:linkedin.com ${n}`,
      `${n} reviews OR rating`,
      `${n} contact phone address`,
      `${n} instagram OR facebook`,
      `${n} employees OR team OR hiring`,
      `${n} news ${year}`,
      `${n} revenue OR turnover OR customers`,
      `${n} competitors OR alternatives`,
    ].slice(0, 15);
  }
  return [
    `"${name}" revenue OR turnover OR "annual sales"`,
    `"${name}" employees OR "team size" site:linkedin.com/company`,
    `"${name}" CEO OR founder OR "managing director" OR owner`,
    `site:linkedin.com/in "${name}" (CEO OR founder OR owner OR director OR head OR manager)`,
    `"${name}" leadership team OR "our team"`,
    `"${name}" reviews OR rating site:trustpilot.com OR site:glassdoor.com OR site:google.com`,
    `"${name}" complaints OR "bad experience" OR "not responding"`,
    `"${name}" news ${year}`,
    `"${name}" funding OR raises OR acquired OR investors`,
    `"${name}" hiring OR careers OR jobs`,
    `"${name}" competitors OR alternatives`,
    `"${name}" customers OR clients OR "case study"`,
    `"${name}" site:zaubacorp.com OR site:tofler.in OR site:thecompanycheck.com`,
    `"${name}" contact email phone address`,
    `"${name}" instagram OR facebook`,
  ];
}

async function searchBatch(queries: string[], label: string, deadline: number, a?: Anchors | null): Promise<{ parts: string[]; sources: Source[]; hits: number; ran: number; dropped: string[] }> {
  const parts: string[] = [];
  const sources: Source[] = [];
  const dropped: string[] = [];
  let hits = 0;
  let ran = 0;
  for (let i = 0; i < queries.length; i += 3) {
    if (Date.now() > deadline) break;
    const results = await Promise.allSettled(queries.slice(i, i + 3).map((qy) => webSearch(qy, 6, label, { wide: true })));
    results.forEach((r, j) => {
      ran += 1;
      const qy = queries[i + j];
      const all: SearchHit[] = r.status === "fulfilled" ? r.value : [];
      // a result about a namesake somewhere else never reaches the profile
      const list = a && canDisambiguate(a) ? all.filter((h) => {
        const m = matchLead({ url: h.url, title: h.title, text: h.snippet }, a);
        if (m.conflict) dropped.push(`${h.title.slice(0, 60)} (${m.reasons.find((x) => x.includes("not ") || x.includes("numbers are")) ?? "another place"})`);
        return !m.conflict;
      }) : all;
      hits += list.length;
      if (list.length) parts.push(`[search: ${qy}]\n${list.map((h) => `- ${h.title} | ${h.url} | ${h.snippet}`).join("\n")}`);
      for (const h of list.slice(0, 6)) sources.push({ label: h.title.slice(0, 90), url: h.url, kind: "search" });
    });
  }
  return { parts, sources, hits, ran, dropped };
}

export async function searchStage(runId: number): Promise<void> {
  const run = await getRun(runId);
  try {
    await stage(runId, "search");
    const c = await one<{ name: string }>("select name from sales_companies where id = $1", [run.subject_id]);
    if (!c) throw new UserError("That company no longer exists.");
    const ev = (run as unknown as { evidence: Evidence }).evidence ?? ({} as Evidence);
    const a = await gatherAnchors(run.subject_id!);
    const r = await searchBatch(companyQueries(c.name, new Date().getUTCFullYear(), a), `research: ${c.name}`, Date.now() + 38_000, a);
    await q("update sales_research_runs set evidence = $2 where id = $1", [runId, JSON.stringify({ ...ev, search: r.parts })]);
    await addSources(runId, r.sources);
    await say(runId, r.hits ? `Ran ${r.ran} web searches and read ${r.hits} results.` : `Ran ${r.ran} web searches, but the free search engines returned nothing from this server.`);
    if (r.dropped.length) await say(runId, `Left out ${r.dropped.length} result${r.dropped.length === 1 ? "" : "s"} about other businesses with the same name: ${r.dropped.slice(0, 3).join("; ")}${r.dropped.length > 3 ? "; and more" : ""}.`);
    await stage(runId, "deep");
    await enqueue("research_deep", { runId }, { dedupeKey: `research_deep:${runId}` });
  } catch (e) {
    await failRun(runId, e);
    throw e;
  }
}

// ------------------------------------------------------------------ stage 2b: Google, in depth (free Gemini key)

/** What to ask Google about a company. Pure. */
export function companyBrief(name: string, o: { website?: string | null; country?: string | null; industry?: string | null; year: number; lead?: string | null; place?: string | null }): string {
  const lead = o.lead ? `\nTHE LEAD (from the owner, who has spoken to them; treat every line as true):\n${o.lead}\n` : "";
  return `Research the business "${name}"${o.place ? ` in ${o.place}` : ""}${o.website ? ` (website ${o.website})` : ""}${!o.place && o.country ? `, ${o.country}` : ""}${o.industry ? `, ${o.industry}` : ""} using Google Search.${lead}
First confirm you have the right business: search the name with the location${o.lead ? ", the contact's name, the phone number and the email domain above" : ""}. Many businesses share a name; one in another city or country is a different business and must be ignored completely, even if it is bigger or better known.
Then run several searches about THAT business (with the location in every query): owner, founder, CEO, LinkedIn, revenue, employees, news ${o.year}, reviews, hiring, contact, Instagram, address, licence or registration, competitors.
Start your answer with "MATCH:" and how you know it is the same business (phone, address, contact, website or location), or "MATCH: not found" if you could not find this exact business. If not found, report nothing about namesakes.
Make sure every fact is about THIS business (same name and same location, phone, contact or website); skip namesakes.
Report only what you found, as short lines, each ending with its source in brackets:
- What they do, for whom, and where (cities, branches)
- Founded year, legal name, registration (e.g. GST, CIN) if public
- Size: employees, branches; revenue or turnover; funding and investors
- Founders, owners and leaders: full name, title, and their LinkedIn profile URL when you found it
- Official contact: email, phone, WhatsApp, address; social profiles (Instagram, Facebook, LinkedIn, YouTube, X)
- Recent news and announcements (last 18 months), hiring, expansion
- Reputation: ratings and what reviews praise or complain about
- Tools and tech they visibly use; competitors
Write "not found" for anything you could not find. Never guess.`;
}

export function personBrief(name: string, o: { company?: string | null; title?: string | null; country?: string | null; linkedin?: string | null; place?: string | null; known?: string | null }): string {
  return `Research the person "${name}"${o.title ? `, ${o.title}` : ""}${o.company ? ` at ${o.company}` : ""}${o.place ? ` in ${o.place}` : o.country ? ` (${o.country})` : ""}${o.linkedin ? `, LinkedIn ${o.linkedin}` : ""} using Google Search.
${o.known ? `WHAT THE OWNER KNOWS (true; use it to find the right person and to rule out namesakes):\n${o.known}\n` : ""}Run several searches: their name with the company and the city; LinkedIn (site:linkedin.com/in with the name and the company or city); their phone number and email in quotes; Instagram, Facebook and X with the name and the business; interviews, podcasts, events, news; the business's own team or about page.
Many people share a name: a person in another city, at another company, or in an unrelated field is someone else. Start with "MATCH:" and how you know it is the same person (company, city, phone, email, photo-free details), or "MATCH: not found".
Make sure every fact is about THIS person (same name AND same company or role); skip namesakes.
Report only what you found, as short lines, each ending with its source in brackets:
- Current role and since when; past roles and companies; education
- LinkedIn profile URL and headline; other public profiles (X, Instagram, YouTube, Medium, GitHub)
- What they post or talk about; interviews, talks, awards, news
- Anything public about how to reach them for work (company email, office phone)
Write "not found" for anything you could not find. Never guess.`;
}

/** The Google research as evidence: the write-up, and its sources as search lines (those links are real). */
function groundedParts(g: Grounded, title: string): { prose: string; lines: string; sources: Source[] } {
  return {
    prose: `[google research: ${title}]\n${g.text}`,
    lines: g.sources.length ? `[google sources: ${title}]\n${g.sources.map((s) => `- ${s.title} | ${s.url} | ${s.snippet}`).join("\n")}` : "",
    sources: g.sources.slice(0, 15).map((s) => ({ label: `Google: ${s.title || s.url}`.slice(0, 90), url: s.url, kind: "search" as const })),
  };
}

export async function deepStage(runId: number): Promise<void> {
  const run = await getRun(runId);
  try {
    await stage(runId, "deep");
    const c = await one<{ name: string; country: string | null; industry: string | null }>("select name, country, industry from sales_companies where id = $1", [run.subject_id]);
    if (!c) throw new UserError("That company no longer exists.");
    const ev = (run as unknown as { evidence: Evidence }).evidence ?? ({} as Evidence);
    if (geminiSearchReady()) {
      try {
        const a = await gatherAnchors(run.subject_id!);
        const g = await groundedResearch(companyBrief(c.name, { website: ev.website, country: a?.country ?? c.country, industry: a?.industry ?? c.industry, year: new Date().getUTCFullYear(), lead: a ? anchorLines(a) : null, place: a ? placeOf(a) : null }), { timeoutMs: 50_000, label: `research: ${c.name}`, deep: true });
        if (/MATCH:\s*not found/i.test(g.text)) await say(runId, "Google could not find this exact business (it may have no web presence yet). Namesakes were ignored.");
        const gp = groundedParts(g, c.name);
        await q("update sales_research_runs set evidence = $2 where id = $1", [runId, JSON.stringify({ ...ev, grounded: gp.prose, search: [...(ev.search ?? []), gp.lines].filter(Boolean) })]);
        await addSources(runId, gp.sources);
        await say(runId, `Searched Google in depth (${g.queries.length || "several"} searches, ${g.sources.length} sources).`);
      } catch (e) {
        await say(runId, `Google search through Gemini did not complete (${(e as Error).message.slice(0, 80)}). Continuing with what was found.`);
      }
    } else {
      await say(runId, "Tip: add a free GEMINI_API_KEY to also search Google itself, for much richer results.");
    }
    await stage(runId, "synth");
    await enqueue("research_synth", { runId }, { dedupeKey: `research_synth:${runId}` });
  } catch (e) {
    await failRun(runId, e);
    throw e;
  }
}

// ------------------------------------------------------------------ stage 3: the profile and the people

interface Candidate {
  name?: string;
  title?: string;
  linkedin?: string;
  email?: string;
  is_decision_maker?: boolean;
  why?: string;
}

const NAME_OK = /^[\p{L}][\p{L}'.-]+(?:\s+[\p{L}][\p{L}'.-]+){1,3}$/u;

const set = (out: Enrichment, k: string, v: string | number | null | undefined, src: string, conf: Field["conf"] = "high", est = false) => {
  if (v === null || v === undefined || v === "") return;
  out[k] = { v, src, conf, est };
};

/**
 * What the owner entered beats what the AI wrote: the location, and the industry when the AI found none. A country
 * the AI gives that contradicts the lead is replaced, and the profile says it was not matched. Pure.
 */
export function applyAnchors(out: Enrichment, a: Anchors, siteMatch?: { score: number; reasons: string[] } | null): Enrichment {
  const typed = a.countryFrom === "you entered it" || !!a.countryFrom?.startsWith("from the city") || !!a.countryFrom?.startsWith("from the phone") || !!a.countryFrom?.startsWith("from the email");
  const aiCountry = out.hq_country?.v ? normCountry(String(out.hq_country.v)) : null;
  const same = (x: string, y: string) => x === y || y.split(" or ").some((part) => part === x || x.startsWith(part) || part.startsWith(x));
  if (a.country && typed && aiCountry && knownCountry(aiCountry) && !same(aiCountry, a.country)) {
    out.identity_match = { v: "not found", src: "check", conf: "high" };
    out.identity_basis = { v: `The research described a business in ${aiCountry}; your lead is in ${placeOf(a)}. Its other facts were about a namesake and are not shown.`, src: "check", conf: "high" };
    // nothing about the namesake survives except what came off the lead's own website and DNS
    for (const k of Object.keys(out)) {
      if (!["identity_match", "identity_basis", "public_emails", "generic_email", "public_phones", "whatsapp_number", "address", "social_profiles", "domain_registered", "domain_age_years", "registrar", "email_provider", "sending_tools", "nameservers"].includes(k)) out[k] = { v: null };
    }
  }
  if (a.country && typed) out.hq_country = { v: a.country, src: "you", conf: "high" };
  if (a.city) out.hq_city = { v: a.city, src: "you", conf: "high" };
  if (a.industry && !out.industry?.v) out.industry = { v: a.industry, src: "you", conf: "high" };
  // the website was checked against the lead: that is proof the profile is about them
  const im = String(out.identity_match?.v ?? "");
  if (siteMatch && im !== "not found" || siteMatch && !im) {
    if (!im || im === "likely" && siteMatch.score >= 8) {
      out.identity_match = { v: siteMatch.score >= 8 ? "confirmed" : "likely", src: "check", conf: siteMatch.score >= 8 ? "high" : "medium" };
      out.identity_basis = { v: `Their website matches your lead: ${siteMatch.reasons.slice(0, 3).join("; ")}.`, src: "check", conf: "high" };
    }
  }
  if (!out.identity_match?.v) out.identity_match = { v: canDisambiguate(a) ? "not found" : "unchecked", src: "check", conf: "low" };
  return out;
}

/**
 * The saved evidence as sources a contact can be proven by: each website page ("[page URL] text") and each search result
 * line ("- title | URL | snippet") is its own source. Anything without a link is not proof. Pure.
 */
export function proofSources(parts: string[]): ProofSource[] {
  const out: ProofSource[] = [];
  for (const part of parts) {
    const page = part.match(/^\[(?:page|home|[a-z ]+)\s+(https?:\/\/[^\]\s]+)\]\s*([\s\S]*)$/i);
    if (page) { out.push({ url: page[1], text: page[2] }); continue; }
    for (const line of part.split("\n")) {
      const m = line.match(/^- (.*?) \| (https?:\/\/\S+) \| (.*)$/);
      if (m) out.push({ url: m[2], text: `${m[1]}\n${m[3]}` });
    }
  }
  return out;
}

const CONTACT_FIELDS = ["public_emails", "generic_email", "public_phones", "whatsapp_number"] as const;

/** A site's contacts that can be theirs: phones from the lead's country, emails at their domain or a webmail. Pure. */
export function strictSiteContacts(c: Contacts, o: { country: string | null; domain: string | null }): Contacts {
  const dom = o.domain?.toLowerCase().replace(/^www\./, "") ?? null;
  const wa = c.socials.whatsapp ? c.socials.whatsapp.replace(/\D/g, "") : null;
  return {
    ...c,
    phones: c.phones.filter((p) => !wrongCountry(p, o.country)),
    emails: c.emails.filter((e) => { const d = businessDomain(e.email); return !d || !dom || d === dom || d.endsWith(`.${dom}`); }),
    socials: { ...c.socials, ...(wa && wrongCountry(`+${wa}`, o.country) ? { whatsapp: "" } : {}) },
  };
}

/** The website is surely theirs: you or the lead gave it, or it matched the lead decisively (phone, email, contact). Pure. */
export function siteIsTheirs(out: Enrichment, websiteSource: string | null, siteMatch: { score: number } | null): boolean {
  if (websiteSource === "you" || websiteSource === "lead") return true;
  if (String(out.identity_match?.v ?? "") === "not found") return false;
  return String(out.identity_match?.v ?? "") === "confirmed" || (siteMatch?.score ?? 0) >= 8;
}

/** Takes the website's contacts out of a profile; returns how many there were. Pure. */
export function dropSiteContacts(out: Enrichment): number {
  let n = 0;
  for (const k of CONTACT_FIELDS) {
    const v = out[k]?.v;
    if (v !== null && v !== undefined && String(v).trim()) { n += String(v).split(",").filter((x) => x.trim()).length; out[k] = { v: null }; }
  }
  return n;
}

/** Facts that came straight off the pages and DNS overwrite whatever the AI wrote for the same field. Pure. */
export function applyFacts(out: Enrichment, ev: Pick<Evidence, "contacts" | "intel">): Enrichment {
  const { contacts, intel } = ev;
  const generic = contacts.emails.find((e) => e.kind === "generic");
  set(out, "public_emails", contacts.emails.map((e) => e.email).join(", "), "their website");
  set(out, "generic_email", generic?.email, "their website");
  set(out, "public_phones", contacts.phones.join(", "), "their website");
  set(out, "whatsapp_number", contacts.socials.whatsapp, "their website");
  set(out, "address", contacts.addresses.join(" | "), "their website (schema.org)");
  const socials = Object.entries(contacts.socials).filter(([k]) => k !== "whatsapp");
  set(out, "social_profiles", socials.map(([k, v]) => `${k}: ${v}`).join("; "), "their website");
  set(out, "domain_registered", intel.registered, "RDAP (domain registry)");
  set(out, "domain_age_years", intel.age, "RDAP (domain registry)");
  set(out, "registrar", intel.registrar, "RDAP (domain registry)");
  set(out, "email_provider", intel.mail, "DNS MX record");
  set(out, "sending_tools", intel.tools.join(", "), "DNS SPF record");
  set(out, "nameservers", intel.nameservers.join(", "), "RDAP (domain registry)");
  return out;
}

function companySystem(offers: string[], year: number, lead?: string | null): string {
  return `You are a B2B research analyst. Build a profile of ONE business from the EVIDENCE only.
Return JSON: an object whose keys are exactly these: ${allKeys(COMPANY_FIELDS).join(", ")}.
Each value is {"v": value or null, "src": short source (url or "website" / "search" / "wikidata" / "estimate" / "you"), "conf": "high|medium|low", "est": true when estimated}.
${lead ? `THE LEAD (from the owner, who has spoken to them; every line is true):
${lead}

IDENTITY FIRST (most important):
- Profile ONLY the business in THE LEAD. Many businesses share a name. Evidence about a business in another city or country,
  with another phone, website, email domain or owners, or in an unrelated industry, is a NAMESAKE: ignore it completely, even if it is
  bigger, better known or appears most often.
- identity_match: "confirmed" when evidence about this business shares the lead's phone, email domain, contact person or website;
  "likely" when it shares the name and the exact location and nothing contradicts; "not found" when no evidence clearly matches.
  identity_basis: one line saying exactly which detail matched (or that nothing did).
- When identity_match is "not found": fill only what THE LEAD itself says (location, industry, contact) with src "you", and leave
  the rest null. Never borrow a namesake's revenue, employees, founders, reviews or history.
- hq_city and hq_country come from THE LEAD's location unless evidence about THIS business proves otherwise.
` : ""}Rules:
- Never invent names, numbers, customers, reviews or news. Unknown facts are {"v": null}.
- revenue_usd is NEVER null. If not published, estimate it realistically: employees x typical revenue per employee for this industry and
  country, adjusted by signals (locations, pricing, traffic, funding, store count, domain age, team size). Put the number in USD per year,
  est true, conf low or medium, and explain the maths in revenue_method. Be brutal and realistic, not flattering: most SMEs are small.
- employees: from LinkedIn snippets, the website, JSON-LD or Wikidata; else estimate with est true.
- review_rating / review_count / review_themes / complaints: only from review snippets in the evidence.
- listed: true only with evidence of a stock listing. company_age_years from founded_year (or the domain's age as a lower bound) and the year ${year}.
- people_found: the leadership and key people named in the evidence, "Name (title)", separated by semicolons.
- pain_points, automation_opportunities, best_entry_offer, money_leak_estimate: your analysis for an AI agency whose offers are: ${offers.join("; ")}. money_leak_estimate must state its assumption.
- summary: one plain paragraph a salesperson can read in 20 seconds.
- Contact and domain fields are filled from verified scans afterwards: leave them out of your reasoning.`;
}

const PEOPLE_SYSTEM = `You extract the real people who run or work at ONE company from the EVIDENCE only.
Return JSON {"people": [{"name": "First Last", "title": "their role", "linkedin": "url if literally in the evidence else null", "email": "only if literally in the evidence else null", "is_decision_maker": true|false, "why": "one short line on how they matter for selling to this company"}]}.
Rules: at most 8, most senior first; full first and last names only; never invent a person, a title, a URL or an email; skip customers, testimonial authors,
journalists and anyone not clearly tied to THIS company; decision makers are founders, owners, C-level, directors and heads of the relevant function.`;

export async function synthStage(runId: number): Promise<void> {
  const run = await getRun(runId);
  try {
    await stage(runId, "synth");
    const cfg = await salesConfig();
    const c = await one<{ id: number; name: string; country: string | null; industry: string | null }>("select id, name, country, industry from sales_companies where id = $1", [run.subject_id]);
    if (!c) throw new UserError("That company no longer exists.");
    const ev = (run as unknown as { evidence: Evidence }).evidence;
    const contacts = ev.contacts ?? EMPTY_CONTACTS;
    const year = new Date().getUTCFullYear();
    const facts = [
      contacts.org && Object.keys(contacts.org).length ? `[schema.org on their site] ${JSON.stringify(contacts.org)}` : "",
      ev.audit ? `[site scan] ${JSON.stringify(ev.audit)}` : "",
      ev.intel?.registered ? `[domain] registered ${ev.intel.registered}${ev.intel.age !== null ? ` (${ev.intel.age} years)` : ""}, email on ${ev.intel.mail ?? "unknown"}, sends via ${ev.intel.tools.join(", ") || "unknown"}` : "",
    ].filter(Boolean);
    // what was literally read (pages, search results): only this can prove an email or a LinkedIn link
    const evidenceText = [...ev.site, ...facts, ...ev.search].join("\n\n").slice(0, 30_000);
    const aiText = [ev.grounded ?? "", evidenceText].filter(Boolean).join("\n\n").slice(0, 36_000);
    const a = await gatherAnchors(c.id);
    const lead = a && canDisambiguate(a) ? anchorLines(a) : null;
    const out = await llmJson<Enrichment>(companySystem(cfg.offers, year, lead), `COMPANY: ${c.name}${a && placeOf(a) ? `, ${placeOf(a)}` : c.country ? `, ${c.country}` : ""}${(a?.industry ?? c.industry) ? `, ${a?.industry ?? c.industry}` : ""}\n\nEVIDENCE:\n${aiText}`, { maxTokens: 6500, totalMs: 55_000, deep: true });
    // contacts off the site: never a number from another country, never another company's email address
    const strict = strictSiteContacts(contacts, { country: a?.country ?? c.country, domain: ev.domain });
    applyFacts(out, { contacts: strict, intel: ev.intel ?? { registered: null, age: null, registrar: null, nameservers: [], mail: null, tools: [] } });
    if (a) applyAnchors(out, a, ev.siteMatch ?? null);
    // and only when the website is surely theirs: you gave it, it came with the lead, or it matched the lead decisively
    const src = (await one<{ website_source: string | null }>("select website_source from sales_companies where id = $1", [c.id]))?.website_source ?? null;
    if (!siteIsTheirs(out, src, ev.siteMatch ?? null)) {
      const dropped = dropSiteContacts(out);
      if (dropped) await say(runId, `Not sure the website ${ev.domain ?? ""} is really this business, so its ${dropped} contact detail${dropped === 1 ? " is" : "s are"} not shown. Add their website or a phone to the lead and research again.`);
    }
    await saveCompany(c.id, out, ev.website, ev.domain, ev.audit);
    const filled = Object.values(out).filter((f) => f?.v !== null && f?.v !== undefined && f?.v !== "").length;
    const im = String(out.identity_match?.v ?? "");
    await say(runId, `Profile written: ${filled} facts. ${im === "confirmed" ? `Confirmed it is your lead (${String(out.identity_basis?.v ?? "").slice(0, 120)}).` : im === "likely" ? `Very likely your lead (${String(out.identity_basis?.v ?? "").slice(0, 120)}).` : im === "not found" ? "No public source could be tied to this exact business, so only what you entered is shown." : ""}`.trim());

    // the people behind the company
    let found = 0;
    try {
      if (out.identity_match?.v === "not found" && lead) {
        await say(runId, "Could not confirm any web result is this exact business, so no people were taken from the web (they could be a namesake's).");
        throw new Error("skip people");
      }
      const people = await llmJson<{ people?: Candidate[] }>(PEOPLE_SYSTEM, `COMPANY: ${c.name}${a && placeOf(a) ? `, ${placeOf(a)}` : ""}${lead ? `\n\nTHE LEAD (true; people of a namesake business elsewhere must be left out):\n${lead}` : ""}\n\nEVIDENCE:\n${aiText}`, { maxTokens: 1500, totalMs: 25_000, deep: true });
      const names: string[] = [];
      const decisionMakers: number[] = [];
      for (const p of (people.people ?? []).slice(0, 8)) {
        const name = String(p.name ?? "").trim();
        if (!NAME_OK.test(name) || name.toLowerCase() === c.name.toLowerCase()) continue;
        // their email only when a real page about this business shows it next to them (or it is at the business's own domain)
        const email = typeof p.email === "string"
          ? verifyEmails([p.email], proofSources([...ev.site, ...ev.search]), { company: c.name, domain: ev.domain, person: name, country: a?.country ?? c.country }).find((v) => v.owner === "person")?.value ?? null
          : null;
        const id = await upsertPerson({ name, title: p.title ?? null, company_id: c.id, email, country: c.country });
        found += 1;
        names.push(name);
        if (typeof p.linkedin === "string" && /linkedin\.com\/in\//i.test(p.linkedin) && seenIn(evidenceText, p.linkedin)) await q("update sales_people set linkedin = coalesce(linkedin, $2) where id = $1", [id, p.linkedin.split("?")[0]]);
        if (p.is_decision_maker) {
          await q("update sales_people set is_decision_maker = true where id = $1", [id]);
          decisionMakers.push(id);
        }
      }
      if (found) {
        const pattern = ev.domain ? learnEmailPattern(contacts.emails, names, ev.domain) : null;
        await q("update sales_research_runs set evidence = $2 where id = $1", [runId, JSON.stringify({ ...ev, pattern })]);
        await say(runId, `Found ${found} ${found === 1 ? "person" : "people"} at the company${decisionMakers.length ? `, ${decisionMakers.length} decision maker${decisionMakers.length === 1 ? "" : "s"}` : ""}${pattern ? `. Their emails look like ${pattern.replace("first", "first").replace("last", "last")}@${ev.domain}` : ""}.`);
        for (const pid of decisionMakers.slice(0, 3)) await startResearch({ subject: "person", id: pid, radarItemId: run.radar_item_id, trigger: "auto" });
      } else {
        await say(runId, "No named people could be found for this company yet.");
      }
    } catch (e) {
      if ((e as Error).message !== "skip people") await say(runId, `People search did not complete (${(e as Error).message.slice(0, 80)}).`);
    }
    await q("update sales_research_runs set status = 'done', stage = 'done', finished_at = now(), updated_at = now() where id = $1", [runId]);
    // the audit was built on the old profile: rebuild it on this one
    await enqueue("audit_website", { id: c.id }, { dedupeKey: `audit:${c.id}` });
  } catch (e) {
    await failRun(runId, e);
    throw e;
  }
}

/** Writes a company profile: the facts, plus the handful of columns the rest of Sales reads. */
export async function saveCompany(id: number, out: Enrichment, website: string | null, domain: string | null, audit: unknown): Promise<void> {
  const num = (f?: Field) => {
    const n = Number(String(f?.v ?? "").replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  await q(
    `update sales_companies set enrichment = $2, enriched_at = now(), website = coalesce(website, $3), domain = coalesce(domain, $4),
       employees = coalesce($5, employees), revenue_usd = coalesce($6, revenue_usd), revenue_is_estimate = coalesce($7, revenue_is_estimate),
       listed = coalesce($8, listed), industry = coalesce(industry, $9), country = coalesce(country, $10), description = coalesce(description, $11),
       audit = coalesce(audit, $12), updated_at = now()
     where id = $1`,
    [
      id, JSON.stringify(out), website, domain, num(out.employees) ? Math.round(num(out.employees)!) : null, num(out.revenue_usd),
      out.revenue_usd ? out.revenue_usd.est !== false : null, typeof out.listed?.v === "boolean" ? out.listed.v : null,
      out.industry?.v ? String(out.industry.v) : null, out.hq_country?.v ? String(out.hq_country.v) : null,
      out.summary?.v ? String(out.summary.v).slice(0, 1500) : null, audit ? JSON.stringify({ tech: audit }) : null,
    ],
  ).catch(async (e) => {
    // a domain already used by another company record: keep the data, skip the domain
    if (!/duplicate key/.test((e as Error).message)) throw e;
    await q("update sales_companies set enrichment = $2, enriched_at = now(), updated_at = now() where id = $1", [id, JSON.stringify(out)]);
  });
}

// ------------------------------------------------------------------ a person

export async function personStage(runId: number): Promise<void> {
  const run = await getRun(runId);
  try {
    await stage(runId, "search");
    const cfg = await salesConfig();
    const p = await one<{ id: number; full_name: string; title: string | null; linkedin: string | null; company_id: number | null; company: string | null; domain: string | null; country: string | null; emails: string[]; phones: string[] }>(
      `select p.id, p.full_name, p.title, p.linkedin, p.company_id, c.name as company, c.domain, coalesce(p.country, c.country) as country, p.emails, p.phones
       from sales_people p left join sales_companies c on c.id = p.company_id where p.id = $1`,
      [run.subject_id],
    );
    if (!p || p.full_name.length < 3 || /unknown/i.test(p.full_name)) throw new UserError("There is no named person to research yet.");
    const a = p.company_id ? await gatherAnchors(p.company_id) : null;
    const place = a ? placeTerm(a) : p.country;
    await say(runId, `Starting research on ${p.full_name}${p.company ? ` at ${p.company}` : ""}${a && placeOf(a) ? ` in ${placeOf(a)}` : ""}.`);
    const who = `"${p.full_name}"${p.company ? ` "${p.company}"` : ""}`;
    const where = place ? ` ${place}` : "";
    const queries = [
      `site:linkedin.com/in "${p.full_name}"${p.company ? ` ${p.company}` : ""}${where}`,
      `${who}${where}`,
      ...p.phones.slice(0, 1).map((ph) => `"${ph.trim()}"`),
      ...p.emails.slice(0, 1).map((em) => `"${em}"`),
      `"${p.full_name}"${where} linkedin`,
      `"${p.full_name}" ${p.company ?? ""}${where} instagram OR facebook`,
      `"${p.full_name}" ${p.company ?? ""} founder OR owner OR director OR manager`,
      `"${p.full_name}" ${p.company ?? ""} interview OR podcast OR speaker OR event`,
      `"${p.full_name}" ${p.company ?? ""} news OR award`,
      `"${p.full_name}" ${p.company ?? ""} twitter OR x.com OR youtube OR medium`,
    ];
    // leave room in this time slot for the Google pass below
    const personAnchors = a ? { ...a, people: [{ name: p.full_name, title: p.title, phones: p.phones, emails: p.emails, linkedin: p.linkedin }, ...a.people], phones: [...new Set([...p.phones, ...a.phones])] } : null;
    const r = await searchBatch(queries, `research: ${p.full_name}`, Date.now() + (geminiSearchReady() ? 20_000 : 34_000), personAnchors);
    await addSources(runId, r.sources);
    await say(runId, `Ran ${r.ran} web searches and read ${r.hits} results.`);
    if (r.dropped.length) await say(runId, `Left out ${r.dropped.length} result${r.dropped.length === 1 ? "" : "s"} about people or businesses elsewhere.`);
    const evidence = [...r.parts];
    // what we already learned about their company, and what their colleagues' emails look like
    let pattern: EmailPattern | null = null;
    let domain = p.domain;
    if (p.company_id) {
      const co = await one<{ summary: string | null; enrichment: Enrichment }>("select description as summary, enrichment from sales_companies where id = $1", [p.company_id]);
      const prior = await one<{ evidence: Evidence | null }>("select evidence from sales_research_runs where subject = 'company' and subject_id = $1 and status = 'done' order by id desc limit 1", [p.company_id]);
      if (co?.summary) evidence.push(`[their company] ${co.summary}`);
      const mem = prior?.evidence;
      if (mem) {
        domain = domain ?? mem.domain;
        pattern = mem.pattern ?? (domain && mem.contacts ? learnEmailPattern(mem.contacts.emails, [p.full_name], domain) : null);
        const t = mem.site?.find((s) => new RegExp(p.full_name.split(" ")[0], "i").test(s) && new RegExp(p.full_name.split(" ").slice(-1)[0], "i").test(s));
        if (t) evidence.push(`[their company's own website mentions them] ${t.slice(0, 1800)}`);
      }
    }
    const own = await one<{ n: string | null }>(
      `select string_agg(coalesce(summary, left(body, 300)), ' | ') as n from (select summary, body from sales_interactions where person_id = $1 order by occurred_at desc limit 6) x`,
      [p.id],
    );
    if (own?.n) evidence.push(`[your own conversations with them] ${own.n.slice(0, 3000)}`);
    // Google, in depth (free Gemini key): the write-up informs the profile; its links count as read
    let grounded: string | null = null;
    if (geminiSearchReady()) {
      await stage(runId, "deep");
      try {
        const known = [
          p.title ? `Title: ${p.title}` : null, p.company ? `Company: ${p.company}` : null, a && placeOf(a) ? `Location: ${placeOf(a)}` : null,
          p.phones.length ? `Phone: ${p.phones.join(" / ")}` : null, p.emails.length ? `Email: ${p.emails.join(" / ")}` : null,
          p.linkedin ? `LinkedIn: ${p.linkedin}` : null, a?.industry ? `Industry: ${a.industry}` : null, a?.website ? `Company website: ${a.website}` : null,
        ].filter(Boolean).join("\n");
        const g = await groundedResearch(personBrief(p.full_name, { company: p.company, title: p.title, country: p.country, linkedin: p.linkedin, place: a ? placeOf(a) : null, known }), { timeoutMs: 40_000, label: `research: ${p.full_name}`, deep: true });
        const gp = groundedParts(g, p.full_name);
        grounded = gp.prose;
        if (gp.lines) evidence.push(gp.lines);
        await addSources(runId, gp.sources);
        await say(runId, `Searched Google in depth (${g.sources.length} sources).`);
      } catch (e) {
        await say(runId, `Google search through Gemini did not complete (${(e as Error).message.slice(0, 80)}).`);
      }
    }
    // the write-up runs as its own step, so the searching and the writing each get a full time slot
    await q("update sales_research_runs set evidence = $2 where id = $1", [runId, JSON.stringify({ person: { evidence, grounded, pattern, domain } })]);
    await stage(runId, "synth");
    await enqueue("research_person_synth", { runId }, { dedupeKey: `research_person_synth:${runId}` });
  } catch (e) {
    await failRun(runId, e);
    throw e;
  }
}

export async function personSynthStage(runId: number): Promise<void> {
  const run = await getRun(runId);
  try {
    await stage(runId, "synth");
    const cfg = await salesConfig();
    const p = await one<{ id: number; full_name: string; title: string | null; linkedin: string | null; company: string | null; country: string | null; emails: string[]; phones: string[] }>(
      `select p.id, p.full_name, p.title, p.linkedin, c.name as company, coalesce(p.country, c.country) as country, p.emails, p.phones
       from sales_people p left join sales_companies c on c.id = p.company_id where p.id = $1`,
      [run.subject_id],
    );
    if (!p) throw new UserError("That person no longer exists.");
    const saved = ((run as unknown as { evidence: { person?: { evidence: string[]; grounded: string | null; pattern: EmailPattern | null; domain: string | null } } }).evidence?.person) ?? { evidence: [], grounded: null, pattern: null, domain: null };
    const evidence = saved.evidence ?? [];
    const pattern = saved.pattern ?? null;
    const domain = saved.domain ?? null;
    const year = new Date().getUTCFullYear();
    const ca = run.subject_id ? await one<{ company_id: number | null }>("select company_id from sales_people where id = $1", [run.subject_id]) : null;
    const anchors = ca?.company_id ? await gatherAnchors(ca.company_id) : null;
    const known = [
      `Name: ${p.full_name}`, p.title ? `Title: ${p.title}` : null, p.company ? `Company: ${p.company}` : null, anchors && placeOf(anchors) ? `Location: ${placeOf(anchors)}` : null,
      p.phones.length ? `Phone: ${p.phones.join(" / ")}` : null, p.emails.length ? `Email: ${p.emails.join(" / ")}` : null, p.linkedin ? `LinkedIn: ${p.linkedin}` : null,
      anchors?.industry ? `Industry: ${anchors.industry}` : null,
    ].filter(Boolean).join("\n");
    const system = `You are a sales researcher. Build a profile of this person from the EVIDENCE only (public information and the owner's own conversations).
Return JSON whose keys are exactly: ${allKeys(PERSON_FIELDS).join(", ")}.
Each value is {"v": value or null, "src": short source, "conf": "high|medium|low", "est": true when estimated}.
WHAT THE OWNER KNOWS (true):
${known}
IDENTITY FIRST: many people share a name. Use only evidence about THIS person: same name AND (same company, or same city with a matching role,
or the same phone, email or LinkedIn). A same-named person elsewhere or in another field is someone else: ignore them completely.
identity_match: "confirmed" (evidence shares their company, phone, email or LinkedIn), "likely" (same name, same city and a fitting role),
or "not found". identity_basis: one line on exactly what matched. When "not found", fill only what the owner knows and the owner's
conversations, and leave public facts null.
Rules:
- Never invent employers, schools, emails, phones or facts. Unknown is {"v": null}. Do not guess private contact details.
- Make sure the evidence is about THIS person (same name AND same company or role). If unsure, leave it null.
- estimated_age: only from career start or graduation year (graduation at ~22), as a range like "38 to 42", est true, explain in age_basis.
- estimated_net_worth: a rough range only when role, ownership or exits give a real basis, est true, explain in net_worth_basis; else null.
- tenure_at_company_years from the start date and the current year ${year}.
- is_decision_maker: true for founders, owners, C-level, directors and heads of the relevant function.
- other_profiles: GitHub, Medium, Substack, YouTube and similar, only URLs literally in the evidence. linkedin_snippet: what the LinkedIn result says about them.
- what_they_care_about, talking_points, opener, likely_objections: practical, specific, for ${cfg.owner.name} of an AI agency.
- email_found / email_guess / email_pattern_basis / phone_found are filled in afterwards from verified data: leave them null.`;
    const out = await llmJson<Enrichment>(system, `PERSON: ${p.full_name}${p.title ? `, ${p.title}` : ""}${p.company ? ` at ${p.company}` : ""}${p.country ? `, ${p.country}` : ""}${p.linkedin ? `\nLinkedIn: ${p.linkedin}` : ""}\n\nEVIDENCE:\n${[saved.grounded ?? "", ...evidence].filter(Boolean).join("\n\n").slice(0, 28_000)}`, { maxTokens: 5200, totalMs: 55_000, deep: true });
    if (anchors?.country && !out.location_country?.v) set(out, "location_country", anchors.country, "you");
    if (anchors?.city && !out.location_city?.v) set(out, "location_city", anchors.city, "you");
    if (!out.identity_match?.v) set(out, "identity_match", "not found", "check", "low");
    // reach-them facts come from data we hold, never from the AI
    if (p.emails[0]) set(out, "email_found", p.emails[0], "your records or their company's site");
    if (p.phones[0]) set(out, "phone_found", p.phones[0], "your records");
    if (!p.emails[0] && domain) {
      const g = pattern ? guessEmail(p.full_name, pattern, domain) : guessEmail(p.full_name, "first.last", domain);
      if (g) {
        set(out, "email_guess", g, "pattern", pattern ? "medium" : "low", true);
        set(out, "email_pattern_basis", pattern ? `Other people at ${domain} use ${pattern}@${domain}. Unverified: check before sending.` : `No colleague's address was found to learn from, so this is the most common pattern (first.last@${domain}). Unverified: check before sending.`, "pattern", pattern ? "medium" : "low", true);
      }
    }
    const str = (f?: Field) => (f?.v !== null && f?.v !== undefined && String(f.v).trim() ? String(f.v).trim() : null);
    await q(
      `update sales_people set enrichment = $2, enriched_at = now(), title = coalesce(title, $3), city = coalesce(city, $4), country = coalesce(country, $5),
         linkedin = coalesce(linkedin, $6), is_decision_maker = coalesce(is_decision_maker, $7), updated_at = now() where id = $1`,
      [p.id, JSON.stringify(out), str(out.current_title), str(out.location_city), str(out.location_country),
        str(out.linkedin_url)?.includes("linkedin.com") && seenIn(evidence.join("\n"), str(out.linkedin_url)) && ["confirmed", "likely"].includes(String(out.identity_match?.v ?? "")) ? str(out.linkedin_url) : null, typeof out.is_decision_maker?.v === "boolean" ? out.is_decision_maker.v : null],
    );
    const filled = Object.values(out).filter((f) => f?.v !== null && f?.v !== undefined && f?.v !== "").length;
    await say(runId, `Profile written: ${filled} facts${out.email_guess ? `, best-guess email ${String(out.email_guess.v)} (unverified)` : ""}.`);
    await q("update sales_research_runs set status = 'done', stage = 'done', finished_at = now(), updated_at = now() where id = $1", [runId]);
  } catch (e) {
    await failRun(runId, e);
    throw e;
  }
}

// ------------------------------------------------------------------ from a radar lead

/** Sites that are the *place* a lead was posted, not the company behind it. */
const PLATFORM = /(^|\.)(reddit|linkedin|upwork|freelancer|facebook|instagram|twitter|x|youtube|tiktok|medium|substack|quora|google|bing|duckduckgo|ycombinator|news\.ycombinator|producthunt|github|glassdoor|indeed|trustpilot|yelp|crunchbase|wikipedia|bark|clutch|peopleperhour|guru|contra|fiverr|remoteok|remotive|arbeitnow|jobicy|himalayas|adzuna|t\.me|wa\.me|bloomberg|reuters|techcrunch|forbes|economictimes|livemint|moneycontrol|yourstory|inc42)\.[a-z.]+$/i;

export interface LeadIdentity {
  name: string | null;
  website: string | null;
  country: string | null;
  industry: string | null;
  contact: string | null;
  contactTitle: string | null;
}

/** Works out who a radar lead is about from what the scorer saw (and, failing that, a non-platform link). Pure. */
export function identifyLead(item: { url: string | null; fit: { company?: string | null; website?: string | null; country?: string | null; industry?: string | null; contact?: string | null } | null }): LeadIdentity {
  const f = item.fit ?? {};
  const clean = (v: unknown) => (typeof v === "string" && v.trim() && !/^(unknown|n\/a|none|null|unnamed)$/i.test(v.trim()) ? v.trim().slice(0, 160) : null);
  let website = clean(f.website);
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  if (website && PLATFORM.test(domainOf(website) ?? "")) website = null;
  if (!website && item.url) {
    const d = domainOf(item.url);
    if (d && !PLATFORM.test(d) && !clean(f.company)) website = `https://${d}`; // a company's own page, e.g. a tender or a launch post
  }
  return { name: clean(f.company), website, country: clean(f.country), industry: clean(f.industry), contact: clean(f.contact), contactTitle: null };
}

/**
 * Researches the company (and the named contact) behind a radar lead, without turning it into a deal. The lead is linked
 * to the company so its profile is one tap away. When the lead names no company the run says so, plainly.
 */
export async function researchRadarItem(itemId: number, override: { company?: string | null; website?: string | null } = {}, trigger = "auto"): Promise<number> {
  const it = await one<{ id: number; url: string | null; fit: Parameters<typeof identifyLead>[0]["fit"]; company_id: number | null }>("select id, url, fit, company_id from sales_radar_items where id = $1", [itemId]);
  if (!it) throw new UserError("That lead no longer exists.");
  const id = identifyLead(it);
  const name = override.company?.trim() || id.name;
  const website = override.website?.trim() ? (/^https?:\/\//i.test(override.website.trim()) ? override.website.trim() : `https://${override.website.trim()}`) : id.website;
  if (!name && !website && !it.company_id) {
    const run = await one<{ id: number }>(
      "insert into sales_research_runs (subject, subject_id, radar_item_id, trigger, status, stage, error, log, finished_at) values ('company', null, $1, $2, 'error', 'done', $3, $4, now()) returning id",
      [itemId, trigger, "This lead does not name a company. Type the company name or website and research again.", ["Could not tell which company this lead is about."]],
    );
    return run!.id;
  }
  const companyId = (name || website ? await ensureCompany(name, { website, country: id.country, industry: id.industry }) : null) ?? it.company_id;
  if (!companyId) throw new UserError("Could not create a company for this lead.");
  await q("update sales_radar_items set company_id = $2 where id = $1", [itemId, companyId]);
  if (id.contact) {
    const personId = await upsertPerson({ name: id.contact, company_id: companyId, country: id.country });
    await q("update sales_radar_items set person_id = $2 where id = $1", [itemId, personId]);
    await startResearch({ subject: "person", id: personId, radarItemId: itemId, trigger });
  }
  return startResearch({ subject: "company", id: companyId, radarItemId: itemId, trigger });
}

// ------------------------------------------------------------------ reading it back, at any time

export interface ResearchView {
  company: { id: number; name: string; website: string | null; domain: string | null; country: string | null; industry: string | null; employees: number | null; revenue_usd: number | null; enrichment: Enrichment; enriched_at: string | null } | null;
  people: { id: number; full_name: string; title: string | null; linkedin: string | null; emails: string[]; is_decision_maker: boolean | null; enrichment: Enrichment; enriched_at: string | null }[];
  runs: RunRow[];
  running: boolean;
  groups: { company: typeof COMPANY_FIELDS; person: typeof PERSON_FIELDS };
}

export async function researchView(a: { radarItemId?: number; companyId?: number }): Promise<ResearchView> {
  let companyId = a.companyId ?? null;
  let runs: RunRow[] = [];
  if (a.radarItemId) {
    const it = await one<{ company_id: number | null }>("select company_id from sales_radar_items where id = $1", [a.radarItemId]);
    companyId = companyId ?? it?.company_id ?? null;
    runs = await q<RunRow>("select id, subject, subject_id, radar_item_id, status, stage, trigger, log, sources, error, started_at, updated_at, finished_at from sales_research_runs where radar_item_id = $1 order by id desc limit 8", [a.radarItemId]);
  }
  const company = companyId
    ? await one<NonNullable<ResearchView["company"]>>("select id, name, website, domain, country, industry, employees, revenue_usd, enrichment, enriched_at from sales_companies where id = $1", [companyId])
    : null;
  const people = companyId
    ? await q<ResearchView["people"][number]>(
        "select id, full_name, title, linkedin, emails, is_decision_maker, enrichment, enriched_at from sales_people where company_id = $1 order by (is_decision_maker is true) desc, (enriched_at is not null) desc, id limit 12",
        [companyId],
      )
    : [];
  if (companyId && !runs.length) {
    runs = await q<RunRow>("select id, subject, subject_id, radar_item_id, status, stage, trigger, log, sources, error, started_at, updated_at, finished_at from sales_research_runs where (subject = 'company' and subject_id = $1) or (subject = 'person' and subject_id = any($2::int[])) order by id desc limit 8", [companyId, people.map((p) => p.id)]);
  }
  const stale = Date.now() - 10 * 60_000;
  const running = runs.some((r) => (r.status === "queued" || r.status === "running") && new Date(r.updated_at).getTime() > stale);
  return { company, people, runs, running, groups: { company: COMPANY_FIELDS, person: PERSON_FIELDS } };
}

// ------------------------------------------------------------------ re-checking older profiles

/**
 * Profiles written before research was pinned to the lead (they have no identity check) may describe a namesake.
 * Each one tied to a live lead is researched again, two at a time, at most once a day each, until all are checked.
 */
export async function scheduleIdentityRechecks(): Promise<number> {
  const due = await q<{ id: number }>(
    `select c.id from sales_companies c
      where c.enriched_at is not null and (c.enrichment->'identity_match') is null
        and (exists (select 1 from sales_deals d join sales_stages s on s.id = d.stage_id where d.company_id = c.id and s.category = 'open')
             or exists (select 1 from sales_radar_items r where r.company_id = c.id and r.created_at > now() - interval '60 days'))
        and not exists (select 1 from sales_research_runs r where r.subject = 'company' and r.subject_id = c.id and r.started_at > now() - interval '1 day')
      order by c.updated_at desc limit 2`,
  );
  for (const c of due) await startResearch({ subject: "company", id: c.id, trigger: "recheck" });
  // audits written before they were built on what the lead said: rebuilt for live leads, two at a time
  const audits = await q<{ id: number }>(
    `select c.id from sales_companies c
      where c.audit is not null and (c.audit->'based_on') is null
        and exists (select 1 from sales_deals d join sales_stages s on s.id = d.stage_id where d.company_id = c.id and s.category = 'open')
        and not (c.id = any($1::int[]))
      order by c.updated_at desc limit 2`, [due.map((x) => x.id)]);
  for (const c of audits) await enqueue("audit_website", { id: c.id }, { dedupeKey: `audit:${c.id}` });
  return due.length + audits.length;
}
