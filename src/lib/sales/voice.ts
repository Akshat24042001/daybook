/**
 * Drafts that sound like Akshat, not like an AI. Two things make that work:
 *   1. a hard style guide (his outreach rules: short, peer-to-peer, no corporate words, no dashes);
 *   2. his own sent messages as examples: every outbound message logged in Sales becomes a voice sample.
 */
import { q } from "../db";
import { salesConfig, type SalesConfig } from "./config";
import { winningMessages } from "./learning";
import { llmJson, stripDashes } from "./llm";

export const STYLE_GUIDE = `VOICE: write exactly like the owner writes, an Indian founder talking to a peer. Warm, direct, a little informal,
short sentences, natural Indian English rhythm. Occasional natural imperfection beats polished text.
- If the other person is Indian and the conversation already uses Hindi or Hinglish words, mirror them lightly
  ("haan", "ji", "thoda", "bas", "chalo", "bhai" only if they use it). Never force Hindi on international clients.
- Never: em dashes or en dashes, "I hope this finds you well", "I wanted to reach out", "I came across your profile",
  "kindly revert", "do the needful", "PFA", "synergy", "leverage", "streamline", "empower", "cutting-edge", "innovative",
  "game-changer", "seamlessly", "delighted", "thrilled", emojis in a first message, exclamation marks in a row.
- Never list services. One specific thing tied to their pain, one line max.
- First touch never pitches a service list. Follow-ups add something new (an insight, a small idea, a relevant example, a question);
  never "just checking in" or "following up on my last message".
- Always end with something that is easy to answer: a yes/no question, a one word answer, or a soft next step.
- FACTS: use only what is in CONTEXT. Never invent their name, company, numbers, tools they use, past projects, results,
  client names or case studies. If you do not know their name, use no name ("Hi," or start directly). If proof is needed
  and none is given, ask a question instead. A wrong detail is worse than a generic line.
READ THE WHOLE HISTORY FIRST (when CONTEXT has a conversation):
- Answer their latest message before anything else, using what they actually said and shared.
- Never ask for something they already gave (details, a website, a number), never repeat a question already asked,
  never re-introduce yourself to someone you are already talking to, never pitch what they already agreed to.
- Do what the STAGE needs (STAGE GOAL in CONTEXT) and move it exactly one step forward.
COLD FIRST MESSAGE (purpose first_touch or radar, nobody has replied yet): be specific and complete, not a one-liner.
  1. Why you are writing: the exact thing you saw (their post, their business, a fact from CONTEXT), in their words.
  2. The problem behind it for a business like theirs, as an observation, not a claim about them.
  3. One concrete idea of how you would solve it: what you would set up and what changes for them. Plain words, no service list.
  4. Who you are, in one short line (name and company).
  5. One easy question to answer.
  Lengths for a cold first message: whatsapp 50 to 90 words; linkedin 70 to 120 words; email body 100 to 170 words;
  a reply on the platform where they posted (reddit, freelancer, upwork...) follows that platform's rule below.
PLATFORM LENGTH (replies and follow-ups):
- whatsapp: 1 to 3 short sentences. No greeting line on its own. No sign-off.
- linkedin: under 60 words (80 if they engaged with content). No links on a first message.
- email: subject 6 to 10 words, plain, no spam words, no fake RE:. Body 55 to 120 words, plain text, sign with first name.
- instagram/sms: like whatsapp.
- call: give 4 to 6 bullet talking points instead of a message.
- reddit / hn / x (a public reply to their post): helpful first, 2 to 4 sentences, answer their actual question with one
  concrete idea, no sales pitch, no links, no "DM me"; end with one light question. Reads like a peer, not an agency.
- linkedin_post (comment or DM after their post): under 60 words, reference their post specifically, one question.
- upwork / freelancer / pph / guru / contra (a proposal): 80 to 150 words. First line restates their exact need, then how
  you would approach it in 2 to 3 short lines, then one clarifying question. No fake portfolio, no "I have 10 years".`;

export async function voiceSamples(limit = 8): Promise<string[]> {
  const rows = await q<{ body: string }>(
    `select body from sales_interactions
     where direction = 'out' and confidence = 'sure' and body is not null and length(body) between 25 and 900
       and channel in ('whatsapp','linkedin','email','instagram','sms')
     order by occurred_at desc limit $1`,
    [limit],
  );
  return rows.map((r) => r.body.trim());
}

export function ownerLine(cfg: SalesConfig): string {
  const o = cfg.owner;
  return `${o.name}, ${o.title} of ${o.company} (${o.website}), an AI agency based in India. Offers: ${cfg.offers.join("; ")}.`;
}

/**
 * Your booking link, when set: offered whenever the natural next step is a call, so nobody trades times by message.
 * Never in a first message or a breakup (links in a first touch look like spam; a breakup asks for nothing).
 */
export function bookingRule(cfg: SalesConfig, kind?: string | null): string {
  const url = cfg.owner.booking_url?.trim();
  if (!url) return "";
  const k = (kind ?? "").split(":")[0];
  if (k === "first_touch" || k === "breakup" || k === "radar" || k === "payment_due") return "";
  return `BOOKING LINK: ${url}\nWhen the natural next step is a call or a meeting, offer this link in one short line ("grab any slot that suits you: <link>") instead of asking for times. Use it at most once, and only when a call is the right next step.\n`;
}

export interface DraftInput {
  channel: string;
  purpose: string;
  context: string;
  /** e.g. "follow-up 2 of 3", "breakup", "first touch" */
  step?: string | null;
  toName?: string | null;
  toCountry?: string | null;
  /** what the message is for ("first_touch", "follow_up:2"): picks your past messages of the same kind that got replies */
  kind?: string | null;
}

export interface Draft {
  subject: string | null;
  message: string;
}

export async function draftMessage(d: DraftInput): Promise<Draft> {
  const cfg = await salesConfig();
  // what worked first (real messages of the same kind and channel that got a reply), then recent ones for the voice
  const winners = await winningMessages({ kind: d.kind, channel: d.channel, limit: 5 }).catch(() => [] as string[]);
  const recent = (await voiceSamples()).filter((x) => !winners.includes(x)).slice(0, Math.max(0, 8 - winners.length));
  const system = `You write sales messages for ${ownerLine(cfg)}
${STYLE_GUIDE}
${cfg.voice_rules ? `OWNER'S OWN EXTRA RULES:\n${cfg.voice_rules}\n` : ""}${winners.length ? `\nTHE OWNER'S MESSAGES THAT GOT REPLIES (closest to this kind of message first). Follow their structure, length and the kind of opening and ask that worked; never copy their content or facts:\n${winners.map((s, i) => `[W${i + 1}] ${s}`).join("\n")}\n` : ""}${recent.length ? `\nTHE OWNER'S OTHER RECENT MESSAGES (voice and rhythm only; do not copy content):\n${recent.map((s, i) => `[${i + 1}] ${s}`).join("\n")}\n` : ""}
${bookingRule(cfg, d.kind)}Return JSON {"subject": string or null (only for email), "message": string}.
CHANNEL tells you where it will be posted; follow that platform's rules exactly.`;
  const user = `CHANNEL: ${d.channel}
PURPOSE: ${d.purpose}${d.step ? `\nSTEP: ${d.step}` : ""}
TO: ${d.toName ?? "the contact"}${d.toCountry ? ` (${d.toCountry})` : ""}
CONTEXT:
${d.context.slice(0, 12000)}`;
  let out = await llmJson<Draft>(system, user, { maxTokens: 1200, temperature: 0.5, totalMs: 40_000 });
  // nothing invented: an email, phone, link or number the context does not have sends it back once to be fixed
  const allowed = `${d.context}\n${ownerLine(cfg)}\n${cfg.owner.signature}\n${cfg.owner.booking_url}\n${cfg.owner.emails.join(" ")}\n${cfg.owner.phones.join(" ")}\n${d.toName ?? ""}`;
  const bad = unsupported(`${out.subject ?? ""}\n${out.message ?? ""}`, allowed);
  if (bad.length) {
    out = await llmJson<Draft>(system, `${user}\n\nYOUR LAST DRAFT USED DETAILS THAT ARE NOT IN CONTEXT: ${bad.join(", ")}. Write it again without them (ask instead if needed).`,
      { maxTokens: 1200, temperature: 0.3, totalMs: 30_000 }).catch(() => out);
  }
  return {
    subject: out.subject ? stripDashes(String(out.subject)) : null,
    message: stripDashes(String(out.message ?? "")).trim(),
  };
}

/**
 * The checkable facts in a draft (emails, links and domains, phone numbers, amounts, percentages, counts with units) that
 * appear nowhere in what the writer was given. Pure, so it is tested.
 */
export function unsupported(draft: string, context: string): string[] {
  const ctx = context.toLowerCase();
  const digits = ctx.replace(/[^0-9]/g, " ");
  const out = new Set<string>();
  for (const m of draft.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []) if (!ctx.includes(m.toLowerCase())) out.add(m);
  for (const m of draft.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, " ").match(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:com|in|io|ai|co|org|net|app|dev|me|us|uk)(?:\.[a-z]{2})?\b(?:\/\S*)?/gi) ?? []) {
    const host = m.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    if (!ctx.includes(host)) out.add(m);
  }
  for (const m of draft.match(/\+?\d[\d\s-]{8,}\d/g) ?? []) {
    const n = m.replace(/\D/g, "");
    if (n.length >= 9 && !ctx.replace(/\D/g, "").includes(n.slice(-9))) out.add(m.trim());
  }
  // amounts and percentages: the number must be in the context (commas ignored, "2 lakh" and "200000" both count)
  const plain = ctx.replace(/(\d),(?=\d)/g, "$1");
  for (const m of draft.match(/(?:₹|rs\.?|inr|usd|\$|aed|£|€)\s?\d[\d,.]*\s?(?:lakhs|lakh|crores|crore|cr|million|k|l|m)?|\d[\d,.]*\s?(?:%|percent|lakh|lakhs|crore)/gi) ?? []) {
    const num = m.replace(/(\d),(?=\d)/g, "$1").match(/\d+(?:\.\d+)?/)?.[0];
    if (num && !new RegExp(`(^|[^\\d.])${num.replace(".", "\\.")}([^\\d]|$)`).test(plain)) out.add(m.trim());
  }
  return [...out].slice(0, 8);
}
