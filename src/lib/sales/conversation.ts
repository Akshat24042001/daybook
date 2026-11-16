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
import { zonedInstant } from "../time";
import { dealEngagement, dealKnowledge, dealReach, engagementLine, onlyReachable, reachLines } from "./reach";
import { enqueue } from "./jobs";

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
 "reply_draft": a short reply the owner could send now if THEM wrote last or a follow-up is due, in the chat's language and tone, else null,
 "next_step": the single next thing the owner should do now, after everything in the notes, imperative, under 15 words,
 "next_step_due": YYYY-MM-DD for it (what was agreed, else a realistic day), else null,
 "done_promise_ids": ids of OPEN PROMISES the notes show were already kept, else []
}
The CURRENT NEXT STEP may be out of date: if the notes show it already happened, replace it with what follows; never repeat a step that is done.
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
  const promises = await q<{ id: number; owner: string; text: string; due_at: string | null }>(
    "select id, owner, text, due_at from sales_commitments where deal_id = $1 and status = 'open' order by due_at nulls last limit 20", [dealId]);
  const cfg = await salesConfig();
  const reach = await dealReach(dealId);
  const out = await llmJson<{ summary?: string; quick_actions?: unknown; reply_draft?: string | null; next_step?: string | null; next_step_due?: string | null; done_promise_ids?: number[] }>(
    SYSTEM(cfg.owner.name, new Date().toISOString()),
    `LEAD: ${d.title}${d.company_name ? ` (${d.company_name})` : ""}${d.person_name ? `, contact ${d.person_name}` : ""}. STAGE: ${d.stage_name}.\n` +
    `${reachLines(reach)}\n${await dealKnowledge(dealId)}\n${engagementLine(await dealEngagement(dealId))}\n` +
    `CURRENT NEXT STEP: ${d.next_action ? `${d.next_action}${d.next_action_at ? ` (due ${new Date(d.next_action_at).toISOString().slice(0, 10)})` : ""}` : "none"}\n` +
    `${promises.length ? `OPEN PROMISES:\n${promises.map((p) => `- id ${p.id}, ${p.owner === "me" ? "ME" : "THEM"}: ${p.text}${p.due_at ? ` (by ${new Date(p.due_at).toISOString().slice(0, 10)})` : ""}`).join("\n")}\n` : ""}` +
    `TOUCHES:\n${notes}`,
    { maxTokens: 1500, totalMs: 45_000 },
  );
  const summary = String(out.summary ?? "").trim();
  if (!summary) throw new UserError("The AI did not return a summary. Try again.");
  const conversation: Conversation = {
    // never a step on a channel you cannot use
    quick_actions: cleanQuickActions(out.quick_actions).map((a) => ({ ...a, label: onlyReachable(a.label, reach) ?? a.label, detail: onlyReachable(a.detail, reach) })),
    reply_draft: out.reply_draft ? String(out.reply_draft).slice(0, 1500) : null,
    at: new Date().toISOString(),
    scope: "all",
  };
  // the next step follows the conversation: a step that already happened is replaced, with its own date
  const patch: Record<string, unknown> = { summary: summary.slice(0, 2000) };
  const step = String(onlyReachable(out.next_step, reach) ?? "").trim();
  if (step) {
    patch.next_action = step.slice(0, 300);
    const due = typeof out.next_step_due === "string" && /^\d{4}-\d{2}-\d{2}/.test(out.next_step_due) && !Number.isNaN(Date.parse(out.next_step_due.slice(0, 10))) ? out.next_step_due.slice(0, 10) : null;
    patch.next_action_at = due ? zonedInstant(due, 11, 0, tz).toISOString() : step === (d.next_action ?? "").trim() ? d.next_action_at : null;
  }
  await updateDeal(dealId, patch, { cause: "ai" });
  const kept = (out.done_promise_ids ?? []).map(Number).filter((n) => promises.some((p) => p.id === n));
  if (kept.length) await q("update sales_commitments set status = 'done', done_at = now() where deal_id = $1 and id = any($2::int[]) and status = 'open'", [dealId, kept]);
  await enqueue("refresh_moves", { deal_id: dealId }, { dedupeKey: `refresh_moves:${dealId}` });
  // what was done for you stays when the summary is rebuilt
  await q("update sales_deals set conversation = $2::jsonb || coalesce(jsonb_build_object('autopilot', conversation->'autopilot'), '{}'::jsonb) where id = $1", [dealId, JSON.stringify(conversation)]);
  await enqueue("deal_autopilot", { deal_id: dealId, trigger: "summary" }, { dedupeKey: `deal_autopilot:${dealId}` });
  return { summary, conversation };
}

/** Marks one quick action done (or not wanted), so it leaves the list. */
export async function doneQuickAction(dealId: number, index: number): Promise<void> {
  const row = await one<{ conversation: Conversation | null }>("select conversation from sales_deals where id = $1", [dealId]);
  if (!row?.conversation) return;
  const done = [...new Set([...(row.conversation.done ?? []), index])];
  await q("update sales_deals set conversation = jsonb_set(conversation, '{done}', $2::jsonb) where id = $1", [dealId, JSON.stringify(done)]);
}
