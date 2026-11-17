/**
 * Which radar lead to work first, and the plumbing behind it: the contacts you can use now, whether the site charges
 * to reply, and which leads are the same requirement found twice. Pure functions, shared by the board and the tests.
 */
import { platformOf } from "./reply-targets";
import { GENERIC_LOCAL } from "./research-extract";

export interface RankItem {
  id: number;
  title: string;
  body: string | null;
  url: string | null;
  score: number | null;
  posted_at: string | null;
  found_at: string;
  seen_at?: string | null;
  lead_kind?: string | null;
  trip?: { from: string } | null;
  fit: { urgency?: string } | null;
  identity?: { status: string; emails: string[]; phones: string[]; linkedin?: string | null; person?: string | null } | null;
  prep?: { stage: string; pack?: { decision_maker?: { name: string; title?: string | null; email?: string | null; phone?: string | null; linkedin?: string | null } | null; contacts?: { whatsapp?: string | null } } | null } | null;
  ready_draft?: string | null;
}

/** Prepared on its own: the requirement, the business, the people and a draft are done. */
export const isReady = (it: RankItem) => it.prep?.stage === "ready";


const PAID = new Set(["upwork", "freelancer", "pph", "guru"]);
export const isPaid = (url: string | null) => PAID.has(platformOf(url)?.key ?? "") || /fiverr\.com|truelancer\.com|workana\.com/.test(url ?? "");
export const hoursSince = (it: RankItem, now: number) => (now - new Date(it.posted_at ?? it.found_at).getTime()) / 3_600_000;

/** Contacts you can use right now: the business found behind the post, plus any written in the post itself. */
export function contactsOf(it: RankItem): { emails: string[]; phones: string[]; linkedin: string | null; name: string | null } {
  const text = `${it.title}\n${it.body ?? ""}`;
  const fromPost = {
    emails: [...text.matchAll(/[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi)].map((m) => m[0].toLowerCase()).filter((e) => !/noreply|example\./.test(e)),
    phones: [...text.matchAll(/\+\d{1,3}[\s().-]*\d[\d\s().-]{7,15}\d/g)].map((m) => m[0].trim()),
  };
  const id = it.identity && it.identity.status !== "running" ? it.identity : null;
  return {
    emails: [...new Set([...(id?.emails ?? []), ...fromPost.emails])].slice(0, 3),
    phones: [...new Set([...(id?.phones ?? []), ...fromPost.phones])].slice(0, 2),
    linkedin: id?.linkedin ?? null,
    name: id?.person ?? null,
  };
}

export type ReachLevel = "decision_maker" | "person" | "generic" | "none";

/** An inbox for everyone (info@, sales@, bookings@): it reaches the company, not the person who decides. Pure. */
export const isGenericEmail = (e: string) => GENERIC_LOCAL.test(e.split("@")[0] ?? "");

/**
 * How well you can reach the person who decides, best first:
 *   decision_maker  the decision maker by name, with their own email, mobile or LinkedIn
 *   person          a named person's own email or LinkedIn, not yet known to be the one who decides
 *   generic         only a shared inbox (info@, sales@), a front desk or company WhatsApp number, or a contact form
 *   none            nothing yet
 * A company line or a sales WhatsApp is never counted as reaching the decision maker. Pure.
 */
export function reachOf(it: RankItem): { level: ReachLevel; label: string; via: string[] } {
  const dm = it.prep?.pack?.decision_maker ?? null;
  const c = contactsOf(it);
  const own = (e: string | null | undefined) => !!e && /@/.test(e) && !isGenericEmail(e);
  if (dm && (own(dm.email) || dm.phone || dm.linkedin)) {
    const via = [own(dm.email) ? dm.email! : null, dm.phone ? `${dm.phone} (their own number)` : null, dm.linkedin ? "LinkedIn" : null].filter(Boolean) as string[];
    return { level: "decision_maker", label: `Decision maker reachable: ${dm.name}${dm.title ? `, ${dm.title}` : ""}`, via };
  }
  const personal = c.emails.filter(own);
  // a number someone wrote in their own post is theirs: the poster is usually the one who decides
  const postPhones = (it.lead_kind ?? "post") === "post" ? [...`${it.title}\n${it.body ?? ""}`.matchAll(/\+\d{1,3}[\s().-]*\d[\d\s().-]{7,15}\d/g)].map((m) => m[0].trim()) : [];
  if (personal.length || postPhones.length || (c.linkedin && c.name)) {
    return { level: "person", label: `A person's own contact${c.name ? `: ${c.name}` : ""}`, via: [...personal, ...postPhones, c.linkedin ? "LinkedIn" : null].filter(Boolean) as string[] };
  }
  const generic = [...c.emails.filter(isGenericEmail), ...c.phones, it.prep?.pack?.contacts?.whatsapp ?? null].filter(Boolean) as string[];
  if (generic.length) return { level: "generic", label: "Only a general inbox or front desk number", via: generic };
  return { level: "none", label: "No way to reach them yet", via: [] };
}

/**
 * One number for "do this first": how good the fit is, how fresh it is (a reply in the first hours wins most work),
 * whether you can reach them directly, and whether answering costs credits. Pure, so it is tested.
 */
export function priority(it: RankItem, now = Date.now()): { value: number; reasons: string[] } {
  const h = hoursSince(it, now);
  const fresh = h < 6 ? 1 : h < 24 ? 0.9 : h < 48 ? 0.75 : h < 96 ? 0.6 : 0.45;
  const c = contactsOf(it);
  const direct = c.emails.length + c.phones.length > 0 || !!c.linkedin;
  const paid = isPaid(it.url);
  const reasons: string[] = [];
  let v = (it.score ?? 50) * fresh;
  // a local business we found was not posted by anyone: its time is when we found it
  const what = it.lead_kind === "prospect" || it.lead_kind === "signal" ? "Found" : "Posted";
  if (h < 6) reasons.push(`${what} in the last 6 hours`);
  else if (h < 24) reasons.push(`${what} today`);
  if (it.trip) { v += 3; reasons.push("For your trip: reach them before you go"); }
  if ((it.score ?? 0) >= 80) reasons.push(`Strong fit (${it.score})`);
  const reach = reachOf(it);
  if (reach.level === "decision_maker") { v += 18; reasons.push("You can reach the decision maker directly"); }
  else if (reach.level === "person") { v += 12; reasons.push("You can reach a person there directly"); }
  else if (direct) { v += 4; reasons.push("Only a general inbox or front desk number"); }
  else if (paid) { v -= 8; }
  else if (platformOf(it.url)?.replyable) { v += 4; reasons.push(`Free to reply on ${platformOf(it.url)!.name}`); }
  if (it.fit?.urgency === "high") { v += 6; reasons.push("They need it soon"); }
  if (isReady(it) && it.ready_draft) { v += 5; reasons.push("Ready: message written"); }
  if (it.seen_at) v -= 3;
  return { value: Math.round(v), reasons };
}

/** The same requirement found twice (two sources, or posted twice): shown once. Pure. */
export function dedupeKey(it: RankItem): string {
  return it.title.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 70);
}

