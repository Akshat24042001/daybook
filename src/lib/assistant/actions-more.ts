/**
 * The rest of what the assistant can change: every create, edit and delete the app's own screens offer. Each action
 * checks its arguments against the database when proposed (prepare), says which rows it can touch (scopes) so undo
 * puts them back exactly, and applies through the same service functions the pages use (run).
 *
 * The one-line `doc` of each action is what the model reads, so keep it accurate.
 */
import { one, q, UserError } from "../db";
import { ACTIVITIES } from "../activity";
import { formatRepeat, describeRrule, parseRepeatPhrase, parseRepeat } from "../recurrence";
import { updateSettings, type Ctx, type SettingsPatch } from "../settings";
import { addDays, fmtDay, fmtHM, type DateStr } from "../time";
import type { TaskType } from "../types";
import {
  bool, dateArg, dayName, dayScope, fmtMin, has, int, isClear, localTime, num, quote, rowOr, rowScope, s, segmentScope,
  strList, taskScopes, type Scope, type Snapshot,
} from "./action-kit";
import { getDay, markPlanned } from "../services/days";
import { clearMinutes, endWaiting, getEntry, removeEntry, setMustDo } from "../services/entries";
import { addToDay, snoozeCadence } from "../services/goals";
import {
  createExerciseType, deleteExerciseType, exerciseSlots, getExerciseType, logExercise, updateExerciseType,
} from "../services/health";
import { createContact, deleteContact, updateContact, type Contact } from "../services/contacts";
import { deleteTouch, setTouchInterval, snoozeTouch } from "../services/keep-in-touch";
import { createRef, deleteRef, updateRef, type Ref } from "../services/refs";
import { deleteEntry as deleteDiaryEntry, summarizeDay, updateEntry as updateDiaryEntry } from "../services/diary";
import { createItem, deleteItem, updateItem } from "../services/scratch";
import { createSegment, deleteSegment, KIND_LABEL, type StateKind } from "../services/segments";
import type { SegmentKind } from "../hours";
import { generateReview, getReview, periodBounds, setIntentions, type ReviewPeriod } from "../services/review";
import { setProjectTimeGoal } from "../services/time-goals";
import { bringToToday } from "../services/unfinished";
import { cleanShowFrom, deleteRemark, deleteTask, ensurePerson, ensureProject, getTask, makeSomeday, updateTask, type TaskPatch } from "../services/tasks";

export interface MorePrepared {
  params: Record<string, unknown>;
  label: string;
  detail: string | null;
}

interface Def {
  /** what the model reads: fields and meaning */
  doc: string;
  prepare(ctx: Ctx, raw: Record<string, unknown>): Promise<MorePrepared>;
  scopes(ctx: Ctx, p: Record<string, unknown>): Promise<Scope[]> | Scope[];
  /** returns a short result line; push created rows to undo.created */
  run(ctx: Ctx, p: Record<string, unknown>, undo: Snapshot): Promise<string>;
}

// ---------------------------------------------------------------- helpers

const TASK_TYPES: TaskType[] = ["one_off", "ongoing", "follow_up", "cadence", "recurring", "someday", "target"];
const SEG_KINDS = new Set<string>(ACTIVITIES.map((a) => a.kind));
const WD: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

async function taskOr(id: unknown) {
  const t = int(id) === null ? null : await getTask(int(id)!);
  if (!t) throw new UserError(`That task does not exist (task_id ${s(id, 12) || "missing"}). Query tasks for the right id.`);
  return t;
}
async function entryOr(id: unknown) {
  const e = int(id) === null ? null : await getEntry(int(id)!);
  if (!e) throw new UserError(`That task entry does not exist (entry_id ${s(id, 12) || "missing"}). Use v_task_days.entry_id.`);
  return e;
}
const changes = (bits: (string | null | false | undefined)[]) => bits.filter(Boolean).join(" · ").slice(0, 280) || null;

/** "mon-sat", "mon,tue,wed", [1,2,3], ["Mon","Tue"] -> sorted ISO weekdays */
function weekdays(v: unknown): number[] {
  const out = new Set<number>();
  const parts = Array.isArray(v) ? v : s(v, 80).toLowerCase().split(/[,\s]+/);
  for (const raw of parts) {
    const p = String(raw).toLowerCase().trim();
    if (!p) continue;
    const range = /^([a-z]{3})[a-z]*-([a-z]{3})[a-z]*$/.exec(p);
    if (range && WD[range[1]] && WD[range[2]]) {
      for (let d = WD[range[1]]; ; d = (d % 7) + 1) { out.add(d); if (d === WD[range[2]]) break; }
      continue;
    }
    const n = Number(p);
    if (Number.isInteger(n) && n >= 1 && n <= 7) { out.add(n); continue; }
    if (WD[p.slice(0, 3)]) { out.add(WD[p.slice(0, 3)]); continue; }
    throw new UserError(`"${p}" is not a weekday.`);
  }
  if (!out.size) throw new UserError("Pick at least one working day.");
  return [...out].sort();
}
const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A text field that may be cleared: undefined = not given, null = clear, string = set */
const optText = (o: Record<string, unknown>, k: string, max = 2000): string | null | undefined =>
  !has(o, k) ? undefined : isClear(o[k]) || s(o[k], max) === "" ? null : s(o[k], max);

// ---------------------------------------------------------------- the registry

export const MORE: Record<string, Def> = {
  // ============================================================ tasks
  update_task: {
    doc: `update_task: task_id + any of title, notes, project ("" clears), person, task_type (one_off|ongoing|follow_up|cadence|recurring|someday|target), is_personal, estimate_min, due_date (YYYY-MM-DD or "clear"), due_time ("HH:MM" or "clear"), show_from ("18:00"/"6pm": keep it off Today until then; "clear"), repeat (phrase: "every day", "every day except sun", "every mon,wed", "every 2 weeks", "1st of the month"; makes it recurring), cadence_days, target_period (week|month|quarter|year), goal_hours, goal_count, lead_min (reminder minutes before due_time), via`,
    async prepare(ctx, o) {
      const t = await taskOr(o.task_id);
      const patch: TaskPatch = {};
      const bits: string[] = [];
      if (has(o, "title")) { const v = s(o.title, 300); if (!v) throw new UserError("title cannot be empty."); patch.title = v; bits.push(`title ${quote(v, 40)}`); }
      const notes = optText(o, "notes", 5000);
      if (notes !== undefined) { patch.notes = notes; bits.push(notes ? "notes" : "notes cleared"); }
      // "type" names the action itself, so the task's type travels as task_type
      if (has(o, "task_type")) {
        const v = s(o.task_type, 20) as TaskType;
        if (!TASK_TYPES.includes(v)) throw new UserError(`task_type must be one of ${TASK_TYPES.join(", ")}.`);
        patch.type = v; bits.push(`type ${v.replace("_", "-")}`);
      }
      const project = optText(o, "project", 80);
      if (project !== undefined) { patch.project = project; bits.push(project ? `project ${project}` : "no project"); }
      const person = optText(o, "person", 80);
      if (person !== undefined) { patch.person = person; patch.person_role = person ? "with" : null; bits.push(person ? `with ${person}` : "no person"); }
      if (has(o, "is_personal")) { const v = bool(o.is_personal); if (v === null) throw new UserError("is_personal must be true or false."); patch.is_personal = v; bits.push(v ? "personal" : "work"); }
      if (has(o, "estimate_min")) { const v = isClear(o.estimate_min) ? null : Math.round(num(o.estimate_min) ?? NaN); if (v !== null && !(v > 0 && v <= 1440)) throw new UserError("estimate_min is 1 to 1440."); patch.estimate_min = v; bits.push(v ? `estimate ${fmtMin(v)}` : "no estimate"); }
      if (has(o, "due_date")) { const v = isClear(o.due_date) ? null : dateArg(ctx, o.due_date); patch.due_date = v; bits.push(v ? `due ${dayName(ctx, v)}` : "no date"); }
      if (has(o, "due_time")) { const v = isClear(o.due_time) ? null : cleanShowFrom(s(o.due_time, 10)); patch.due_time = v; bits.push(v ? `at ${v}` : "no time"); }
      if (has(o, "show_from")) { const v = isClear(o.show_from) ? null : cleanShowFrom(s(o.show_from, 10)); patch.show_from = v; bits.push(v ? `shows from ${v}` : "shows all day"); }
      if (has(o, "repeat") || has(o, "rrule")) {
        let rrule: string | null = null;
        if (has(o, "rrule") && parseRepeat(s(o.rrule, 300))) rrule = s(o.rrule, 300).toUpperCase();
        else {
          const r = parseRepeatPhrase(s(o.repeat ?? o.rrule, 120).replace(/^every\s+/i, ""));
          if ("error" in r) throw new UserError(`repeat: ${r.error}`);
          rrule = formatRepeat(r.repeat);
        }
        patch.rrule = rrule;
        if (!has(o, "task_type")) patch.type = "recurring";
        bits.push(`repeats ${describeRrule(rrule).toLowerCase()}`);
      }
      if (has(o, "cadence_days")) { const v = int(o.cadence_days); if (v === null || v < 1 || v > 365) throw new UserError("cadence_days is 1 to 365."); patch.cadence_days = v; if (!has(o, "task_type")) patch.type = "cadence"; bits.push(`every ${v} days`); }
      if (has(o, "target_period")) { const v = s(o.target_period, 10); if (!["week", "month", "quarter", "year"].includes(v)) throw new UserError("target_period is week, month, quarter or year."); patch.target_period = v as TaskPatch["target_period"]; bits.push(`target this ${v}`); }
      if (has(o, "goal_hours")) { const v = isClear(o.goal_hours) ? null : num(o.goal_hours); if (v !== null && !(v > 0 && v <= 1000)) throw new UserError("goal_hours must be positive."); patch.goal_min = v === null ? null : Math.round(v * 60); bits.push(v ? `goal ${v}h` : "no hours goal"); }
      if (has(o, "goal_count")) { const v = isClear(o.goal_count) ? null : int(o.goal_count); if (v !== null && !(v > 0 && v <= 1000)) throw new UserError("goal_count must be positive."); patch.goal_count = v; bits.push(v ? `goal ${v} sessions` : "no sessions goal"); }
      if (has(o, "lead_min")) { const v = isClear(o.lead_min) ? null : int(o.lead_min); if (v !== null && !(v >= 0 && v <= 240)) throw new UserError("lead_min is 0 to 240."); patch.lead_min = v; bits.push(v === null ? "default reminder" : `reminder ${v}m before`); }
      const via = optText(o, "via", 80);
      if (via !== undefined) { patch.via = via; bits.push(via ? `via ${via}` : "no via"); }
      if (!bits.length) throw new UserError("update_task needs at least one field to change.");
      return { params: { task_id: t.id, patch }, label: `✎ Edit: ${t.title}`, detail: changes(bits) };
    },
    scopes: (_c, p) => taskScopes(p.task_id as number),
    async run(ctx, p) {
      await updateTask(ctx, p.task_id as number, p.patch as TaskPatch);
      return "Task updated.";
    },
  },

  delete_task: {
    doc: "delete_task: task_id — deletes the task with its whole history (undo brings it all back). Prefer set_task_state dropped to keep history.",
    async prepare(ctx, o) {
      const t = await taskOr(o.task_id);
      const [h] = await q<{ days: number; min: number }>(
        "select (select count(*) from day_entries where task_id = $1)::int as days, coalesce((select sum(minutes) from time_logs where task_id = $1), 0)::int as min",
        [t.id],
      );
      return { params: { task_id: t.id }, label: `🗑 Delete task: ${t.title}`, detail: changes([`${h.days} day${h.days === 1 ? "" : "s"} of history`, h.min ? `${fmtMin(h.min)} logged` : null, "undo restores everything"]) };
    },
    scopes: (_c, p) => taskScopes(p.task_id as number),
    async run(_c, p) {
      await deleteTask(p.task_id as number);
      return "Deleted.";
    },
  },

  set_task_state: {
    doc: "set_task_state: task_id, state done|dropped|active — close the whole task (not just today's entry), drop it keeping history, or reopen it",
    async prepare(ctx, o) {
      const t = await taskOr(o.task_id);
      const st = s(o.state, 10);
      if (!["done", "dropped", "active"].includes(st)) throw new UserError("state must be done, dropped or active.");
      if (st === t.state) throw new UserError(`The task is already ${st}.`);
      const verb = st === "done" ? "✓ Close task" : st === "dropped" ? "⌫ Drop task" : "↺ Reopen task";
      return { params: { task_id: t.id, state: st }, label: `${verb}: ${t.title}`, detail: st === "dropped" ? "history is kept" : null };
    },
    scopes: (_c, p) => taskScopes(p.task_id as number),
    async run(ctx, p) {
      const id = p.task_id as number;
      if (p.state === "active") await q("update tasks set state = 'active', closed_at = null where id = $1", [id]);
      else {
        await q("update tasks set state = $2, closed_at = $3 where id = $1 and state = 'active'", [id, p.state, ctx.now]);
        await q("delete from day_entries where task_id = $1 and date > $2 and status = 'open'", [id, ctx.today]);
      }
      return p.state === "active" ? "Reopened." : p.state === "done" ? "Closed." : "Dropped.";
    },
  },

  must_do: {
    doc: "must_do: entry_id, on (true|false) — mark or unmark a day's task as must-do",
    async prepare(ctx, o) {
      const e = await entryOr(o.entry_id);
      const on = bool(o.on) ?? true;
      if (e.must_do === on) throw new UserError(on ? "It is already a must-do." : "It is not a must-do.");
      return { params: { entry_id: e.id, on }, label: `${on ? "★ Must-do" : "☆ Not a must-do"}: ${e.title}`, detail: dayName(ctx, e.date) };
    },
    scopes: async (_c, p) => taskScopes((await entryOr(p.entry_id)).task_id),
    async run(ctx, p) {
      await setMustDo(ctx, p.entry_id as number, p.on as boolean);
      return "Updated.";
    },
  },

  add_to_day: {
    doc: "add_to_day: task_id, date (default today), must (true|false) — put an existing task (someday, cadence, target, any) on a day's list",
    async prepare(ctx, o) {
      const t = await taskOr(o.task_id);
      if (t.state !== "active") throw new UserError("That task is closed; reopen it first with set_task_state.");
      const date = dateArg(ctx, o.date);
      const on = await one("select 1 from day_entries where task_id = $1 and date = $2", [t.id, date]);
      if (on) throw new UserError(`It is already on ${dayName(ctx, date)}'s list.`);
      const must = bool(o.must) ?? false;
      return { params: { task_id: t.id, date, must }, label: `＋ ${t.title} → ${dayName(ctx, date)}`, detail: must ? "as a must-do" : null };
    },
    scopes: (_c, p) => taskScopes(p.task_id as number),
    async run(ctx, p) {
      await addToDay(ctx, p.task_id as number, p.date as DateStr, p.must as boolean);
      return "Added to the list.";
    },
  },

  remove_from_day: {
    doc: "remove_from_day: entry_id — take an untouched (open) task off that day's list; the task itself stays",
    async prepare(ctx, o) {
      const e = await entryOr(o.entry_id);
      if (e.status !== "open") throw new UserError("Only an untouched (open) entry can be removed; set a status instead.");
      return { params: { entry_id: e.id }, label: `− Remove from ${dayName(ctx, e.date)}: ${e.title}`, detail: "the task stays" };
    },
    scopes: async (_c, p) => taskScopes((await entryOr(p.entry_id)).task_id),
    async run(_c, p) {
      await removeEntry(p.entry_id as number);
      return "Removed from the list.";
    },
  },

  end_waiting: {
    doc: "end_waiting: task_id — the thing you were waiting on arrived: back to the task list today",
    async prepare(_c, o) {
      const t = await taskOr(o.task_id);
      if (!t.waiting_until && !t.waiting_since) throw new UserError("That task is not waiting.");
      return { params: { task_id: t.id }, label: `↩ Not waiting any more: ${t.title}`, detail: t.waiting_on ? `was waiting on ${t.waiting_on}` : null };
    },
    scopes: (_c, p) => taskScopes(p.task_id as number),
    async run(ctx, p) {
      await endWaiting(ctx, p.task_id as number);
      return "Back on today's list.";
    },
  },

  clear_time: {
    doc: "clear_time: task_id, date (default today) — remove all minutes logged on that task that day (a wrong log)",
    async prepare(ctx, o) {
      const t = await taskOr(o.task_id);
      const date = dateArg(ctx, o.date);
      const [m] = await q<{ m: number }>("select coalesce(sum(minutes),0)::int as m from time_logs where task_id = $1 and date = $2", [t.id, date]);
      if (!m.m) throw new UserError(`No time is logged on it ${dayName(ctx, date)}.`);
      return { params: { task_id: t.id, date }, label: `⌫ Clear ${fmtMin(m.m)} on ${t.title}`, detail: dayName(ctx, date) };
    },
    scopes: (_c, p) => taskScopes(p.task_id as number),
    async run(_c, p) {
      await clearMinutes(p.task_id as number, p.date as DateStr);
      return "Time cleared.";
    },
  },

  delete_note: {
    doc: "delete_note: note_id (task_remarks.id) — delete one note on a task",
    async prepare(_c, o) {
      const r = await rowOr<{ id: number; task_id: number; body: string }>("task_remarks", int(o.note_id), "task note");
      const t = await getTask(r.task_id);
      return { params: { note_id: r.id, task_id: r.task_id }, label: `🗑 Delete note on ${t?.title ?? "task"}`, detail: quote(r.body, 80) };
    },
    scopes: (_c, p) => taskScopes(p.task_id as number),
    async run(_c, p) {
      await deleteRemark(p.note_id as number);
      return "Note deleted.";
    },
  },

  someday: {
    doc: "someday: task_id — park a task in the Someday pool (off every list until you pick it again)",
    async prepare(_c, o) {
      const t = await taskOr(o.task_id);
      if (t.type === "someday") throw new UserError("It is already in Someday.");
      if (t.state !== "active") throw new UserError("That task is closed.");
      return { params: { task_id: t.id }, label: `☁ To Someday: ${t.title}`, detail: null };
    },
    scopes: (_c, p) => taskScopes(p.task_id as number),
    async run(_c, p) {
      await makeSomeday(p.task_id as number);
      return "Parked in Someday.";
    },
  },

  snooze_cadence: {
    doc: "snooze_cadence: task_id — snooze a cadence (every N days) task's nudge by a day",
    async prepare(_c, o) {
      const t = await taskOr(o.task_id);
      if (t.type !== "cadence") throw new UserError("Only cadence tasks can be snoozed.");
      return { params: { task_id: t.id }, label: `😴 Snooze 1 day: ${t.title}`, detail: null };
    },
    scopes: (_c, p) => taskScopes(p.task_id as number),
    async run(ctx, p) {
      await snoozeCadence(ctx, p.task_id as number);
      return "Snoozed.";
    },
  },

  bring_to_today: {
    doc: "bring_to_today: task_ids (array), must (true|false) — put tasks that fell off every list (the Unfinished page) back on today",
    async prepare(ctx, o) {
      const ids = (Array.isArray(o.task_ids) ? o.task_ids : [o.task_ids ?? o.task_id]).map(int).filter((x): x is number => x !== null).slice(0, 30);
      if (!ids.length) throw new UserError("bring_to_today needs task_ids.");
      const rows = await q<{ id: number; title: string; state: string }>("select id, title, state from tasks where id = any($1)", [ids]);
      if (rows.length !== ids.length) throw new UserError("Some task_ids do not exist.");
      if (rows.some((r) => r.state !== "active")) throw new UserError("Some of those tasks are closed.");
      const must = bool(o.must) ?? false;
      return { params: { task_ids: ids, must }, label: `↥ Today: ${rows.map((r) => r.title).join(", ").slice(0, 120)}`, detail: changes([`${ids.length} task${ids.length === 1 ? "" : "s"}`, must ? "as must-dos" : null]) };
    },
    scopes: (_c, p) => (p.task_ids as number[]).flatMap(taskScopes),
    async run(ctx, p) {
      const n = await bringToToday(ctx, p.task_ids as number[], p.must as boolean);
      return `${n} added to today.`;
    },
  },

  finish_plan: {
    doc: "finish_plan: date (default tomorrow) — mark that day as planned (counts for the planning streak)",
    async prepare(ctx, o) {
      const date = dateArg(ctx, o.date, addDays(ctx.today, 1));
      const d = await getDay(date);
      if (d?.planned_at) throw new UserError(`${dayName(ctx, date)} is already planned.`);
      return { params: { date }, label: `✓ Plan done for ${dayName(ctx, date)}`, detail: null };
    },
    scopes: (_c, p) => [dayScope(p.date as DateStr)],
    async run(ctx, p) {
      await markPlanned(ctx, p.date as DateStr);
      return "Marked as planned.";
    },
  },

  // ============================================================ projects & people
  add_project: {
    doc: "add_project: name, color (#rrggbb, optional), weekly_goal_hours (optional)",
    async prepare(_c, o) {
      const name = s(o.name, 80);
      if (!name) throw new UserError("add_project needs a name.");
      if (await one("select 1 from projects where lower(name) = lower($1)", [name])) throw new UserError(`A project called ${name} already exists.`);
      const color = s(o.color, 7);
      if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new UserError("color must look like #22aa88.");
      const goal = has(o, "weekly_goal_hours") ? num(o.weekly_goal_hours) : null;
      if (goal !== null && !(goal > 0 && goal <= 168)) throw new UserError("weekly_goal_hours is 0 to 168.");
      return { params: { name, color: color || null, goal }, label: `＋ Project: ${name}`, detail: goal ? `goal ${goal}h a week` : null };
    },
    scopes: () => [],
    async run(_c, p, undo) {
      const id = await ensureProject(p.name as string);
      undo.created.push({ table: "projects", id });
      if (p.color) await q("update projects set color = $2 where id = $1", [id, p.color]);
      if (p.goal) await setProjectTimeGoal(id, (p.goal as number) * 60);
      return "Project created.";
    },
  },

  update_project: {
    doc: "update_project: project_id + any of name, color (#rrggbb), archived (true|false), weekly_goal_hours (number, or \"clear\")",
    async prepare(_c, o) {
      const pr = await rowOr<{ id: number; name: string }>("projects", int(o.project_id), "project");
      const bits: string[] = [];
      const params: Record<string, unknown> = { project_id: pr.id };
      if (has(o, "name")) {
        const v = s(o.name, 80);
        if (!v) throw new UserError("name cannot be empty.");
        if (await one("select 1 from projects where lower(name) = lower($1) and id <> $2", [v, pr.id])) throw new UserError("Another project already has that name.");
        params.name = v; bits.push(`rename to ${v}`);
      }
      if (has(o, "color")) { const v = s(o.color, 7); if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new UserError("color must look like #22aa88."); params.color = v; bits.push(`colour ${v}`); }
      if (has(o, "archived")) { const v = bool(o.archived); if (v === null) throw new UserError("archived must be true or false."); params.archived = v; bits.push(v ? "archive" : "unarchive"); }
      if (has(o, "weekly_goal_hours")) {
        const v = isClear(o.weekly_goal_hours) ? null : num(o.weekly_goal_hours);
        if (v !== null && !(v > 0 && v <= 168)) throw new UserError("weekly_goal_hours is 0 to 168.");
        params.goal = v; bits.push(v ? `goal ${v}h a week` : "no weekly goal");
      }
      if (bits.length === 0) throw new UserError("update_project needs a field to change.");
      return { params, label: `✎ Project: ${pr.name}`, detail: changes(bits) };
    },
    scopes: (_c, p) => [rowScope("projects", p.project_id as number)],
    async run(_c, p) {
      const id = p.project_id as number;
      if (p.name !== undefined) await q("update projects set name = $2 where id = $1", [id, p.name]);
      if (p.color !== undefined) await q("update projects set color = $2 where id = $1", [id, p.color]);
      if (p.archived !== undefined) await q("update projects set archived = $2 where id = $1", [id, p.archived]);
      if (p.goal !== undefined) await setProjectTimeGoal(id, p.goal === null ? null : (p.goal as number) * 60);
      return "Project updated.";
    },
  },

  delete_project: {
    doc: "delete_project: project_id — deletes the project; its tasks stay, without a project (prefer update_project archived)",
    async prepare(_c, o) {
      const pr = await rowOr<{ id: number; name: string }>("projects", int(o.project_id), "project");
      const [n] = await q<{ n: number }>("select count(*)::int as n from tasks where project_id = $1", [pr.id]);
      return { params: { project_id: pr.id }, label: `🗑 Delete project: ${pr.name}`, detail: `${n.n} task${n.n === 1 ? "" : "s"} keep going without a project` };
    },
    scopes: (_c, p) => [rowScope("projects", p.project_id as number), { table: "tasks", key: "id", where: "project_id = $1", params: [p.project_id] }],
    async run(_c, p) {
      await q("delete from projects where id = $1", [p.project_id]);
      return "Project deleted.";
    },
  },

  add_person: {
    doc: "add_person: name, relation (optional) — a person named on tasks (+Name). For a full contact card use add_contact.",
    async prepare(_c, o) {
      const name = s(o.name, 80);
      if (!name) throw new UserError("add_person needs a name.");
      if (await one("select 1 from people where lower(name) = lower($1)", [name])) throw new UserError(`${name} already exists.`);
      return { params: { name, relation: s(o.relation, 80) || null }, label: `＋ Person: ${name}`, detail: s(o.relation, 80) || null };
    },
    scopes: () => [],
    async run(_c, p, undo) {
      const id = await ensurePerson(p.name as string, (p.relation as string | null) ?? null);
      undo.created.push({ table: "people", id });
      if (p.relation) await q("update people set relation = $2 where id = $1", [id, p.relation]);
      return "Added.";
    },
  },

  update_person: {
    doc: "update_person: person_id + name and/or relation",
    async prepare(_c, o) {
      const pe = await rowOr<{ id: number; name: string }>("people", int(o.person_id), "person");
      const params: Record<string, unknown> = { person_id: pe.id };
      const bits: string[] = [];
      if (has(o, "name")) { const v = s(o.name, 80); if (!v) throw new UserError("name cannot be empty."); params.name = v; bits.push(`rename to ${v}`); }
      const rel = optText(o, "relation", 80);
      if (rel !== undefined) { params.relation = rel; bits.push(rel ? `relation ${rel}` : "no relation"); }
      if (!bits.length) throw new UserError("update_person needs name or relation.");
      return { params, label: `✎ ${pe.name}`, detail: changes(bits) };
    },
    scopes: (_c, p) => [rowScope("people", p.person_id as number)],
    async run(_c, p) {
      if (p.name !== undefined) await q("update people set name = $2 where id = $1", [p.person_id, p.name]);
      if (p.relation !== undefined) await q("update people set relation = $2 where id = $1", [p.person_id, p.relation]);
      return "Updated.";
    },
  },

  delete_person: {
    doc: "delete_person: person_id — removes the person; tasks naming them stay, without the name",
    async prepare(_c, o) {
      const pe = await rowOr<{ id: number; name: string }>("people", int(o.person_id), "person");
      return { params: { person_id: pe.id }, label: `🗑 Delete person: ${pe.name}`, detail: null };
    },
    scopes: (_c, p) => [rowScope("people", p.person_id as number), { table: "tasks", key: "id", where: "person_id = $1", params: [p.person_id] }],
    async run(_c, p) {
      await q("delete from people where id = $1", [p.person_id]);
      return "Deleted.";
    },
  },

  // ============================================================ contacts
  add_contact: {
    doc: "add_contact: name + optional companies, roles, cities, phones, emails, tags (arrays or comma lists), linkedin, notes, touch_every_days (keep-in-touch interval)",
    async prepare(_c, o) {
      const name = s(o.name, 120);
      if (!name) throw new UserError("add_contact needs a name.");
      const data: Omit<Contact, "id" | "created_at"> = {
        name, companies: strList(o.companies ?? o.company), roles: strList(o.roles ?? o.role), cities: strList(o.cities ?? o.city),
        phones: strList(o.phones ?? o.phone), emails: strList(o.emails ?? o.email), tags: strList(o.tags),
        linkedin: s(o.linkedin, 300) || null, notes: s(o.notes, 5000) || null,
      };
      const every = has(o, "touch_every_days") ? int(o.touch_every_days) : null;
      if (every !== null && !(every >= 1 && every <= 365)) throw new UserError("touch_every_days is 1 to 365.");
      return { params: { data, every }, label: `＋ Contact: ${name}`, detail: changes([data.companies.join(", "), data.cities.join(", "), every ? `keep in touch every ${every}d` : null]) };
    },
    scopes: () => [],
    async run(_c, p, undo) {
      const id = await createContact(p.data as Omit<Contact, "id" | "created_at">);
      undo.created.push({ table: "contacts", id });
      if (p.every) await setTouchInterval(id, p.every as number);
      return "Contact added.";
    },
  },

  update_contact: {
    doc: "update_contact: contact_id + any of name, companies, roles, cities, phones, emails, tags (replace the list), linkedin, notes",
    async prepare(_c, o) {
      const c = await rowOr<{ id: number; name: string }>("contacts", int(o.contact_id), "contact");
      const data: Partial<Omit<Contact, "id" | "created_at">> = {};
      for (const k of ["companies", "roles", "cities", "phones", "emails", "tags"] as const) if (has(o, k)) data[k] = strList(o[k]);
      if (has(o, "name")) { const v = s(o.name, 120); if (!v) throw new UserError("name cannot be empty."); data.name = v; }
      const li = optText(o, "linkedin", 300); if (li !== undefined) data.linkedin = li;
      const notes = optText(o, "notes", 5000); if (notes !== undefined) data.notes = notes;
      const keys = Object.keys(data);
      if (!keys.length) throw new UserError("update_contact needs a field to change.");
      return { params: { contact_id: c.id, data }, label: `✎ Contact: ${c.name}`, detail: keys.join(", ") };
    },
    scopes: (_c, p) => [rowScope("contacts", p.contact_id as number)],
    async run(_c, p) {
      await updateContact(p.contact_id as number, p.data as Partial<Contact>);
      return "Contact updated.";
    },
  },

  delete_contact: {
    doc: "delete_contact: contact_id — deletes the contact and its keep-in-touch history",
    async prepare(_c, o) {
      const c = await rowOr<{ id: number; name: string }>("contacts", int(o.contact_id), "contact");
      return { params: { contact_id: c.id }, label: `🗑 Delete contact: ${c.name}`, detail: "undo restores it" };
    },
    scopes: (_c, p) => [rowScope("contacts", p.contact_id as number), { table: "contact_touches", key: "id", where: "contact_id = $1", params: [p.contact_id] }],
    async run(_c, p) {
      await deleteContact(p.contact_id as number);
      return "Contact deleted.";
    },
  },

  touch_every: {
    doc: "touch_every: contact_id, days (1-365, or \"clear\" for the default) — how often to keep in touch",
    async prepare(_c, o) {
      const c = await rowOr<{ id: number; name: string }>("contacts", int(o.contact_id), "contact");
      const days = isClear(o.days) ? null : int(o.days);
      if (days !== null && !(days >= 1 && days <= 365)) throw new UserError("days is 1 to 365.");
      return { params: { contact_id: c.id, days }, label: `⟳ ${c.name}: ${days ? `every ${days} days` : "default interval"}`, detail: null };
    },
    scopes: (_c, p) => [rowScope("contacts", p.contact_id as number)],
    async run(_c, p) {
      await setTouchInterval(p.contact_id as number, p.days as number | null);
      return "Saved.";
    },
  },

  snooze_contact: {
    doc: "snooze_contact: contact_id, days (default 7) — stop the keep-in-touch reminder for a while",
    async prepare(ctx, o) {
      const c = await rowOr<{ id: number; name: string }>("contacts", int(o.contact_id), "contact");
      const days = int(o.days) ?? 7;
      if (!(days >= 1 && days <= 365)) throw new UserError("days is 1 to 365.");
      return { params: { contact_id: c.id, days }, label: `😴 Snooze ${c.name}`, detail: `until ${fmtDay(addDays(ctx.today, days), ctx.today)}` };
    },
    scopes: (_c, p) => [rowScope("contacts", p.contact_id as number)],
    async run(ctx, p) {
      await snoozeTouch(p.contact_id as number, ctx.today, p.days as number);
      return "Snoozed.";
    },
  },

  delete_touch: {
    doc: "delete_touch: touch_id (contact_touches.id) — remove a wrongly logged call/meeting",
    async prepare(ctx, o) {
      const t = await rowOr<{ id: number; contact_id: number; date: DateStr; kind: string }>("contact_touches", int(o.touch_id), "contact touch");
      const [c] = await q<{ name: string }>("select name from contacts where id = $1", [t.contact_id]);
      return { params: { touch_id: t.id }, label: `🗑 Remove ${t.kind} with ${c?.name ?? "contact"}`, detail: dayName(ctx, t.date) };
    },
    scopes: (_c, p) => [rowScope("contact_touches", p.touch_id as number)],
    async run(_c, p) {
      await deleteTouch(p.touch_id as number);
      return "Removed.";
    },
  },

  // ============================================================ references
  add_ref: {
    doc: "add_ref: kind link|note|quote, title, url, body, source, tags (array), pinned — save a reference",
    async prepare(_c, o) {
      const kind = (s(o.kind, 10) || (s(o.url, 10) ? "link" : "note")) as Ref["kind"];
      if (!["link", "note", "quote"].includes(kind)) throw new UserError("kind is link, note or quote.");
      const title = s(o.title, 300);
      if (!title) throw new UserError("add_ref needs a title.");
      const url = s(o.url, 2000) || null;
      if (url && !/^https?:\/\//i.test(url)) throw new UserError("url must start with http:// or https://.");
      const data: Omit<Ref, "id" | "created_at"> = { kind, title, url, body: s(o.body, 20000) || null, source: s(o.source, 300) || null, tags: strList(o.tags), pinned: bool(o.pinned) ?? false };
      return { params: { data }, label: `＋ Reference: ${title}`, detail: changes([kind, url, data.tags.join(", ")]) };
    },
    scopes: () => [],
    async run(_c, p, undo) {
      const id = await createRef(p.data as Omit<Ref, "id" | "created_at">);
      undo.created.push({ table: "refs", id });
      return "Saved.";
    },
  },

  update_ref: {
    doc: "update_ref: ref_id + any of title, url, body, source, tags, pinned, kind",
    async prepare(_c, o) {
      const r = await rowOr<{ id: number; title: string }>("refs", int(o.ref_id), "reference");
      const data: Partial<Omit<Ref, "id" | "created_at">> = {};
      if (has(o, "title")) { const v = s(o.title, 300); if (!v) throw new UserError("title cannot be empty."); data.title = v; }
      if (has(o, "kind")) { const v = s(o.kind, 10) as Ref["kind"]; if (!["link", "note", "quote"].includes(v)) throw new UserError("kind is link, note or quote."); data.kind = v; }
      for (const k of ["url", "body", "source"] as const) { const v = optText(o, k, k === "body" ? 20000 : 2000); if (v !== undefined) data[k] = v; }
      if (has(o, "tags")) data.tags = strList(o.tags);
      if (has(o, "pinned")) data.pinned = bool(o.pinned) ?? false;
      if (!Object.keys(data).length) throw new UserError("update_ref needs a field to change.");
      return { params: { ref_id: r.id, data }, label: `✎ Reference: ${r.title}`, detail: Object.keys(data).join(", ") };
    },
    scopes: (_c, p) => [rowScope("refs", p.ref_id as number)],
    async run(_c, p) {
      await updateRef(p.ref_id as number, p.data as Partial<Ref>);
      return "Updated.";
    },
  },

  delete_ref: {
    doc: "delete_ref: ref_id",
    async prepare(_c, o) {
      const r = await rowOr<{ id: number; title: string }>("refs", int(o.ref_id), "reference");
      return { params: { ref_id: r.id }, label: `🗑 Delete reference: ${r.title}`, detail: null };
    },
    scopes: (_c, p) => [rowScope("refs", p.ref_id as number)],
    async run(_c, p) {
      await deleteRef(p.ref_id as number);
      return "Deleted.";
    },
  },

  // ============================================================ diary
  edit_diary: {
    doc: "edit_diary: diary_id (diary_entries.id), text — rewrite one diary note",
    async prepare(ctx, o) {
      const d = await rowOr<{ id: number; date: DateStr }>("diary_entries", int(o.diary_id), "diary note");
      const text = s(o.text, 20000);
      if (!text) throw new UserError("edit_diary needs text.");
      return { params: { diary_id: d.id, text }, label: `✎ Diary note`, detail: changes([dayName(ctx, d.date), quote(text, 70)]) };
    },
    scopes: (_c, p) => [rowScope("diary_entries", p.diary_id as number)],
    async run(_c, p) {
      await updateDiaryEntry(p.diary_id as number, p.text as string);
      return "Note updated.";
    },
  },

  delete_diary: {
    doc: "delete_diary: diary_id — delete one diary note",
    async prepare(ctx, o) {
      const d = await rowOr<{ id: number; date: DateStr; body: string }>("diary_entries", int(o.diary_id), "diary note");
      return { params: { diary_id: d.id }, label: `🗑 Delete diary note`, detail: changes([dayName(ctx, d.date), quote(d.body, 70)]) };
    },
    scopes: (_c, p) => [rowScope("diary_entries", p.diary_id as number)],
    async run(_c, p) {
      await deleteDiaryEntry(p.diary_id as number);
      return "Note deleted.";
    },
  },

  summarize_diary: {
    doc: "summarize_diary: date (default today) — (re)write the AI summary and rating of that day's diary",
    async prepare(ctx, o) {
      const date = dateArg(ctx, o.date);
      if (date > ctx.today) throw new UserError("Only today or earlier.");
      return { params: { date }, label: `✦ Summarise the diary`, detail: dayName(ctx, date) };
    },
    scopes: (_c, p) => [{ table: "diary_summaries", key: "date", where: "date = $1", params: [p.date] }],
    async run(ctx, p) {
      const r = await summarizeDay(ctx, p.date as DateStr);
      return r.rating !== null ? `Summarised: ${r.rating}/10.` : "Summarised.";
    },
  },

  // ============================================================ scratchpad
  add_scratch: {
    doc: "add_scratch: kind note|checklist|link|code|calc|table, title + content: text (note), items (checklist: array of strings), url + note (link), code + lang (code), lines (calc: array of expressions), rows (table: array of arrays), date (default today)",
    async prepare(ctx, o) {
      const kind = s(o.kind, 12) || "note";
      const data = scratchData(kind, o);
      const date = dateArg(ctx, o.date);
      const title = s(o.title, 120);
      return { params: { kind, data, date, title }, label: `✎ Scratchpad ${kind}: ${title || "untitled"}`, detail: dayName(ctx, date) };
    },
    scopes: () => [],
    async run(_c, p, undo) {
      const r = await createItem(p.date as DateStr, p.kind as string, p.title, p.data);
      undo.created.push({ table: "scratch_items", id: r.id });
      return "Added to the scratchpad.";
    },
  },

  update_scratch: {
    doc: "update_scratch: item_id + title and/or the content fields of its kind (as in add_scratch; they replace the content)",
    async prepare(_c, o) {
      const it = await rowOr<{ id: number; kind: string; title: string | null }>("scratch_items", int(o.item_id), "scratchpad item");
      const params: Record<string, unknown> = { item_id: it.id };
      if (has(o, "title")) params.title = s(o.title, 120);
      const contentKeys = ["text", "items", "url", "note", "code", "lang", "lines", "rows"];
      if (contentKeys.some((k) => has(o, k))) params.data = scratchData(it.kind, o);
      if (params.title === undefined && params.data === undefined) throw new UserError("update_scratch needs a title or content.");
      return { params, label: `✎ Scratchpad: ${it.title || it.kind}`, detail: [params.title !== undefined ? "title" : null, params.data ? "content" : null].filter(Boolean).join(", ") };
    },
    scopes: (_c, p) => [rowScope("scratch_items", p.item_id as number)],
    async run(_c, p) {
      await updateItem(p.item_id as number, { title: p.title, data: p.data });
      return "Updated.";
    },
  },

  delete_scratch: {
    doc: "delete_scratch: item_id — delete a scratchpad item (an uploaded file or voice memo cannot be brought back by undo)",
    async prepare(_c, o) {
      const it = await rowOr<{ id: number; kind: string; title: string | null }>("scratch_items", int(o.item_id), "scratchpad item");
      const media = it.kind === "file" || it.kind === "voice";
      return { params: { item_id: it.id }, label: `🗑 Delete scratchpad ${it.kind}: ${it.title || "untitled"}`, detail: media ? "the file is deleted for good" : null };
    },
    scopes: (_c, p) => [rowScope("scratch_items", p.item_id as number)],
    async run(_c, p) {
      await deleteItem(p.item_id as number);
      return "Deleted.";
    },
  },

  // ============================================================ time segments
  add_segment: {
    doc: `add_segment: kind (${[...SEG_KINDS].join("|")}), start "HH:MM", end "HH:MM" (or omit while still running), date (default today) — add a stretch of time you forgot to record`,
    async prepare(ctx, o) {
      const kind = s(o.kind, 20);
      if (!SEG_KINDS.has(kind)) throw new UserError(`kind must be one of ${[...SEG_KINDS].join(", ")}.`);
      const date = dateArg(ctx, o.date);
      const start = localTime(ctx, o.start, date);
      const end = o.end === undefined || o.end === null || o.end === "" || o.end === "running" ? null : localTime(ctx, o.end, date);
      if (end && end <= start) throw new UserError("end must be after start.");
      if (start > ctx.now) throw new UserError("That starts in the future.");
      return {
        params: { kind, start: start.toISOString(), end: end ? end.toISOString() : null, date },
        label: `◷ ${KIND_LABEL[kind as StateKind]} ${fmtHM(start, ctx.tz)}–${end ? fmtHM(end, ctx.tz) : "now"}`,
        detail: dayName(ctx, date),
      };
    },
    scopes: (_c, p) => [segmentScope(addDays(p.date as DateStr, -1), addDays(p.date as DateStr, 1))],
    async run(ctx, p, undo) {
      const r = await createSegment(ctx, { kind: p.kind as SegmentKind, start: new Date(p.start as string), end: p.end ? new Date(p.end as string) : null });
      undo.created.push({ table: "work_segments", id: r.id });
      return "Added to the timeline.";
    },
  },

  delete_segment: {
    doc: "delete_segment: segment_id (v_segments.id) — remove a stretch of time recorded by mistake",
    async prepare(ctx, o) {
      const g = await rowOr<{ id: number; date: DateStr; kind: StateKind; start_at: Date; end_at: Date | null }>("work_segments", int(o.segment_id), "time segment");
      return {
        params: { segment_id: g.id, date: g.date },
        label: `🗑 ${KIND_LABEL[g.kind]} ${fmtHM(g.start_at, ctx.tz)}–${g.end_at ? fmtHM(g.end_at, ctx.tz) : "now"}`,
        detail: dayName(ctx, g.date),
      };
    },
    scopes: (_c, p) => [segmentScope(addDays(p.date as DateStr, -1), addDays(p.date as DateStr, 1))],
    async run(_c, p) {
      await deleteSegment(p.segment_id as number);
      return "Removed from the timeline.";
    },
  },

  // ============================================================ exercise
  skip_exercise: {
    doc: "skip_exercise: time (\"HH:MM\" of the slot, default the current one), date (default today) — mark an exercise slot skipped",
    async prepare(ctx, o) {
      const date = dateArg(ctx, o.date);
      const slot = pickSlot(ctx, date, o.time);
      return { params: { slot: slot.toISOString(), date }, label: `⏭ Skip the ${fmtHM(slot, ctx.tz)} exercise`, detail: dayName(ctx, date) };
    },
    scopes: (_c, p) => [{ table: "exercise_logs", key: "id", where: "date = $1", params: [p.date] }],
    async run(ctx, p) {
      await logExercise(ctx, new Date(p.slot as string), "skipped", null, null);
      return "Marked skipped.";
    },
  },

  delete_exercise_log: {
    doc: "delete_exercise_log: log_id (exercise_logs.id) — remove a wrongly logged set",
    async prepare(ctx, o) {
      const l = await rowOr<{ id: number; date: DateStr; slot_at: Date; exercise_type_id: number | null; amount: number | null; status: string }>("exercise_logs", int(o.log_id), "exercise log");
      const t = l.exercise_type_id ? await getExerciseType(l.exercise_type_id) : null;
      return { params: { log_id: l.id }, label: `🗑 ${l.status === "done" ? `${l.amount ?? ""} ${t?.name ?? "exercise"}` : `${l.status} slot`} at ${fmtHM(l.slot_at, ctx.tz)}`, detail: dayName(ctx, l.date) };
    },
    scopes: (_c, p) => [rowScope("exercise_logs", p.log_id as number)],
    async run(_c, p) {
      await q("delete from exercise_logs where id = $1", [p.log_id]);
      return "Removed.";
    },
  },

  add_exercise_type: {
    doc: "add_exercise_type: name, amount (per set), unit reps|seconds",
    async prepare(_c, o) {
      const name = s(o.name, 60);
      if (!name) throw new UserError("add_exercise_type needs a name.");
      if (await one("select 1 from exercise_types where lower(name) = lower($1)", [name])) throw new UserError(`${name} is already in the list.`);
      const unit = s(o.unit, 10) === "seconds" ? "seconds" : "reps";
      const amount = Math.round(num(o.amount) ?? (unit === "seconds" ? 30 : 15));
      if (!(amount >= 1 && amount <= 10000)) throw new UserError("amount must be at least 1.");
      return { params: { name, unit, amount }, label: `＋ Exercise: ${name}`, detail: `${amount} ${unit} a set` };
    },
    scopes: () => [],
    async run(_c, p, undo) {
      const r = await createExerciseType({ name: p.name as string, default_amount: p.amount as number, unit: p.unit as "reps" | "seconds" });
      undo.created.push({ table: "exercise_types", id: r.id });
      return "Added to the exercise list.";
    },
  },

  update_exercise_type: {
    doc: "update_exercise_type: type_id + any of name, amount, unit (reps|seconds), active (false hides it from logging and pings)",
    async prepare(_c, o) {
      const t = await getExerciseType(int(o.type_id) ?? -1);
      if (!t) throw new UserError("That exercise type does not exist. Query exercise_types for the id.");
      const next = {
        name: has(o, "name") ? s(o.name, 60) : t.name,
        default_amount: has(o, "amount") ? Math.round(num(o.amount) ?? NaN) : t.default_amount,
        unit: (has(o, "unit") ? s(o.unit, 10) : t.unit) as "reps" | "seconds",
        active: has(o, "active") ? bool(o.active) ?? t.active : t.active,
      };
      if (!next.name) throw new UserError("name cannot be empty.");
      if (!(next.default_amount >= 1 && next.default_amount <= 10000)) throw new UserError("amount must be at least 1.");
      if (next.unit !== "reps" && next.unit !== "seconds") throw new UserError("unit is reps or seconds.");
      const bits = [next.name !== t.name ? `rename to ${next.name}` : null, next.default_amount !== t.default_amount || next.unit !== t.unit ? `${next.default_amount} ${next.unit} a set` : null, next.active !== t.active ? (next.active ? "show" : "hide") : null];
      if (!bits.some(Boolean)) throw new UserError("Nothing would change.");
      return { params: { type_id: t.id, ...next }, label: `✎ Exercise: ${t.name}`, detail: changes(bits) };
    },
    scopes: (_c, p) => [rowScope("exercise_types", p.type_id as number)],
    async run(_c, p) {
      await updateExerciseType(p.type_id as number, { name: p.name as string, default_amount: p.default_amount as number, unit: p.unit as "reps" | "seconds", active: p.active as boolean });
      return "Updated.";
    },
  },

  delete_exercise_type: {
    doc: "delete_exercise_type: type_id — remove an exercise from the list (logged sets stay in history); prefer update_exercise_type active false",
    async prepare(_c, o) {
      const t = await getExerciseType(int(o.type_id) ?? -1);
      if (!t) throw new UserError("That exercise type does not exist.");
      return { params: { type_id: t.id }, label: `🗑 Delete exercise: ${t.name}`, detail: "logged sets stay" };
    },
    scopes: (_c, p) => [rowScope("exercise_types", p.type_id as number), { table: "exercise_logs", key: "id", where: "exercise_type_id = $1", params: [p.type_id] }],
    async run(_c, p) {
      await deleteExerciseType(p.type_id as number);
      return "Deleted.";
    },
  },

  // ============================================================ reviews
  set_intentions: {
    doc: "set_intentions: period week|month, start (YYYY-MM-DD, default the current period), items (array of up to 5 short intentions; replaces the list)",
    async prepare(ctx, o) {
      const period = (s(o.period, 6) || "week") as ReviewPeriod;
      if (period !== "week" && period !== "month") throw new UserError("period is week or month.");
      const start = periodBounds(period, has(o, "start") ? dateArg(ctx, o.start) : ctx.today).start;
      const items = strList(o.items, 5);
      if (!items.length) throw new UserError("items needs at least one intention.");
      return { params: { period, start, items }, label: `◎ ${period === "week" ? "Week" : "Month"} intentions (${items.length})`, detail: items.map((i) => quote(i, 30)).join(" · ").slice(0, 280) };
    },
    scopes: (_c, p) => [{ table: "reviews", key: "period,start_date", where: "period = $1 and start_date = $2", params: [p.period, p.start] }],
    async run(_c, p) {
      const prev = (await getReview(p.period as ReviewPeriod, p.start as DateStr))?.intentions ?? [];
      await setIntentions(p.period as ReviewPeriod, p.start as DateStr, (p.items as string[]).map((text) => ({ text, done: prev.find((x) => x.text === text)?.done ?? null })));
      return "Intentions saved.";
    },
  },

  mark_intention: {
    doc: "mark_intention: period week|month, start (default current), index (0-based), done (true|false|null)",
    async prepare(ctx, o) {
      const period = (s(o.period, 6) || "week") as ReviewPeriod;
      if (period !== "week" && period !== "month") throw new UserError("period is week or month.");
      const start = periodBounds(period, has(o, "start") ? dateArg(ctx, o.start) : ctx.today).start;
      const list = (await getReview(period, start))?.intentions ?? [];
      const i = int(o.index);
      if (i === null || !list[i]) throw new UserError(`index must be 0 to ${Math.max(0, list.length - 1)} (there are ${list.length} intentions).`);
      const done = o.done === null ? null : bool(o.done) ?? true;
      return { params: { period, start, index: i, done }, label: `${done === true ? "✓" : done === false ? "✗" : "○"} ${list[i].text}`, detail: `${period} intention` };
    },
    scopes: (_c, p) => [{ table: "reviews", key: "period,start_date", where: "period = $1 and start_date = $2", params: [p.period, p.start] }],
    async run(_c, p) {
      const list = (await getReview(p.period as ReviewPeriod, p.start as DateStr))?.intentions ?? [];
      if (!list[p.index as number]) throw new UserError("That intention no longer exists.");
      list[p.index as number] = { ...list[p.index as number], done: p.done as boolean | null };
      await setIntentions(p.period as ReviewPeriod, p.start as DateStr, list);
      return "Marked.";
    },
  },

  generate_review: {
    doc: "generate_review: period week|month, start (default the current period) — write (or rewrite) the AI review",
    async prepare(ctx, o) {
      const period = (s(o.period, 6) || "week") as ReviewPeriod;
      if (period !== "week" && period !== "month") throw new UserError("period is week or month.");
      const start = periodBounds(period, has(o, "start") ? dateArg(ctx, o.start) : ctx.today).start;
      return { params: { period, start }, label: `✦ Write the ${period} review`, detail: `from ${fmtDay(start, ctx.today)}` };
    },
    scopes: (_c, p) => [{ table: "reviews", key: "period,start_date", where: "period = $1 and start_date = $2", params: [p.period, p.start] }],
    async run(ctx, p) {
      const r = await generateReview(ctx, p.period as ReviewPeriod, p.start as DateStr);
      return r.grade !== null ? `Review written: ${r.grade}/10.` : "Review written.";
    },
  },

  // ============================================================ settings
  update_settings: {
    doc: `update_settings: any of ${"working_days (\"mon-sat\" or [1,2,3,4,5,6]), step_goal, available_hours, rot_threshold, timezone, day_boundary, morning_brief, exercise_start, exercise_end, exercise_interval_min, exercise_paused (true|false), lunch_start, lunch_end (\"clear\" removes), quiet_start, quiet_end, score_reminder, evening_fallback, cadence_nudge, open_segment_check, weekly_review_day (1-7), weekly_review_time, task_lead_min"} (times as "HH:MM")`,
    async prepare(ctx, o) {
      const patch: Record<string, unknown> = {};
      const bits: string[] = [];
      const times = ["day_boundary", "morning_brief", "exercise_start", "exercise_end", "quiet_start", "quiet_end", "score_reminder", "evening_fallback", "cadence_nudge", "open_segment_check", "weekly_review_time"];
      const nums = ["step_goal", "available_hours", "rot_threshold", "exercise_interval_min", "weekly_review_day", "task_lead_min", "must_do_cap"];
      for (const [k, v] of Object.entries(o)) {
        if (k === "type") continue;
        if (k === "working_days") { const d = weekdays(v); patch.working_days = d; bits.push(`working days ${d.map((n) => DAY_SHORT[n]).join(" ")}`); }
        else if (times.includes(k)) { const t = cleanShowFrom(s(v, 10)); if (!t) throw new UserError(`${k} needs a time.`); patch[k] = t; bits.push(`${k.replace(/_/g, " ")} ${t}`); }
        else if (k === "lunch_start" || k === "lunch_end") { const t = isClear(v) ? null : cleanShowFrom(s(v, 10)); patch[k] = t; bits.push(`${k.replace("_", " ")} ${t ?? "off"}`); }
        else if (nums.includes(k)) { const n = num(v); if (n === null) throw new UserError(`${k} must be a number.`); patch[k] = n; bits.push(`${k.replace(/_/g, " ")} ${n}`); }
        else if (k === "exercise_paused") { const b = bool(v); if (b === null) throw new UserError("exercise_paused is true or false."); patch[k] = b; bits.push(b ? "exercise pings paused" : "exercise pings on"); }
        else if (k === "timezone") { const z = s(v, 60); try { new Intl.DateTimeFormat("en", { timeZone: z }); } catch { throw new UserError(`"${z}" is not a timezone.`); } patch[k] = z; bits.push(`timezone ${z}`); }
        else throw new UserError(`"${k}" is not a setting the assistant can change.`);
      }
      if (!bits.length) throw new UserError("update_settings needs at least one setting.");
      void ctx;
      return { params: { patch }, label: `⚙ Settings`, detail: changes(bits) };
    },
    scopes: () => [{ table: "settings", key: "id", where: "id = 1", params: [] }],
    async run(_c, p) {
      await updateSettings(p.patch as SettingsPatch);
      return "Settings saved.";
    },
  },
};

/** One exercise slot of a day: the one at "HH:MM", or the current (latest started) one. */
function pickSlot(ctx: Ctx, date: DateStr, time: unknown): Date {
  const slots = exerciseSlots(ctx, date);
  if (!slots.length) throw new UserError("There are no exercise slots that day.");
  if (s(time, 10)) {
    const want = localTime(ctx, time, date).getTime();
    const hit = slots.reduce((b, x) => (Math.abs(x.getTime() - want) < Math.abs(b.getTime() - want) ? x : b));
    if (Math.abs(hit.getTime() - want) > 20 * 60_000) throw new UserError(`No exercise slot near ${s(time, 10)}. Slots: ${slots.map((x) => fmtHM(x, ctx.tz)).join(", ")}.`);
    return hit;
  }
  return [...slots].reverse().find((x) => x.getTime() <= ctx.now.getTime()) ?? slots[0];
}

/** Scratchpad content from the model's simple fields. */
function scratchData(kind: string, o: Record<string, unknown>): unknown {
  switch (kind) {
    case "note": return { text: s(o.text ?? o.note, 50_000) };
    case "checklist": return {
      items: (Array.isArray(o.items) ? o.items : strList(o.items, 200)).slice(0, 200).map((it) =>
        typeof it === "object" && it ? { text: s((it as Record<string, unknown>).text, 500), done: (it as Record<string, unknown>).done === true } : { text: s(it, 500), done: false }),
    };
    case "link": {
      const url = s(o.url, 2000);
      if (!/^https?:\/\//i.test(url)) throw new UserError("A link needs a url starting with http.");
      return { url, note: s(o.note ?? o.text, 2000) };
    }
    case "code": return { lang: s(o.lang, 20) || "text", code: s(o.code ?? o.text, 50_000) };
    case "calc": return { lines: (Array.isArray(o.lines) ? o.lines : s(o.lines ?? o.text, 5000).split("\n")).map((l) => s(l, 500)).slice(0, 500) };
    case "table": return { rows: (Array.isArray(o.rows) ? o.rows : []).slice(0, 200).map((r) => (Array.isArray(r) ? r : [r]).slice(0, 26).map((c) => s(c, 500))) };
    default: throw new UserError("kind must be note, checklist, link, code, calc or table (sketches, graphs, voice and files are made on the Scratchpad page).");
  }
}

/** Every type the registry adds, for the prompt. */
export const MORE_DOCS = Object.values(MORE).map((d) => `- ${d.doc}`).join("\n");
