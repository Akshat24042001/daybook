/**
 * What a salesperson must give before a new lead is accepted. Client-safe (pure), so the form shows the same rules
 * live that the server enforces.
 *
 * The bar, from how sales teams qualify a lead at entry (who, how to reach them, where it came from, why it is a
 * lead): enough to act on and to trust, and not more, so a real lead with little known can still go in.
 *   1. Who        a company name or a contact's name (both is better)
 *   2. Reach      at least one working way to reach them: phone or WhatsApp, email, LinkedIn, Instagram or website
 *   3. Source     where it came from; a referral names who referred (and who they are to you), an event names the
 *                 event, a partner or an existing client is named
 *   4. Why        what they need or what makes this a lead, in a real sentence (or the services they want)
 *   5. Status     how far it has gone (not contacted yet, first conversation, meeting set, asked for a quote)
 * Everything else (role, decision maker, city, budget, timeline) raises the quality but is never required.
 */

export const LEAD_SOURCES = [
  ["inbound", "They contacted us (call, WhatsApp, website)"],
  ["referral", "Referral"],
  ["outbound", "I reached out (cold call or message)"],
  ["linkedin", "LinkedIn"],
  ["social", "Instagram or other social"],
  ["event", "Event or meetup"],
  ["existing_client", "Existing client (more work)"],
  ["partner", "Partner or agency"],
  ["other", "Other"],
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number][0];

export const REFERRER_TYPES = [["client", "A client"], ["team", "Someone in our team"], ["friend", "Friend or family"], ["partner", "A partner"], ["other", "Other"]] as const;

export const LEAD_STATUS = [
  ["new", "Not contacted yet"],
  ["contacted", "First message or call done"],
  ["discovery", "Meeting or call set up"],
  ["proposal", "They asked for a quote"],
] as const;

export interface NewLeadInput {
  company?: string;
  person?: string;
  title?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  linkedin?: string;
  instagram?: string;
  website?: string;
  source?: string;
  source_detail?: string;
  referrer_name?: string;
  referrer_type?: string;
  need?: string;
  services?: string[];
  status?: string;
  city?: string;
  country?: string;
  industry?: string;
  decision_maker?: boolean;
  budget?: string;
  timeline?: string;
}

const t = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export const validPhone = (v: string) => {
  const d = v.replace(/[^\d]/g, "");
  return d.length >= 10 && d.length <= 15 && !/^(\d)\1+$/.test(d);
};
export const validEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v) && !/@(example|test)\./i.test(v);
export const validLinkedin = (v: string) => /linkedin\.com\/(in|company)\/[^/\s]{2,}/i.test(v);
export const validInstagram = (v: string) => /^@?[a-z0-9._]{2,30}$/i.test(v) || /instagram\.com\/[a-z0-9._]{2,}/i.test(v);
export const validWebsite = (v: string) => /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(v);
const realName = (v: string) => v.length >= 2 && /[a-z]{2}/i.test(v) && !/^(test|asdf|abc|xyz|na|n\/a|none|unknown|lead|client)$/i.test(v);

export interface LeadCheck {
  ok: boolean;
  /** field -> what is wrong; only for fields that block saving */
  errors: Record<string, string>;
  quality: "Basic" | "Good" | "Strong";
  missing: string[];
}

/** Checks a new lead the way the server will. */
export function checkNewLead(i: NewLeadInput): LeadCheck {
  const e: Record<string, string> = {};
  const company = t(i.company, 160);
  const person = t(i.person, 120);
  if (!company && !person) e.who = "Add the company or the person's name.";
  else if ((company && !realName(company)) || (person && !realName(person))) e.who = "Use their real name.";

  const reach = {
    phone: t(i.phone, 40), whatsapp: t(i.whatsapp, 40), email: t(i.email, 200), linkedin: t(i.linkedin, 300), instagram: t(i.instagram, 120), website: t(i.website, 300),
  };
  const bad: string[] = [];
  if (reach.phone && !validPhone(reach.phone)) bad.push("phone");
  if (reach.whatsapp && !validPhone(reach.whatsapp)) bad.push("WhatsApp");
  if (reach.email && !validEmail(reach.email)) bad.push("email");
  if (reach.linkedin && !validLinkedin(reach.linkedin)) bad.push("LinkedIn link");
  if (reach.instagram && !validInstagram(reach.instagram)) bad.push("Instagram");
  if (reach.website && !validWebsite(reach.website)) bad.push("website");
  const working = Object.entries(reach).filter(([k, v]) => v && !bad.includes(k === "linkedin" ? "LinkedIn link" : k === "whatsapp" ? "WhatsApp" : k === "instagram" ? "Instagram" : k)).length;
  if (bad.length) e.reach = `Check the ${bad.join(", ")}: it does not look valid.`;
  else if (!working) e.reach = "Add at least one way to reach them: phone, WhatsApp, email, LinkedIn, Instagram or website.";

  const source = t(i.source, 30);
  if (!LEAD_SOURCES.some(([k]) => k === source)) e.source = "Pick where this lead came from.";
  else if (source === "referral") {
    if (!realName(t(i.referrer_name, 120))) e.source = "A referral needs the name of who referred them.";
    else if (!REFERRER_TYPES.some(([k]) => k === t(i.referrer_type, 20))) e.source = "Say who the referrer is to us (client, team, friend, partner).";
  } else if (["event", "partner", "existing_client", "other"].includes(source) && t(i.source_detail, 200).length < 3) {
    e.source = source === "event" ? "Name the event." : source === "partner" ? "Name the partner." : source === "existing_client" ? "Name the client." : "Say where it came from.";
  }

  const need = t(i.need, 2000);
  if (need.split(/\s+/).filter(Boolean).length < 4 && !(i.services?.length && need.length >= 3)) e.need = "Say what they need or why this is a lead, in a sentence (or pick a service and add a few words).";

  if (!LEAD_STATUS.some(([k]) => k === t(i.status, 20))) e.status = "Say how far it has gone.";

  // quality: what makes a lead easy to work, never required
  const extras = [
    [!!t(i.title, 120), "their role"],
    [i.decision_maker !== undefined, "whether they decide"],
    [!!(t(i.city, 80) || t(i.country, 80)), "city"],
    [!!t(i.industry, 80), "industry"],
    [!!t(i.budget, 120), "budget"],
    [!!t(i.timeline, 120), "timeline"],
    [working >= 2, "a second way to reach them"],
    [!!(company && person), "both company and person"],
  ] as const;
  const have = extras.filter(([ok]) => ok).length;
  return {
    ok: Object.keys(e).length === 0,
    errors: e,
    quality: have >= 6 ? "Strong" : have >= 3 ? "Good" : "Basic",
    missing: extras.filter(([ok]) => !ok).map(([, l]) => l),
  };
}
