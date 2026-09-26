import { one, q, tx, UserError, type Db, getPool } from "../db";
import { type Ctx } from "../settings";
import type { DateStr } from "../time";
import type { EntryStatus } from "../types";
import { addEntry } from "./entries";

/**
 * A task that is still open but is not on today's list or any later day.
 *
 * Tasks drop off the daily lists in a few ordinary ways: an entry was marked
 * "progressed" (which never carries), it was removed from a day, a day was
 * never rolled over, or it was added without a date. None of those close the
 * task, so it is still unfinished; this finds them so nothing silently vanishes.
 * Ongoing, recurring, cadence, someday and target tasks have their own homes and
 * are left out.
 */
export interface UnfinishedTask {
  taskId: number;
  title: string;
  type: "one_off" | "follow_up";
  projectName: string | null;
  projectColor: string | null;
  personName: string | null;
  isPersonal: boolean;
  /** last day it was on a list, null if it never was */
  lastDate: DateStr | null;
  lastStatus: EntryStatus | null;
  /** how many days it has appeared on */
  days: number;
  carryCount: number;
  minutesTotal: number;
  createdAt: Date;
  dueDate: DateStr | null;
}

export async function unfinishedTasks(today: DateStr, db: Db = getPool()): Promise<UnfinishedTask[]> {
  return q<UnfinishedTask>(
    `select t.id as "taskId", t.title, t.type, p.name as "projectName", p.color as "projectColor",
            pe.name as "personName", t.is_personal as "isPersonal",
            last.date as "lastDate", last.status as "lastStatus",
            (select count(*)::int from day_entries e where e.task_id = t.id) as days,
            t.carry_count as "carryCount",
            coalesce((select sum(l.minutes) from time_logs l where l.task_id = t.id), 0)::int as "minutesTotal",
            t.created_at as "createdAt", t.due_date as "dueDate"
     from tasks t
     left join projects p on p.id = t.project_id
     left join people pe on pe.id = t.person_id
     left join lateral (
       select e.date, e.status from day_entries e where e.task_id = t.id order by e.date desc limit 1
     ) last on true
     where t.state = 'active'
       and t.type in ('one_off', 'follow_up')
       and not exists (select 1 from day_entries e where e.task_id = t.id and e.date >= $1)
     order by last.date desc nulls last, t.created_at desc`,
    [today],
    db,
  );
}

export async function unfinishedCount(today: DateStr, db: Db = getPool()): Promise<number> {
  const r = await one<{ n: number }>(
    `select count(*)::int as n from tasks t
     where t.state = 'active' and t.type in ('one_off', 'follow_up')
       and not exists (select 1 from day_entries e where e.task_id = t.id and e.date >= $1)`,
    [today],
    db,
  );
  return r?.n ?? 0;
}

/** Puts unfinished tasks on today's list. Returns how many were added. */
export async function bringToToday(ctx: Ctx, taskIds: number[], mustDo = false): Promise<number> {
  if (!taskIds.length) return 0;
  return tx(async (db) => {
    let n = 0;
    for (const id of taskIds) {
      const t = await one<{ state: string; last: DateStr | null }>(
        `select t.state, (select max(e.date) from day_entries e where e.task_id = t.id and e.date < $2) as last
         from tasks t where t.id = $1`,
        [id, ctx.today],
        db,
      );
      if (!t) throw new UserError("Task not found.");
      if (t.state !== "active") continue;
      await addEntry(ctx, id, ctx.today, { mustDo, source: "carried", carriedFrom: t.last }, db);
      n++;
    }
    return n;
  });
}

/** Closes unfinished tasks without doing them: "done" (already handled) or "dropped" (not doing it). */
export async function closeUnfinished(ctx: Ctx, taskIds: number[], state: "done" | "dropped"): Promise<void> {
  if (!taskIds.length) return;
  await q(
    `update tasks set state = $2, closed_at = $3,
            last_done_at = case when $2 = 'done' then $3 else last_done_at end
     where id = any($1::int[]) and state = 'active'`,
    [taskIds, state, ctx.now],
  );
}
