import { one, q } from "../db";
import { dueFor } from "../sections";
import { buildCtx, getSettings, isWorkingDay, type Ctx } from "../settings";
import { atLogical, fmtHM, isoDow, parseHM, periodStart, addDays } from "../time";
import { entriesForDate, getEntry } from "../services/entries";
import { cadenceToNudge, targetsBehind } from "../services/goals";
import { exerciseActiveOn, exerciseSlots, logExercise } from "../services/health";
import { getDay } from "../services/days";
import { openSegment, segmentsForDate, KIND_LABEL } from "../services/segments";
import { rolloverIfNeeded } from "../services/rollover";
import { editMessage, esc, sendMessage, telegramConfigured, type InlineMarkup } from "./api";
import {
  claim, claimScheduled, fallbackInstant, inQuietHours, markFailed, markSent, markSuppressed, sendRecapOnce,
} from "./notify";
import {
  cadenceNudge, exercisePing, inline, morningBrief, openSegmentPrompt, scoreReminder, taskAction, urlBtn, type Msg,
} from "./ui";
import { weeklyReviewMessage } from "./weekly";

const MIN = 60_000;

export interface TickReport {
  now: string;
  rollover: { ran: boolean; carried: number };
  sent: string[];
  suppressed: string[];
  failed: string[];
  errors: string[];
}

interface Candidate {
  kind: string;
  ref: string;
  at: Date;
  /** How long after `at` this is still worth sending. */
  graceMin: number;
  /** Skip the freshness window; the unique key alone guarantees once-only (mid-period target warnings). */
  noWindow?: boolean;
  build: () => Promise<Msg | null>;
}

async function ownerChat(ctx: Ctx): Promise<number | null> {
  const env = Number((process.env.TELEGRAM_OWNER_CHAT_ID ?? "").trim());
  return (Number.isFinite(env) && env !== 0 ? env : null) ?? ctx.s.telegram_chat_id;
}

/** One idempotent send: claim the notification row first, then send. */
async function dispatch(ctx: Ctx, chat: number, c: Candidate, report: TickReport): Promise<void> {
  const age = ctx.now.getTime() - c.at.getTime();
  if (age < 0) return;
  if (!c.noWindow && age > c.graceMin * MIN) return;
  const id = await claim(c.kind, c.ref, c.at);
  if (!id) return; // already sent (or in flight): a tick that runs twice never double-sends
  const label = `${c.kind}:${c.ref}`;
  try {
    if (inQuietHours(ctx)) {
      await markSuppressed(id);
      report.suppressed.push(label);
      return;
    }
    const msg = await c.build();
    if (!msg) {
      await markSuppressed(id);
      return;
    }
    const mid = await sendMessage(chat, msg.text, msg.markup);
    await markSent(id, mid);
    report.sent.push(label);
  } catch (e) {
    await markFailed(id);
    report.failed.push(label);
    report.errors.push(`${label}: ${(e as Error).message}`);
  }
}

/** Pings that were created ahead of time (snooze, retry) and are now due. */
async function dispatchScheduled(ctx: Ctx, chat: number, report: TickReport): Promise<void> {
  const due = await q<{ id: number; kind: string; ref_id: string; scheduled_for: Date }>(
    `select id, kind, ref_id, scheduled_for from notifications
     where status = 'scheduled' and scheduled_for <= $1 and scheduled_for > $2 order by scheduled_for`,
    [ctx.now, new Date(ctx.now.getTime() - 12 * 3600 * MIN)],
  );
  for (const n of due) {
    if (!(await claimScheduled(n.id))) continue;
    const label = `${n.kind}:${n.ref_id}`;
    try {
      if (inQuietHours(ctx)) {
        await markSuppressed(n.id);
        report.suppressed.push(label);
        continue;
      }
      const entry = await getEntry(Number(n.ref_id));
      if (!entry || entry.task_state !== "active" || ["done", "dropped"].includes(entry.status)) {
        await markSuppressed(n.id);
        continue;
      }
      const m = taskAction(ctx, entry, n.kind === "task_retry" ? "📞 Retry: " : "⏰ Reminder: ");
      const mid = await sendMessage(chat, m.text, m.markup);
      await markSent(n.id, mid);
      report.sent.push(label);
    } catch (e) {
      await markFailed(n.id);
      report.failed.push(label);
      report.errors.push(`${label}: ${(e as Error).message}`);
    }
  }
}

/**
 * A ping that gets no answer before the next one is edited to "Missed" and logged as missed, so pings
 * never stack up (PRD 9.3). Looks at today and yesterday's slots whose next slot time has passed.
 */
async function resolveMissedExercise(ctx: Ctx): Promise<void> {
  for (const date of [addDays(ctx.today, -1), ctx.today]) {
    for (const slot of exerciseSlots(ctx, date)) {
      const next = slot.getTime() + ctx.s.exercise_interval_min * MIN;
      if (next > ctx.now.getTime()) continue;
      const sent = await one<{ telegram_message_id: number | null }>(
        "select telegram_message_id from notifications where kind = 'exercise' and ref_id = $1 and scheduled_for = $2 and status = 'sent'",
        [date, slot],
      );
      if (!sent) continue;
      const logged = await one("select 1 from exercise_logs where slot_at = $1", [slot]);
      if (logged) continue;
      await logExercise(ctx, slot, "missed", null, null, sent.telegram_message_id);
      const chat = await ownerChat(ctx);
      if (chat && sent.telegram_message_id) {
        await editMessage(chat, sent.telegram_message_id, `💪 ${fmtHM(slot, ctx.tz)} exercise: Missed.`).catch(() => {});
      }
    }
  }
}

function candidates(ctx: Ctx, work: {
  entries: Awaited<ReturnType<typeof entriesForDate>>;
  hasSegments: boolean;
  closed: boolean;
}): Candidate[] {
  const out: Candidate[] = [];
  const today = ctx.today;
  const at = (hm: string) => atLogical(today, parseHM(hm), ctx.tz, ctx.boundaryMin);

  // 08:00 morning brief
  out.push({
    kind: "morning_brief", ref: today, at: at(ctx.s.morning_brief), graceMin: 240,
    build: () => morningBrief(ctx),
  });

  // Timed tasks: first reminder N minutes before, second and final at the task time if still open
  for (const e of work.entries) {
    if (e.status !== "open" || e.task_state !== "active") continue;
    const due = dueFor(e, ctx.tz, ctx.boundaryMin);
    if (!due) continue;
    const lead = e.lead_min ?? ctx.s.task_lead_min;
    const fresh = async (prefix: string): Promise<Msg | null> => {
      const now = await getEntry(e.id);
      if (!now || now.status !== "open") return null; // resolved in the meantime
      return taskAction(ctx, now, prefix);
    };
    if (lead > 0) {
      out.push({
        kind: "task_remind1", ref: String(e.id), at: new Date(due.getTime() - lead * MIN), graceMin: 10,
        build: () => fresh(`⏰ In ${lead} min: `),
      });
    }
    out.push({
      kind: "task_remind2", ref: String(e.id), at: due, graceMin: 10,
      build: () => fresh("⏰ Now: "),
    });
  }

  // Exercise pings 09:30 to 20:30 every 30 minutes (working days, unless paused)
  if (exerciseActiveOn(ctx, today)) {
    for (const slot of exerciseSlots(ctx, today)) {
      out.push({
        kind: "exercise", ref: today, at: slot, graceMin: 10,
        build: () => exercisePing(ctx, slot),
      });
    }
  }

  // Recap fallback if Day end was not tapped, then the score reminder and the open segment check
  if (isWorkingDay(ctx, today) || work.hasSegments) {
    if (!work.closed) {
      out.push({
        kind: "recap", ref: today, at: fallbackInstant(ctx, today), graceMin: 120,
        build: async () => null, // handled specially below: needs sendRecapOnce
      });
    }
    out.push({
      kind: "score_reminder", ref: today, at: at(ctx.s.score_reminder), graceMin: 120,
      build: () => scoreReminder(ctx, today),
    });
  }
  out.push({
    kind: "open_segment", ref: today, at: at(ctx.s.open_segment_check), graceMin: 60,
    build: async () => {
      const open = await openSegment();
      if (!open || open.kind === "break") return null;
      return openSegmentPrompt(ctx, open.start_at, KIND_LABEL[open.kind]);
    },
  });

  // Sunday 10:00 weekly review
  if (isoDow(today) === ctx.s.weekly_review_day) {
    out.push({
      kind: "weekly_review", ref: today, at: at(ctx.s.weekly_review_time), graceMin: 360,
      build: () => weeklyReviewMessage(ctx),
    });
  }
  return out;
}

export async function runTick(now: Date = new Date(), opts: { touchLastTick?: boolean } = {}): Promise<TickReport> {
  const s = await getSettings();
  const ctx = buildCtx(s, now);
  const report: TickReport = { now: now.toISOString(), rollover: { ran: false, carried: 0 }, sent: [], suppressed: [], failed: [], errors: [] };
  const guard = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      report.errors.push(`${name}: ${(e as Error).message}`);
    }
  };

  await guard("rollover", async () => {
    const r = await rolloverIfNeeded(ctx);
    report.rollover = { ran: r.ran, carried: r.carried };
  });

  const chat = telegramConfigured() ? await ownerChat(ctx) : null;
  if (chat) {
    await guard("missed-exercise", () => resolveMissedExercise(ctx));

    const entries = await entriesForDate(ctx.today);
    const segs = await segmentsForDate(ctx, ctx.today);
    const day = await getDay(ctx.today);
    const cands = candidates(ctx, {
      entries,
      hasSegments: segs.length > 0,
      closed: !!day?.closed_at,
    });

    // Cadence nudges (11:00): one per overdue, unsnoozed item, once per day
    await guard("cadence-candidates", async () => {
      const nudgeAt = atLogical(ctx.today, parseHM(ctx.s.cadence_nudge), ctx.tz, ctx.boundaryMin);
      for (const c of await cadenceToNudge(ctx)) {
        cands.push({ kind: "cadence_nudge", ref: String(c.task.id), at: nudgeAt, graceMin: 180, build: () => cadenceNudge(ctx, c.task.id) });
      }
      // Mid-period target warning: at most once per target per period
      for (const b of await targetsBehind(ctx)) {
        if (b.elapsed < 0.5) continue;
        const key = atLogical(periodStart(b.start, b.task.target_period ?? "week"), parseHM(ctx.s.cadence_nudge), ctx.tz, ctx.boundaryMin);
        cands.push({
          kind: "target_behind", ref: String(b.task.id), at: key, graceMin: 0, noWindow: true,
          build: async () => ({
            text: `🎯 <b>${esc(b.task.title)}</b> is behind pace with ${b.daysLeft} day${b.daysLeft === 1 ? "" : "s"} left.`,
            markup: inline([[urlBtn("Open Goals", "/goals")]]),
          }),
        });
      }
    });

    for (const c of cands) {
      await guard(`${c.kind}:${c.ref}`, async () => {
        if (c.kind === "recap") {
          // The recap shares its key with the Day end button, so it can only ever go out once.
          const age = ctx.now.getTime() - c.at.getTime();
          if (age < 0 || age > c.graceMin * MIN) return;
          if (inQuietHours(ctx)) return;
          const r = await sendRecapOnce(ctx, chat, ctx.today);
          if (r.sent) report.sent.push(`recap:${ctx.today}`);
          return;
        }
        await dispatch(ctx, chat, c, report);
      });
    }
    await guard("scheduled", () => dispatchScheduled(ctx, chat, report));
  }

  await guard("housekeeping", async () => {
    await q("delete from tg_updates where received_at < now() - interval '3 days'");
    await q("delete from pending_adds where created_at < now() - interval '2 days'");
  });

  if (opts.touchLastTick !== false) {
    await q("update settings set last_tick_at = now() where id = 1");
  }
  return report;
}

export type { InlineMarkup };
