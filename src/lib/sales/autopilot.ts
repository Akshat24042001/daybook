/**
 * Done for you: after every log (a chat, a screenshot, a call note) the AI does the work it can do on its own, so the
 * owner only has to read, tweak and send.
 *
 *   1. the deal's moves are refreshed and the ones due get a message written in the owner's voice, ready to send
 *      (unless Sales settings say "suggest only" for replies);
 *   2. the contact and the business are researched if they never were (the website check runs with it);
 *   3. when the next step is to prepare something (a demo, a proposal, a quote, a plan), a prep note is written from
 *      everything known: what they told us, what to build or show, the steps, what to confirm, and the message to send
 *      with it. Facts only from the record; assumptions are marked.
 * What it did is kept on the deal ("Done for you") and sent to Telegram.
 * Each piece runs as its own short job, so a slow AI never holds the others up.
 */
import { one, q } from "../db";
import { salesConfig } from "./config";
import { dealContext } from "./context";
import { createLinkDoc } from "./docs";
import { enqueue } from "./jobs";
import { llm, llmConfigured } from "./llm";
import { noDashes } from "../text/no-dashes";

export interface DoneItem { label: string; href?: string | null }
export interface Autopilot { at: string; items: DoneItem[]; trigger?: string | null }

/** A next step that means preparing something the AI can draft. Pure. */
export function prepKind(step: string | null | undefined): "demo" | "proposal" | "plan" | null {
  const t = (step ?? "").toLowerCase();
  if (/\b(demo|prototype|mock ?up|walkthrough|sample)\b/.test(t)) return "demo";
  if (/\b(proposal|quote|quotation|estimate|pricing|price|costing|sow|scope of work)\b/.test(t)) return "proposal";
  if (/\b(plan|roadmap|deck|presentation|audit|report|strategy)\b/.test(t) && /\b(prepare|make|create|build|draft|share|send|write)\b/.test(t)) return "plan";
  return null;
}

async function record(dealId: number, items: DoneItem[], trigger: string | null): Promise<void> {
  if (!items.length) return;
  const cur = (await one<{ a: Autopilot | null }>("select conversation->'autopilot' as a from sales_deals where id = $1", [dealId]))?.a;
  // the same run adding more (the prep note arrives a little later) joins the list instead of replacing it
  const fresh = cur && Date.now() - new Date(cur.at).getTime() < 10 * 60_000;
  const merged: Autopilot = { at: new Date().toISOString(), trigger, items: [...(fresh ? cur!.items : []), ...items].filter((x, i, a) => a.findIndex((y) => y.label === x.label) === i).slice(-10) };
  await q("update sales_deals set conversation = coalesce(conversation, '{}'::jsonb) || jsonb_build_object('autopilot', $2::jsonb) where id = $1", [dealId, JSON.stringify(merged)]);
}

/** Step one, right after a log: moves, drafts and research are queued; the prep note follows in its own job. */
export async function dealAutopilot(dealId: number, trigger: string | null = "log"): Promise<DoneItem[]> {
  const d = await one<{ id: number; title: string; person_id: number | null; company_id: number | null; next_action: string | null }>(
    "select id, title, person_id, company_id, next_action from sales_deals where id = $1", [dealId]);
  if (!d) return [];
  const cfg = await salesConfig();
  const items: DoneItem[] = [];
  const { refreshMoves } = await import("./moves");
  await refreshMoves(dealId).catch(() => {});

  // messages that are due, written now, so the Moves list has them ready
  if (cfg.autonomy.reply !== "suggest" && llmConfigured()) {
    const due = await q<{ id: number; title: string }>(
      "select id, title from sales_moves where deal_id = $1 and status = 'open' and draft is null order by due_at, score desc limit 2", [dealId]);
    for (const m of due) {
      await enqueue("draft_move", { id: m.id }, { dedupeKey: `draft_move:${m.id}` });
      items.push({ label: `Message being written: ${m.title}`, href: "/sales/moves" });
    }
  }
  // research what was never researched
  if (d.person_id && !(await one("select 1 from sales_people where id = $1 and enriched_at is not null", [d.person_id]))) {
    await enqueue("enrich_person", { id: d.person_id }, { dedupeKey: `enrich_person:${d.person_id}` });
    items.push({ label: "Researching the contact" });
  }
  if (d.company_id && !(await one("select 1 from sales_companies where id = $1 and enriched_at is not null", [d.company_id]))) {
    await enqueue("enrich_company", { id: d.company_id }, { dedupeKey: `enrich_company:${d.company_id}` });
    if (await one("select 1 from sales_companies where id = $1 and website is not null and audit is null", [d.company_id])) {
      await enqueue("audit_website", { id: d.company_id }, { dedupeKey: `audit:${d.company_id}` });
    }
    items.push({ label: "Researching the business and checking its website" });
  }
  // the next step is to prepare something: a prep note follows
  const kind = prepKind(d.next_action);
  if (kind && llmConfigured() && !(await one("select 1 from sales_docs where deal_id = $1 and title = $2", [dealId, prepTitle(d.next_action!)]))) {
    await enqueue("deal_prep", { deal_id: dealId }, { dedupeKey: `deal_prep:${dealId}`, runAfter: new Date(Date.now() + 45_000) });
    items.push({ label: `Writing a ${kind} prep note for: ${d.next_action}` });
  }
  await record(dealId, items, trigger);
  return items;
}

const prepTitle = (step: string) => `Prep: ${step}`.slice(0, 200);

/** Step two: the prep note for the next step, from everything known about the deal. */
export async function dealPrep(dealId: number): Promise<number | null> {
  const d = await one<{ id: number; title: string; next_action: string | null }>("select id, title, next_action from sales_deals where id = $1", [dealId]);
  const kind = prepKind(d?.next_action);
  if (!d || !kind || !llmConfigured()) return null;
  const title = prepTitle(d.next_action!);
  if (await one("select 1 from sales_docs where deal_id = $1 and title = $2", [dealId, title])) return null;
  const cfg = await salesConfig();
  const ctx = await dealContext(dealId, { interactions: 20 });
  const what = kind === "demo" ? "the demo (what to build and show, the flow screen by screen, sample data from their details)"
    : kind === "proposal" ? "the proposal (scope in their words, deliverables, phases and timeline, pricing options to fill in, assumptions)"
    : "the plan or document";
  const r = await llm([
    { role: "system", content: `You prepare the work of ${cfg.owner.name} (${cfg.owner.company}; offers: ${cfg.offers.join("; ")}) for the next step on a deal.
Write a practical prep note in plain Markdown with these sections:
## What they told us (facts from CONTEXT only, with names, details and numbers exactly as given)
## What to prepare: ${what}
## Steps, in order, with rough time for each
## Confirm with them (open questions that matter for it)
## Message to send with it (ready to paste, in the owner's voice, short, specific to them)
Rules: use only facts in CONTEXT; anything not known is written as a question or marked "assumption". Never invent prices, results, client names or tools they use. No dashes as punctuation.` },
    { role: "user", content: `NEXT STEP: ${d.next_action}\n\nCONTEXT:\n${ctx.slice(0, 12_000)}` },
  ], { maxTokens: 1800, temperature: 0.4, totalMs: 45_000 });
  const body = noDashes(r.text.replace(/^```\w*\s*|```\s*$/g, "").trim());
  if (body.length < 80) return null;
  const id = await createLinkDoc({ deal_id: dealId, title, kind: "brief", body, internal: true, category: "prep" });
  await record(dealId, [{ label: `Prep note ready: ${d.next_action}`, href: `/sales/deal/${dealId}#documents` }], "prep");
  const { push } = await import("./notify");
  const { esc } = await import("../telegram/api");
  const { baseUrl } = await import("./links");
  await push(`🤖 <b>Done for you</b> on ${esc(d.title)}: a prep note for "${esc(d.next_action!)}" is ready.`, { inline_keyboard: [[{ text: "Open the deal", url: `${baseUrl()}/sales/deal/${dealId}` }]] }).catch(() => {});
  return id;
}
