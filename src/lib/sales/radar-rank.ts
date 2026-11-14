/**
 * Which radar lead to work first, and the plumbing behind it: the contacts you can use now, whether the site charges
 * to reply, and which leads are the same requirement found twice. Pure functions, shared by the board and the tests.
 */
import { platformOf } from "./reply-targets";

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
  prep?: { stage: string } | null;
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
  const what = it.lead_kind === "prospect" ? "Found" : "Posted";
  if (h < 6) reasons.push(`${what} in the last 6 hours`);
  else if (h < 24) reasons.push(`${what} today`);
  if (it.trip) { v += 3; reasons.push("For your trip: reach them before you go"); }
  if ((it.score ?? 0) >= 80) reasons.push(`Strong fit (${it.score})`);
  if (direct) { v += 12; reasons.push("You can reach them directly"); }
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

