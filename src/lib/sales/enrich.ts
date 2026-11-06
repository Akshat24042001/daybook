/**
 * Enrichment from public sources only: the company's own website, web search snippets (including LinkedIn and news),
 * Wikidata (revenue, staff, listing, founding for larger companies), then an AI pass that fills 50+ fields for a company
 * and 50+ for a person. Every field carries its source, a confidence, and whether it is an estimate. Revenue is never
 * left blank: when it is not published it is estimated, with the method shown, and marked as an estimate.
 */
import { one, q } from "../db";
import { salesConfig } from "./config";
import { domainOf } from "./identity";
import { llmJson } from "./llm";
import { fetchPage, strip, webSearch, type SearchHit } from "./search";

export interface Field {
  v: string | number | boolean | null;
  src?: string | null;
  conf?: "high" | "medium" | "low";
  est?: boolean;
}
export type Enrichment = Record<string, Field>;

export const COMPANY_FIELDS: { group: string; fields: [string, string][] }[] = [
  { group: "Identity", fields: [
    ["legal_name", "Legal name"], ["brand_names", "Brands"], ["website", "Website"], ["founded_year", "Founded"], ["company_age_years", "Age (years)"],
    ["hq_city", "HQ city"], ["hq_country", "HQ country"], ["other_locations", "Other locations"], ["company_type", "Type (private, family, public, subsidiary)"],
    ["listed", "Listed?"], ["stock_exchange", "Exchange"], ["ticker", "Ticker"], ["parent_company", "Parent company"], ["subsidiaries", "Subsidiaries"],
  ] },
  { group: "Size and money", fields: [
    ["employees", "Employees"], ["employee_range", "Employee range"], ["revenue_usd", "Revenue (USD / yr)"], ["revenue_range", "Revenue range"],
    ["revenue_method", "How revenue was found or estimated"], ["growth_signal", "Growth signal"], ["funding_total", "Total funding"],
    ["last_funding", "Last round (type, amount, date)"], ["investors", "Investors"], ["pricing_model", "Pricing model"], ["avg_ticket_size", "Typical order / deal size"],
    ["budget_capacity", "Realistic budget for a project with you"],
  ] },
  { group: "Market", fields: [
    ["industry", "Industry"], ["sub_industry", "Sub-industry"], ["products_services", "Products and services"], ["industries_served", "Industries served"],
    ["customer_type", "Customers (B2B, B2C, D2C, B2G)"], ["target_markets", "Markets they sell to"], ["key_customers", "Known customers"],
    ["competitors", "Competitors"], ["differentiation", "What makes them different"], ["market_position", "Market position"],
  ] },
  { group: "People", fields: [
    ["ceo", "CEO / MD"], ["founders", "Founders"], ["key_decision_makers", "Key decision makers"], ["tech_or_ops_head", "Head of tech / ops"],
    ["hiring_now", "Open roles"], ["departments_hiring", "Teams hiring"],
  ] },
  { group: "Digital footprint", fields: [
    ["tech_stack", "Tech stack seen"], ["ecommerce_platform", "E-commerce platform"], ["crm_signal", "CRM / marketing tools"], ["chat_on_site", "Chat on site"],
    ["booking_on_site", "Online booking"], ["whatsapp_on_site", "WhatsApp on site"], ["mobile_app", "Mobile app"], ["social_profiles", "Social profiles"],
    ["recent_campaigns", "Recent campaigns"], ["ad_activity", "Ads running"], ["content_activity", "Content activity"], ["website_quality", "Website quality"],
  ] },
  { group: "Signals and pain", fields: [
    ["recent_news", "Recent news"], ["expansion_signals", "Expansion signals"], ["pain_points", "Likely pain points"],
    ["automation_opportunities", "Automation opportunities"], ["ai_maturity", "AI maturity"], ["money_leak_estimate", "What the pain costs them (est.)"],
    ["best_entry_offer", "Best first offer"], ["best_entry_person", "Who to approach"], ["risks", "Risks / red flags"], ["summary", "One-paragraph summary"],
  ] },
];

export const PERSON_FIELDS: { group: string; fields: [string, string][] }[] = [
  { group: "Who", fields: [
    ["full_name", "Full name"], ["first_name", "First name"], ["current_title", "Title"], ["seniority", "Seniority"], ["department", "Department"],
    ["company", "Company"], ["is_decision_maker", "Decision maker?"], ["decision_role", "Role in the decision"], ["reports_to", "Reports to"], ["team_size", "Team size"],
  ] },
  { group: "Career", fields: [
    ["tenure_at_company_years", "Years at company"], ["start_date_at_company", "Joined"], ["years_experience", "Years of experience"],
    ["previous_companies", "Previous companies"], ["career_timeline", "Career journey"], ["career_summary", "Background"], ["education", "Education"],
    ["graduation_year", "Graduated"], ["board_roles", "Board / advisory roles"], ["side_businesses", "Other ventures"], ["investments", "Angel investments"],
  ] },
  { group: "Personal (public only)", fields: [
    ["estimated_age", "Age (est.)"], ["age_basis", "How age was estimated"], ["location_city", "City"], ["location_country", "Country"], ["timezone", "Timezone"],
    ["languages", "Languages"], ["estimated_net_worth", "Net worth (rough est.)"], ["net_worth_basis", "How net worth was estimated"], ["interests", "Interests"], ["causes", "Causes"],
  ] },
  { group: "Public presence", fields: [
    ["linkedin_url", "LinkedIn"], ["twitter", "X / Twitter"], ["instagram", "Instagram"], ["personal_site", "Website / blog"], ["public_email", "Public email"],
    ["public_phone", "Public phone"], ["publications_talks", "Talks / articles"], ["podcasts_interviews", "Podcasts / interviews"], ["awards", "Awards"],
    ["recent_posts_topics", "What they post about"],
  ] },
  { group: "How to sell to them", fields: [
    ["what_they_care_about", "What they care about"], ["communication_style", "Communication style"], ["personality_read", "Personality read"],
    ["likely_objections", "Likely objections"], ["talking_points", "Talking points"], ["best_channel", "Best channel"], ["best_time", "Best time to reach"],
    ["opener", "Opening line idea"], ["risk_notes", "Watch-outs"], ["summary", "One-paragraph summary"],
  ] },
];

const allKeys = (g: { fields: [string, string][] }[]) => g.flatMap((x) => x.fields.map(([k]) => k));

// ------------------------------------------------------------------ Wikidata (free, keyless)

const CURRENCY_Q: Record<string, string> = { Q4917: "USD", Q4916: "EUR", Q80524: "INR", Q25224: "GBP", Q200294: "AED", Q1104069: "CAD", Q259502: "AUD", Q39099: "CNY", Q8146: "JPY", Q190951: "SGD", Q199857: "SAR" };

async function wikidata(name: string, domain: string | null): Promise<string | null> {
  try {
    const s = (await (await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=3&format=json`, { headers: { "user-agent": "DaybookSales/1.0" }, signal: AbortSignal.timeout(10_000) })).json()) as { search?: { id: string; description?: string }[] };
    for (const hit of s.search ?? []) {
      if (!/company|business|manufacturer|retailer|brand|organization|firm|group|corporation|enterprise|startup|conglomerate/i.test(hit.description ?? "")) continue;
      const e = (await (await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${hit.id}.json`, { signal: AbortSignal.timeout(10_000) })).json()) as { entities: Record<string, { claims: Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]> }> };
      const claims = e.entities[hit.id]?.claims ?? {};
      const val = (p: string) => claims[p]?.[claims[p].length - 1]?.mainsnak?.datavalue?.value as Record<string, unknown> | string | undefined;
      const site = val("P856");
      if (domain && typeof site === "string" && domainOf(site) !== domain) continue;
      const out: string[] = [`Wikidata ${hit.id}: ${hit.description ?? ""}`];
      const rev = val("P2139") as { amount?: string; unit?: string } | undefined;
      if (rev?.amount) out.push(`revenue ${rev.amount} ${CURRENCY_Q[String(rev.unit).split("/").pop() ?? ""] ?? rev.unit}`);
      const emp = val("P1128") as { amount?: string } | undefined;
      if (emp?.amount) out.push(`employees ${emp.amount}`);
      const inc = val("P571") as { time?: string } | undefined;
      if (inc?.time) out.push(`founded ${inc.time.slice(1, 5)}`);
      if (claims.P414) out.push("listed on a stock exchange (P414)");
      const ticker = (claims.P414?.[0] as unknown as { qualifiers?: { P249?: { datavalue?: { value?: string } }[] } })?.qualifiers?.P249?.[0]?.datavalue?.value;
      if (ticker) out.push(`ticker ${ticker}`);
      if (typeof site === "string") out.push(`website ${site}`);
      return out.join("; ");
    }
  } catch {
    /* Wikidata is a bonus, never a blocker */
  }
  return null;
}

// ------------------------------------------------------------------ website audit (free heuristics)

export interface TechAudit {
  https: boolean;
  chat: string | null;
  booking: string | null;
  whatsapp: boolean;
  ecommerce: string | null;
  cms: string | null;
  analytics: string[];
  crm: string[];
  forms: number;
  mobile_meta: boolean;
  copyright_year: number | null;
  phone_visible: boolean;
  email_visible: boolean;
  socials: string[];
  page_kb: number;
  title: string;
}

export function techAudit(url: string, html: string): TechAudit {
  const h = html.toLowerCase();
  const pick = (pairs: [RegExp, string][]) => pairs.find(([re]) => re.test(h))?.[1] ?? null;
  const years = [...h.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/g)].map((m) => Number(m[1])).filter((y) => y > 1995 && y < 2100);
  return {
    https: url.startsWith("https://"),
    chat: pick([[/intercom/, "Intercom"], [/tawk\.to/, "Tawk"], [/crisp\.chat/, "Crisp"], [/drift\.com/, "Drift"], [/zendesk|zopim/, "Zendesk"], [/livechatinc|livechat\.com/, "LiveChat"], [/tidio/, "Tidio"], [/freshchat|freshdesk/, "Freshworks"], [/hubspot.*conversations|js\.usemessages/, "HubSpot chat"], [/botpress|voiceflow|chatbase|dialogflow/, "AI chatbot"]]),
    booking: pick([[/calendly\.com/, "Calendly"], [/cal\.com/, "Cal.com"], [/acuityscheduling/, "Acuity"], [/setmore/, "Setmore"], [/booksy|fresha|vagaro|square\.site\/book|simplybook/, "Booking app"], [/opentable|resy\.com|sevenrooms/, "Restaurant booking"]]),
    whatsapp: /wa\.me\/|api\.whatsapp\.com|whatsapp:\/\//.test(h),
    ecommerce: pick([[/cdn\.shopify|myshopify/, "Shopify"], [/woocommerce/, "WooCommerce"], [/magento|mage\//, "Magento"], [/bigcommerce/, "BigCommerce"], [/wix\.com.*ecom|wixstores/, "Wix Stores"], [/prestashop/, "PrestaShop"], [/opencart/, "OpenCart"]]),
    cms: pick([[/wp-content|wordpress/, "WordPress"], [/wix\.com|wixstatic/, "Wix"], [/squarespace/, "Squarespace"], [/webflow/, "Webflow"], [/framer/, "Framer"], [/__next|_next\/static/, "Next.js"], [/godaddy|websitebuilder/, "GoDaddy builder"]]),
    analytics: [[/googletagmanager|gtag\(|google-analytics/, "Google Analytics"], [/fbq\(|connect\.facebook\.net/, "Meta Pixel"], [/hotjar/, "Hotjar"], [/clarity\.ms/, "Clarity"], [/linkedin.*insight|snap\.licdn/, "LinkedIn Insight"], [/tiktok.*pixel|analytics\.tiktok/, "TikTok Pixel"]].filter(([re]) => (re as RegExp).test(h)).map(([, n]) => n as string),
    crm: [[/hs-scripts|hubspot/, "HubSpot"], [/salesforce|pardot/, "Salesforce"], [/zoho/, "Zoho"], [/mailchimp/, "Mailchimp"], [/klaviyo/, "Klaviyo"], [/activecampaign/, "ActiveCampaign"]].filter(([re]) => (re as RegExp).test(h)).map(([, n]) => n as string),
    forms: (h.match(/<form/g) ?? []).length,
    mobile_meta: /<meta[^>]+name=["']viewport/.test(h),
    copyright_year: years.length ? Math.max(...years) : null,
    phone_visible: /tel:|\+\d[\d\s-]{8,}/.test(h),
    email_visible: /mailto:/.test(h),
    socials: ["facebook.com", "instagram.com", "linkedin.com", "youtube.com", "x.com", "twitter.com", "tiktok.com"].filter((s) => h.includes(s)),
    page_kb: Math.round(html.length / 1024),
    title: strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
  };
}

function subLinks(base: string, html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    const href = m[1];
    if (!/about|team|company|who-we-are|contact|careers|jobs|services|products|leadership|our-story/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      if (domainOf(u.href) === domainOf(base)) out.add(u.href.split("?")[0]);
    } catch {
      /* skip */
    }
  }
  return [...out].slice(0, 4);
}

async function findWebsite(name: string): Promise<string | null> {
  const hits = await webSearch(`${name} official website`, 5).catch(() => [] as SearchHit[]);
  const skip = /linkedin|facebook|instagram|wikipedia|crunchbase|zaubacorp|tofler|glassdoor|indeed|justdial|indiamart|yelp|trustpilot|bloomberg|zoominfo|dnb\.com|twitter|x\.com|youtube/i;
  return hits.find((h) => !skip.test(h.url))?.url ?? null;
}

// ------------------------------------------------------------------ company

export async function enrichCompany(id: number): Promise<void> {
  const cfg = await salesConfig();
  const c = await one<{ id: number; name: string; domain: string | null; website: string | null; country: string | null; industry: string | null }>("select id, name, domain, website, country, industry from sales_companies where id = $1", [id]);
  if (!c) return;
  const evidence: string[] = [];
  let website = c.website ?? (c.domain ? `https://${c.domain}` : null);
  if (!website) website = await findWebsite(c.name);
  let audit: TechAudit | null = null;
  if (website) {
    const home = await fetchPage(website, { maxChars: 5000 });
    if (home) {
      website = home.url;
      if (home.html) audit = techAudit(home.url, home.html);
      evidence.push(`[website ${home.url}] ${home.title}\n${home.text}`);
      for (const link of home.html ? subLinks(home.url, home.html) : []) {
        const p = await fetchPage(link, { maxChars: 2500, reader: false });
        if (p) evidence.push(`[page ${link}] ${p.text}`);
      }
    }
  }
  const domain = domainOf(website);
  const wd = await wikidata(c.name, domain);
  if (wd) evidence.push(`[wikidata] ${wd}`);
  const year = new Date().getUTCFullYear();
  const queries = [
    `"${c.name}" revenue OR turnover OR "annual sales"`,
    `"${c.name}" employees OR "team size" site:linkedin.com`,
    `"${c.name}" CEO OR founder OR "managing director"`,
    `"${c.name}" competitors OR alternatives`,
    `"${c.name}" news ${year}`,
    `"${c.name}" funding OR raises OR acquired`,
  ].slice(0, cfg.radar.enrich_queries);
  for (const qy of queries) {
    const hits = await webSearch(qy, 6).catch(() => [] as SearchHit[]);
    if (hits.length) evidence.push(`[search: ${qy}]\n${hits.map((h) => `- ${h.title} | ${h.url} | ${h.snippet}`).join("\n")}`);
  }
  if (audit) evidence.push(`[site scan] ${JSON.stringify(audit)}`);

  const system = `You are a B2B research analyst. Build a company profile from the EVIDENCE only.
Return JSON: an object whose keys are exactly these: ${allKeys(COMPANY_FIELDS).join(", ")}.
Each value is {"v": value or null, "src": short source (url or "website" / "search" / "wikidata" / "estimate"), "conf": "high|medium|low", "est": true when estimated}.
Rules:
- Never invent names, numbers, customers or news. Unknown facts are {"v": null}.
- revenue_usd is NEVER null. If not published, estimate it realistically: employees x typical revenue per employee for this
  industry and country, adjusted by signals (locations, pricing, traffic, funding, store count). Put the number in USD per year,
  est true, conf low or medium, and explain the maths in revenue_method. Be brutal and realistic, not flattering: most SMEs are small.
- employees: from LinkedIn snippets, the website or Wikidata; else estimate with est true.
- listed: true only with evidence of a stock listing.
- company_age_years from founded_year and the current year ${year}.
- pain_points, automation_opportunities, best_entry_offer, money_leak_estimate: your analysis for an AI agency whose offers are:
  ${cfg.offers.join("; ")}. money_leak_estimate must state its assumption.
- summary: one plain paragraph a salesperson can read in 20 seconds.`;
  const out = await llmJson<Enrichment>(system, `COMPANY: ${c.name}${c.country ? `, ${c.country}` : ""}${c.industry ? `, ${c.industry}` : ""}\n\nEVIDENCE:\n${evidence.join("\n\n").slice(0, 26_000)}`, { maxTokens: 6000, totalMs: 80_000 });
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

// ------------------------------------------------------------------ person

export async function enrichPerson(id: number): Promise<void> {
  const p = await one<{ id: number; full_name: string; title: string | null; linkedin: string | null; company: string | null; country: string | null; emails: string[] }>(
    `select p.id, p.full_name, p.title, p.linkedin, c.name as company, coalesce(p.country, c.country) as country, p.emails
     from sales_people p left join sales_companies c on c.id = p.company_id where p.id = $1`,
    [id],
  );
  if (!p || p.full_name.length < 3 || /unknown/i.test(p.full_name)) return;
  const evidence: string[] = [];
  const who = `"${p.full_name}"${p.company ? ` "${p.company}"` : ""}`;
  const queries = [`${who} linkedin`, `${who}`, `"${p.full_name}" ${p.company ?? ""} interview OR podcast OR speaker`, `"${p.full_name}" ${p.company ?? ""} founder OR director OR investor`];
  for (const qy of queries.slice(0, 4)) {
    const hits = await webSearch(qy, 6).catch(() => [] as SearchHit[]);
    if (hits.length) evidence.push(`[search: ${qy}]\n${hits.map((h) => `- ${h.title} | ${h.url} | ${h.snippet}`).join("\n")}`);
  }
  const existing = await one<{ n: string | null }>(
    `select string_agg(coalesce(summary, left(body, 300)), ' | ') as n from (select summary, body from sales_interactions where person_id = $1 order by occurred_at desc limit 6) x`,
    [id],
  );
  if (existing?.n) evidence.push(`[your own conversations with them] ${existing.n.slice(0, 3000)}`);
  const year = new Date().getUTCFullYear();
  const system = `You are a sales researcher. Build a profile of this person from the EVIDENCE only (public information and the owner's own conversations).
Return JSON whose keys are exactly: ${allKeys(PERSON_FIELDS).join(", ")}.
Each value is {"v": value or null, "src": short source, "conf": "high|medium|low", "est": true when estimated}.
Rules:
- Never invent employers, schools, emails, phones or facts. Unknown is {"v": null}. Do not guess private contact details.
- Make sure the evidence is about THIS person (same name AND same company or role). If unsure, leave it null.
- estimated_age: only from career start or graduation year (graduation at ~22), as a range like "38 to 42", est true, explain in age_basis.
- estimated_net_worth: a rough range only when role, ownership or exits give a real basis, est true, explain in net_worth_basis; else null.
- tenure_at_company_years from the start date and the current year ${year}.
- is_decision_maker: true for founders, owners, C-level, directors and heads of the relevant function.
- what_they_care_about, talking_points, opener, likely_objections: practical, specific, for ${(await salesConfig()).owner.name} of an AI agency.`;
  const out = await llmJson<Enrichment>(system, `PERSON: ${p.full_name}${p.title ? `, ${p.title}` : ""}${p.company ? ` at ${p.company}` : ""}${p.country ? `, ${p.country}` : ""}${p.linkedin ? `\nLinkedIn: ${p.linkedin}` : ""}\n\nEVIDENCE:\n${evidence.join("\n\n").slice(0, 20_000)}`, { maxTokens: 5000, totalMs: 75_000 });
  const str = (f?: Field) => (f?.v !== null && f?.v !== undefined && String(f.v).trim() ? String(f.v).trim() : null);
  await q(
    `update sales_people set enrichment = $2, enriched_at = now(), title = coalesce(title, $3), city = coalesce(city, $4), country = coalesce(country, $5),
       linkedin = coalesce(linkedin, $6), is_decision_maker = coalesce(is_decision_maker, $7), updated_at = now() where id = $1`,
    [id, JSON.stringify(out), str(out.current_title), str(out.location_city), str(out.location_country),
      str(out.linkedin_url)?.includes("linkedin.com") ? str(out.linkedin_url) : null, typeof out.is_decision_maker?.v === "boolean" ? out.is_decision_maker.v : null],
  );
}

// ------------------------------------------------------------------ opportunity audit and brief

export interface Opportunity {
  title: string;
  problem: string;
  fix: string;
  impact: string;
  effort: "days" | "weeks" | "months";
}
export interface SiteAudit {
  tech?: TechAudit;
  score?: number;
  summary?: string;
  findings?: string[];
  opportunities?: Opportunity[];
  money_leak?: string;
  first_project?: string;
  brief_md?: string;
}

/** Scans the website and writes the value-first brief: what they are losing today and the fixes, with honest estimates. */
export async function auditCompany(id: number): Promise<SiteAudit | null> {
  const cfg = await salesConfig();
  const c = await one<{ id: number; name: string; website: string | null; domain: string | null; industry: string | null; country: string | null; employees: number | null; revenue_usd: number | null; enrichment: Enrichment }>(
    "select id, name, website, domain, industry, country, employees, revenue_usd, enrichment from sales_companies where id = $1",
    [id],
  );
  if (!c) return null;
  const url = c.website ?? (c.domain ? `https://${c.domain}` : await findWebsite(c.name));
  const page = url ? await fetchPage(url, { maxChars: 6000 }) : null;
  const tech = page?.html ? techAudit(page.url, page.html) : null;
  const facts = Object.entries(c.enrichment ?? {}).filter(([, f]) => f?.v).slice(0, 40).map(([k, f]) => `${k}: ${String(f.v).slice(0, 200)}`).join("\n");
  const system = `You are ${cfg.owner.name} of ${cfg.owner.company}, writing a value-first opportunity brief for a business you want to help.
Offers you can deliver: ${cfg.offers.join("; ")}.
Return JSON {"score": 0-100 digital maturity, "summary": 2 lines, "findings": [plain observations from the scan, max 8],
"opportunities": [{"title","problem","fix","impact" (honest estimate with the assumption, e.g. "~25 hrs/week of manual order entry, about $30k/yr at local wages"),"effort":"days|weeks|months"}] max 5,
"money_leak": one honest line on what the gaps cost them per year with assumptions,
"first_project": the smallest high-value first project,
"brief_md": a short markdown brief addressed to them (headings: What we noticed, What it is costing you, What we would fix first, How it would work), friendly and specific, no hype, no invented numbers beyond clearly labelled estimates, no em dashes}.`;
  const user = `COMPANY: ${c.name} | ${c.industry ?? ""} | ${c.country ?? ""} | employees ${c.employees ?? "?"} | revenue est ${c.revenue_usd ?? "?"} USD
WEBSITE: ${url ?? "none found"}
SCAN: ${tech ? JSON.stringify(tech) : "no site scan"}
PAGE TEXT: ${(page?.text ?? "").slice(0, 4000)}
KNOWN FACTS:\n${facts}`;
  const out = await llmJson<SiteAudit>(system, user, { maxTokens: 3000, totalMs: 60_000 });
  const audit: SiteAudit = { ...out, tech: tech ?? undefined };
  await q("update sales_companies set audit = $2, audited_at = now(), website = coalesce(website, $3) where id = $1", [id, JSON.stringify(audit), url]);
  return audit;
}
