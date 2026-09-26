import { one, q, tx, UserError, type Db, getPool } from "../db";
import { rruleMatches } from "../recurrence";
import { type Ctx, isWorkingDay } from "../settings";
import { type DateStr, addDays, logicalDate } from "../time";
import type { EntryView, TaskRow } from "../types";
import { addEntry, entriesForDate, setEntryStatus, VIEW_SELECT } from "./entries";
import { listCadence, listSomeday, targetsBehind, type TargetProgress } from "./goals";
import { getDay, markPlanned } from "./days";
import { makeSomeday } from "./tasks";

/**
 * Unresolved = the latest entry of an active task is open, skipped, attempted (or progressed, for one-offs) and is
 * older than `before`. "Latest entry" means: once a task has an entry on a later date it
 * counts as triaged (carried, dated, or auto-carried).
 */
export async function unresolvedEntries(before: DateStr, db: Db = getPool()): Promise<EntryView[]> {
  return q<EntryView>(
    `${VIEW_SELECT}
     where e.date < $1
       and (e.status in ('open','skipped','attempted')
            -- progressed one-offs come back too; ongoing, recurring and cadence tasks return on their own schedule
            or (e.status = 'progressed' and t.type in ('one_off','follow_up')))
       and t.state = 'active' and t.type <> 'someday'
       and not exists (select 1 from day_entries e2 where e2.task_id = e.task_id and e2.date > e.date)
     order by e.date, e.must_do desc, e.sort, e.id`,
    [before],
    db,
  );
}

export type TriageAction = "carry" | "carry_must" | "pick" | "someday" | "drop";

/** One tap per unresolved entry (PRD 6.2 step 1). Carrying an untouched (open) entry adds to its carry count. */
export async function triageEntry(
  ctx: Ctx,
  entryId: number,
  action: TriageAction,
  planDate: DateStr,
  pickDate?: DateStr,
): Promise<void> {
  if (action === "drop") {
    await setEntryStatus(ctx, entryId, "dropped");
    return;
  }
  await tx(async (db) => {
    const e = await one<{ id: number; task_id: number; date: DateStr; status: string }>(
      "select id, task_id, date, status from day_entries where id = $1 for update",
      [entryId],
      db,
    );
    if (!e) throw new UserError("Entry not found.");
    const later = await one("select 1 from day_entries where task_id = $1 and date > $2", [e.task_id, e.date], db);
    if (later) return; // already triaged (double tap)
    if (action === "someday") {
      await makeSomeday(e.task_id, db);
      return;
    }
    const target = action === "pick" ? pickDate : planDate;
    if (!target) throw new UserError("Pick a date.");
    if (target <= e.date) throw new UserError("Pick a date after the original day.");
    await addEntry(ctx, e.task_id, target, { mustDo: action === "carry_must", source: "carried", carriedFrom: e.date }, db);
    if (e.status === "open") await db.query("update tasks set carry_count = carry_count + 1 where id = $1", [e.task_id]);
  });
}

/**
 * Fills a day from rules: Ongoing tasks on working days, Recurring tasks whose rule matches,
 * tasks dated for that day, and (for the Plan screen) overdue Cadence items.
 * Idempotent: an existing entry is never duplicated.
 */
export async function materializeDay(
  ctx: Ctx,
  date: DateStr,
  opts: { cadence?: boolean } = {},
  db: Db = getPool(),
): Promise<number> {
  let added = 0;
  const before = await one<{ n: number }>("select count(*)::int as n from day_entries where date = $1", [date], db);

  if (isWorkingDay(ctx, date)) {
    await db.query(
      `insert into day_entries (task_id, date, source, sort)
       select t.id, $1, 'auto',
              coalesce((select max(sort) from day_entries where date = $1), 0) + row_number() over (order by t.id)
       from tasks t
       where t.state = 'active' and t.type = 'ongoing'
         and coalesce(t.due_date, ((t.created_at - make_interval(mins => $3::int)) at time zone $2)::date) <= $1
       on conflict (task_id, date) do nothing`,
      [date, ctx.tz, ctx.boundaryMin],
    );
  }

  await db.query(
    `insert into day_entries (task_id, date, source, sort)
     select t.id, $1, 'planned',
            coalesce((select max(sort) from day_entries where date = $1), 0) + row_number() over (order by t.id)
     from tasks t
     where t.state = 'active' and t.type in ('one_off','follow_up') and t.due_date = $1
     on conflict (task_id, date) do nothing`,
    [date],
  );

  const recurring = await q<TaskRow>("select * from tasks where state = 'active' and type = 'recurring'", [], db);
  for (const t of recurring) {
    const createdDay = logicalDate(t.created_at, ctx.tz, ctx.boundaryMin);
    if (createdDay <= date && rruleMatches(t.rrule, date)) await addEntry(ctx, t.id, date, { source: "auto" }, db);
  }

  if (opts.cadence) {
    for (const c of await listCadence(ctx, date, db)) {
      if (c.overdue) await addEntry(ctx, c.task.id, date, { source: "auto" }, db);
    }
  }

  const after = await one<{ n: number }>("select count(*)::int as n from day_entries where date = $1", [date], db);
  added = after!.n - before!.n;
  return added;
}

export interface Capacity {
  plannedMin: number;
  availableMin: number;
  ratio: number;
  level: "ok" | "amber" | "red";
  message: string | null;
}

export function computeCapacity(entries: Pick<EntryView, "estimate_min" | "is_personal" | "status">[], availableHours: number): Capacity {
  const plannedMin = entries
    .filter((e) => !e.is_personal && e.status !== "dropped" && e.status !== "done")
    .reduce((sum, e) => sum + (e.estimate_min ?? 0), 0);
  const availableMin = availableHours * 60;
  const ratio = availableMin > 0 ? plannedMin / availableMin : 0;
  const level = ratio > 1 ? "red" : ratio >= 0.9 ? "amber" : "ok";
  return {
    plannedMin,
    availableMin,
    ratio,
    level,
    message: level === "red" ? "You are planning more than you can do." : null,
  };
}

export interface PlanView {
  date: DateStr;
  triage: EntryView[];
  entries: EntryView[];
  capacity: Capacity;
  suggestions: { someday: TaskRow[]; targets: TargetProgress[] };
  mustDoCount: number;
  plannedAt: Date | null;
}

export async function planView(ctx: Ctx, date: DateStr): Promise<PlanView> {
  // Auto-carry all unresolved entries to the plan date without asking.
  const stale = await unresolvedEntries(date);
  for (const e of stale) {
    await addEntry(ctx, e.task_id, date, { source: "carried", carriedFrom: e.date });
    if (e.status === "open") await getPool().query("update tasks set carry_count = carry_count + 1 where id = $1", [e.task_id]);
  }
  await materializeDay(ctx, date, { cadence: true });
  const triage: EntryView[] = [];
  const entries = await entriesForDate(date);
  const onDay = new Set(entries.map((e) => e.task_id));
  const someday = (await listSomeday()).filter((t) => !onDay.has(t.id));
  const targets = (await targetsBehind(ctx)).filter((p) => !onDay.has(p.task.id));
  const day = await getDay(date);
  return {
    date,
    triage,
    entries,
    capacity: computeCapacity(entries, ctx.s.available_hours),
    suggestions: { someday, targets },
    mustDoCount: entries.filter((e) => e.must_do && e.status !== "dropped").length,
    plannedAt: day?.planned_at ?? null,
  };
}

export async function finishPlan(ctx: Ctx, date: DateStr): Promise<void> {
  await markPlanned(ctx, date);
}

export function tomorrow(ctx: Ctx): DateStr {
  return addDays(ctx.today, 1);
}
