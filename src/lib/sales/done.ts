/**
 * "I did it": whatever you tick as done on a lead (a move, the next step, one of your promises) is logged on its
 * timeline, so the deal's clocks, its stage and the next moves all know. Nothing you finish disappears unrecorded.
 *
 * The channel is worked out the way you would: the button you used (WhatsApp, Gmail, a call), else what the step says
 * ("send the WhatsApp", "call Rahul", "email the quote"), else where you last talked to them. Messages and calls count
 * as you reaching out; a meeting counts as both sides talking; a step that is only work on your side (prepare the
 * deck) is a note on the timeline, not a touch. When it was the deal's next step, the next step is cleared, so it
 * never shows as still to do.
 */
import { one, q } from "../db";
import { CHANNELS, logInteraction, type Channel } from "./deals";

const TARGET: Record<string, Channel> = {
  whatsapp: "whatsapp", wa: "whatsapp", gmail: "email", mail: "email", email: "email", call: "call", tel: "call", phone: "call",
  linkedin: "linkedin", instagram: "instagram", sms: "sms", telegram: "telegram", meeting: "meeting",
};

/** The channel a step names, if it names one. Pure. */
export function channelIn(text: string | null | undefined): Channel | null {
  const t = ` ${(text ?? "").toLowerCase()} `;
  if (/whats\s?app|\bwa\b/.test(t)) return "whatsapp";
  if (/linked\s?in/.test(t)) return "linkedin";
  if (/instagram|\binsta\b/.test(t)) return "instagram";
  if (/telegram/.test(t)) return "telegram";
  if (/\bsms\b|text message/.test(t)) return "sms";
  if (/e-?mail|\bmail\b|\binbox\b/.test(t)) return "email";
  if (/\b(call|called|phone|ring|dial|spoke|speak)\b/.test(t)) return "call";
  if (/\b(meet|meeting|visit|visited|demo|presentation|in person|catch up)\b/.test(t)) return "meeting";
  return null;
}

/** Work only on your side: preparing, writing, building. Logged as a note, not as a touch. Pure. */
export function isOwnWork(text: string | null | undefined): boolean {
  const t = (text ?? "").toLowerCase();
  return /^(prepare|prep|make|create|build|draft|write|research|review|update|fix|design|plan|think|check)\b/.test(t.trim())
    && !/\b(send|share|call|email|whatsapp|message|meet|follow up|follow-up|ask|tell|remind)\b/.test(t);
}

/** How a finished step goes on the timeline: channel and direction. Pure. */
export function doneAs(what: string, o: { target?: string | null; lastChannel?: string | null } = {}): { channel: Channel; direction: "out" | "both" | "internal" } {
  const named = channelIn(what);
  const fromTarget = o.target ? TARGET[o.target.toLowerCase()] ?? null : null;
  if (!fromTarget && !named && isOwnWork(what)) return { channel: "note", direction: "internal" };
  const last = o.lastChannel && (CHANNELS as string[]).includes(o.lastChannel) && !["note", "document"].includes(o.lastChannel) ? (o.lastChannel as Channel) : null;
  const channel = fromTarget ?? named ?? last ?? "other";
  return { channel, direction: channel === "meeting" || channel === "in_person" ? "both" : "out" };
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Logs a finished step on the deal. Returns the channel it was logged on (null when there is no deal). Clears the
 * deal's next step when this was it.
 */
export async function recordDone(dealId: number | null, what: string, o: {
  target?: string | null; body?: string | null; subject?: string | null; personId?: number | null; moveId?: number | null; moveKind?: string | null;
  externalId?: string | null; source?: string; wasNextStep?: boolean;
} = {}): Promise<{ channel: Channel; direction: string } | null> {
  if (!dealId) return null;
  const last = await one<{ channel: string }>("select channel from sales_interactions where deal_id = $1 and direction in ('out','both','in') and channel not in ('note','document') order by occurred_at desc limit 1", [dealId]);
  const as = doneAs(what, { target: o.target, lastChannel: last?.channel ?? null });
  const message = as.direction === "out" && !["call", "meeting"].includes(as.channel);
  await logInteraction({
    deal_id: dealId, person_id: o.personId ?? null, channel: as.channel, direction: as.direction,
    summary: `Done: ${what}`.slice(0, 300), body: message ? (o.body?.trim() || null) : null, subject: message ? o.subject ?? null : null,
    source: o.source ?? "daybook", confidence: o.target ? "sure" : "assumed", external_id: o.externalId ?? null,
    move_id: o.moveId ?? null, move_kind: o.moveKind ?? null,
  });
  // the deal's next step was this one: it is done, so it no longer shows as to do
  const d = await one<{ next_action: string | null }>("select next_action from sales_deals where id = $1", [dealId]);
  if (d?.next_action && (o.wasNextStep || norm(d.next_action) === norm(what))) {
    await q("update sales_deals set next_action = null, next_action_at = null, updated_at = now() where id = $1", [dealId]);
  }
  return as;
}
