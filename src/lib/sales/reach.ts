/**
 * How you can actually reach a lead, and what you know and do not know about them.
 *
 * Every AI step (filing a log, the next step, quick actions, drafts, the lead chat) gets these facts, so it never tells
 * you to "message them on LinkedIn" when no LinkedIn profile or LinkedIn conversation exists, and never acts as if it
 * knew a budget or a decision maker that nobody has told you.
 *
 * A channel counts when you have their address for it (a phone, an email, a profile) or when you already talk to them
 * there (a logged WhatsApp, LinkedIn, Instagram or email conversation: you can reply in that same chat).
 */
import { one, q } from "../db";

export type Channel = "whatsapp" | "call" | "email" | "linkedin" | "instagram" | "sms";

export const CHANNEL_NAME: Record<Channel, string> = { whatsapp: "WhatsApp", call: "a call", email: "email", linkedin: "LinkedIn", instagram: "Instagram", sms: "SMS" };

export interface Reach {
  /** channels you can use, best first, each with how */
  channels: { channel: Channel; via: string }[];
  /** the ones you cannot use yet, and why */
  missing: { channel: Channel; why: string }[];
  /** where the next message should go: where they last wrote to you, else the best one you have; null when none */
  best: Channel | null;
}

export interface ReachInput {
  phones?: string[] | null;
  whatsapp?: string | null;
  emails?: string[] | null;
  linkedin?: string | null;
  instagram?: string | null;
  /** conversations logged with them, newest first */
  threads?: { channel: string; direction: string; at: string | Date }[];
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** Pure: the channels a lead can be reached on, from their details and the conversations you already have. */
export function reachFrom(r: ReachInput): Reach {
  const phone = (r.phones ?? []).find((p) => digits(p).length >= 8) ?? (digits(r.whatsapp).length >= 8 ? r.whatsapp! : null);
  const email = (r.emails ?? []).find((e) => /@/.test(e)) ?? null;
  const threads = r.threads ?? [];
  const talked = (c: string) => threads.find((t) => t.channel === c);
  const out: Reach["channels"] = [];
  const add = (channel: Channel, via: string) => { if (!out.some((x) => x.channel === channel)) out.push({ channel, via }); };

  if (talked("whatsapp")) add("whatsapp", `the WhatsApp chat you already have with them${phone ? ` (${phone})` : ""}`);
  else if (phone) add("whatsapp", `their number ${phone}`);
  if (talked("email")) add("email", `the email thread you already have${email ? ` (${email})` : ""}`);
  else if (email) add("email", email);
  if (talked("linkedin")) add("linkedin", `the LinkedIn conversation you already have${r.linkedin ? ` (${r.linkedin})` : ""}`);
  else if (r.linkedin) add("linkedin", `their profile ${r.linkedin}`);
  if (talked("instagram")) add("instagram", "the Instagram chat you already have");
  else if (r.instagram) add("instagram", `@${r.instagram.replace(/^@/, "")}`);
  if (phone) add("call", phone);

  const missing: Reach["missing"] = [];
  if (!out.some((x) => x.channel === "whatsapp")) missing.push({ channel: "whatsapp", why: "no phone number and no WhatsApp chat" });
  if (!out.some((x) => x.channel === "email")) missing.push({ channel: "email", why: "no email address and no email thread" });
  if (!out.some((x) => x.channel === "linkedin")) missing.push({ channel: "linkedin", why: "no LinkedIn profile saved and no LinkedIn conversation" });

  // the next message goes where they last wrote to you, else where you last talked, else the best you have
  const usable = new Set(out.map((x) => x.channel));
  const lastIn = threads.find((t) => (t.direction === "in" || t.direction === "both") && usable.has(t.channel as Channel));
  const last = threads.find((t) => usable.has(t.channel as Channel));
  const order: Channel[] = ["whatsapp", "email", "linkedin", "instagram", "call"];
  const best = (lastIn?.channel as Channel) ?? (last?.channel as Channel) ?? order.find((c) => usable.has(c)) ?? null;
  return { channels: out, missing, best };
}

/** The lines every prompt gets. Pure. */
export function reachLines(r: Reach): string {
  const have = r.channels.length ? r.channels.map((c) => `${CHANNEL_NAME[c.channel]} via ${c.via}`).join("; ") : "NONE: no phone, email, profile or conversation is known";
  const no = r.missing.map((m) => `${CHANNEL_NAME[m.channel]} (${m.why})`).join("; ");
  return `HOW YOU CAN REACH THEM: ${have}.${r.best ? ` Next message goes on ${CHANNEL_NAME[r.best]}.` : ""}
CANNOT USE YET: ${no || "nothing missing"}.
Only ever suggest, plan or write for a channel you CAN reach them on. If one you need is missing, the step is to get it (ask for it, or find it), never to use it.`;
}

/** Their details and the conversations logged with them, for a deal. */
export async function dealReach(dealId: number): Promise<Reach> {
  const d = await one<{ person_id: number | null }>("select person_id from sales_deals where id = $1", [dealId]);
  const p = d?.person_id
    ? await one<{ phones: string[]; emails: string[]; linkedin: string | null; instagram: string | null; whatsapp: string | null }>(
        "select phones, emails, linkedin, instagram, whatsapp from sales_people where id = $1", [d.person_id])
    : null;
  const threads = await q<{ channel: string; direction: string; at: string }>(
    `select channel, direction, occurred_at as at from sales_interactions
     where deal_id = $1 and channel in ('whatsapp','email','linkedin','instagram','sms') and direction in ('in','out','both')
     order by occurred_at desc limit 30`, [dealId]);
  return reachFrom({ ...(p ?? {}), threads });
}

/**
 * Pure: a suggestion that names a channel you cannot use is pointed at the one you can ("Message her on LinkedIn" becomes
 * "Message her on WhatsApp"). Steps about getting the contact ("find her LinkedIn", "ask for her email") stay as they are.
 */
export function onlyReachable(text: string | null | undefined, r: Reach): string | null {
  if (!text) return text ?? null;
  if (!r.best || /\b(find|search|look up|get|ask (?:for|her|him|them)|request|save|add)\b/i.test(text)) return text;
  const words: Record<Channel, RegExp> = {
    linkedin: /\bLinked ?In\b/gi, email: /\b(e-?mail|mail)\b/gi, whatsapp: /\bWhats ?App\b/gi, instagram: /\b(Instagram|IG)\b/gi, call: /\bcall\b/gi, sms: /\bSMS\b/gi,
  };
  const usable = new Set(r.channels.map((c) => c.channel));
  const bestName = r.best === "call" ? "a call" : CHANNEL_NAME[r.best];
  let out = text;
  for (const m of r.missing) {
    if (usable.has(m.channel)) continue;
    out = out.replace(words[m.channel], bestName);
  }
  return out;
}

// ------------------------------------------------------------------ what you know, and what you do not

/** The facts that matter for selling, each either known or not. Pure. */
export function knowledgeLines(f: {
  contact?: string | null; title?: string | null; decision_maker?: string | null; company?: string | null; website?: string | null;
  industry?: string | null; city?: string | null; size?: string | null; budget?: string | null; value?: string | null; timeline?: string | null;
  requirements?: string | null; decision_process?: string | null; pain?: string | null; researched?: boolean;
}): string {
  const items: [string, string | null | undefined][] = [
    ["Contact's name", f.contact], ["Their role", f.title], ["Who decides", f.decision_maker], ["Their business", f.company], ["Website", f.website],
    ["Industry", f.industry], ["City", f.city], ["Size", f.size], ["What they need", f.requirements], ["Their pain", f.pain],
    ["Budget", f.budget ?? f.value], ["Timeline", f.timeline], ["How they decide", f.decision_process],
  ];
  const known = items.filter(([, v]) => v && String(v).trim()).map(([k, v]) => `${k}: ${String(v).replace(/\s+/g, " ").slice(0, 160)}`);
  const unknown = items.filter(([, v]) => !v || !String(v).trim()).map(([k]) => k);
  return `WHAT YOU KNOW: ${known.join("; ") || "almost nothing yet"}.
WHAT YOU DO NOT KNOW YET: ${unknown.join(", ") || "nothing important"}${f.researched === false ? "; the business has not been researched yet" : ""}.
Never state or assume anything in the second list. Where one matters for the next step, the step is to find it out.`;
}

/** The knowledge lines for a deal. */
export async function dealKnowledge(dealId: number): Promise<string> {
  const d = await one<Record<string, unknown> & { person_id: number | null; company_id: number | null }>("select * from sales_deals where id = $1", [dealId]);
  if (!d) return "";
  const p = d.person_id ? await one<{ full_name: string; title: string | null; is_decision_maker: boolean | null }>("select full_name, title, is_decision_maker from sales_people where id = $1", [d.person_id]) : null;
  const c = d.company_id ? await one<{ name: string; website: string | null; industry: string | null; city: string | null; employees: number | null; enriched_at: string | null }>(
    "select name, website, industry, city, employees, enriched_at from sales_companies where id = $1", [d.company_id]) : null;
  const dm = p?.is_decision_maker ? `${p.full_name} (the contact)` : (await one<{ full_name: string }>(
    "select p.full_name from sales_deal_people x join sales_people p on p.id = x.person_id where x.deal_id = $1 and (x.role = 'decision_maker' or p.is_decision_maker) limit 1", [dealId]))?.full_name ?? null;
  const s = (v: unknown) => (v === null || v === undefined || v === "" ? null : Array.isArray(v) ? (v.length ? v.join(", ") : null) : String(v));
  return knowledgeLines({
    contact: p?.full_name, title: p?.title, decision_maker: dm, company: c?.name, website: c?.website, industry: c?.industry ?? s(d.industry), city: c?.city ?? s(d.city),
    size: c?.employees ? `${c.employees} people` : null, budget: s(d.budget), value: d.value_amount ? `${d.currency} ${d.value_amount}` : null, timeline: s(d.timeline),
    requirements: s(d.requirements), decision_process: s(d.decision_process), pain: s(d.pain), researched: c ? !!c.enriched_at : undefined,
  });
}

// ------------------------------------------------------------------ how they engage

export interface Engagement {
  their_replies: number;
  /** median hours they take to answer you */
  their_median_h: number | null;
  /** hours they took the last time */
  their_last_h: number | null;
  days_since_they_wrote: number | null;
  waiting_on: "them" | "you" | null;
  waiting_days: number | null;
  trend: "warming" | "cooling" | "steady" | null;
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] : null);

/** Pure: how a lead behaves, from the dated touches (any order). */
export function engagementFrom(touches: { direction: string; at: string | Date }[], now = Date.now()): Engagement {
  const t = touches.filter((x) => x.direction === "in" || x.direction === "out").map((x) => ({ d: x.direction, at: new Date(x.at).getTime() })).sort((a, b) => a.at - b.at);
  const delays: number[] = [];
  let pendingOut: number | null = null;
  for (const x of t) {
    if (x.d === "out") { if (pendingOut === null) pendingOut = x.at; }
    else if (pendingOut !== null) { delays.push((x.at - pendingOut) / 3_600_000); pendingOut = null; }
  }
  const ins = t.filter((x) => x.d === "in");
  const last = t[t.length - 1];
  const lastIn = ins[ins.length - 1];
  const H = (n: number) => Math.round(n * 10) / 10;
  let trend: Engagement["trend"] = null;
  if (delays.length >= 3) {
    const recent = delays[delays.length - 1];
    const before = median(delays.slice(0, -1))!;
    trend = recent < before * 0.6 ? "warming" : recent > before * 1.8 ? "cooling" : "steady";
  }
  return {
    their_replies: ins.length,
    their_median_h: median(delays) !== null ? H(median(delays)!) : null,
    their_last_h: delays.length ? H(delays[delays.length - 1]) : null,
    days_since_they_wrote: lastIn ? Math.floor((now - lastIn.at) / 86_400_000) : null,
    waiting_on: last ? (last.d === "out" ? "them" : "you") : null,
    waiting_days: last ? Math.floor((now - last.at) / 86_400_000) : null,
    trend,
  };
}

const hours = (h: number) => (h < 1 ? "under an hour" : h < 24 ? `about ${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"}` : `about ${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? "" : "s"}`);

/** Pure: the engagement in one line, for prompts and the deal page. */
export function engagementLine(e: Engagement): string {
  if (!e.their_replies && !e.waiting_on) return "HOW THEY ENGAGE: no conversation logged yet.";
  const parts = [
    e.their_replies ? `they have written ${e.their_replies} time${e.their_replies === 1 ? "" : "s"}` : "they have not replied yet",
    e.their_median_h !== null ? `they usually answer in ${hours(e.their_median_h)}` : "",
    e.their_last_h !== null && e.their_median_h !== null && Math.abs(e.their_last_h - e.their_median_h) > 1 ? `last time ${hours(e.their_last_h)}` : "",
    e.trend && e.trend !== "steady" ? (e.trend === "warming" ? "answering faster than before (warming)" : "answering slower than before (cooling)") : "",
    e.waiting_on === "you" ? `you owe them a reply${e.waiting_days ? ` for ${e.waiting_days} day${e.waiting_days === 1 ? "" : "s"}` : ""}` : e.waiting_on === "them" ? `waiting on them${e.waiting_days ? ` for ${e.waiting_days} day${e.waiting_days === 1 ? "" : "s"}` : ""}` : "",
  ].filter(Boolean);
  return `HOW THEY ENGAGE: ${parts.join("; ")}.`;
}

export async function dealEngagement(dealId: number): Promise<Engagement> {
  const rows = await q<{ direction: string; at: string }>("select direction, occurred_at as at from sales_interactions where deal_id = $1 and direction in ('in','out') order by occurred_at", [dealId]);
  return engagementFrom(rows);
}
