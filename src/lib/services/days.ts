import { one, q, UserError, type Db, getPool } from "../db";
import { type Ctx, isWorkingDay, windowOf } from "../settings";
import { type DateStr, addDays, dateRange } from "../time";
import type { EntryStatus } from "../types";
import { dayTimeSummary } from "./segments";

export interface DayRow {
  date: DateStr;
  score: number | null;
  steps: number | null;
  worked_minutes_override: number | null;
  sleep_minutes: number | null;
  sleep_quality: number | null;
  planned_at: Date | null;
  closed_at: Date | null;
  rollover_at: Date | null;
}

export async function getDay(date: DateStr, db: Db = getPool()): Promise<DayRow | null> {
  return one<DayRow>("select * from days where date = $1", [date], db);
}

export async function setWorkedOverride(date: DateStr, minutes: number | null): Promise<void> {
  if (minutes !== null && (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440)) {
    throw new UserError("Hours must be between 0 and 24.");
  }
  await q(
    `insert into days (date, worked_minutes_override) values ($1, $2)
     on conflict (date) do update set worked_minutes_override = excluded.worked_minutes_override`,
    [date, minutes],
  );
}

export async function setScore(date: DateStr, score: number | null): Promise<void> {
  if (score !== null) {
    if (!Number.isFinite(score) || score < 0 || score > 10) throw new UserError("Score must be between 0 and 10.");
    score = Math.round(score * 10) / 10;
  }
  await q(
    `insert into days (date, score) values ($1, $2)
     on conflict (date) do update set score = excluded.score`,
    [date, score],
  );
}

/** Sleep that led into this day. Pass null minutes to clear; quality 1-5 is optional. */
export async function setSleep(date: DateStr, minutes: number | null, quality?: number | null): Promise<void> {
  if (minutes !== null && (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440)) {
    throw new UserError("Sleep must be between 0 and 24 hours.");
  }
  if (quality !== undefined && quality !== null && (!Number.isInteger(quality) || quality < 1 || quality > 5)) {
    throw new UserError("Sleep quality is 1 to 5.");
  }
  const m = minutes === null ? null : Math.round(minutes);
  if (quality === undefined) {
    await q(
      `insert into days (date, sleep_minutes) values ($1, $2)
       on conflict (date) do update set sleep_minutes = excluded.sleep_minutes`,
      [date, m],
    );
  } else {
    await q(
      `insert into days (date, sleep_minutes, sleep_quality) values ($1, $2, $3)
       on conflict (date) do update set sleep_minutes = excluded.sleep_minutes, sleep_quality = excluded.sleep_quality`,
      [date, m, quality],
    );
  }
}

export async function setSteps(date: DateStr, steps: number | null): Promise<void> {
  if (steps !== null && (!Number.isInteger(steps) || steps < 0 || steps > 200000)) {
    throw new UserError("Steps must be a whole number between 0 and 200,000.");
  }
  await q(
    `insert into days (date, steps) values ($1, $2)
     on conflict (date) do update set steps = excluded.steps`,
    [date, steps],
  );
}

export interface Recap {
  date: DateStr;
  worked: number;
  logged: number;
  unaccountedMin: number;
  unaccountedPct: number;
  counts: Record<EntryStatus, number>;
  mustDoTotal: number;
  mustDoHit: number;
  score: number | null;
  steps: number | null;
}

export async function recapFor(ctx: Ctx, date: DateStr, db: Db = getPool()): Promise<Recap> {
  const t = await dayTimeSummary(ctx, date, db);
  const counts: Record<EntryStatus, number> = { open: 0, done: 0, progressed: 0, attempted: 0, skipped: 0, dropped: 0, waiting: 0 };
  const rows = await q<{ status: EntryStatus; n: number }>(
    "select status, count(*)::int as n from day_entries where date = $1 group by status",
    [date],
    db,
  );
  for (const r of rows) counts[r.status] = r.n;
  const md = await one<{ total: number; hit: number }>(
    `select count(*)::int as total,
            count(*) filter (where status in ('done','progressed'))::int as hit
     from day_entries where date = $1 and must_do and status not in ('dropped','waiting')`,
    [date],
    db,
  );
  const day = await getDay(date, db);
  return {
    date,
    worked: t.worked,
    logged: t.logged,
    unaccountedMin: t.minutes,
    unaccountedPct: t.pct,
    counts,
    mustDoTotal: md!.total,
    mustDoHit: md!.hit,
    score: day?.score ?? null,
    steps: day?.steps ?? null,
  };
}

/** Marks the plan for `date` as finished; the earliest completion time wins. */
export async function markPlanned(ctx: Ctx, date: DateStr, db: Db = getPool()): Promise<void> {
  await q(
    `insert into days (date, planned_at) values ($1, $2)
     on conflict (date) do update set planned_at = coalesce(days.planned_at, excluded.planned_at)`,
    [date, ctx.now],
    db,
  );
}

/** A day counts as planned only if the plan was finished before that day's boundary. */
export function wasPlannedInTime(ctx: Ctx, date: DateStr, plannedAt: Date | null): boolean {
  return !!plannedAt && plannedAt.getTime() < windowOf(ctx, date).start.getTime();
}

/**
 * Planning streak: consecutive days whose plan was finished before that day's boundary. Planning tomorrow counts
 * straight away. A day that was planned too late (or not at all) breaks the streak.
 */
export async function planningStreak(ctx: Ctx, db: Db = getPool()): Promise<number> {
  const from = addDays(ctx.today, -400);
  const tomorrow = addDays(ctx.today, 1);
  const rows = await q<{ date: DateStr; planned_at: Date | null }>(
    "select date, planned_at from days where date >= $1 and date <= $2",
    [from, tomorrow],
    db,
  );
  const map = new Map(rows.map((r) => [r.date, r.planned_at]));
  const ok = (d: DateStr) => wasPlannedInTime(ctx, d, map.get(d) ?? null);
  let d = ok(tomorrow) ? tomorrow : ctx.today;
  let n = 0;
  while (ok(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/** Consecutive days where every must-do was Done or Progressed. Non-working days without must-dos are skipped. */
export async function mustDoStreak(ctx: Ctx, db: Db = getPool()): Promise<number> {
  const from = addDays(ctx.today, -400);
  const rows = await q<{ date: DateStr; total: number; hit: number }>(
    `select date, count(*)::int as total, count(*) filter (where status in ('done','progressed'))::int as hit
     from day_entries where must_do and status not in ('dropped','waiting') and date >= $1 and date < $2 group by date`,
    [from, ctx.today],
    db,
  );
  const map = new Map(rows.map((r) => [r.date, r]));
  let n = 0;
  for (let d = addDays(ctx.today, -1); d >= from; d = addDays(d, -1)) {
    const r = map.get(d);
    if (!r) {
      if (isWorkingDay(ctx, d)) break;
      continue;
    }
    if (r.hit !== r.total) break;
    n++;
  }
  return n;
}

export async function daysInRange(from: DateStr, to: DateStr, db: Db = getPool()): Promise<Map<DateStr, DayRow>> {
  const rows = await q<DayRow>("select * from days where date >= $1 and date <= $2", [from, to], db);
  const map = new Map<DateStr, DayRow>();
  for (const r of rows) map.set(r.date, r);
  for (const d of dateRange(from, to)) if (!map.has(d)) map.set(d, { date: d, score: null, steps: null, worked_minutes_override: null, sleep_minutes: null, sleep_quality: null, planned_at: null, closed_at: null, rollover_at: null });
  return map;
}
