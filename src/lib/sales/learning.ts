/**
 * What works: reply rates of your messages by purpose, channel, time of day, length and draft use, and the real
 * messages of yours that got replies (the drafts copy those). The maths lives in learning-calc.ts.
 */
import { one, q } from "../db";
import { zonedParts } from "../time";
import {
  attributeReplies, bucketize, DRAFT_LABEL, draftUse, findings, LENGTH_LABEL, lengthBand, purposeLabel, TIME_LABEL, timeBand,
  type Bucket, type Send, type Touch,
} from "./learning-calc";

/** Channels where a message expects a written reply. Calls, meetings, notes and documents are not "messages". */
export const MESSAGE_CHANNELS = ["whatsapp", "email", "linkedin", "instagram", "sms", "twitter", "telegram"];

export async function ownerTz(): Promise<string> {
  const r = await one<{ timezone: string | null }>("select timezone from settings where id = 1").catch(() => null);
  return r?.timezone || "Asia/Kolkata";
}

/**
 * Every touch on deals that had a message in the window. Inbound of any channel counts as a response (they can answer
 * a WhatsApp on a call), but only messages on MESSAGE_CHANNELS count as sends.
 */
export async function loadSends(days: number, now = Date.now()): Promise<Send[]> {
  const rows = await q<{ id: number; deal_id: number; at: string; direction: "in" | "out" | "both"; channel: string; move_kind: string | null; drafted: boolean | null; edited: boolean | null; body: string | null; confidence: string }>(
    `select i.id, i.deal_id, i.occurred_at as at, i.direction, i.channel, i.move_kind, i.drafted, i.edited, i.body, i.confidence
     from sales_interactions i
     where i.deal_id is not null and i.direction in ('in','out','both') and i.channel <> 'note'
       and i.occurred_at > $1::timestamptz - interval '14 days'
       and (i.direction <> 'out' or i.channel = any($2))`,
    [new Date(now - days * 86_400_000).toISOString(), MESSAGE_CHANNELS],
  );
  const touches: Touch[] = rows.map((r) => ({ ...r, at: new Date(r.at).getTime(), dir: r.direction }));
  const since = now - days * 86_400_000;
  return attributeReplies(touches, now).filter((s) => s.at >= since);
}

export interface MessagePerformance {
  days: number;
  sent: number;
  decided: number;
  replied: number;
  pending: number;
  rate: number | null;
  by_purpose: Bucket[];
  by_channel: Bucket[];
  by_time: Bucket[];
  by_weekday: Bucket[];
  by_length: Bucket[];
  by_draft: Bucket[];
  findings: string[];
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export async function messagePerformance(days = 90, now = Date.now()): Promise<MessagePerformance> {
  const tz = await ownerTz();
  const sends = await loadSends(days, now);
  const decided = sends.filter((s) => !s.pending);
  const replied = decided.filter((s) => s.replied).length;
  const hourOf = (s: Send) => zonedParts(s.at, tz).h;
  // the owner's weekday, not the server's
  const localDow = (s: Send) => {
    const p = zonedParts(s.at, tz);
    return (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7;
  };
  const by_purpose = bucketize(sends, (s) => s.move_kind ?? "manual", purposeLabel);
  const by_channel = bucketize(sends, (s) => s.channel, (k) => k.charAt(0).toUpperCase() + k.slice(1));
  const by_time = bucketize(sends, (s) => timeBand(hourOf(s)), (k) => TIME_LABEL[k], ["morning", "afternoon", "evening", "night"]);
  const by_weekday = bucketize(sends, (s) => String(localDow(s)), (k) => WEEKDAYS[Number(k)], ["0", "1", "2", "3", "4", "5", "6"]);
  const by_length = bucketize(sends, lengthBand, (k) => LENGTH_LABEL[k], ["short", "medium", "long"]);
  const by_draft = bucketize(sends, draftUse, (k) => DRAFT_LABEL[k], ["as_is", "edited", "own"]);
  return {
    days, sent: sends.length, decided: decided.length, replied, pending: sends.length - decided.length,
    rate: decided.length ? Math.round((replied / decided.length) * 100) : null,
    by_purpose, by_channel, by_time, by_weekday, by_length, by_draft,
    findings: findings([
      { name: "Purpose", rows: by_purpose }, { name: "Channel", rows: by_channel }, { name: "Time of day", rows: by_time },
      { name: "Length", rows: by_length }, { name: "Drafts", rows: by_draft },
    ]),
  };
}

/**
 * Your real messages that got replies, best match first: same purpose and channel, then same purpose, then same
 * channel, then the most recent. Only messages you are sure went out (not one-tap guesses).
 */
export async function winningMessages(o: { kind?: string | null; channel?: string | null; limit?: number } = {}, now = Date.now()): Promise<string[]> {
  const sends = (await loadSends(365, now)).filter((s) => s.replied && s.confidence === "sure" && s.body && s.body.length >= 25 && s.body.length <= 900);
  const kind = o.kind?.split(":")[0] ?? null;
  const rank = (s: Send) => (kind && s.move_kind?.split(":")[0] === kind ? 2 : 0) + (o.channel && s.channel === o.channel ? 1 : 0);
  const seen = new Set<string>();
  return sends
    .sort((a, b) => rank(b) - rank(a) || b.at - a.at)
    .map((s) => s.body!.trim())
    .filter((b) => (seen.has(b) ? false : (seen.add(b), true)))
    .slice(0, o.limit ?? 5);
}
