/**
 * Drafts that sound like Akshat, not like an AI. Two things make that work:
 *   1. a hard style guide (his outreach rules: short, peer-to-peer, no corporate words, no dashes);
 *   2. his own sent messages as examples: every outbound message logged in Sales becomes a voice sample.
 */
import { q } from "../db";
import { salesConfig, type SalesConfig } from "./config";
import { llmJson, stripDashes } from "./llm";

export const STYLE_GUIDE = `VOICE: write exactly like the owner writes, an Indian founder talking to a peer. Warm, direct, a little informal,
short sentences, natural Indian English rhythm. Occasional natural imperfection beats polished text.
- If the other person is Indian and the conversation already uses Hindi or Hinglish words, mirror them lightly
  ("haan", "ji", "thoda", "bas", "chalo", "bhai" only if they use it). Never force Hindi on international clients.
- Never: em dashes or en dashes, "I hope this finds you well", "I wanted to reach out", "I came across your profile",
  "kindly revert", "do the needful", "PFA", "synergy", "leverage", "streamline", "empower", "cutting-edge", "innovative",
  "game-changer", "seamlessly", "delighted", "thrilled", emojis in a first message, exclamation marks in a row.
- Never list services. One specific thing tied to their pain, one line max.
- First touch never pitches. Follow-ups add something new (an insight, a small idea, a relevant example, a question);
  never "just checking in" or "following up on my last message".
- Always end with something that is easy to answer: a yes/no question, a one word answer, or a soft next step.
- FACTS: use only what is in CONTEXT. Never invent their name, company, numbers, tools they use, past projects, results,
  client names or case studies. If you do not know their name, use no name ("Hi," or start directly). If proof is needed
  and none is given, ask a question instead. A wrong detail is worse than a generic line.
PLATFORM LENGTH:
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

export interface DraftInput {
  channel: string;
  purpose: string;
  context: string;
  /** e.g. "follow-up 2 of 3", "breakup", "first touch" */
  step?: string | null;
  toName?: string | null;
  toCountry?: string | null;
}

export interface Draft {
  subject: string | null;
  message: string;
}

export async function draftMessage(d: DraftInput): Promise<Draft> {
  const cfg = await salesConfig();
  const samples = await voiceSamples();
  const system = `You write sales messages for ${ownerLine(cfg)}
${STYLE_GUIDE}
${cfg.voice_rules ? `OWNER'S OWN EXTRA RULES:\n${cfg.voice_rules}\n` : ""}${samples.length ? `\nTHE OWNER'S REAL MESSAGES (copy this voice, rhythm and length; do not copy content):\n${samples.map((s, i) => `[${i + 1}] ${s}`).join("\n")}\n` : ""}
Return JSON {"subject": string or null (only for email), "message": string}.
CHANNEL tells you where it will be posted; follow that platform's rules exactly.`;
  const user = `CHANNEL: ${d.channel}
PURPOSE: ${d.purpose}${d.step ? `\nSTEP: ${d.step}` : ""}
TO: ${d.toName ?? "the contact"}${d.toCountry ? ` (${d.toCountry})` : ""}
CONTEXT:
${d.context.slice(0, 6000)}`;
  const out = await llmJson<Draft>(system, user, { maxTokens: 700, temperature: 0.6, totalMs: 40_000 });
  return {
    subject: out.subject ? stripDashes(String(out.subject)) : null,
    message: stripDashes(String(out.message ?? "")).trim(),
  };
}
