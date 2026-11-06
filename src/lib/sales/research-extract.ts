/**
 * Pulling contact details and technical facts out of what we fetched. Pure functions with no network and no database,
 * so they are easy to test and cannot hallucinate: what comes out was literally on the page or in the DNS record.
 */

export interface FoundEmail {
  email: string;
  kind: "generic" | "personal";
  page: string;
}
export interface Contacts {
  emails: FoundEmail[];
  phones: string[];
  socials: Record<string, string>;
  addresses: string[];
  /** schema.org organisation facts the site publishes about itself */
  org: Record<string, unknown>;
}

const GENERIC_LOCAL = /^(info|hello|hi|contact|sales|support|admin|office|enquir(y|ies)|inquir(y|ies)|careers|jobs|hr|team|mail|accounts?|billing|help|marketing|press|media|service|customerservice|reception|bookings?|orders?|general|partners?|hey)$/i;
const JUNK_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|user|name|yourname|your-?email|email|test|username|example|you|someone|firstname|lastname|john\.?doe|jane\.?doe)$/i;
const JUNK_DOMAIN = /(^|\.)(example\.(com|org)|domain\.com|email\.com|sentry\.io|sentry\.wixpress\.com|wixpress\.com|yoursite\.com|yourdomain\.com|mysite\.com|company\.com|test\.com|godaddy\.com|schema\.org|w3\.org|gravatar\.com)$/i;

export function extractEmails(text: string, page: string): FoundEmail[] {
  const found = new Map<string, FoundEmail>();
  const decoded = text.replace(/\s*(?:\[at\]|\(at\))\s*/gi, "@").replace(/&#64;|&commat;|%40/gi, "@");
  for (const m of decoded.matchAll(/[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi)) {
    const email = m[0].toLowerCase().replace(/[.,;:]+$/, "");
    const [local, domain] = email.split("@");
    if (!domain || /\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$/i.test(email)) continue;
    if (JUNK_LOCAL.test(local) || JUNK_DOMAIN.test(domain) || local.length < 2 || /^\d+$/.test(local)) continue;
    if (!found.has(email)) found.set(email, { email, kind: GENERIC_LOCAL.test(local) ? "generic" : "personal", page });
  }
  return [...found.values()];
}

export function extractPhones(html: string): string[] {
  const out = new Map<string, string>();
  const add = (raw: string) => {
    const cleaned = raw.replace(/[^\d+]/g, "");
    const digits = cleaned.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return;
    if (/^(\d)\1+$/.test(digits)) return; // 0000000000
    const key = digits.slice(-9);
    if (!out.has(key)) out.set(key, cleaned.startsWith("+") ? cleaned : raw.trim().replace(/\s+/g, " "));
  };
  for (const m of html.matchAll(/href=["']tel:([^"']+)["']/gi)) add(decodeURIComponent(m[1]));
  for (const m of html.matchAll(/\+\d{1,3}[\s().-]*\d[\d\s().-]{7,15}\d/g)) add(m[0]);
  return [...out.values()].slice(0, 6);
}

const SOCIAL: [string, RegExp][] = [
  ["linkedin", /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in|school)\/[A-Za-z0-9_%.-]+/i],
  ["facebook", /https?:\/\/(?:www\.|m\.)?facebook\.com\/(?!sharer|share|tr\?|plugins|dialog)[A-Za-z0-9_.-]+/i],
  ["instagram", /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel|explore)[A-Za-z0-9_.]+/i],
  ["x", /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home)[A-Za-z0-9_]+/i],
  ["youtube", /https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/|user\/)[A-Za-z0-9_.-]+/i],
  ["tiktok", /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9_.]+/i],
  ["github", /https?:\/\/(?:www\.)?github\.com\/(?!sponsors)[A-Za-z0-9_-]+/i],
  ["whatsapp", /https?:\/\/(?:wa\.me\/\d+|api\.whatsapp\.com\/send\?phone=\d+)/i],
];

export function extractSocials(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, re] of SOCIAL) {
    const m = html.match(re);
    if (m) out[name] = m[0].replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
  return out;
}

const ORG_TYPES = /^(Organization|Corporation|LocalBusiness|Store|Restaurant|ProfessionalService|LegalService|MedicalBusiness|RealEstateAgent|FinancialService|AutomotiveBusiness|Hotel|LodgingBusiness|EducationalOrganization|NGO|OnlineStore)$/i;

/** schema.org JSON-LD blocks: what the company says about itself in a machine-readable way. */
export function extractJsonLd(html: string): { org: Record<string, unknown>; addresses: string[] } {
  const org: Record<string, unknown> = {};
  const addresses: string[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const nodes: Record<string, unknown>[] = [];
    const walk = (n: unknown) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === "object") {
        nodes.push(n as Record<string, unknown>);
        walk((n as Record<string, unknown>)["@graph"]);
      }
    };
    walk(data);
    for (const n of nodes) {
      const t = n["@type"];
      const types = Array.isArray(t) ? t.map(String) : [String(t ?? "")];
      if (!types.some((x) => ORG_TYPES.test(x))) continue;
      for (const k of ["name", "legalName", "telephone", "email", "foundingDate", "url", "description", "priceRange", "openingHours"]) {
        if (typeof n[k] === "string" && !org[k]) org[k] = (n[k] as string).slice(0, 300);
      }
      const emp = n.numberOfEmployees as { value?: unknown } | number | string | undefined;
      if (emp !== undefined && !org.employees) org.employees = typeof emp === "object" ? emp?.value : emp;
      const founder = n.founder as { name?: string } | { name?: string }[] | undefined;
      if (founder && !org.founders) org.founders = (Array.isArray(founder) ? founder : [founder]).map((f) => f?.name).filter(Boolean).slice(0, 4);
      const rating = n.aggregateRating as { ratingValue?: unknown; reviewCount?: unknown; ratingCount?: unknown } | undefined;
      if (rating && !org.rating) org.rating = { value: rating.ratingValue, count: rating.reviewCount ?? rating.ratingCount };
      const adr = n.address as Record<string, unknown> | string | undefined;
      if (typeof adr === "string") addresses.push(adr.slice(0, 200));
      else if (adr && typeof adr === "object") {
        const line = [adr.streetAddress, adr.addressLocality, adr.addressRegion, adr.postalCode, adr.addressCountry && typeof adr.addressCountry === "object" ? (adr.addressCountry as { name?: string }).name : adr.addressCountry]
          .filter((x) => x && typeof x === "string").join(", ");
        if (line) addresses.push(line.slice(0, 200));
      }
    }
  }
  return { org, addresses: [...new Set(addresses)].slice(0, 3) };
}

/** Everything contact-like on one page. */
export function extractContacts(html: string, pageUrl: string): Contacts {
  const ld = extractJsonLd(html);
  const mailtos = [...html.matchAll(/href=["']mailto:([^"'?]+)/gi)].map((m) => decodeURIComponent(m[1])).join(" ");
  const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  const emails = extractEmails(`${mailtos} ${visible}${ld.org.email ? ` ${String(ld.org.email)}` : ""}`, pageUrl);
  const phones = extractPhones(html);
  if (typeof ld.org.telephone === "string") phones.unshift(...extractPhones(`href="tel:${ld.org.telephone}"`));
  return { emails, phones: [...new Set(phones)].slice(0, 6), socials: extractSocials(html), addresses: ld.addresses, org: ld.org };
}

/** Merges the contacts of several pages: first sighting wins, nothing is listed twice. */
export function mergeContacts(list: Contacts[]): Contacts {
  const emails = new Map<string, FoundEmail>();
  const phones = new Map<string, string>();
  const socials: Record<string, string> = {};
  const addresses = new Set<string>();
  let org: Record<string, unknown> = {};
  for (const c of list) {
    for (const e of c.emails) if (!emails.has(e.email)) emails.set(e.email, e);
    for (const p of c.phones) if (!phones.has(p.replace(/\D/g, "").slice(-9))) phones.set(p.replace(/\D/g, "").slice(-9), p);
    for (const [k, v] of Object.entries(c.socials)) if (!socials[k]) socials[k] = v;
    c.addresses.forEach((a) => addresses.add(a));
    org = { ...c.org, ...org };
  }
  return { emails: [...emails.values()].slice(0, 20), phones: [...phones.values()].slice(0, 8), socials, addresses: [...addresses].slice(0, 4), org };
}

// ------------------------------------------------------------------ email patterns

export type EmailPattern = "first.last" | "firstlast" | "flast" | "first" | "firstl" | "f.last" | "last";

const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z\s'-]/g, "").replace(/['-]/g, "");

function nameParts(full: string): { first: string; last: string } | null {
  const parts = ascii(full).split(/\s+/).filter((x) => x.length > 0 && !/^(mr|mrs|ms|dr|prof|sir)$/.test(x));
  if (parts.length < 2) return null;
  return { first: parts[0], last: parts[parts.length - 1] };
}

function applyPattern(p: EmailPattern, n: { first: string; last: string }): string {
  switch (p) {
    case "first.last": return `${n.first}.${n.last}`;
    case "firstlast": return `${n.first}${n.last}`;
    case "flast": return `${n.first[0]}${n.last}`;
    case "first": return n.first;
    case "firstl": return `${n.first}${n.last[0]}`;
    case "f.last": return `${n.first[0]}.${n.last}`;
    case "last": return n.last;
  }
}

/**
 * Works out how a company writes its emails from the personal addresses we saw next to a known name
 * (aisha.khan@acme.com for Aisha Khan means first.last). Needs a named person to learn from.
 */
export function learnEmailPattern(emails: { email: string }[], knownNames: string[], domain: string): EmailPattern | null {
  const patterns: EmailPattern[] = ["first.last", "firstlast", "flast", "firstl", "f.last", "first", "last"];
  const votes = new Map<EmailPattern, number>();
  for (const e of emails) {
    const [local, d] = e.email.toLowerCase().split("@");
    if (d !== domain) continue;
    for (const name of knownNames) {
      const n = nameParts(name);
      if (!n) continue;
      for (const p of patterns) if (applyPattern(p, n) === local) votes.set(p, (votes.get(p) ?? 0) + 1);
    }
  }
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** A best guess at someone's work email. Always a guess: it is shown as such and never treated as verified. */
export function guessEmail(fullName: string, pattern: EmailPattern, domain: string): string | null {
  const n = nameParts(fullName);
  return n ? `${applyPattern(pattern, n)}@${domain}` : null;
}

// ------------------------------------------------------------------ DNS and domain facts

const MX_PROVIDERS: [RegExp, string][] = [
  [/(^|\.)(google|googlemail)\.com\.?$/i, "Google Workspace"], [/outlook\.com\.?$|protection\.outlook\.com\.?$|office365/i, "Microsoft 365"],
  [/zoho/i, "Zoho Mail"], [/secureserver\.net/i, "GoDaddy mail"], [/mimecast/i, "Mimecast (security gateway)"], [/pphosted|proofpoint/i, "Proofpoint (security gateway)"],
  [/protonmail|proton\.ch/i, "Proton Mail"], [/icloud|me\.com\.?$/i, "iCloud"], [/titan\.email|hostinger/i, "Titan / Hostinger mail"], [/yandex/i, "Yandex"],
  [/mailgun/i, "Mailgun"], [/ovh\.net/i, "OVH mail"], [/ionos|1and1|kundenserver/i, "IONOS mail"], [/yahoodns|yahoo/i, "Yahoo"], [/namecheap|privateemail/i, "Namecheap mail"],
];

export function classifyMx(hosts: string[]): string | null {
  if (!hosts.length) return null;
  for (const [re, name] of MX_PROVIDERS) if (hosts.some((h) => re.test(h))) return name;
  return hosts[0].replace(/\.$/, "");
}

const SPF_TOOLS: [RegExp, string][] = [
  [/_spf\.google\.com/i, "Google"], [/spf\.protection\.outlook\.com/i, "Microsoft 365"], [/sendgrid\.net/i, "SendGrid"], [/mailchimp|mcsv\.net|mandrillapp/i, "Mailchimp"],
  [/hubspot/i, "HubSpot"], [/salesforce|exacttarget|pardot/i, "Salesforce"], [/zendesk/i, "Zendesk"], [/freshdesk|freshworks/i, "Freshworks"], [/amazonses/i, "Amazon SES"],
  [/mailgun/i, "Mailgun"], [/klaviyo/i, "Klaviyo"], [/zoho/i, "Zoho"], [/shopify/i, "Shopify"], [/intercom/i, "Intercom"], [/activecampaign/i, "ActiveCampaign"],
  [/sendinblue|brevo/i, "Brevo"], [/postmarkapp/i, "Postmark"], [/helpscout/i, "Help Scout"], [/atlassian/i, "Atlassian"], [/calendly/i, "Calendly"],
];

/** The services a company authorises to send email for it, from its SPF record. */
export function parseSpf(txt: string[]): string[] {
  const spf = txt.find((t) => /^"?v=spf1/i.test(t.replace(/"/g, "").trim())) ?? "";
  const includes = [...spf.matchAll(/include:([^\s"]+)/gi)].map((m) => m[1]);
  const names = new Set<string>();
  for (const inc of includes) for (const [re, n] of SPF_TOOLS) if (re.test(inc)) names.add(n);
  return [...names];
}

export function ageYears(iso: string | null | undefined, now = new Date()): number | null {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round(((now.getTime() - t) / (365.25 * 86_400_000)) * 10) / 10);
}

/** Registration facts from an RDAP response (the modern WHOIS). */
export function parseRdap(j: unknown): { registered: string | null; expires: string | null; registrar: string | null; nameservers: string[] } {
  const r = (j ?? {}) as { events?: { eventAction?: string; eventDate?: string }[]; entities?: { roles?: string[]; vcardArray?: [string, [string, unknown, unknown, unknown][]] }[]; nameservers?: { ldhName?: string }[] };
  const ev = (a: string) => r.events?.find((e) => e.eventAction === a)?.eventDate?.slice(0, 10) ?? null;
  const reg = r.entities?.find((e) => e.roles?.includes("registrar"));
  const fn = reg?.vcardArray?.[1]?.find((v) => v[0] === "fn")?.[3];
  return {
    registered: ev("registration"), expires: ev("expiration"), registrar: typeof fn === "string" ? fn : null,
    nameservers: (r.nameservers ?? []).map((n) => String(n.ldhName ?? "").toLowerCase()).filter(Boolean).slice(0, 4),
  };
}
