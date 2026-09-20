import { one, q, tx } from "../db";
import { type Ctx } from "../settings";
import { type DateStr, addDays, periodEnd } from "../time";
import type { EntryView } from "../types";
import { addEntry } from "./entries";
import { materializeDay, unresolvedEntries } from "./plan";

export interface RolloverResult {
  ran: boolean;
  carried: number;
  materialized: number;
  targetsClosed: number;
}

/**
 * Day rollover (PRD section 14), run by the tick once per day after the boundary:
 * - every unresolved entry that was not triaged gets an entry today (source = auto,
 *   carried_from set, carry_count + 1 for untouched ones) so it shows up flagged in the brief;
 * - Ongoing tasks get entries on working days, Recurring tasks are expanded from their rule;
 * - targets whose period ended are closed (done if the goal was met, dropped if not).
 * Idempotent: guarded by days.rollover_at.
 */
export async function rolloverIfNeeded(ctx: Ctx): Promise<RolloverResult> {
  const today = ctx.today;
  const day = await one<{ rollover_at: Date | null }>("select rollover_at from days where date = $1", [today]);
  if (day?.rollover_at) return { ran: false, carried: 0, materialized: 0, targetsClosed: 0 };

  return tx(async (db) => {
    // Claim the rollover; a concurrent tick loses here.
    const claim = await one<{ date: DateStr }>(
      `insert into days (date, rollover_at) values ($1, $2)
       on conflict (date) do update set rollover_at = excluded.rollover_at
       where days.rollover_at is null
       returning date`,
      [today, ctx.now],
      db,
    );
    if (!claim) return { ran: false, carried: 0, materialized: 0, targetsClosed: 0 };

    const stale: EntryView[] = await unresolvedEntries(today, db);
    let carried = 0;
    for (const e of stale) {
      await addEntry(ctx, e.task_id, today, { source: "auto", carriedFrom: e.date }, db);
      if (e.status === "open") await db.query("update tasks set carry_count = carry_count + 1 where id = $1", [e.task_id]);
      carried++;
    }
    const materialized = await materializeDay(ctx, today, { cadence: false }, db);

    // Close targets whose period has ended.
    const closed = await q<{ id: number; goal_min: number | null; goal_count: number | null; period_start: DateStr; target_period: string }>(
      `select id, goal_min, goal_count, period_start, target_period from tasks
       where type = 'target' and state = 'active' and period_start is not null`,
      [],
      db,
    );
    let targetsClosed = 0;
    for (const t of closed) {
      const end = periodEnd(t.period_start, t.target_period as "week" | "month" | "quarter");
      if (end >= today) continue;
      const m = await one<{ minutes: number }>(
        "select coalesce(sum(minutes),0)::int as minutes from time_logs where task_id = $1 and date between $2 and $3",
        [t.id, t.period_start, end],
        db,
      );
      const c = await one<{ n: number }>(
        "select count(*)::int as n from day_entries where task_id = $1 and date between $2 and $3 and status in ('done','progressed')",
        [t.id, t.period_start, end],
        db,
      );
      const hasGoal = !!(t.goal_min || t.goal_count);
      const met = hasGoal && (!t.goal_min || m!.minutes >= t.goal_min) && (!t.goal_count || c!.n >= t.goal_count);
      await db.query("update tasks set state = $2, closed_at = $3 where id = $1", [t.id, met ? "done" : "dropped", ctx.now]);
      targetsClosed++;
    }
    return { ran: true, carried, materialized, targetsClosed };
  });
}

export function yesterdayOf(ctx: Ctx): DateStr {
  return addDays(ctx.today, -1);
}
