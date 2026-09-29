/**
 * Changes the assistant can make, always on the owner's tap.
 *
 *  prepare  — the model proposes {type, ...}; the server checks every id against the database and writes the button
 *             label itself from real records (never from the model's wording), so a button says what it will do.
 *  apply    — runs through the same service functions the app and the Telegram bot use, so every rule holds.
 *  undo     — before applying, the rows the action can touch are snapshotted; undo restores them exactly, whatever
 *             side effects the service had (closing a task, carry counts, check-back entries, neighbour segments).
 */
import { getPool, q, tx, UserError, type Db } from "../db";
import { ACTIVITIES } from "../activity";
import { describeParsed, parseQuickAdd } from "../parser";
import type { Ctx } from "../settings";
import { addDays, fmtDay, fmtHM, zonedInstant, type DateStr } from "../time";
import type { EntryStatus, SkipReason } from "../types";
import { addEntry as addDiaryEntry } from "../services/diary";
import { getEntry, logMinutes, moveEntry, setEntryStatus, setSkipReason, setWaiting } from "../services/entries";
import { exerciseSlots, listExerciseTypes, logExercise } from "../services/health";
import { logTouch } from "../services/keep-in-touch";
import { createItem } from "../services/scratch";
import type { SegmentKind } from "../hours";
import { KIND_LABEL, switchState, updateSegment, type StateKind } from "../services/segments";
import { setScore, setSleep, setSteps } from "../services/days";
import { createFromParsed, createRemark, getTask } from "../services/tasks";
import type { ActionItem } from "./types";

export const ACTION_TYPES = [
  "task_status", "log_time", "add_task", "move_task", "waiting", "task_note",
  "switch_state", "edit_segment", "set_day", "log_exercise", "diary_note", "scratch_note", "contact_touch",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface Prepared {
  kind: ActionType;
  params: Record<string, unknown>;
  label: string;
  detail: string | null;
}

// ---------------------------------------------------------------- helpers

const STATUS_LABEL: Record<string, string> = {
  done: "✓ Done", progressed: "↗ Progressed", attempted: "↻ Tried", skipped: "✗ Not today", dropped: "⌫ Drop", open: "↺ Reopen",
};
const REASONS: SkipReason[] = ["no_time", "low_energy", "blocked", "not_important"];
const REASON_LABEL: Record<string, string> = { no_time: "no time", low_energy: "low energy", blocked: "blocked", not_important: "not important" };
const STATE_KINDS = new Set<string>([...ACTIVITIES.map((a) => a.kind), "off"]);

const s = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
};
const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const quote = (t: string, max = 60) => `“${t.length > max ? `${t.slice(0, max - 1)}…` : t}”`;

/** "today", "tomorrow", "yesterday" or YYYY-MM-DD. */
function dateArg(ctx: Ctx, v: unknown, fallback: DateStr = ctx.today): DateStr {
  const t = s(v, 20).toLowerCase();
  if (!t || t === "today") return fallback;
  if (t === "tomorrow") return addDays(ctx.today, 1);
  if (t === "yesterday") return addDays(ctx.today, -1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  throw new UserError(`"${t}" is not a date.`);
}

const dayName = (ctx: Ctx, d: DateStr) =>
  d === ctx.today ? "today" : d === addDays(ctx.today, 1) ? "tomorrow" : d === addDays(ctx.today, -1) ? "yesterday" : fmtDay(d, ctx.today);

/** "15:50" on the given logical date, or "YYYY-MM-DD 15:50". Times before the day boundary fall on the next calendar day. */
function localTime(ctx: Ctx, v: unknown, date: DateStr): Date {
  const t = s(v, 40);
  // an exact instant (how a prepared action stores it)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(t)) return new Date(t);
  const full = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/.exec(t);
  if (full) return zonedInstant(full[1], +full[2], +full[3], ctx.tz);
  const hm = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!hm || +hm[1] > 23 || +hm[2] > 59) throw new UserError(`"${t}" is not a time.`);
  const min = +hm[1] * 60 + +hm[2];
  return zonedInstant(min < ctx.boundaryMin ? addDays(date, 1) : date, +hm[1], +hm[2], ctx.tz);
}

async function entryOrFail(id: number | null) {
  const e = id === null ? null : await getEntry(id);
  if (!e) throw new UserError("That task entry no longer exists.");
  return e;
}

// ---------------------------------------------------------------- prepare

/** Validates one proposed action and writes its label. Throws UserError with a reason the model can read. */
export async function prepareAction(ctx: Ctx, raw: Record<string, unknown>): Promise<Prepared> {
  const kind = s(raw.type, 40) as ActionType;
  if (!ACTION_TYPES.includes(kind)) throw new UserError(`Unknown action "${kind}".`);

  switch (kind) {
    case "task_status": {
      const e = await entryOrFail(int(raw.entry_id));
      const status = s(raw.status, 20) as EntryStatus;
      if (!(status in STATUS_LABEL)) throw new UserError("status must be done, progressed, attempted, skipped, dropped or open.");
      const reason = status === "skipped" && REASONS.includes(s(raw.reason, 20) as SkipReason) ? s(raw.reason, 20) : null;
      return {
        kind, params: { entry_id: e.id, status, reason },
        label: `${STATUS_LABEL[status]}: ${e.title}`,
        detail: [dayName(ctx, e.date), e.status !== "open" ? `now ${e.status === "skipped" ? "not today" : e.status}` : null, reason ? REASON_LABEL[reason] : null].filter(Boolean).join(" · "),
      };
    }
    case "log_time": {
      const task = int(raw.task_id) === null ? null : await getTask(int(raw.task_id)!);
      if (!task) throw new UserError("That task does not exist.");
      const minutes = Math.round(num(raw.minutes) ?? 0);
      if (minutes < 1 || minutes > 1440) throw new UserError("minutes must be 1 to 1440.");
      const date = dateArg(ctx, raw.date);
      if (date > ctx.today) throw new UserError("Time cannot be logged on a future day.");
      return {
        kind, params: { task_id: task.id, minutes, date },
        label: `⏱ Log ${minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` : `${minutes} min`} on ${task.title}`,
        detail: dayName(ctx, date),
      };
    }
    case "add_task": {
      const text = s(raw.text, 300);
      if (!text) throw new UserError("add_task needs text.");
      const parsed = parseQuickAdd(text, { now: ctx.now, tz: ctx.tz, boundaryMin: ctx.boundaryMin, defaultDate: ctx.today });
      if (parsed.errors.length) throw new UserError(parsed.errors[0]);
      if (!parsed.title) throw new UserError("add_task text has no title.");
      return {
        kind, params: { text },
        label: `+ Add task: ${parsed.title}`,
        detail: describeParsed(parsed, { tz: ctx.tz, today: ctx.today }).join(" · ").slice(0, 200) || null,
      };
    }
    case "move_task": {
      const e = await entryOrFail(int(raw.entry_id));
      const date = dateArg(ctx, raw.date);
      if (date === e.date) throw new UserError("The task is already on that day.");
      return { kind, params: { entry_id: e.id, date }, label: `→ Move ${e.title} to ${dayName(ctx, date)}`, detail: `from ${dayName(ctx, e.date)}` };
    }
    case "waiting": {
      const e = await entryOrFail(int(raw.entry_id));
      const until = dateArg(ctx, raw.until, addDays(e.date, 2));
      if (until <= e.date) throw new UserError("until must be after the task's day.");
      const on = s(raw.on, 80) || null;
      return { kind, params: { entry_id: e.id, until, on }, label: `⏳ Waiting${on ? ` on ${on}` : ""}: ${e.title}`, detail: `back on ${fmtDay(until, ctx.today)}` };
    }
    case "task_note": {
      const task = int(raw.task_id) === null ? null : await getTask(int(raw.task_id)!);
      if (!task) throw new UserError("That task does not exist.");
      const text = s(raw.text, 2000);
      if (!text) throw new UserError("task_note needs text.");
      return { kind, params: { task_id: task.id, text }, label: `✎ Note on ${task.title}`, detail: quote(text, 90) };
    }
    case "switch_state": {
      const k = s(raw.kind, 20);
      if (!STATE_KINDS.has(k)) throw new UserError(`kind must be one of ${[...STATE_KINDS].join(", ")}.`);
      return { kind, params: { kind: k }, label: k === "off" ? "■ Day end" : `● Switch to ${KIND_LABEL[k as StateKind]}`, detail: `from ${fmtHM(ctx.now, ctx.tz)}` };
    }
    case "edit_segment": {
      const id = int(raw.segment_id);
      const seg = id === null ? null : (await q<{ id: number; date: DateStr; kind: StateKind; start_at: Date; end_at: Date | null }>(
        "select id, date, kind, start_at, end_at from work_segments where id = $1", [id]))[0];
      if (!seg) throw new UserError("That time segment does not exist.");
      const start = raw.start !== undefined && raw.start !== null && raw.start !== "" ? localTime(ctx, raw.start, seg.date) : seg.start_at;
      const end = raw.end === "running" || raw.end === null ? null
        : raw.end !== undefined && raw.end !== "" ? localTime(ctx, raw.end, seg.date) : seg.end_at;
      if (end && end <= start) throw new UserError("end must be after start.");
      const was = `${fmtHM(seg.start_at, ctx.tz)}–${seg.end_at ? fmtHM(seg.end_at, ctx.tz) : "now"}`;
      const now = `${fmtHM(start, ctx.tz)}–${end ? fmtHM(end, ctx.tz) : "now"}`;
      if (was === now) throw new UserError("That segment already has those times.");
      return {
        kind, params: { segment_id: seg.id, start: start.toISOString(), end: end ? end.toISOString() : null },
        label: `◷ ${KIND_LABEL[seg.kind]}: ${was} → ${now}`,
        detail: `${dayName(ctx, seg.date)} · a touching neighbour moves with it`,
      };
    }
    case "set_day": {
      const field = s(raw.field, 20);
      const date = dateArg(ctx, raw.date);
      if (date > ctx.today) throw new UserError("Only today or earlier.");
      // "clear" (or null) takes the value off, e.g. a score entered by mistake
      if (raw.value === null || /^(clear|none|reset|remove|delete)$/i.test(s(raw.value, 10))) {
        if (!["score", "steps", "sleep_minutes"].includes(field)) throw new UserError("field must be score, steps or sleep_minutes.");
        const what = field === "sleep_minutes" ? "sleep" : field;
        return { kind, params: { field, date, value: null }, label: `⌫ Clear ${what}`, detail: dayName(ctx, date) };
      }
      const value = num(raw.value);
      if (value === null) throw new UserError("set_day needs a numeric value, or \"clear\".");
      if (field === "score") {
        if (value < 0 || value > 10) throw new UserError("score is 0 to 10.");
        return { kind, params: { field, date, value: Math.round(value * 10) / 10 }, label: `★ Score ${Math.round(value * 10) / 10}/10`, detail: dayName(ctx, date) };
      }
      if (field === "steps") {
        if (value < 0 || value > 200000) throw new UserError("steps is 0 to 200000.");
        return { kind, params: { field, date, value: Math.round(value) }, label: `👣 Steps ${Math.round(value).toLocaleString("en-IN")}`, detail: dayName(ctx, date) };
      }
      if (field === "sleep_minutes") {
        if (value < 0 || value > 1440) throw new UserError("sleep_minutes is 0 to 1440.");
        const m = Math.round(value);
        return { kind, params: { field, date, value: m }, label: `☾ Sleep ${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`, detail: `into ${dayName(ctx, date)}` };
      }
      throw new UserError("field must be score, steps or sleep_minutes.");
    }
    case "log_exercise": {
      const name = s(raw.exercise, 60).toLowerCase().replace(/[-_]/g, " ").replace(/s\b/g, "");
      const types = await listExerciseTypes(true);
      const type = types.find((t) => {
        const n = t.name.toLowerCase().replace(/[-_]/g, " ").replace(/s\b/g, "");
        return n === name || n.includes(name) || name.includes(n);
      });
      if (!type) throw new UserError(`No exercise type matches "${s(raw.exercise, 60)}". Known: ${types.map((t) => t.name).join(", ")}.`);
      const amount = Math.round(num(raw.amount) ?? type.default_amount);
      if (amount < 1 || amount > 100000) throw new UserError("amount must be positive.");
      return { kind, params: { type_id: type.id, amount }, label: `💪 ${amount}${type.unit === "seconds" ? "s" : ""} ${type.name}`, detail: "today, next free slot" };
    }
    case "diary_note": {
      const text = s(raw.text, 5000);
      if (!text) throw new UserError("diary_note needs text.");
      const date = dateArg(ctx, raw.date);
      if (date > ctx.today) throw new UserError("Only today or earlier.");
      return { kind, params: { text, date }, label: `✎ Diary: ${quote(text)}`, detail: dayName(ctx, date) };
    }
    case "scratch_note": {
      const text = s(raw.text, 20000);
      if (!text) throw new UserError("scratch_note needs text.");
      const title = s(raw.title, 120);
      return { kind, params: { text, title }, label: `✎ Scratchpad: ${title || quote(text)}`, detail: "today" };
    }
    case "contact_touch": {
      const id = int(raw.contact_id);
      const c = id === null ? null : (await q<{ id: number; name: string }>("select id, name from contacts where id = $1", [id]))[0];
      if (!c) throw new UserError("That contact does not exist.");
      const k = ["call", "meet", "message", "other"].includes(s(raw.kind, 10)) ? s(raw.kind, 10) : "other";
      const date = dateArg(ctx, raw.date);
      if (date > ctx.today) throw new UserError("Only today or earlier.");
      const note = s(raw.note, 500) || null;
      const verb = { call: "☎ Called", meet: "☕ Met", message: "✉ Messaged", other: "✓ In touch with" }[k];
      return { kind, params: { contact_id: c.id, kind: k, date, note }, label: `${verb} ${c.name}`, detail: [dayName(ctx, date), note ? quote(note, 60) : null].filter(Boolean).join(" · ") };
    }
  }
}

// ---------------------------------------------------------------- snapshots

interface Scope { table: string; key: string; where: string; params: unknown[] }
interface Snapshot { scopes: (Scope & { rows: Record<string, unknown>[] })[]; created: { table: string; id: number }[] }

const TABLES = new Set(["tasks", "day_entries", "time_logs", "task_remarks", "work_segments", "days", "exercise_logs", "contacts"]);
const CREATED_TABLES = new Set(["tasks", "diary_entries", "scratch_items", "contact_touches", "task_remarks", "time_logs"]);

const taskScopes = (taskId: number): Scope[] => [
  { table: "tasks", key: "id", where: "id = $1", params: [taskId] },
  { table: "day_entries", key: "id", where: "task_id = $1", params: [taskId] },
  { table: "time_logs", key: "id", where: "task_id = $1", params: [taskId] },
  { table: "task_remarks", key: "id", where: "task_id = $1", params: [taskId] },
];
const dayScope = (date: DateStr): Scope => ({ table: "days", key: "date", where: "date = $1", params: [date] });
const segmentScope = (from: DateStr, to: DateStr): Scope => ({
  table: "work_segments", key: "id", where: "(date between $1 and $2) or end_at is null", params: [from, to],
});

async function takeSnapshot(scopes: Scope[], db: Db): Promise<Snapshot> {
  const out: Snapshot = { scopes: [], created: [] };
  for (const sc of scopes) {
    if (!TABLES.has(sc.table)) throw new Error(`no snapshots for ${sc.table}`);
    const rows = await q<Record<string, unknown>>(`select * from ${sc.table} where ${sc.where}`, sc.params, db);
    out.scopes.push({ ...sc, rows });
  }
  return out;
}

const toParam = (v: unknown) => (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) ? JSON.stringify(v) : v);

async function restore(snap: Snapshot, db: Db): Promise<void> {
  for (const c of snap.created) {
    if (!CREATED_TABLES.has(c.table)) continue;
    await db.query(`delete from ${c.table} where id = $1`, [c.id]);
  }
  // parents before children on upsert, children before parents on delete
  const order = ["tasks", "day_entries", "time_logs", "task_remarks", "work_segments", "days", "exercise_logs", "contacts"];
  const scopes = [...snap.scopes].sort((a, b) => order.indexOf(a.table) - order.indexOf(b.table));
  for (const sc of [...scopes].reverse()) {
    if (!TABLES.has(sc.table)) continue;
    const keys = sc.rows.map((r) => r[sc.key]);
    const n = sc.params.length;
    await db.query(
      `delete from ${sc.table} where (${sc.where}) and not (${sc.key} = any($${n + 1}))`,
      [...sc.params, keys],
    );
  }
  for (const sc of scopes) {
    if (!TABLES.has(sc.table)) continue;
    for (const row of sc.rows) {
      const cols = Object.keys(row).filter((c) => /^[a-z_]+$/.test(c));
      const vals = cols.map((c) => toParam(row[c]));
      const set = cols.filter((c) => c !== sc.key).map((c) => `${c} = excluded.${c}`).join(", ");
      await db.query(
        `insert into ${sc.table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})
         on conflict (${sc.key}) do update set ${set}`,
        vals,
      );
    }
  }
}

// ---------------------------------------------------------------- apply

/** What each action may touch, taken before it runs. */
async function scopesFor(ctx: Ctx, p: Prepared): Promise<Scope[]> {
  const pr = p.params;
  switch (p.kind) {
    case "task_status":
    case "move_task":
    case "waiting": {
      const e = await entryOrFail(pr.entry_id as number);
      return taskScopes(e.task_id);
    }
    case "log_time":
    case "task_note":
      return taskScopes(pr.task_id as number);
    case "switch_state":
      return [segmentScope(addDays(ctx.today, -1), addDays(ctx.today, 1)), dayScope(ctx.today)];
    case "edit_segment": {
      const [seg] = await q<{ date: DateStr }>("select date from work_segments where id = $1", [pr.segment_id]);
      if (!seg) throw new UserError("That time segment no longer exists.");
      return [segmentScope(addDays(seg.date, -1), addDays(seg.date, 1))];
    }
    case "set_day":
      return [dayScope(pr.date as DateStr)];
    case "log_exercise":
      return [{ table: "exercise_logs", key: "id", where: "date = $1", params: [ctx.today] }];
    case "contact_touch":
      return [{ table: "contacts", key: "id", where: "id = $1", params: [pr.contact_id] }];
    default:
      return [];
  }
}

/** Runs a prepared action. Returns a short result line and the snapshot that undoes it. */
export async function runAction(ctx: Ctx, p: Prepared): Promise<{ result: string; undo: Snapshot }> {
  const pool = getPool();
  const undo = await takeSnapshot(await scopesFor(ctx, p), pool);
  const pr = p.params;
  let result = "Done.";
  switch (p.kind) {
    case "task_status": {
      const r = await setEntryStatus(ctx, pr.entry_id as number, pr.status as EntryStatus);
      if (pr.status === "skipped" && pr.reason) await setSkipReason(pr.entry_id as number, pr.reason as SkipReason);
      result = r.taskClosed ? "Task closed." : "Updated.";
      break;
    }
    case "log_time":
      await logMinutes(ctx, pr.task_id as number, pr.date as DateStr, pr.minutes as number, "web");
      result = "Time logged.";
      break;
    case "add_task": {
      const parsed = parseQuickAdd(pr.text as string, { now: ctx.now, tz: ctx.tz, boundaryMin: ctx.boundaryMin, defaultDate: ctx.today });
      const created = await createFromParsed(ctx, parsed);
      undo.created.push({ table: "tasks", id: created.task.id });
      result = created.entry ? `Added to ${dayName(ctx, created.entry.date)}.` : "Added.";
      break;
    }
    case "move_task":
      await moveEntry(ctx, pr.entry_id as number, pr.date as DateStr);
      result = "Moved.";
      break;
    case "waiting":
      await setWaiting(ctx, pr.entry_id as number, pr.until as DateStr, (pr.on as string | null) ?? null);
      result = "Parked until the check-back day.";
      break;
    case "task_note": {
      const r = await createRemark(pr.task_id as number, pr.text as string);
      undo.created.push({ table: "task_remarks", id: r.id });
      result = "Note added.";
      break;
    }
    case "switch_state": {
      const r = await switchState(ctx, pr.kind as StateKind);
      result = r.changed ? "Switched." : "Already in that state.";
      break;
    }
    case "edit_segment": {
      const [seg] = await q<{ kind: SegmentKind }>("select kind from work_segments where id = $1", [pr.segment_id]);
      await updateSegment(ctx, pr.segment_id as number, {
        kind: seg.kind, start: new Date(pr.start as string), end: pr.end ? new Date(pr.end as string) : null,
      });
      result = "Times updated.";
      break;
    }
    case "set_day": {
      const d = pr.date as DateStr;
      const v = pr.value as number | null;
      if (pr.field === "score") await setScore(d, v);
      else if (pr.field === "steps") await setSteps(d, v);
      else await setSleep(d, v);
      if (v === null) result = "Cleared.";
      else result = "Saved.";
      break;
    }
    case "log_exercise": {
      const taken = new Set((await q<{ t: number }>("select extract(epoch from slot_at)::bigint * 1000 as t from exercise_logs where date = $1", [ctx.today])).map((r) => Number(r.t)));
      const slots = exerciseSlots(ctx, ctx.today);
      const free = slots.filter((x) => !taken.has(x.getTime()));
      // the current slot if it is free, else the next free one, else the latest free one
      const current = [...slots].reverse().find((x) => x.getTime() <= ctx.now.getTime());
      const slot = (current && !taken.has(current.getTime()) ? current : null)
        ?? free.find((x) => x.getTime() >= ctx.now.getTime()) ?? free[free.length - 1];
      if (!slot) throw new UserError("Every exercise slot today is already logged.");
      await logExercise(ctx, slot, "done", pr.type_id as number, pr.amount as number);
      result = `Logged in the ${fmtHM(slot, ctx.tz)} slot.`;
      break;
    }
    case "diary_note": {
      const r = await addDiaryEntry(pr.date as DateStr, pr.text as string, "text");
      undo.created.push({ table: "diary_entries", id: r.id });
      result = "Added to the diary.";
      break;
    }
    case "scratch_note": {
      const r = await createItem(ctx.today, "note", pr.title, { text: pr.text });
      undo.created.push({ table: "scratch_items", id: r.id });
      result = "On today's scratchpad.";
      break;
    }
    case "contact_touch": {
      await logTouch(pr.contact_id as number, pr.date as DateStr, pr.kind as "call", (pr.note as string | null) ?? null);
      const [t] = await q<{ id: number }>("select id from contact_touches where contact_id = $1 order by id desc limit 1", [pr.contact_id]);
      if (t) undo.created.push({ table: "contact_touches", id: t.id });
      result = "Logged.";
      break;
    }
  }
  return { result, undo };
}

// ---------------------------------------------------------------- storage

interface ActionRow {
  id: number; chat_id: number | null; kind: ActionType; params: Record<string, unknown>; label: string; detail: string | null;
  status: ActionItem["status"]; error: string | null; undo: Snapshot | null;
}
const toItem = (r: ActionRow): ActionItem => ({ id: r.id, label: r.label, detail: r.detail, status: r.status, error: r.error });

/** Checks the model's proposals and stores the valid ones. Invalid ones come back as reasons. */
export async function proposeActions(ctx: Ctx, chatId: number | null, raws: unknown[]): Promise<{ items: ActionItem[]; rejected: string[] }> {
  const items: ActionItem[] = [];
  const rejected: string[] = [];
  for (const raw of raws.slice(0, 12)) {
    try {
      if (!raw || typeof raw !== "object") throw new UserError("not an object");
      const p = await prepareAction(ctx, raw as Record<string, unknown>);
      const [row] = await q<ActionRow>(
        "insert into assistant_actions (chat_id, kind, params, label, detail) values ($1, $2, $3, $4, $5) returning *",
        [chatId, p.kind, JSON.stringify(p.params), p.label.slice(0, 200), p.detail?.slice(0, 300) ?? null],
      );
      items.push(toItem(row));
    } catch (e) {
      rejected.push(`${s((raw as { type?: unknown })?.type, 40) || "action"}: ${e instanceof UserError ? e.message : "invalid"}`);
    }
  }
  return { items, rejected };
}

export async function applyStoredAction(ctx: Ctx, id: number): Promise<ActionItem> {
  const [row] = await q<ActionRow>("select * from assistant_actions where id = $1", [id]);
  if (!row) throw new UserError("That action no longer exists.");
  if (row.status === "applied") return toItem(row);
  try {
    // re-check against the data as it is now: things may have changed since it was proposed
    const p = await prepareAction(ctx, { type: row.kind, ...row.params });
    const { result, undo } = await runAction(ctx, p);
    const [done] = await q<ActionRow>(
      "update assistant_actions set status = 'applied', undo = $2, error = null, detail = $3, applied_at = now() where id = $1 returning *",
      [id, JSON.stringify(undo), [row.detail, result].filter(Boolean).join(" · ").slice(0, 300)],
    );
    return toItem(done);
  } catch (e) {
    const msg = e instanceof UserError ? e.message : "That did not work.";
    await q("update assistant_actions set status = 'failed', error = $2 where id = $1", [id, msg]);
    throw e instanceof UserError ? e : new UserError(msg);
  }
}

export async function undoStoredAction(id: number): Promise<ActionItem> {
  const [row] = await q<ActionRow>("select * from assistant_actions where id = $1", [id]);
  if (!row) throw new UserError("That action no longer exists.");
  if (row.status !== "applied" || !row.undo) throw new UserError("Only an applied action can be undone.");
  await tx(async (db) => restore(row.undo!, db));
  const [done] = await q<ActionRow>("update assistant_actions set status = 'undone', undone_at = now() where id = $1 returning *", [id]);
  return toItem(done);
}
