/**
 * How well a lead fits your business, and which of your offers they are most likely to want. Pure (no database), so
 * it is easy to test and runs anywhere.
 *
 * The score (0 to 100) adds up seven parts, each with the reason it gave or lost points:
 *   industry 25 (one you target, plus your own results there), location 15 (home market or a target country),
 *   need 20 (what they asked for matches something you sell), size 10, money 10, decision maker 10, source 10.
 * Grades: A 75+, B 55+, C 35+, D below.
 *
 * Service hints only come from things on the record: an industry pattern ("clinics lose bookings on the phone"), words
 * in what they said or what research found ("missed calls"), or services already on the deal. Each hint says which.
 * They point at your own offer catalogue, so a hint is always something you can sell.
 */
import { norm, sameCountry, sameIndustry, type Weighted } from "./focus-calc";

export type Capability = "ai_agents" | "voice" | "website" | "mobile" | "automation" | "vision" | "hardware" | "growth" | "software";

/**
 * How each capability shows up in an offer's name, keywords or description. Each list goes from the most specific
 * wording to the loosest, so "Workflow automation" wins the automation hint over "AI agents and AI automation".
 */
const OFFER_WORDS: Record<Capability, RegExp[]> = {
  ai_agents: [/ai agent|chat ?bot|assistant/i, /ai automation|whatsapp/i],
  voice: [/voice/i, /calls?\b|receptionist/i],
  website: [/website|landing page|web ?site/i],
  mobile: [/mobile|ios|android/i, /\bapps?\b/i],
  automation: [/workflow/i, /integrat/i, /automation/i],
  vision: [/computer vision|vision/i, /camera|cctv/i],
  hardware: [/hardware|robot/i, /iot|sensor/i],
  growth: [/growth|crm|lead capture/i, /lead|reporting|follow.?up/i],
  software: [/custom software|web application|full stack/i, /software|portal|platform/i],
};
/** Any of a capability's wordings, for reading what a deal asked for. */
const OFFER_TEXT: Record<Capability, RegExp> = {
  ai_agents: /ai agent|chat ?bot|ai automation|assistant|whatsapp/i,
  voice: /voice|calls?\b|receptionist/i,
  website: /website|landing page|web ?site/i,
  mobile: /mobile|ios|android|\bapps?\b/i,
  automation: /workflow|automation|integrat/i,
  vision: /computer vision|vision|camera|cctv/i,
  hardware: /hardware|robot|iot|sensor/i,
  growth: /lead|crm|growth|reporting|follow.?up/i,
  software: /custom software|web application|full stack|software|portal|platform/i,
};

/** Words in what they said or what research found, and the capability each points at. */
const SIGNALS: { cap: Capability; re: RegExp; says: string }[] = [
  { cap: "voice", re: /miss(?:es|ed|ing)? (?:\w+ ){0,3}calls?|unanswered|calls? (?:go|going|that go) unanswered|phone (?:calls?|bookings?)|receptionist|front desk|call ?cent(?:er|re)|calls? (?:a|per) day/i, says: "calls going unanswered" },
  { cap: "ai_agents", re: /whatsapp|enquir(?:y|ies)|customer support|tickets?|faqs?|chat\b|slow (?:reply|response)|after hours/i, says: "enquiries and support messages" },
  { cap: "automation", re: /manual(?:ly)?|excel|spreadsheet|data entry|copy.?paste|paper(?:work)?|reconcil|repetitive|typed? (?:in|into)/i, says: "manual, repetitive work" },
  { cap: "website", re: /website|seo|traffic|landing page|online presence|google rank/i, says: "their website or online presence" },
  { cap: "mobile", re: /mobile app|\bapp\b|android|ios/i, says: "an app" },
  { cap: "growth", re: /\bleads?\b|follow.?ups?|\bcrm\b|pipeline|conversion|sales team|lost customers/i, says: "leads and follow-ups" },
  { cap: "vision", re: /quality (?:check|control|issues?)|defects?|inspection|safety|\bppe\b|counting|cctv|cameras?|theft|footfall|worker productivity/i, says: "quality, safety or counting on site" },
  { cap: "hardware", re: /sensors?|\biot\b|machines?|\bplc\b|robot|scanners?/i, says: "machines and sensors" },
  { cap: "software", re: /portal|dashboard|\berp\b|custom software|internal tool|platform/i, says: "a custom system or portal" },
];

/** Industry patterns: what businesses like this usually need, said plainly. */
const INDUSTRY: { re: RegExp; caps: [Capability, string][] }[] = [
  { re: /health|clinic|hospital|dental|diagnost|pharma|physio|wellness/i, caps: [["voice", "clinics lose bookings when calls go unanswered"], ["ai_agents", "appointment booking and reminders on WhatsApp"], ["growth", "patient follow-ups and reviews"]] },
  { re: /real estate|property|realty|builder|developer/i, caps: [["growth", "property enquiries need fast, steady follow-up"], ["voice", "an instant call-back to every enquiry"], ["ai_agents", "qualifying buyers on WhatsApp"]] },
  { re: /retail|e-?commerce|jewel|apparel|textile|fashion|store|shop/i, caps: [["website", "a store that sells online"], ["ai_agents", "answering product questions on WhatsApp"], ["growth", "repeat buyers and abandoned carts"]] },
  { re: /manufactur|production|mining|construction|factory|plant|industrial/i, caps: [["vision", "safety, quality checks and counting on cameras"], ["automation", "production and dispatch paperwork"], ["hardware", "machines and sensors on the floor"]] },
  { re: /logistic|freight|transport|courier|warehouse|shipping|supply chain/i, caps: [["automation", "order intake and dispatch entry"], ["ai_agents", "where-is-my-shipment questions"], ["vision", "counting and damage checks"]] },
  { re: /hospitality|hotel|resort|restaurant|food|beverage|cafe|travel|tour/i, caps: [["voice", "reservations by phone"], ["ai_agents", "bookings and questions on WhatsApp"], ["website", "direct bookings online"]] },
  { re: /education|school|college|coaching|institute|academy|edtech|training/i, caps: [["growth", "admission enquiries need follow-up"], ["ai_agents", "answering parents and students"], ["website", "a site that brings enquiries"]] },
  { re: /legal|law|accounting|chartered|\bca\b|audit|tax|insurance|finance|bank/i, caps: [["automation", "document and data handling"], ["ai_agents", "client questions and document collection"], ["growth", "renewals and client follow-ups"]] },
  { re: /automotive|car dealer|dealership|showroom|motors/i, caps: [["voice", "test-drive and service bookings"], ["growth", "lead follow-up"], ["ai_agents", "enquiries on WhatsApp"]] },
  { re: /agri|farm|dairy|poultry/i, caps: [["vision", "counting and quality checks"], ["hardware", "sensors in the field"]] },
  { re: /salon|spa|gym|fitness|beauty/i, caps: [["voice", "bookings by phone"], ["ai_agents", "booking and reminders on WhatsApp"], ["growth", "bringing members back"]] },
];

const SOURCE_POINTS: Record<string, [number, string]> = {
  repeat: [10, "a client buying again"], referral: [9, "came by referral"], inbound: [8, "they came to you"], network: [7, "from your network"],
  partner: [6, "through a partner"], content: [6, "from your content"], radar: [5, "found by the radar"], outbound: [4, "cold outreach"], other: [4, "other source"],
};

export interface FitOffer { id?: number; name: string; summary?: string | null; keywords?: string[] }
export interface FitContext {
  homeCountry: string | null;
  countries: string[];
  industries: string[];
  /** your results by industry and country (radar plan weights) */
  industryStats: Weighted[];
  countryStats: Weighted[];
  offers: FitOffer[];
  /** average won deal in USD, for "is this a real budget" */
  avgWonUsd: number | null;
}
export interface FitInput {
  industry?: string | null;
  country?: string | null;
  city?: string | null;
  employees?: number | null;
  source?: string | null;
  value_usd?: number | null;
  budget?: string | null;
  decision_maker?: boolean;
  has_contact?: boolean;
  services?: string[];
  /** everything said or found about them: requirement, problem, notes, research, audit */
  text?: string;
  /** services they already bought from you (won deals with this company) */
  bought?: string[];
}
export interface ServiceHint { offer: string; offer_id?: number; strength: number; why: string[]; already: boolean }
export interface Fit { score: number; grade: "A" | "B" | "C" | "D"; plus: string[]; minus: string[]; hints: ServiceHint[] }

/** The offer for a capability: by its name first, then its keywords, then its description (so "website assistants" in
 * an AI offer's description does not win over an offer called "Websites"). */
function offerFor(cap: Capability, offers: FitOffer[]): FitOffer | null {
  for (const re of OFFER_WORDS[cap]) {
    const o = offers.find((x) => re.test(x.name)) ?? offers.find((x) => (x.keywords ?? []).some((k) => re.test(k)));
    if (o) return o;
  }
  for (const re of OFFER_WORDS[cap]) {
    const o = offers.find((x) => re.test(x.summary ?? ""));
    if (o) return o;
  }
  return null;
}

/** Which of your offers they most likely want, strongest first, each with the reasons from the record. */
export function serviceHints(input: FitInput, offers: FitOffer[]): ServiceHint[] {
  const byOffer = new Map<string, ServiceHint>();
  const add = (cap: Capability, strength: number, why: string) => {
    const o = offerFor(cap, offers);
    if (!o) return;
    const h = byOffer.get(o.name) ?? { offer: o.name, offer_id: o.id, strength: 0, why: [], already: false };
    h.strength += strength;
    if (!h.why.includes(why)) h.why.push(why);
    byOffer.set(o.name, h);
  };
  for (const s of input.services ?? []) {
    for (const cap of Object.keys(OFFER_TEXT) as Capability[]) if (OFFER_TEXT[cap].test(s)) add(cap, 3, `they asked about "${s}"`);
  }
  const text = input.text ?? "";
  for (const sig of SIGNALS) {
    const m = text.match(sig.re);
    if (m) add(sig.cap, 2, `they mention ${sig.says} ("${m[0].trim()}")`);
  }
  const ind = INDUSTRY.find((x) => input.industry && x.re.test(input.industry));
  if (ind) for (const [cap, why] of ind.caps) add(cap, 1, `${input.industry}: ${why}`);
  const bought = (input.bought ?? []).map((b) => norm(b));
  return [...byOffer.values()]
    .map((h) => ({ ...h, already: bought.some((b) => b && (norm(h.offer).includes(b) || b.includes(norm(h.offer)))) }))
    .sort((a, b) => b.strength - a.strength || a.offer.localeCompare(b.offer))
    .slice(0, 4);
}

export function fitScore(input: FitInput, ctx: FitContext): Fit {
  const plus: string[] = [];
  const minus: string[] = [];
  let score = 0;

  // industry (25)
  const ind = input.industry?.trim();
  if (!ind) minus.push("Industry not known yet");
  else {
    const target = ctx.industries.find((t) => sameIndustry(ind, t));
    if (target) {
      score += 15;
      plus.push(`${ind}: an industry you target`);
      const st = ctx.industryStats.find((s) => s.value === target);
      if (st?.won) { score += 10; plus.push(`you have won ${st.won} deal${st.won === 1 ? "" : "s"} in ${target}`); }
      else if (st?.conversations) { score += 5; plus.push(`${st.conversations} conversation${st.conversations === 1 ? "" : "s"} so far in ${target}`); }
    } else if (INDUSTRY.some((x) => x.re.test(ind))) { score += 8; plus.push(`${ind}: a kind of business your services suit, though not on your target list`); }
    else { score += 3; minus.push(`${ind} is not one of your target industries`); }
  }

  // location (15)
  const country = input.country?.trim();
  if (!country) { score += 5; minus.push("Country not known yet"); }
  else if (ctx.homeCountry && sameCountry(country, ctx.homeCountry)) { score += 15; plus.push(`${country}: your home market`); }
  else {
    const target = ctx.countries.find((c) => sameCountry(country, c));
    if (target) {
      score += 13;
      const st = ctx.countryStats.find((s) => s.value === target);
      plus.push(`${country}: a country you target${st?.won ? `, where you have won ${st.won}` : ""}`);
      if (st?.won) score += 2;
    } else { score += 3; minus.push(`${country} is outside your target countries`); }
  }

  // need (20)
  const hints = serviceHints(input, ctx.offers);
  const strong = hints.filter((h) => h.strength >= 2);
  if (strong.length) { score += 20; plus.push(`what they need matches ${strong[0].offer}`); }
  else if (hints.length) { score += 10; plus.push(`businesses like this usually need ${hints[0].offer}`); minus.push("They have not said what they need yet"); }
  else minus.push("Nothing on the record matches what you sell yet");

  // size (10)
  const emp = input.employees ?? null;
  if (emp === null) { score += 4; minus.push("Company size not known"); }
  else if (emp >= 10 && emp <= 1000) { score += 10; plus.push(`${emp} staff: big enough to pay, small enough to decide fast`); }
  else if (emp > 1000) { score += 6; minus.push(`${emp} staff: expect a long buying process`); }
  else { score += 5; minus.push(`${emp} staff: budgets are usually small`); }

  // money (10)
  if (input.value_usd && ctx.avgWonUsd && input.value_usd >= ctx.avgWonUsd) { score += 10; plus.push("deal value at or above your average win"); }
  else if (input.value_usd) { score += 6; plus.push("a deal value is set"); }
  else if (input.budget?.trim()) { score += 5; plus.push(`budget mentioned: ${input.budget.trim()}`); }
  else minus.push("No budget or value yet");

  // decision maker (10)
  if (input.decision_maker) { score += 10; plus.push("you are talking to who decides"); }
  else if (input.has_contact) { score += 5; minus.push("Not yet talking to who decides"); }
  else minus.push("No contact person yet");

  // source (10)
  const [pts, says] = SOURCE_POINTS[input.source ?? "other"] ?? SOURCE_POINTS.other;
  score += pts;
  (pts >= 7 ? plus : minus).push(`Source: ${says}`);

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, grade: score >= 75 ? "A" : score >= 55 ? "B" : score >= 35 ? "C" : "D", plus, minus, hints };
}
