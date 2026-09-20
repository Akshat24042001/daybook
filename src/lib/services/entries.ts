import { one, q, tx, UserError, type Db, getPool } from "../db";
import { type Ctx } from "../settings";
import { type DateStr, addDays } from "../time";
import type { EntryRow, EntrySource, EntryStatus, EntryView } from "../types";

export const VIEW_SELECT = `
  select e.*, t.title, t.type, t.project_id, p.name as project_name, p.color as project_color,
         pe.name as person_name, t.person_role, t.is_personal, t.estimate_min, t.due_at, t.lead_min,
         t.carry_count, t.state as task_state,
         coalesce((select sum(l.minutes) from time_logs l
                   where l.task_id = e.task_id and l.date = e.date), 0)::int as minutes_today
  from day_entries e
  join tasks t on t.id = e.task_id
  left join projects p on p.id = t.project_id
  left join people pe on pe.id = t.person_id`;

export async function getEntry(id: number, db: Db = getPool()): Promise<EntryView | null> {
  return one<EntryView>(`${VIEW_SELECT} where e.id = $1`, [id], db);
}

export async function entriesForDate(date: DateStr, db: Db = getPool()): Promise<EntryView[]> {
  return q<EntryView>(`${VIEW_SELECT} where e.date = $1 order by e.must_do desc, e.sort, e.id`, [date], db);
}

export async function entryForTask(taskId: number, date: DateStr, db: Db = getPool()): Promise<EntryView | null> {
  return one<EntryView>(`${VIEW_SELECT} where e.task_id = $1 and e.date = $2`, [taskId, date], db);
}

export async function mustDoCount(date: DateStr, excludeEntryId: number | null, db: Db = getPool()): Promise<number> {
  const row = await one<{ n: number }>(
    `select count(*)::int as n from day_entries
     where date = $1 and must_do and status <> 'dropped' and ($2::int is null or id <> $2)`,
    [date, excludeEntryId],
    db,
  );
  return row!.n;
}

/** Throws when adding one more must-do would exceed the cap (PRD 4.4). */
export async function assertMustDoRoom(
  ctx: Ctx,
  date: DateStr,
  excludeEntryId: number | null,
  db: Db = getPool(),
): Promise<void> {
  const n = await mustDoCount(date, excludeEntryId, db);
  if (n >= ctx.s.must_do_cap) {
    throw new UserError(
      `Must-do cap is ${ctx.s.must_do_cap} for this day. Demote another must-do first.`,
    );
  }
}

export interface AddEntryOptions {
  mustDo?: boolean;
  source?: EntrySource;
  carriedFrom?: DateStr | null;
}

/** Attaches an existing task to a date. Never duplicates: one entry per task per day. */
export async function addEntry(
  ctx: Ctx,
  taskId: number,
  date: DateStr,
  opts: AddEntryOptions = {},
  db: Db = getPool(),
): Promise<EntryRow> {
  const existing = await one<EntryRow>("select * from day_entries where task_id = $1 and date = $2", [taskId, date], db);
  if (opts.mustDo && !existing?.must_do) {
    await assertMustDoRoom(ctx, date, existing?.id ?? null, db);
  }
  const row = await one<EntryRow>(
    `insert into day_entries (task_id, date, must_do, sort, source, carried_from)
     values ($1, $2, $3, coalesce((select max(sort) from day_entries where date = $2), 0) + 1, $4, $5)
     on conflict (task_id, date) do update
       set must_do = day_entries.must_do or excluded.must_do, updated_at = now()
     returning *`,
    [taskId, date, !!opts.mustDo, opts.source ?? "planned", opts.carriedFrom ?? null],
    db,
  );
  return row!;
}

export async function setMustDo(ctx: Ctx, entryId: number, on: boolean): Promise<EntryRow> {
  return tx(async (db) => {
    const e = await one<EntryRow>("select * from day_entries where id = $1 for update", [entryId], db);
    if (!e) throw new UserError("Entry not found.");
    if (on && !e.must_do) await assertMustDoRoom(ctx, e.date, e.id, db);
    const row = await one<EntryRow>(
      "update day_entries set must_do = $2, updated_at = now() where id = $1 returning *",
      [entryId, on],
      db,
    );
    return row!;
  });
}

const CLOSES_ON_DONE = new Set(["one_off", "ongoing", "follow_up", "someday", "target"]);

export interface StatusResult {
  entry: EntryView;
  taskClosed: boolean;
  changed: boolean;
}

/**
 * Applies a day status and its effect on the task (PRD 4.3):
 *  done       -> closes the task (cadence/recurring stay active, last_done_at set)
 *  progressed -> task stays active
 *  attempted  -> no carry count
 *  skipped    -> carry_count + 1
 *  dropped    -> task closed as dropped
 * Setting the same status again is a no-op, so retried taps never double count.
 */
export async function setEntryStatus(ctx: Ctx, entryId: number, status: EntryStatus): Promise<StatusResult> {
  return tx(async (db) => {
    const e = await one<EntryRow>("select * from day_entries where id = $1 for update", [entryId], db);
    if (!e) throw new UserError("Entry not found.");
    const task = await one<{ id: number; type: string; state: string }>(
      "select id, type, state from tasks where id = $1 for update",
      [e.task_id],
      db,
    );
    if (!task) throw new UserError("Task not found.");
    const prev = e.status;
    if (prev === status) {
      return { entry: (await getEntry(entryId, db))!, taskClosed: task.state !== "active", changed: false };
    }
    await db.query("update day_entries set status = $2, updated_at = now() where id = $1", [entryId, status]);

    let taskClosed = false;
    const closeTask = async (state: "done" | "dropped") => {
      await db.query(
        "update tasks set state = $2, closed_at = $3, last_done_at = case when $2 = 'done' then $3 else last_done_at end where id = $1",
        [task.id, state, ctx.now],
      );
      await db.query("delete from day_entries where task_id = $1 and date > $2 and status = 'open'", [task.id, e.date]);
      taskClosed = true;
    };

    // Leaving skipped / done / dropped undoes what that status did to the task.
    if (prev === "skipped") {
      await db.query("update tasks set carry_count = greatest(carry_count - 1, 0) where id = $1", [task.id]);
    }
    if ((prev === "done" || prev === "dropped") && task.state !== "active") {
      await db.query("update tasks set state = 'active', closed_at = null where id = $1", [task.id]);
    }

    switch (status) {
      case "done":
        if (CLOSES_ON_DONE.has(task.type)) await closeTask("done");
        else await db.query("update tasks set last_done_at = $2 where id = $1", [task.id, ctx.now]);
        break;
      case "skipped":
        await db.query("update tasks set carry_count = carry_count + 1 where id = $1", [task.id]);
        break;
      case "dropped":
        await closeTask("dropped");
        break;
      default:
        break;
    }
    return { entry: (await getEntry(entryId, db))!, taskClosed, changed: true };
  });
}

export async function logMinutes(
  ctx: Ctx,
  taskId: number,
  date: DateStr,
  minutes: number,
  source: "web" | "telegram",
  db: Db = getPool(),
): Promise<void> {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new UserError("Minutes must be a whole number between 1 and 1440.");
  }
  await q("insert into time_logs (task_id, date, minutes, source) values ($1,$2,$3,$4)", [taskId, date, minutes, source], db);
}

export async function clearMinutes(taskId: number, date: DateStr): Promise<void> {
  await q("delete from time_logs where task_id = $1 and date = $2", [taskId, date]);
}

/**
 * Moves an open entry to another date. A non-open entry stays as history and a
 * new entry is created on the target date. Never adds to the carry count.
 */
export async function moveEntry(ctx: Ctx, entryId: number, toDate: DateStr): Promise<EntryRow> {
  return tx(async (db) => {
    const e = await one<EntryRow>("select * from day_entries where id = $1 for update", [entryId], db);
    if (!e) throw new UserError("Entry not found.");
    if (e.date === toDate) return e;
    const existing = await one<EntryRow>("select * from day_entries where task_id = $1 and date = $2", [e.task_id, toDate], db);
    if (e.status === "open") {
      if (existing) {
        await db.query("delete from day_entries where id = $1", [e.id]);
        return existing;
      }
      const keepMust = e.must_do && (await mustDoCount(toDate, null, db)) < ctx.s.must_do_cap;
      const row = await one<EntryRow>(
        `update day_entries set date = $2, must_do = $3, source = 'carried', carried_from = $4, updated_at = now(),
                sort = coalesce((select max(sort) from day_entries where date = $2), 0) + 1
         where id = $1 returning *`,
        [e.id, toDate, keepMust, e.date],
        db,
      );
      return row!;
    }
    return addEntry(ctx, e.task_id, toDate, { source: "carried", carriedFrom: e.date }, db);
  });
}

export async function reorderEntry(entryId: number, direction: "up" | "down"): Promise<void> {
  await tx(async (db) => {
    const e = await one<EntryRow>("select * from day_entries where id = $1", [entryId], db);
    if (!e) return;
    const neighbour = await one<EntryRow>(
      direction === "up"
        ? "select * from day_entries where date = $1 and (sort < $2 or (sort = $2 and id < $3)) order by sort desc, id desc limit 1"
        : "select * from day_entries where date = $1 and (sort > $2 or (sort = $2 and id > $3)) order by sort asc, id asc limit 1",
      [e.date, e.sort, e.id],
      db,
    );
    if (!neighbour) return;
    await db.query("update day_entries set sort = $2 where id = $1", [e.id, neighbour.sort === e.sort ? neighbour.sort + (direction === "up" ? -1 : 1) : neighbour.sort]);
    await db.query("update day_entries set sort = $2 where id = $1", [neighbour.id, e.sort]);
  });
}

export async function removeEntry(entryId: number): Promise<void> {
  await q("delete from day_entries where id = $1 and status = 'open'", [entryId]);
}

/** Schedules a bot message about an entry at a future time (snooze, retry). */
export async function scheduleTaskPing(
  kind: "task_snooze" | "task_retry",
  entryId: number,
  at: Date,
  db: Db = getPool(),
): Promise<void> {
  await q(
    `insert into notifications (kind, ref_id, scheduled_for, status)
     values ($1, $2, $3, 'scheduled') on conflict do nothing`,
    [kind, String(entryId), at],
    db,
  );
}

export type RetryChoice = "2h" | "tam" | "tpm";

export const RETRY_HOURS: Record<"tam" | "tpm", number> = { tam: 10, tpm: 16 };

export function tomorrowOf(ctx: Ctx): DateStr {
  return addDays(ctx.today, 1);
}
