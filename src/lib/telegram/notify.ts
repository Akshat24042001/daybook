import { one, q } from "../db";
import type { Ctx } from "../settings";
import { atLogical, parseHM, zonedParts, type DateStr } from "../time";
import { sendMessage } from "./api";
import { recapMessage, type Msg } from "./ui";

/**
 * Idempotent sending (PRD section 10): a notifications row with a unique key
 * (kind, ref_id, scheduled_for) is inserted BEFORE anything is sent, so a tick that runs twice
 * (or two ticks that overlap) can never double-send. A failed send may be retried up to 3 times.
 */
export async function claim(kind: string, ref: string, scheduledFor: Date): Promise<number | null> {
  const row = await one<{ id: number }>(
    `insert into notifications (kind, ref_id, scheduled_for, status, attempts)
     values ($1, $2, $3, 'pending', 1)
     on conflict (kind, ref_id, scheduled_for) do update
       set status = 'pending', attempts = notifications.attempts + 1
       where notifications.status = 'failed' and notifications.attempts < 3
     returning id`,
    [kind, ref, scheduledFor],
  );
  return row?.id ?? null;
}

/** Claims a row that was scheduled ahead of time (snooze / retry pings). */
export async function claimScheduled(id: number): Promise<boolean> {
  const row = await one<{ id: number }>(
    "update notifications set status = 'pending', attempts = attempts + 1 where id = $1 and status = 'scheduled' returning id",
    [id],
  );
  return !!row;
}

export async function markSent(id: number, messageId: number | null): Promise<void> {
  await q("update notifications set status = 'sent', sent_at = now(), telegram_message_id = $2 where id = $1", [id, messageId]);
}
export async function markFailed(id: number): Promise<void> {
  await q("update notifications set status = 'failed' where id = $1", [id]);
}
export async function markSuppressed(id: number): Promise<void> {
  await q("update notifications set status = 'suppressed' where id = $1", [id]);
}

/** Quiet hours (default 22:45 to 07:45): nothing is sent, wrapping midnight. */
export function inQuietHours(ctx: Ctx, at: Date = ctx.now): boolean {
  const p = zonedParts(at, ctx.tz);
  const m = p.h * 60 + p.mi;
  const from = parseHM(ctx.s.quiet_start);
  const to = parseHM(ctx.s.quiet_end);
  return from <= to ? m >= from && m < to : m >= from || m < to;
}

export function fallbackInstant(ctx: Ctx, date: DateStr): Date {
  return atLogical(date, parseHM(ctx.s.evening_fallback), ctx.tz, ctx.boundaryMin);
}

/**
 * Sends the day recap once per day. Shared by the Day end button and the 20:45 fallback: both use the
 * same notification key, so whichever comes second finds it already claimed.
 */
export async function sendRecapOnce(ctx: Ctx, chatId: number, date: DateStr): Promise<{ sent: boolean; messageId?: number }> {
  const id = await claim("recap", date, fallbackInstant(ctx, date));
  if (!id) return { sent: false };
  try {
    const msg: Msg = await recapMessage(ctx, date);
    const mid = await sendMessage(chatId, msg.text, msg.markup);
    await markSent(id, mid);
    return { sent: true, messageId: mid };
  } catch (e) {
    await markFailed(id);
    throw e;
  }
}
