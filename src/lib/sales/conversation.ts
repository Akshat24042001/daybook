/**
 * The whole conversation on a deal in one place: a short summary, the timeline it comes from, and two to four quick
 * actions to take next. Each capture keeps this fresh; "Summarize again" rebuilds it from every logged touch.
 */
import { one, q, UserError } from "../db";
import { getSettings } from "../settings";
import { salesConfig } from "./config";
import { getDeal, updateDeal } from "./deals";
import { cleanQuickActions, type QuickAction } from "./ingest";
import { llmJson, llmConfigured } from "./llm";

export interface Conversation {
  quick_actions: QuickAction[];
  reply_draft: string | null;
  at: string;
  /** "all" when rebuilt from the whole timeline */
  scope?: "all" | "capture";
  done?: number[];
}

const SYSTEM = (owner: string, now: string) => `You keep the sales notes of ${owner}. NOW: ${now}.
You get every logged touch with one lead, oldest first (ME = the owner, THEM = the lead), plus open promises.
Return JSON:
{
 "summary": "where it stands, 3 to 5 short plain lines: who they are and what they want, what has happened, where it is now, what is blocking",
 "quick_actions": 2 to 4 concrete next steps, most urgent first, each
   {"kind":"reply|follow_up|promise|meeting|call|send|stage","label":"imperative, under 10 words","detail":"one line or null",
    "due":"YYYY-MM-DD or null","stage":"contacted|engaged|discovery|proposal|negotiation|won|lost|nurture for kind stage, else null"},
 "reply_draft": a short reply the owner could send now if THEM wrote last or a follow-up is due, in the chat's language and tone, else null
}
Use only what is in the notes. Do not invent prices, dates or names.`;

export async function summarizeDeal(dealId: number): Promise<{ summary: string; conversation: Conversation }> {
  if (!llmConfigured()) throw new UserError("Summaries need an AI key: add GEMINI_API_KEY or OPENROUTER_API_KEY.");
  const d = await getDeal(dealId);
  if (!d) throw new UserError("That deal no longer exists.");
  const rows = await q<{ occurred_at: string; channel: string; direction: string; summary: string | null; body: string | null }>(
    `select occurred_at, channel, direction, summary, body from sales_interactions where deal_id = $1 order by occurred_at desc limit 80`,
    [dealId],
  );
  if (!rows.length) throw new UserError("Nothing is logged on this deal yet. Log a chat, a call or a screenshot first.");
  const tz = (await getSettings()).timezone;
  const day = (s: string) => new Date(s).toLocaleString("en-IN", { timeZone: tz, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  const who = (dir: string) => (dir === "in" ? "THEM" : dir === "out" ? "ME" : "BOTH");
  // newest 80, oldest first, each cut so the whole fits
  const lines = rows.reverse().map((r) => `[${day(r.occurred_at)}] ${r.channel} ${who(r.direction)}: ${(r.body || r.summary || "").replace(/\s+/g, " ").slice(0, 600)}`);
  let notes = lines.join("\n");
  while (notes.length > 16_000 && lines.length > 5) notes = (lines.shift(), lines.join("\n"));
  const promises = await q<{ owner: string; text: string; due_at: string | null }>(
    "select owner, text, due_at from sales_commitments where deal_id = $1 and status = 'open' order by due_at nulls last limit 20", [dealId]);
  const cfg = await salesConfig();
  const out = await llmJson<{ summary?: string; quick_actions?: unknown; reply_draft?: string | null }>(
    SYSTEM(cfg.owner.name, new Date().toISOString()),
    `LEAD: ${d.title}${d.company_name ? ` (${d.company_name})` : ""}${d.person_name ? `, contact ${d.person_name}` : ""}. STAGE: ${d.stage_name}.\n` +
    `${promises.length ? `OPEN PROMISES:\n${promises.map((p) => `- ${p.owner === "me" ? "ME" : "THEM"}: ${p.text}${p.due_at ? ` (by ${p.due_at.slice(0, 10)})` : ""}`).join("\n")}\n` : ""}` +
    `TOUCHES:\n${notes}`,
    { maxTokens: 1500, totalMs: 45_000 },
  );
  const summary = String(out.summary ?? "").trim();
  if (!summary) throw new UserError("The AI did not return a summary. Try again.");
  const conversation: Conversation = {
    quick_actions: cleanQuickActions(out.quick_actions),
    reply_draft: out.reply_draft ? String(out.reply_draft).slice(0, 1500) : null,
    at: new Date().toISOString(),
    scope: "all",
  };
  await updateDeal(dealId, { summary: summary.slice(0, 2000) }, { cause: "ai" });
  await q("update sales_deals set conversation = $2 where id = $1", [dealId, JSON.stringify(conversation)]);
  return { summary, conversation };
}

/** Marks one quick action done (or not wanted), so it leaves the list. */
export async function doneQuickAction(dealId: number, index: number): Promise<void> {
  const row = await one<{ conversation: Conversation | null }>("select conversation from sales_deals where id = $1", [dealId]);
  if (!row?.conversation) return;
  const done = [...new Set([...(row.conversation.done ?? []), index])];
  await q("update sales_deals set conversation = jsonb_set(conversation, '{done}', $2::jsonb) where id = $1", [dealId, JSON.stringify(done)]);
}
