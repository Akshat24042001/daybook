/**
 * Who a lead really is, from everything the owner entered: the company name, the city and country, the industry and
 * services, the contact's name, phone and email, the website, notes and what was said. Research is pinned to these
 * "anchors" so it never profiles a namesake (Bliss in Dubai is not Bliss Club Fitness in Bangalore).
 *
 *   - the location comes from the deal, the company, the contacts, the phone's country code and the email's ending;
 *   - a business email's domain is the strongest website clue there is;
 *   - every candidate website or search result is scored against the anchors: same phone, same person, same city or
 *     country count for it; another country's city, phone code or domain ending counts against it.
 */
import { one, q } from "../db";

export interface AnchorPerson { name: string; title: string | null; phones: string[]; emails: string[]; linkedin: string | null }
export interface Anchors {
  companyId: number;
  name: string;
  website: string | null;
  domain: string | null;
  websiteSource: string | null;
  /** business email domains of the contacts (gmail and the like left out) */
  emailDomains: string[];
  city: string | null;
  region: string | null;
  country: string | null;
  /** where the country came from, in words */
  countryFrom: string | null;
  industry: string | null;
  services: string | null;
  people: AnchorPerson[];
  phones: string[];
  socials: string[];
  /** what the owner wrote about them (deal notes, requirements, summary), short */
  notes: string | null;
}

// ------------------------------------------------------------------ pure helpers

const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|zoho|zohomail|gmx|mail|yandex|rediffmail|rediff|qq|163|126)\.[a-z.]+$/i;

/** Country names by international dialling code (longest code first when matching). */
const DIAL: [string, string][] = [
  ["971", "United Arab Emirates"], ["966", "Saudi Arabia"], ["974", "Qatar"], ["968", "Oman"], ["973", "Bahrain"], ["965", "Kuwait"],
  ["962", "Jordan"], ["961", "Lebanon"], ["972", "Israel"], ["880", "Bangladesh"], ["977", "Nepal"], ["852", "Hong Kong"], ["353", "Ireland"],
  ["351", "Portugal"], ["254", "Kenya"], ["234", "Nigeria"], ["233", "Ghana"], ["255", "Tanzania"], ["256", "Uganda"], ["212", "Morocco"],
  ["91", "India"], ["92", "Pakistan"], ["94", "Sri Lanka"], ["44", "United Kingdom"], ["61", "Australia"], ["64", "New Zealand"],
  ["65", "Singapore"], ["60", "Malaysia"], ["62", "Indonesia"], ["63", "Philippines"], ["66", "Thailand"], ["84", "Vietnam"], ["86", "China"],
  ["81", "Japan"], ["82", "South Korea"], ["49", "Germany"], ["33", "France"], ["34", "Spain"], ["39", "Italy"], ["31", "Netherlands"],
  ["41", "Switzerland"], ["32", "Belgium"], ["46", "Sweden"], ["47", "Norway"], ["45", "Denmark"], ["48", "Poland"], ["90", "Turkey"],
  ["20", "Egypt"], ["27", "South Africa"], ["55", "Brazil"], ["52", "Mexico"], ["1", "United States or Canada"],
];

const ALIASES: Record<string, string> = {
  uae: "United Arab Emirates", "u.a.e": "United Arab Emirates", "u.a.e.": "United Arab Emirates", emirates: "United Arab Emirates", "united arab emirates": "United Arab Emirates",
  india: "India", bharat: "India", usa: "United States", "u.s.a": "United States", us: "United States", "united states": "United States", america: "United States",
  uk: "United Kingdom", "u.k": "United Kingdom", "united kingdom": "United Kingdom", england: "United Kingdom", britain: "United Kingdom", ksa: "Saudi Arabia",
  "saudi arabia": "Saudi Arabia", saudi: "Saudi Arabia", qatar: "Qatar", oman: "Oman", bahrain: "Bahrain", kuwait: "Kuwait", singapore: "Singapore",
  australia: "Australia", canada: "Canada", germany: "Germany", france: "France", pakistan: "Pakistan", bangladesh: "Bangladesh", "sri lanka": "Sri Lanka",
  nepal: "Nepal", malaysia: "Malaysia", "new zealand": "New Zealand", "south africa": "South Africa", nigeria: "Nigeria", kenya: "Kenya", ireland: "Ireland",
  netherlands: "Netherlands", spain: "Spain", italy: "Italy", switzerland: "Switzerland", turkey: "Turkey", egypt: "Egypt", "hong kong": "Hong Kong", china: "China",
};

/** Big cities by country, to read a country from a city and to spot a page about another place. */
const CITIES: Record<string, string[]> = {
  "United Arab Emirates": ["dubai", "abu dhabi", "sharjah", "ajman", "ras al khaimah", "fujairah", "umm al quwain", "al ain", "jebel ali", "deira", "jumeirah", "business bay", "dubai marina"],
  India: ["mumbai", "bombay", "delhi", "new delhi", "noida", "gurgaon", "gurugram", "bangalore", "bengaluru", "hyderabad", "chennai", "kolkata", "pune", "ahmedabad",
    "surat", "jaipur", "udaipur", "lucknow", "indore", "bhopal", "nagpur", "vadodara", "baroda", "rajkot", "chandigarh", "kochi", "coimbatore", "thane", "navi mumbai",
    "vizag", "visakhapatnam", "nashik", "kanpur", "ludhiana", "agra", "mysore", "mysuru", "goa", "bhubaneswar", "guwahati", "patna", "ranchi", "raipur", "dehradun"],
  "Saudi Arabia": ["riyadh", "jeddah", "dammam", "mecca", "makkah", "medina", "khobar"],
  Qatar: ["doha"], Oman: ["muscat"], Bahrain: ["manama"], Kuwait: ["kuwait city"],
  "United Kingdom": ["london", "manchester", "birmingham", "leeds", "glasgow", "edinburgh", "liverpool", "bristol"],
  "United States": ["new york", "los angeles", "chicago", "houston", "san francisco", "seattle", "austin", "boston", "miami", "dallas", "atlanta"],
  Singapore: ["singapore"], Australia: ["sydney", "melbourne", "brisbane", "perth", "adelaide"], Canada: ["toronto", "vancouver", "montreal", "calgary"],
  Pakistan: ["karachi", "lahore", "islamabad"], Bangladesh: ["dhaka", "chittagong"], "Sri Lanka": ["colombo"], Nepal: ["kathmandu"],
  Malaysia: ["kuala lumpur"], Germany: ["berlin", "munich", "hamburg", "frankfurt"], France: ["paris", "lyon"], Netherlands: ["amsterdam", "rotterdam"],
};

/** Each country's own domain ending. */
const TLD: Record<string, string> = {
  "United Arab Emirates": "ae", India: "in", "United Kingdom": "uk", "Saudi Arabia": "sa", Qatar: "qa", Oman: "om", Bahrain: "bh", Kuwait: "kw",
  Singapore: "sg", Australia: "au", Canada: "ca", Germany: "de", France: "fr", Pakistan: "pk", Bangladesh: "bd", "Sri Lanka": "lk", Nepal: "np",
  Malaysia: "my", "New Zealand": "nz", "South Africa": "za", Nigeria: "ng", Kenya: "ke", Ireland: "ie", Netherlands: "nl", Spain: "es", Italy: "it",
  Switzerland: "ch", Turkey: "tr", Egypt: "eg", "Hong Kong": "hk", China: "cn",
};

/** "UAE", "dubai" or "U.A.E." -> "United Arab Emirates". Unknown text comes back trimmed. Pure. */
export function normCountry(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  const k = t.toLowerCase().replace(/\s+/g, " ");
  if (ALIASES[k]) return ALIASES[k];
  const city = countryOfCity(k);
  return city ?? t;
}

/** A country name or alias we recognise, else null (never an unknown word). Pure. */
export function knownCountry(v: string | null | undefined): string | null {
  const k = (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!k) return null;
  if (ALIASES[k]) return ALIASES[k];
  return Object.keys(CITIES).find((c) => c.toLowerCase() === k) ?? Object.keys(TLD).find((c) => c.toLowerCase() === k) ?? null;
}

/** The country of a well known city, or null. Pure. */
export function countryOfCity(city: string | null | undefined): string | null {
  const c = (city ?? "").trim().toLowerCase();
  if (!c) return null;
  for (const [country, list] of Object.entries(CITIES)) if (list.includes(c)) return country;
  return null;
}

/** The country a phone number dials, when it carries an international code (+971..., 00971..., or 12 digits starting 91 / 971). Pure. */
export function dialCountry(phone: string | null | undefined): string | null {
  const raw = (phone ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  const intl = /^\s*(\+|00)/.test(raw) ? digits.replace(/^00/, "") : (digits.length >= 11 ? digits : "");
  if (!intl) return null;
  for (const [code, country] of DIAL) if (intl.startsWith(code) && intl.length - code.length >= 7) return country;
  return null;
}

/** The last 8 digits of a phone: how it is matched on a page, whatever the formatting. Pure. */
export const phoneKey = (p: string): string => p.replace(/[^\d]/g, "").slice(-8);

/** The domain of a business email, or null for gmail and the like. Pure. */
export function businessDomain(email: string | null | undefined): string | null {
  const d = (email ?? "").trim().toLowerCase().split("@")[1];
  if (!d || !d.includes(".") || FREE_MAIL.test(d)) return null;
  return d;
}

/** Where the lead is, in words: "Dubai, United Arab Emirates". Pure. */
export function placeOf(a: Pick<Anchors, "city" | "region" | "country">): string | null {
  const parts = [a.city, a.region && a.region !== a.city ? a.region : null, a.country && a.country !== a.city ? a.country : null].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** The words a search or a page should carry to be about this place: "Dubai" or "United Arab Emirates" / "UAE". Pure. */
export function placeWords(a: Pick<Anchors, "city" | "country">): string[] {
  const out = new Set<string>();
  if (a.city) out.add(a.city.toLowerCase());
  if (a.country) {
    out.add(a.country.toLowerCase());
    for (const [k, v] of Object.entries(ALIASES)) if (v === a.country && k.length >= 3) out.add(k);
    for (const c of CITIES[a.country] ?? []) out.add(c);
  }
  return [...out];
}

/** The best single search term for the place: the city when known, else a short country name. Pure. */
export function placeTerm(a: Pick<Anchors, "city" | "country">): string | null {
  if (a.city) return a.city;
  if (a.country === "United Arab Emirates") return "UAE";
  return a.country;
}

export interface Match { score: number; conflict: boolean; reasons: string[] }

/**
 * How well a page or a search result fits the lead. Positive signals: the contact's phone, their email domain, the
 * contact's name, the city or country, the country's domain ending, the industry. Negative: it plainly sits in another
 * country (that country's cities, phone code or domain ending, and none of the lead's). Pure.
 */
export function matchLead(page: { url: string; text: string; title?: string }, a: Anchors): Match {
  const reasons: string[] = [];
  let score = 0;
  const hay = `${page.title ?? ""} ${page.text}`.toLowerCase();
  const host = (() => { try { return new URL(page.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } })();
  const tld = host.split(".").pop() ?? "";
  const digits = hay.replace(/[^\d]/g, " ");
  const words = nameKeyWords(a.name);

  if (a.emailDomains.some((d) => host === d || host.endsWith(`.${d}`))) { score += 10; reasons.push("it is the domain of your contact's email"); }
  // only a website you (or the lead) gave proves anything; one an earlier run picked is what is being checked
  const given = a.websiteSource === "you" || a.websiteSource === "lead";
  if (given && a.domain && (host === a.domain || host.endsWith(`.${a.domain}`))) { score += 10; reasons.push("it is the website you gave"); }
  const phoneHit = a.phones.find((p) => phoneKey(p).length === 8 && digits.replace(/\s+/g, "").includes(phoneKey(p)));
  if (phoneHit) { score += 8; reasons.push(`it lists your contact's number ${phoneHit}`); }
  const person = a.people.find((p) => p.name.length > 4 && hay.includes(p.name.toLowerCase()));
  if (person) { score += 5; reasons.push(`it names ${person.name}`); }
  if (words.length && words.some((w) => host.includes(w))) { score += 2; reasons.push("the name is in the web address"); }
  else if (words.length && words.every((w) => hay.includes(w))) { score += 1; reasons.push("it mentions the name"); }
  const place = placeWords(a);
  const placeHit = place.find((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(hay));
  if (placeHit) { score += 3; reasons.push(`it is in ${placeHit}`); }
  const ownCode = a.country ? DIAL.find(([, c]) => c === a.country)?.[0] : null;
  const pageCodes = [...hay.matchAll(/(?:\+|\b00)(\d{1,3})[\s-]?\d/g)].map((m) => m[1]);
  if (ownCode && pageCodes.some((c) => c.startsWith(ownCode))) { score += 3; reasons.push(`its phone numbers are ${a.country} numbers`); }
  const ownTld = a.country ? TLD[a.country] : null;
  if (ownTld && tld === ownTld) { score += 2; reasons.push(`its address ends .${tld}`); }
  if (a.industry && a.industry.length > 3 && hay.includes(a.industry.toLowerCase().split(/[\s,/]+/)[0])) score += 1;

  // somewhere else?
  let conflict = false;
  const ownNumbers = !!ownCode && pageCodes.some((c) => c.startsWith(ownCode));
  if (a.country && !placeHit && !phoneHit && !ownNumbers && !reasons.some((r) => r.includes("email") || r.includes("you gave"))) {
    const elsewhere = Object.entries(CITIES).filter(([c]) => c !== a.country)
      .map(([c, list]) => [c, list.filter((x) => new RegExp(`\\b${x}\\b`, "i").test(hay)).length] as const)
      .sort((x, y) => y[1] - x[1])[0];
    const otherTld = Object.entries(TLD).find(([c, t]) => c !== a.country && t === tld)?.[0];
    const codes = pageCodes;
    const otherCode = codes.length && ownCode && !codes.some((c) => c.startsWith(ownCode)) ? DIAL.find(([code]) => codes.some((c) => c.startsWith(code)))?.[1] : null;
    if (elsewhere && elsewhere[1] > 0) { conflict = true; score -= 5; reasons.push(`it is about ${elsewhere[0]} (mentions ${CITIES[elsewhere[0]].find((x) => new RegExp(`\\b${x}\\b`, "i").test(hay))}), not ${placeOf(a)}`); }
    else if (otherTld) { conflict = true; score -= 4; reasons.push(`its address ends .${tld} (${otherTld}), not ${a.country}`); }
    else if (otherCode && otherCode !== a.country) { conflict = true; score -= 4; reasons.push(`its phone numbers are ${otherCode} numbers`); }
  }
  return { score, conflict, reasons };
}

/** The distinctive words of a company name, for matching (legal endings and filler left out). Pure. */
export function nameKeyWords(name: string): string[] {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\b(private|pvt|limited|ltd|llp|llc|fzco|fze|fz|dmcc|inc|co|corp|corporation|company|the|and|group|opc|trading|services|solutions)\b/g, " ")
    .split(/[\s-]+/).filter((w) => w.length > 2);
}

/** True when what we know is enough to tell this lead from a namesake (a place, a phone, a person or an email domain). Pure. */
export function canDisambiguate(a: Anchors): boolean {
  return !!(a.country || a.city || a.phones.length || a.emailDomains.length || a.domain || a.people.length);
}

/** The anchors as plain lines for an AI prompt. Pure. */
export function anchorLines(a: Anchors): string {
  const lines = [
    `Business name: ${a.name}`,
    placeOf(a) ? `Location: ${placeOf(a)}${a.countryFrom ? ` (${a.countryFrom})` : ""}` : null,
    a.industry ? `Industry: ${a.industry}` : null,
    a.services ? `What they need or do: ${a.services}` : null,
    a.website ? `Website: ${a.website}${a.websiteSource === "research" ? " (found by earlier research, not confirmed)" : ""}` : null,
    a.emailDomains.length ? `Their email domain: ${a.emailDomains.join(", ")}` : null,
    ...a.people.slice(0, 4).map((p) => `Contact: ${p.name}${p.title ? `, ${p.title}` : ""}${p.phones.length ? `, phone ${p.phones.join(" / ")}` : ""}${p.emails.length ? `, email ${p.emails.join(" / ")}` : ""}${p.linkedin ? `, ${p.linkedin}` : ""}`),
    a.phones.length && !a.people.some((p) => p.phones.length) ? `Phone: ${a.phones.join(" / ")}` : null,
    a.socials.length ? `Social: ${a.socials.join(", ")}` : null,
    a.notes ? `Owner's notes: ${a.notes}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

// ------------------------------------------------------------------ gathering

const clip = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n) || null;

/** Everything the owner told us about a company and its lead, in one place. */
export async function gatherAnchors(companyId: number): Promise<Anchors | null> {
  const c = await one<{ id: number; name: string; website: string | null; domain: string | null; website_source: string | null; city: string | null; region: string | null;
    country: string | null; industry: string | null; description: string | null; notes: string | null; phone: string | null; email: string | null; linkedin: string | null; address: string | null }>(
    "select id, name, website, domain, website_source, city, region, country, industry, description, notes, phone, email, linkedin, address from sales_companies where id = $1", [companyId]);
  if (!c) return null;
  const deals = await q<{ title: string | null; city: string | null; region: string | null; country: string | null; industry: string | null; services: string | null;
    summary: string | null; requirements: string | null; notes: string | null; address: string | null; person_id: number | null }>(
    `select title, city, region, country, industry, services, summary, requirements, notes, address, person_id from sales_deals
      where company_id = $1 order by updated_at desc limit 3`, [companyId]);
  const people = await q<{ full_name: string; title: string | null; phones: string[]; emails: string[]; linkedin: string | null; city: string | null; country: string | null; instagram: string | null; whatsapp: string | null }>(
    `select full_name, title, phones, emails, linkedin, city, country, instagram, whatsapp from sales_people
      where company_id = $1 or id = any($2::int[]) order by is_decision_maker desc nulls last, id limit 6`,
    [companyId, deals.map((d) => d.person_id).filter((x): x is number => !!x)]);
  const radar = await one<{ country: string | null; industry: string | null; city: string | null }>(
    "select fit->>'country' as country, fit->>'industry' as industry, fit->>'city' as city from sales_radar_items where company_id = $1 order by id desc limit 1", [companyId]).catch(() => null);

  const first = <T>(...xs: (T | null | undefined)[]) => xs.find((x) => x !== null && x !== undefined && String(x).trim() !== "") ?? null;
  const city = first(...deals.map((d) => d.city), c.city, ...people.map((p) => p.city), radar?.city);
  const region = first(c.region, ...deals.map((d) => d.region));
  const phones = [...new Set([c.phone, ...people.flatMap((p) => [...(p.phones ?? []), p.whatsapp])].filter((x): x is string => !!x && x.replace(/\D/g, "").length >= 7))];
  const emails = [...new Set([c.email, ...people.flatMap((p) => p.emails ?? [])].filter((x): x is string => !!x))];
  const emailDomains = [...new Set(emails.map(businessDomain).filter((x): x is string => !!x))];

  // the country: said outright, else read from the city, the phones or the email ending
  let country: string | null = null;
  let countryFrom: string | null = null;
  // the deal and the contacts are what you typed; the company's own country may have been filled by research, so it comes last
  const said = first(...deals.map((d) => d.country), ...people.map((p) => p.country), radar?.country);
  if (said) { country = normCountry(said); countryFrom = "you entered it"; }
  if (!country && city) {
    country = countryOfCity(city) ?? knownCountry(city);
    countryFrom = country ? (countryOfCity(city) ? `from the city ${city}` : "you entered it") : null;
  }
  if (!country) {
    const dial = phones.map(dialCountry).find(Boolean);
    if (dial) { country = dial; countryFrom = "from the phone's country code"; }
  }
  if (!country && c.country) { country = normCountry(c.country); countryFrom = c.website_source === "research" ? "from earlier research" : "from the company record"; }
  if (!country) {
    const ending = emailDomains.map((d) => d.split(".").pop()!).find((t) => Object.values(TLD).includes(t));
    if (ending) { country = Object.entries(TLD).find(([, t]) => t === ending)![0]; countryFrom = `from the email ending .${ending}`; }
  }
  // a typed "Dubai" in the city field is also the city; a country typed as a city is not
  const cityClean = city && normCountry(city) !== city && !countryOfCity(city) ? null : city;

  const notes = clip([c.description, c.notes, ...deals.flatMap((d) => [d.requirements, d.summary, d.notes, d.address]), c.address].filter(Boolean).join(" | "), 700);
  return {
    companyId,
    name: c.name,
    website: c.website ?? (c.domain ? `https://${c.domain}` : null),
    domain: c.domain,
    websiteSource: c.website_source,
    emailDomains,
    city: cityClean,
    region,
    country,
    countryFrom,
    industry: first(c.industry, ...deals.map((d) => d.industry), radar?.industry),
    services: first(...deals.map((d) => d.services)),
    people: people.filter((p) => p.full_name && !/unknown/i.test(p.full_name)).map((p) => ({ name: p.full_name, title: p.title, phones: p.phones ?? [], emails: p.emails ?? [], linkedin: p.linkedin })),
    phones,
    socials: [c.linkedin, ...people.map((p) => p.instagram)].filter((x): x is string => !!x),
    notes,
  };
}
