/**
 * Pure maths behind "what works": which of your messages got a reply, and how fast. No database here, so it is
 * tested directly and shared by Insights, the drafts and the weekly review.
 *
 * Rules (stated once, used everywhere):
 * - A "send" is one outbound message. Outbound messages on the same deal less than 30 minutes apart with nothing from
 *   them in between are one send (a WhatsApp export re-logging what a one-tap link already logged, or a message split
 *   in two). The send keeps the move it came from if any part has one.
 * - A send is "replied" when they write (or a meeting/call with them is logged) after it and before your next send,
 *   within 14 days.
 * - A send with no reply yet that is under 3 days old is "pending": it is left out of every rate until it has had a
 *   fair chance.
 */

export const MERGE_MS = 30 * 60_000;
export const REPLY_WINDOW_MS = 14 * 86_400_000;
export const PENDING_MS = 3 * 86_400_000;
/** below this many sends a rate is shown but never called a winner */
export const MIN_SAMPLE = 5;

export interface Touch {
  id: number;
  deal_id: number;
  at: number;
  dir: "in" | "out" | "both";
  channel: string;
  move_kind: string | null;
  drafted: boolean | null;
  edited: boolean | null;
  body: string | null;
  confidence: string;
}

export interface Send {
  id: number;
  deal_id: number;
  at: number;
  channel: string;
  move_kind: string | null;
  drafted: boolean | null;
  edited: boolean | null;
  body: string | null;
  confidence: string;
  replied: boolean;
  pending: boolean;
  reply_ms: number | null;
}

/** Turns every deal's touches into sends with their outcome. `touches` may be in any order. */
export function attributeReplies(touches: Touch[], now: number): Send[] {
  const byDeal = new Map<number, Touch[]>();
  for (const t of touches) {
    const list = byDeal.get(t.deal_id) ?? [];
    list.push(t);
    byDeal.set(t.deal_id, list);
  }
  const out: Send[] = [];
  for (const list of byDeal.values()) {
    list.sort((a, b) => a.at - b.at || a.id - b.id);
    // 1. merge outbound bursts into sends
    const sends: Send[] = [];
    let last: Send | null = null;
    let inboundSinceLast = false;
    for (const t of list) {
      if (t.dir !== "out") {
        inboundSinceLast = true;
        continue;
      }
      if (last && !inboundSinceLast && t.at - last.at < MERGE_MS) {
        if (!last.move_kind && t.move_kind) Object.assign(last, { id: t.id, move_kind: t.move_kind, drafted: t.drafted, edited: t.edited, body: t.body ?? last.body, channel: t.channel, confidence: t.confidence });
        continue;
      }
      last = { id: t.id, deal_id: t.deal_id, at: t.at, channel: t.channel, move_kind: t.move_kind, drafted: t.drafted, edited: t.edited, body: t.body, confidence: t.confidence, replied: false, pending: false, reply_ms: null };
      sends.push(last);
      inboundSinceLast = false;
    }
    // 2. outcome of each send
    const inbound = list.filter((t) => t.dir !== "out");
    sends.forEach((s, i) => {
      const end = Math.min(sends[i + 1]?.at ?? Infinity, s.at + REPLY_WINDOW_MS);
      const reply = inbound.find((t) => t.at > s.at && t.at <= end);
      if (reply) {
        s.replied = true;
        s.reply_ms = reply.at - s.at;
      } else if (now - s.at < PENDING_MS && !sends[i + 1]) {
        s.pending = true;
      }
    });
    out.push(...sends);
  }
  return out.sort((a, b) => b.at - a.at);
}

export interface Bucket {
  key: string;
  label: string;
  sent: number;
  replied: number;
  /** percent, or null when nothing has been decided yet */
  rate: number | null;
  /** median hours to their reply, among sends that got one */
  median_reply_h: number | null;
  /** too few sends to call it */
  thin: boolean;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Groups decided sends (not pending) by a key and works out the reply rate of each group. */
export function bucketize(sends: Send[], keyOf: (s: Send) => string | null, labelOf: (k: string) => string, order?: string[]): Bucket[] {
  const groups = new Map<string, Send[]>();
  for (const s of sends) {
    if (s.pending) continue;
    const k = keyOf(s);
    if (k === null) continue;
    const g = groups.get(k) ?? [];
    g.push(s);
    groups.set(k, g);
  }
  const rows = [...groups.entries()].map(([key, g]) => {
    const replied = g.filter((s) => s.replied);
    const med = median(replied.map((s) => s.reply_ms!));
    return {
      key, label: labelOf(key), sent: g.length, replied: replied.length,
      rate: g.length ? Math.round((replied.length / g.length) * 100) : null,
      median_reply_h: med === null ? null : Math.round((med / 3_600_000) * 10) / 10,
      thin: g.length < MIN_SAMPLE,
    };
  });
  if (order) return rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return rows.sort((a, b) => b.sent - a.sent);
}

/** Purpose labels for the move kinds a message can come from. */
export function purposeLabel(k: string): string {
  if (k === "manual") return "Written outside a move";
  const [kind, step] = k.split(":");
  const L: Record<string, string> = {
    first_touch: "First message", follow_up: "Follow-up", breakup: "Last follow-up", reengage: "Re-engage", reply: "Reply to them",
    radar: "Reply to a radar lead", quote_unseen: "Quote not opened", quote_silent: "Quote read, no reply", quote_hot: "Hot quote",
    commit_mine: "Your promise", commit_theirs: "Nudge on their promise", payment_due: "Payment reminder", referral_ask: "Referral ask",
    resurrect: "Revisit", stale: "Stuck deal", next_action: "Next step", debrief: "Meeting recap", custom: "Your own move",
    checkin: "Client check-in", upsell: "Upsell", retainer: "Retainer offer",
  };
  return step ? `${L[kind] ?? kind} ${step}` : L[kind] ?? kind;
}

export function draftUse(s: Send): string | null {
  if (s.drafted === null) return null;
  if (!s.drafted) return "own";
  if (s.edited === null) return null;
  return s.edited ? "edited" : "as_is";
}
export const DRAFT_LABEL: Record<string, string> = { as_is: "AI draft sent as is", edited: "AI draft, edited by you", own: "Written by you" };

export function lengthBand(s: Send): string | null {
  if (!s.body?.trim()) return null;
  const w = s.body.trim().split(/\s+/).length;
  return w < 25 ? "short" : w <= 60 ? "medium" : "long";
}
export const LENGTH_LABEL: Record<string, string> = { short: "Short (under 25 words)", medium: "Medium (25 to 60)", long: "Long (over 60)" };

export function timeBand(hour: number): string {
  return hour < 6 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "night";
}
export const TIME_LABEL: Record<string, string> = { morning: "Morning (6 to 12)", afternoon: "Afternoon (12 to 5)", evening: "Evening (5 to 10)", night: "Night (10 to 6)" };

/**
 * Plain-language findings, only where the data supports them: a group must have at least MIN_SAMPLE decided sends and
 * beat the next best by 10 points or more. Otherwise nothing is claimed.
 */
export function findings(groups: { name: string; rows: Bucket[] }[]): string[] {
  const out: string[] = [];
  for (const g of groups) {
    const solid = g.rows.filter((r) => !r.thin && r.rate !== null).sort((a, b) => b.rate! - a.rate!);
    if (solid.length < 2) continue;
    const [best, next] = solid;
    const worst = solid[solid.length - 1];
    if (best.rate! - next.rate! >= 10) out.push(`${g.name}: "${best.label}" gets replies ${best.rate}% of the time (${best.replied} of ${best.sent}), against ${next.rate}% for "${next.label}".`);
    else if (best.rate! - worst.rate! >= 15) out.push(`${g.name}: "${best.label}" (${best.rate}%) clearly beats "${worst.label}" (${worst.rate}%).`);
  }
  return out;
}
