import { one, q, tx, UserError, type Db, getPool } from "../db";
import { findSimilar, type Match } from "../fuzzy";
import type { ParsedQuickAdd, TaskType } from "../parser";
import { type Ctx } from "../settings";
import {
  type DateStr,
  atLogical,
  fmtHM,
  logicalDate,
  parseHM,
  periodStart,
  type TargetPeriod,
} from "../time";
import type { EntryRow, TaskRow } from "../types";
import { addEntry } from "./entries";

const TASK_SELECT = `
  select t.*, p.name as project_name, p.color as project_color, pe.name as person_name
  from tasks t
  left join projects p on p.id = t.project_id
  left join people pe on pe.id = t.person_id`;

export async function getTask(id: number, db: Db = getPool()): Promise<TaskRow | null> {
  return one<TaskRow>(`${TASK_SELECT} where t.id = $1`, [id], db);
}

export async function listActiveTasks(db: Db = getPool()): Promise<TaskRow[]> {
  return q<TaskRow>(`${TASK_SELECT} where t.state = 'active' order by t.id`, [], db);
}

export async function ensureProject(name: string, db: Db = getPool()): Promise<number> {
  const clean = name.trim();
  const row = await one<{ id: number }>(
    `insert into projects (name) values ($1)
     on conflict (lower(name)) do update set archived = false
     returning id`,
    [clean],
    db,
  );
  return row!.id;
}

export async function ensurePerson(
  name: string,
  relation: string | null = null,
  db: Db = getPool(),
): Promise<number> {
  const clean = name.trim();
  const row = await one<{ id: number }>(
    `insert into people (name, relation) values ($1, $2)
     on conflict (lower(name)) do update set name = people.name
     returning id`,
    [clean, relation],
    db,
  );
  return row!.id;
}

/** Duplicate guard: active tasks whose title closely matches the parsed line. */
export async function findDuplicates(parsed: Pick<ParsedQuickAdd, "title" | "project">): Promise<Match[]> {
  if (!parsed.title) return [];
  const active = await listActiveTasks();
  return findSimilar(
    parsed.title,
    parsed.project,
    active.map((t) => ({ id: t.id, title: t.title, projectName: t.project_name ?? null })),
  );
}

export interface CreateOptions {
  /** Override the parsed type (e.g. the bot's [Someday] button). */
  type?: TaskType;
  /** Override the day the entry lands on (e.g. the bot's [Tomorrow] button). */
  targetDate?: DateStr;
}

/** Creates a task (and, where the type implies it, its first day entry) from a parsed quick-add line. */
export async function createFromParsed(
  ctx: Ctx,
  parsed: ParsedQuickAdd,
  opts: CreateOptions = {},
): Promise<{ task: TaskRow; entry: EntryRow | null }> {
  if (parsed.errors.length) throw new UserError(parsed.errors[0]);
  if (!parsed.title) throw new UserError("Add a title.");

  const type = opts.type ?? parsed.type;
  const targetDate = opts.targetDate ?? parsed.targetDate;
  let dueAt = parsed.dueAt;
  if (opts.targetDate && parsed.timeMin !== null && opts.targetDate !== parsed.targetDate) {
    dueAt = null; // the time was meant for the original day
  }

  const created = await tx(async (db) => {
    const projectId = parsed.project ? await ensureProject(parsed.project, db) : null;
    const personId = parsed.person ? await ensurePerson(parsed.person, null, db) : null;
    const period: TargetPeriod | null = type === "target" ? (parsed.targetPeriod ?? "week") : null;

    const row = await one<{ id: number }>(
      `insert into tasks
        (title, type, project_id, person_id, person_role, via, is_personal, estimate_min,
         due_date, due_at, cadence_days, rrule, target_period, period_start, goal_min, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       returning id`,
      [
        parsed.title,
        type,
        projectId,
        personId,
        personId ? parsed.personRole : null,
        parsed.via,
        parsed.isPersonal,
        parsed.estimateMin,
        opts.targetDate ?? parsed.date,
        type === "someday" || type === "target" ? null : dueAt,
        type === "cadence" ? parsed.cadenceDays : null,
        type === "recurring" ? parsed.rrule : null,
        period,
        period ? periodStart(targetDate, period) : null,
        type === "target" ? parsed.goalMin : null,
        ctx.now,
      ],
      db,
    );
    const taskId = row!.id;

    // Which types get a day entry straight away.
    const wantsEntry =
      type === "one_off" ||
      type === "follow_up" ||
      type === "ongoing" ||
      ((type === "cadence" || type === "recurring") && (parsed.date !== null || parsed.timeMin !== null));
    let entry: EntryRow | null = null;
    if (wantsEntry) {
      entry = await addEntry(ctx, taskId, targetDate, { mustDo: parsed.mustDo, source: "planned" }, db);
    } else if (parsed.mustDo && type !== "someday" && type !== "target") {
      entry = await addEntry(ctx, taskId, targetDate, { mustDo: true, source: "planned" }, db);
    }
    const task = (await getTask(taskId, db))!;
    return { task, entry };
  });
  return created;
}

export interface TaskPatch {
  title?: string;
  notes?: string | null;
  type?: TaskType;
  project?: string | null;
  person?: string | null;
  person_role?: "with" | "requested_by" | null;
  via?: string | null;
  is_personal?: boolean;
  estimate_min?: number | null;
  due_date?: DateStr | null;
  due_time?: string | null; // HH:MM on due_date (or today)
  lead_min?: number | null;
  cadence_days?: number | null;
  rrule?: string | null;
  target_period?: TargetPeriod | null;
  goal_count?: number | null;
  goal_min?: number | null;
}

const TYPES: TaskType[] = ["one_off", "ongoing", "follow_up", "cadence", "recurring", "someday", "target"];

export async function updateTask(ctx: Ctx, id: number, patch: TaskPatch): Promise<TaskRow> {
  return tx(async (db) => {
    const cur = await getTask(id, db);
    if (!cur) throw new UserError("Task not found.");
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };

    if (patch.title !== undefined) {
      const t = patch.title.trim();
      if (!t) throw new UserError("Title cannot be empty.");
      set("title", t);
    }
    if (patch.notes !== undefined) set("notes", patch.notes?.trim() || null);
    let type = cur.type;
    if (patch.type !== undefined) {
      if (!TYPES.includes(patch.type)) throw new UserError("Unknown task type.");
      set("type", patch.type);
      type = patch.type;
    }
    if (patch.project !== undefined) {
      set("project_id", patch.project?.trim() ? await ensureProject(patch.project, db) : null);
    }
    if (patch.person !== undefined) {
      set("person_id", patch.person?.trim() ? await ensurePerson(patch.person, null, db) : null);
    }
    if (patch.person_role !== undefined) set("person_role", patch.person_role);
    if (patch.via !== undefined) set("via", patch.via?.trim() || null);
    if (patch.is_personal !== undefined) set("is_personal", patch.is_personal);
    if (patch.estimate_min !== undefined) set("estimate_min", patch.estimate_min);
    if (patch.lead_min !== undefined) set("lead_min", patch.lead_min);
    if (patch.cadence_days !== undefined) set("cadence_days", patch.cadence_days);
    if (patch.rrule !== undefined) set("rrule", patch.rrule || null);
    if (patch.target_period !== undefined) {
      set("target_period", patch.target_period);
      if (patch.target_period) set("period_start", periodStart(ctx.today, patch.target_period));
    }
    if (patch.goal_count !== undefined) set("goal_count", patch.goal_count);
    if (patch.goal_min !== undefined) set("goal_min", patch.goal_min);

    let newDue: DateStr | null | undefined = patch.due_date;
    if (patch.due_date !== undefined || patch.due_time !== undefined) {
      const date = patch.due_date !== undefined ? patch.due_date : cur.due_date;
      set("due_date", date);
      if (patch.due_time) {
        const base = date ?? ctx.today;
        set("due_at", atLogical(base, parseHM(patch.due_time), ctx.tz, ctx.boundaryMin));
      } else if (patch.due_time === null || (patch.due_date !== undefined && patch.due_time === undefined && cur.due_at === null)) {
        set("due_at", null);
      } else if (patch.due_date !== undefined && cur.due_at) {
        // date moved but the time was not touched: keep the same wall-clock time on the new date
        const hm = parseHM(fmtHM(cur.due_at, ctx.tz));
        set("due_at", atLogical(date ?? ctx.today, hm, ctx.tz, ctx.boundaryMin));
      }
    }

    if (sets.length) await db.query(`update tasks set ${sets.join(", ")} where id = $${vals.length + 1}`, [...vals, id]);

    // A task moved to a date should show up on that date (never retyped).
    if (newDue && cur.state === "active" && ["one_off", "follow_up", "ongoing"].includes(type)) {
      await addEntry(ctx, id, newDue, { source: "planned" }, db);
    }
    return (await getTask(id, db))!;
  });
}

/** Turns a task into a Someday item (used by triage and the bot). */
export async function makeSomeday(id: number, db: Db = getPool()): Promise<void> {
  await q("update tasks set type = 'someday', due_at = null where id = $1 and state = 'active'", [id], db);
}

export async function deleteTask(id: number): Promise<void> {
  await q("delete from tasks where id = $1", [id]);
}

export function dueLabel(t: Pick<TaskRow, "due_at">, tz: string): string | null {
  return t.due_at ? fmtHM(t.due_at, tz) : null;
}

/** Local-day of a timestamp (used for "days since last done"). */
export function loggedDay(ctx: Ctx, at: Date): DateStr {
  return logicalDate(at, ctx.tz, ctx.boundaryMin);
}

export interface TaskRemark {
  id: number;
  task_id: number;
  body: string;
  created_at: Date;
}

export async function listRemarks(taskId: number, db: Db = getPool()): Promise<TaskRemark[]> {
  return q<TaskRemark>("select * from task_remarks where task_id = $1 order by created_at desc", [taskId], db);
}

export async function createRemark(taskId: number, body: string, db: Db = getPool()): Promise<TaskRemark> {
  const clean = body.trim();
  if (!clean) throw new UserError("The remark is empty.");
  const t = await getTask(taskId, db);
  if (!t) throw new UserError("Task not found.");
  return (await one<TaskRemark>(
    "insert into task_remarks (task_id, body) values ($1, $2) returning *",
    [taskId, clean],
    db,
  ))!;
}

export async function deleteRemark(id: number, db: Db = getPool()): Promise<void> {
  await q("delete from task_remarks where id = $1", [id], db);
}

/** @deprecated Use createRemark. Kept for Telegram bot compatibility. */
export async function appendNote(ctx: Ctx, taskId: number, text: string): Promise<TaskRow> {
  await createRemark(taskId, text);
  return (await getTask(taskId))!;
}
