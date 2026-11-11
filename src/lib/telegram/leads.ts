/**
 * Leads in Telegram:
 *   /leads                      the open leads, most urgent first (tap one for its card)
 *   /lead Shah Dental           the lead's card: stage, priority, value, contact, next step, promises, latest talk
 *   /lead Shah Dental: <text>   ask about it or say what changed ("budget 2 lakh, call Friday"); changes come back
 *                               as buttons: tap to apply, tap again to undo
 *   reply to a lead card        the same, by text or voice note
 * The chat behind it is the assistant's, focused on that lead, so follow-ups keep the context (web and Telegram).
 */
import { one, q } from "../db";
import { aiConfigured } from "../ai";
import { money } from "@/components/sales/format";
import { findDeal } from "../sales/chat-focus";
import type { Ctx } from "../settings";
import { askFromTelegram } from "./assistant";
import { esc, sendMessage, type InlineMarkup } from "./api";
import { inline, urlBtn } from "./ui";

const day = (x: unknown) => (x ? new Date(String(x)).toISOString().slice(0, 10) : "");

/** "/lead Shah Dental: budget is 2 lakh" -> { who: "Shah Dental", say: "budget is 2 lakh" }. Pure. */
export function parseLeadCommand(text: string): { list: true } | { who: string; say: string | null } | { help: true } | null {
  const t = text.trim();
  if (/^\/leads(@\w+)?$/i.test(t)) return { list: true };
  const m = /^\/lead(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(t);
  if (!m) return null;
  const rest = (m[1] ?? "").trim();
  if (!rest) return { help: true };
  const cut = rest.search(/[:–—]|\s-\s/);
  if (cut < 0) return { who: rest, say: null };
  const who = rest.slice(0, cut).trim();
  const say = rest.slice(cut).replace(/^(\s-\s|[:–—])\s*/, "").trim();
  return who ? { who, say: say || null } : { help: true };
}

export async function leadCard(dealId: number): Promise<{ text: string; markup: InlineMarkup } | null> {
  const d = await one<Record<string, unknown> & { id: number; title: string }>(
    `select d.id, d.title, d.priority, d.value_amount, d.currency, d.next_action, d.next_action_at, d.summary, d.last_inbound_at, d.last_outbound_at,
            s.name as stage, p.full_name as person, p.title as person_title, p.phones, p.emails, c.name as company
     from sales_deals d join sales_stages s on s.id = d.stage_id left join sales_people p on p.id = d.person_id left join sales_companies c on c.id = d.company_id
     where d.id = $1`,
    [dealId],
  );
  if (!d) return null;
  const [promises, talk] = await Promise.all([
    q<{ owner: string; text: string; due_at: string | null }>("select owner, text, due_at from sales_commitments where deal_id = $1 and status = 'open' order by due_at nulls last limit 3", [dealId]),
    one<{ occurred_at: string; channel: string; direction: string; s: string }>("select occurred_at, channel, direction, left(coalesce(summary, body, ''), 200) as s from sales_interactions where deal_id = $1 order by occurred_at desc limit 1", [dealId]),
  ]);
  const lines = [
    `💼 <b>${esc(d.title)}</b>`,
    `${esc(String(d.stage))} · priority <b>${d.priority}</b>${d.value_amount ? ` · ${esc(money(Number(d.value_amount), String(d.currency)))}` : ""}`,
    d.person ? `👤 ${esc(String(d.person))}${d.person_title ? `, ${esc(String(d.person_title))}` : ""}${d.company ? ` · ${esc(String(d.company))}` : ""}` : "",
    (d.phones as string[] | null)?.[0] || (d.emails as string[] | null)?.[0] ? `📇 ${esc([(d.phones as string[])?.[0], (d.emails as string[])?.[0]].filter(Boolean).join(" · "))}` : "",
    d.summary ? `📝 ${esc(String(d.summary).slice(0, 300))}` : "",
    `➡️ ${d.next_action ? esc(String(d.next_action)) + (d.next_action_at ? ` (by ${day(d.next_action_at)})` : "") : "No next step set"}`,
    ...promises.map((p) => `${p.owner === "me" ? "📌 You" : "🤝 They"}: ${esc(p.text)}${p.due_at ? ` (by ${day(p.due_at)})` : ""}`),
    talk ? `💬 ${day(talk.occurred_at)} ${esc(talk.channel)} ${talk.direction === "in" ? "from them" : "from you"}: ${esc(talk.s.replace(/\s+/g, " "))}` : "💬 No conversation logged yet",
    "",
    "<i>Reply to this card (text or voice) to ask about it or say what changed.</i>",
  ].filter((x) => x !== "");
  return { text: lines.join("\n"), markup: inline([[urlBtn("Open", `/sales/deal/${dealId}`)]]) };
}

export async function leadsList(): Promise<{ text: string; markup: InlineMarkup }> {
  const rows = await q<{ id: number; title: string; priority: number; stage: string }>(
    `select d.id, d.title, d.priority, s.name as stage from sales_deals d join sales_stages s on s.id = d.stage_id
     where s.category = 'open' order by d.manual_rank nulls last, d.priority desc limit 10`,
  );
  if (!rows.length) return { text: "No open leads yet. Send <code>lead: …</code> with a chat or a screenshot to add one.", markup: inline([]) };
  return {
    text: `💼 <b>Open leads</b>, most urgent first\nTap one for its card, or send <code>/lead name: what changed</code>.`,
    markup: inline(rows.map((r) => [{ text: `${r.priority} · ${r.title.slice(0, 40)} (${r.stage})`, callback_data: `zs:lc:${r.id}` }])),
  };
}

/** Sends a lead's card and remembers it, so a reply to it talks about that lead. */
export async function sendLeadCard(chat: number, dealId: number): Promise<void> {
  const c = await leadCard(dealId);
  if (!c) {
    await sendMessage(chat, "That lead no longer exists.");
    return;
  }
  const mid = await sendMessage(chat, c.text, c.markup);
  if (mid) await q("insert into sales_tg_prompts (message_id, kind, deal_id) values ($1, 'lead_card', $2) on conflict (message_id) do update set kind = 'lead_card', deal_id = excluded.deal_id", [mid, dealId]);
}

/** The assistant chat about this lead: the recent one if there is one, else a new one. */
async function leadChat(dealId: number): Promise<number | null> {
  const r = await one<{ id: number }>("select id from assistant_chats where (focus->>'deal_id')::int = $1 and updated_at > now() - interval '12 hours' order by updated_at desc limit 1", [dealId]);
  return r?.id ?? null;
}

export async function askAboutLead(ctx: Ctx, chat: number, dealId: number, text: string): Promise<void> {
  if (!aiConfigured()) {
    await sendMessage(chat, "⚠️ Chatting about a lead needs the assistant's AI key (OPENROUTER_API_KEY) on the server.");
    return;
  }
  await askFromTelegram(ctx, chat, text, await leadChat(dealId), { deal_id: dealId });
}

/** "/leads", "/lead …": true when handled. */
type Later = (fn: () => Promise<void>) => Promise<void> | void;

export async function handleLeadCommand(ctx: Ctx, chat: number, text: string, later: Later): Promise<boolean> {
  const cmd = parseLeadCommand(text);
  if (!cmd) return false;
  if ("list" in cmd) {
    const m = await leadsList();
    await sendMessage(chat, m.text, m.markup);
    return true;
  }
  if ("help" in cmd) {
    await sendMessage(chat, LEAD_HELP);
    return true;
  }
  const d = await findDeal(cmd.who);
  if (!d) {
    await sendMessage(chat, `No lead matches “${esc(cmd.who)}”. Send /leads to see them, or <code>lead: …</code> to add one.`);
    return true;
  }
  if (!cmd.say) await sendLeadCard(chat, d.id);
  else await later(() => askAboutLead(ctx, chat, d.id, cmd.say!));
  return true;
}

/** A reply to a lead card: true when handled. */
export async function handleLeadReply(ctx: Ctx, chat: number, replyToId: number, text: string, later: Later): Promise<boolean> {
  const p = await one<{ deal_id: number }>("select deal_id from sales_tg_prompts where message_id = $1 and kind = 'lead_card'", [replyToId]);
  if (!p?.deal_id) return false;
  await later(() => askAboutLead(ctx, chat, p.deal_id, text));
  return true;
}

export const LEAD_HELP = `<b>Leads</b>
/leads — open leads, most urgent first (tap one for its card)
/lead Shah Dental — the lead's card
/lead Shah Dental: what's happening? — ask anything about it
/lead Shah Dental: budget 2 lakh, call on Friday — update it (tap the buttons to apply)
Reply to a lead card, by text or voice note, to ask or update.
<code>lead: …</code> (no slash) with a chat, email or screenshot logs a new conversation.`;
