/** Carrying out a move: send (or open) on a channel, log it, close the move. Shared by the web app, Telegram and go-links. */
import { one, UserError } from "../db";
import { logInteraction, type Channel } from "./deals";
import { sendEmail } from "./google";
import { channelUrl, type GoChannel } from "./links";
import { getMove, setMoveStatus, type MoveRow } from "./moves";
import { radarToDeal } from "./radar";

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

/** The URL that opens the channel with the draft ready (no logging). */
export function openUrlFor(m: MoveRow, channel: GoChannel): string | null {
  if (m.radar_item_id && !m.deal_id && m.radar_url?.startsWith("http")) return m.radar_url;
  return channelUrl(channel, contactFor(m), m.draft ?? "", m.draft_subject ?? "");
}

/** Logs the move as done on a channel. `assumed` when you only tapped a link (we cannot see the app send it). */
export async function completeMove(moveId: number, channel: GoChannel | "other", o: { text?: string | null; assumed?: boolean; externalId?: string | null } = {}): Promise<MoveRow | null> {
  const m = await getMove(moveId);
  if (!m) return null;
  if (m.status === "open" || m.status === "snoozed") {
    const body = (o.text ?? m.draft ?? "").trim();
    // replying to a radar lead makes it a real deal, so the reply and everything after it are tracked
    const dealId = m.deal_id ?? (m.radar_item_id && channel !== "other" ? await radarToDeal(m.radar_item_id) : null);
    if (dealId && channel !== "other") {
      await logInteraction({
        deal_id: dealId, person_id: m.person_id, channel: (channel === "call" ? "call" : channel) as Channel, direction: "out",
        body: body || null, subject: m.draft_subject, summary: `${m.title}${o.assumed ? " (sent from Daybook link)" : ""}`.slice(0, 300),
        source: o.assumed ? "tap" : "daybook", confidence: o.assumed ? "assumed" : "sure", external_id: o.externalId ?? `move:${moveId}`,
        move_id: m.id, move_kind: moveKindTag(m), drafted: !!m.draft?.trim(),
        // a one-tap link opens the app with the draft; we cannot see what you changed there, so "edited" stays unknown
        edited: o.assumed ? null : m.draft?.trim() ? norm(body) !== norm(m.draft) : null,
      });
    }
    await setMoveStatus(moveId, "done");
    if (m.radar_item_id) await one("update sales_radar_items set status = 'contacted' where id = $1 and status in ('qualified','new','skipped','converted')", [m.radar_item_id]);
  }
  return getMove(moveId);
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
  await completeMove(moveId, "email", { text, externalId: sent.id ? `gmail:${sent.id}` : null });
}
