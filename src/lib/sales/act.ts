/**
 * Carrying out a move. Opening an app or a page is never treated as sending: a move is logged as sent only when
 * Daybook itself sent it (Gmail) or you confirmed "Sent it". Shared by the web app, Telegram and go-links.
 */
import { one, UserError } from "../db";
import { CHANNELS, logInteraction, type Channel } from "./deals";
import { sendEmail } from "./google";
import { getMove, setMoveStatus, targetInput, type MoveRow } from "./moves";
import { radarToDeal } from "./radar";
import { replyTargets, type Target } from "./reply-targets";

/** "follow_up:2" for the second follow-up, else the move kind: what the message was for. */
export function moveKindTag(m: Pick<MoveRow, "kind" | "title">): string {
  const step = m.kind === "follow_up" ? m.title.match(/Follow-up (\d+)/)?.[1] : null;
  return step ? `follow_up:${step}` : m.kind;
}

/** Whitespace and case do not count as an edit. */
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export function contactFor(m: MoveRow): { phone: string | null; email: string | null; linkedin: string | null; instagram: string | null } {
  return { phone: m.phones?.[0] ?? null, email: m.emails?.[0] ?? null, linkedin: m.linkedin, instagram: m.instagram };
}

/** The honest buttons for a move (see reply-targets.ts). */
export function targetsFor(m: MoveRow, googleReady: boolean): Target[] {
  return replyTargets(targetInput(m, googleReady));
}

/** Records that you opened a channel for this move, so a later "Sent it" knows where it went. Logs nothing. */
export async function markOpened(moveId: number, targetId: string): Promise<void> {
  await one("update sales_moves set channel = $2 where id = $1", [moveId, targetId]);
}

/**
 * Closes a move.
 *   logChannel null: just done (nothing was sent, e.g. a task you did yourself).
 *   logChannel set: you confirmed you sent it there; it is logged on the deal (a radar lead becomes a deal first).
 *   assumed: the text may have been changed outside Daybook, so whether you edited the draft stays unknown.
 */
export async function completeMove(
  moveId: number,
  logChannel: string | null,
  o: { text?: string | null; where?: string | null; externalId?: string | null; assumed?: boolean } = {},
): Promise<MoveRow | null> {
  const m = await getMove(moveId);
  if (!m) return null;
  if (m.status === "open" || m.status === "snoozed") {
    if (logChannel) {
      const channel = (CHANNELS as string[]).includes(logChannel) ? (logChannel as Channel) : "other";
      const body = (o.text ?? m.draft ?? "").trim();
      const original = (m.ai_draft ?? m.draft)?.trim();
      // replying to a radar lead makes it a real deal, so the reply and everything after it are tracked
      const dealId = m.deal_id ?? (m.radar_item_id ? await radarToDeal(m.radar_item_id) : null);
      if (dealId) {
        await logInteraction({
          deal_id: dealId, person_id: m.person_id, channel, direction: "out", body: body || null, subject: m.draft_subject,
          summary: `${m.title}${o.where ? ` (sent on ${o.where})` : ""}`.slice(0, 300), source: "daybook", confidence: "sure",
          external_id: o.externalId ?? `move:${moveId}`,
          // compared with the AI's own draft (your saved edits overwrite "draft", never "ai_draft")
          move_id: m.id, move_kind: moveKindTag(m), drafted: !!original,
          edited: o.assumed ? null : original ? norm(body) !== norm(original) : null,
        });
      }
      if (m.radar_item_id) await one("update sales_radar_items set status = 'contacted' where id = $1 and status in ('qualified','new','skipped','converted')", [m.radar_item_id]);
    }
    await setMoveStatus(moveId, "done");
  }
  return getMove(moveId);
}

/** "Sent it" from Telegram or a card: logs on the channel you last opened for this move. */
export async function confirmSent(moveId: number, googleReady = false): Promise<{ where: string | null }> {
  const m = await getMove(moveId);
  if (!m) throw new UserError("That move is gone.");
  const targets = targetsFor(m, googleReady).filter((t) => t.log);
  // the channel you opened; failing that, the one the draft was written for (whatsapp, email, reddit...)
  const target =
    targets.find((t) => t.id === m.channel) ??
    targets.find((t) => (m.channel === "email" && (t.id === "gmail" || t.id === "mail")) || (t.id === "platform" && !!m.channel && !["whatsapp", "email", "linkedin", "call"].includes(m.channel)));
  // Telegram cannot see what you changed before sending, so the edit comparison stays unknown there
  await completeMove(moveId, target?.log ?? null, { where: target?.where ?? null, assumed: true });
  return { where: target?.where ?? null };
}

/** Sends the move's email from your Gmail (Apps Script) and logs it with the Gmail id. */
export async function sendMoveEmail(moveId: number, edited?: { text?: string; subject?: string }): Promise<void> {
  const m = await getMove(moveId);
  if (!m) throw new UserError("Move not found.");
  const to = m.emails?.[0];
  if (!to) throw new UserError("No email address on this contact.");
  const text = (edited?.text ?? m.draft ?? "").trim();
  if (!text) throw new UserError("Write or draft the message first.");
  const thread = m.deal_id
    ? await one<{ t: string | null }>(
        "select c.hints->>'thread_id' as t from sales_captures c where c.hints->>'thread_id' is not null and (c.hints->>'deal_id')::int = $1 order by c.id desc limit 1",
        [m.deal_id],
      )
    : null;
  const sent = await sendEmail({ to, subject: edited?.subject ?? m.draft_subject ?? `Re: ${m.deal_title ?? ""}`, body: text, threadId: thread?.t ?? null });
  await completeMove(moveId, "email", { text, where: "Gmail", externalId: sent.id ? `gmail:${sent.id}` : null });
}
