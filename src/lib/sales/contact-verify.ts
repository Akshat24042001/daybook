/**
 * The strict gate every phone number and email has to pass before it is shown as a way to reach a lead.
 *
 * A wrong number is worse than no number, so a contact is kept only with proof:
 *   1. It is written, character for character, on a real page or search result we read. Text an AI wrote (a Google
 *      AI summary, a model's answer) never counts, however sure it sounds.
 *   2. That same page is about THIS lead: it is their own website, or it names the business (or the person) close to
 *      the number. A number on a page about another business is that business's number.
 *   3. A phone's country code fits the lead's country (a +91 number for a Dubai business is someone else's), and a
 *      number without a country code only counts on their own website.
 *   4. It is not a credit in a footer ("website designed by ... +91 ..."): that is the web designer's number.
 *   5. An email at another company's domain is that company's email.
 * Each kept contact carries the page that proves it, and whether it is the person's own (their name right next to
 * it) or the business's (an office line or a shared inbox). Pure: no network, no database.
 */
import { businessDomain, dialCountry, normCountry } from "./anchors";

export interface Source { url: string; text: string; /** written by an AI: never proof */ ai?: boolean }
export interface Subject { company?: string | null; domain?: string | null; person?: string | null; country?: string | null }
export interface VerifiedContact { kind: "phone" | "email"; value: string; url: string; owner: "person" | "company" }

const digitsOf = (s: string) => s.replace(/\D/g, "");
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const hostOf = (u: string) => u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
const CREDIT = /(designed|developed|powered|maintained|hosted|created|built|managed|marketing|seo)\s+(and\s+\w+\s+)?by\b|web\s*(design|development|developer)|digital\s+(agency|marketing)|website\s+by|site\s+by/i;
const GENERIC_WORDS = new Set(["the", "and", "pvt", "ltd", "llc", "inc", "co", "company", "private", "limited", "group", "services", "solutions", "trading", "fze", "fzco", "gmbh", "plc", "corp"]);

/** Their own website: the page's host is their domain or one of its subdomains. Pure. */
export function ownSite(url: string, domain: string | null | undefined): boolean {
  if (!domain) return false;
  const h = hostOf(url);
  const d = domain.toLowerCase().replace(/^www\./, "");
  return h === d || h.endsWith(`.${d}`);
}

/** Where the business or the person is named in a text: positions of each mention. Pure. */
export function mentions(text: string, s: Subject): { company: number[]; person: number[] } {
  const low = text.toLowerCase();
  const find = (name: string | null | undefined, minLen: number): number[] => {
    if (!name) return [];
    const out: number[] = [];
    // the full name, and for a business also its distinctive words without "Pvt Ltd" and the like
    const forms = new Set<string>([name.toLowerCase().trim()]);
    const core = norm(name).split(" ").filter((w) => w.length >= 2 && !GENERIC_WORDS.has(w)).join(" ");
    if (core.length >= minLen) forms.add(core);
    for (const f of forms) {
      if (f.length < minLen) continue;
      for (let i = low.indexOf(f); i >= 0; i = low.indexOf(f, i + 1)) out.push(i);
    }
    // the text also written without punctuation ("Smile-Arc" for "Smile Arc")
    if (!out.length && core.length >= minLen) {
      const flat = norm(text);
      if (flat.includes(core)) out.push(Math.round((flat.indexOf(core) / Math.max(1, flat.length)) * low.length));
    }
    return out;
  };
  return { company: find(s.company, 4), person: find(s.person, 5) };
}

const near = (pos: number, list: number[], within: number) => list.some((p) => Math.abs(p - pos) <= within);

/** Every place a phone number with these digits is written in a text. Pure. */
function phonePositions(text: string, key: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\+?\(?\d[\d\s().-]{6,20}\d/g)) if (digitsOf(m[0]).endsWith(key) || digitsOf(m[0]).includes(key)) out.push(m.index ?? 0);
  return out;
}

/** True when the lead's country is known and the number's country code says somewhere else. Pure. */
export function wrongCountry(phone: string, country: string | null | undefined): boolean {
  const want = normCountry(country ?? null);
  const got = dialCountry(phone);
  if (!want || !got) return false;
  const a = normCountry(got) ?? got;
  return !(a === want || a.split(" or ").includes(want) || want.split(" or ").includes(a));
}

/** The phones that pass every check, each with the page that proves it. Pure. */
export function verifyPhones(candidates: (string | null | undefined)[], sources: Source[], s: Subject): VerifiedContact[] {
  const real = sources.filter((x) => !x.ai && /^https?:\/\//i.test(x.url) && x.text);
  const out: VerifiedContact[] = [];
  for (const raw of candidates) {
    const value = String(raw ?? "").trim();
    const d = digitsOf(value);
    if (d.length < 8 || d.length > 15 || /^(\d)\1+$/.test(d)) continue;
    if (wrongCountry(value, s.country)) continue;
    const key = d.slice(-9);
    const intl = /^\s*(\+|00)/.test(value);
    let proof: VerifiedContact | null = null;
    for (const src of real) {
      const at = phonePositions(src.text, key);
      if (!at.length) continue;
      const own = ownSite(src.url, s.domain);
      const m = mentions(src.text, s);
      for (const pos of at) {
        if (CREDIT.test(src.text.slice(Math.max(0, pos - 120), pos + 20))) continue; // a footer credit: the designer's number
        const aboutThem = own || near(pos, m.company, 300) || near(pos, m.person, 300);
        if (!aboutThem) continue;
        if (!intl && !own && !s.country) continue; // a bare local number off their own site, with no country to check it by
        const owner = near(pos, m.person, 150) ? "person" : "company";
        if (!proof || (owner === "person" && proof.owner === "company") || (own && !ownSite(proof.url, s.domain))) proof = { kind: "phone", value, url: src.url, owner };
      }
    }
    if (proof && !out.some((x) => digitsOf(x.value).slice(-9) === key)) out.push(proof);
  }
  return out;
}

const EMAIL_OK = /^[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}$/i;
const GENERIC_LOCAL = /^(info|hello|hi|contact|sales|support|admin|office|enquir(y|ies)|inquir(y|ies)|careers|jobs|hr|team|mail|accounts?|billing|help|marketing|press|media|service|customerservice|reception|bookings?|orders?|general|partners?|hey)$/i;

/** The emails that pass every check, each with the page that proves it. Pure. */
export function verifyEmails(candidates: (string | null | undefined)[], sources: Source[], s: Subject): VerifiedContact[] {
  const real = sources.filter((x) => !x.ai && /^https?:\/\//i.test(x.url) && x.text);
  const out: VerifiedContact[] = [];
  const dom = s.domain?.toLowerCase().replace(/^www\./, "") ?? null;
  const personWords = norm(s.person ?? "").split(" ").filter((w) => w.length >= 3);
  for (const raw of candidates) {
    const value = String(raw ?? "").trim().toLowerCase();
    if (!EMAIL_OK.test(value) || /noreply|no-reply|example\.|sentry|wixpress/.test(value)) continue;
    const [local, edom] = value.split("@");
    const theirDomain = !!dom && (edom === dom || edom.endsWith(`.${dom}`));
    // another company's address (not webmail) is that company's: never theirs
    if (dom && !theirDomain && businessDomain(value)) continue;
    let proof: VerifiedContact | null = null;
    for (const src of real) {
      const low = src.text.toLowerCase();
      const pos = low.indexOf(value);
      if (pos < 0) continue;
      const own = ownSite(src.url, dom);
      const m = mentions(src.text, s);
      const aboutThem = own || (theirDomain && (near(pos, m.company, 600) || near(pos, m.person, 600))) || near(pos, m.company, 250) || near(pos, m.person, 250);
      if (!aboutThem) continue;
      if (CREDIT.test(src.text.slice(Math.max(0, pos - 120), pos + 10))) continue;
      const named = personWords.length > 0 && personWords.some((w) => local.includes(w));
      const owner = !GENERIC_LOCAL.test(local) && (named || near(pos, m.person, 150)) ? "person" : "company";
      if (!proof || (owner === "person" && proof.owner === "company")) proof = { kind: "email", value, url: src.url, owner };
    }
    if (proof && !out.some((x) => x.value === value)) out.push(proof);
  }
  return out;
}
