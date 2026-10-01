/**
 * Changes the assistant can make, always on the owner's tap.
 *
 *  prepare  — the model proposes {type, ...}; the server checks every id against the database and writes the button
 *             label itself from real records (never from the model's wording), so a button says what it will do.
 *  apply    — runs through the same service functions the app and the Telegram bot use, so every rule holds.
 *  undo     — before applying, the rows the action can touch are snapshotted; undo restores them exactly, whatever
 *             side effects the service had (closing a task, carry counts, check-back entries, neighbour segments).
 */
import { getPool, q, tx, UserError } from "../db";
import { ACTIVITIES } from "../activity";
import { describeParsed, parseQuickAdd } from "../parser";
import type { Ctx } from "../settings";
import { addDays, fmtDay, fmtHM, type DateStr } from "../time";
import type { EntryStatus, SkipReason } from "../types";
import { addEntry as addDiaryEntry } from "../services/diary";
import { getEntry, logMinutes, moveEntry, setEntryStatus, setSkipReason, setWaiting } from "../services/entries";
import { exerciseSlots, listExerciseTypes, logExercise } from "../services/health";
import { logTouch } from "../services/keep-in-touch";
import { createItem } from "../services/scratch";
import type { SegmentKind } from "../hours";
import { KIND_LABEL, switchState, updateSegment, type StateKind } from "../services/segments";
import { getDay, setInstagram, setScore, setSleep, setSteps, setWorkedOverride } from "../services/days";
import { createFromParsed, createRemark, getTask } from "../services/tasks";
import type { ActionItem } from "./types";
import {
  dateArg, dayName, dayScope, int, localTime, num, quote, restore, s, segmentScope, takeSnapshot, taskScopes,
  type Scope, type Snapshot,
} from "./action-kit";
import { MORE } from "./actions-more";

const BASE_TYPES = [
  "task_status", "log_time", "add_task", "move_task", "waiting", "task_note",
  "switch_state", "edit_segment", "set_day", "log_exercise", "diary_note", "scratch_note", "contact_touch",
] as const;
type BaseType = (typeof BASE_TYPES)[number];
/** every action the assistant can propose: the original set plus the registry in actions-more.ts */
export const ACTION_TYPES: string[] = [...BASE_TYPES, ...Object.keys(MORE)];
export type ActionType = string;
const isBase = (k: string): k is BaseType => (BASE_TYPES as readonly string[]).includes(k);

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

async function entryOrFail(id: number | null) {
  const e = id === null ? null : await getEntry(id);
  if (!e) throw new UserError("That task entry no longer exists.");
  return e;
}

// ---------------------------------------------------------------- prepare

/** Validates one proposed action and writes its label. Throws UserError with a reason the model can read. */
export async function prepareAction(ctx: Ctx, raw: Record<string, unknown>): Promise<Prepared> {
  const kind = s(raw.type, 40);
  if (!ACTION_TYPES.includes(kind)) throw new UserError(`Unknown action "${kind}". Known: ${ACTION_TYPES.join(", ")}.`);
  if (!isBase(kind)) return { kind, ...(await MORE[kind].prepare(ctx, raw)) };

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
      const newKind = s(raw.kind, 20) || seg.kind;
      if (!STATE_KINDS.has(newKind) || newKind === "off") throw new UserError(`kind must be one of ${[...STATE_KINDS].filter((k) => k !== "off").join(", ")}.`);
      const was = `${fmtHM(seg.start_at, ctx.tz)}–${seg.end_at ? fmtHM(seg.end_at, ctx.tz) : "now"}`;
      const now = `${fmtHM(start, ctx.tz)}–${end ? fmtHM(end, ctx.tz) : "now"}`;
      if (was === now && newKind === seg.kind) throw new UserError("That segment already has those times.");
      return {
        kind, params: { segment_id: seg.id, start: start.toISOString(), end: end ? end.toISOString() : null, kind: newKind },
        label: newKind !== seg.kind
          ? `◷ ${KIND_LABEL[seg.kind]} → ${KIND_LABEL[newKind as StateKind]}${was !== now ? `, ${now}` : ` (${was})`}`
          : `◷ ${KIND_LABEL[seg.kind]}: ${was} → ${now}`,
        detail: `${dayName(ctx, seg.date)} · a touching neighbour moves with it`,
      };
    }
    case "set_day": {
      const field = s(raw.field, 24);
      const date = dateArg(ctx, raw.date);
      if (date > ctx.today) throw new UserError("Only today or earlier.");
      if (field === "worked_minutes") {
        if (raw.value === null || /^(clear|none|reset|auto|remove)$/i.test(s(raw.value, 10))) {
          return { kind, params: { field, date, value: null }, label: "↺ Worked time back to automatic", detail: dayName(ctx, date) };
        }
        const m = Math.round(num(raw.value) ?? NaN);
        if (!(m >= 0 && m <= 1440)) throw new UserError("worked_minutes is 0 to 1440, or \"clear\".");
        return { kind, params: { field, date, value: m }, label: `◷ Worked ${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""} (manual)`, detail: dayName(ctx, date) };
      }
      if (field === "sleep_quality") {
        const v = int(raw.value);
        if (v === null || v < 1 || v > 5) throw new UserError("sleep_quality is 1 to 5.");
        const day = await getDay(date);
        if (day?.sleep_minutes == null) throw new UserError("Log the sleep hours first (set_day sleep_minutes).");
        return { kind, params: { field, date, value: v }, label: `☾ Sleep quality ${v}/5`, detail: dayName(ctx, date) };
      }
      // "add": running totals through the day (Instagram, steps)
      if (raw.mode === "add" || raw.add === true) {
        if (field !== "instagram_minutes" && field !== "steps") throw new UserError("mode add works for instagram_minutes and steps.");
        const plus = num(raw.value);
        if (plus === null || plus <= 0) throw new UserError("add needs a positive value.");
        const day = await getDay(date);
        const cur = (field === "steps" ? day?.steps : day?.instagram_minutes) ?? 0;
        const total = Math.round(cur + plus);
        if (field === "instagram_minutes" && total > 1440) throw new UserError("That would be more than 24 hours.");
        return {
          kind, params: { field, date, value: total },
          label: field === "steps" ? `👣 +${Math.round(plus).toLocaleString("en-IN")} steps (= ${total.toLocaleString("en-IN")})` : `Instagram +${Math.round(plus)}m (= ${Math.floor(total / 60)}h${total % 60 ? ` ${total % 60}m` : ""}${total > 60 ? ", over the 1h limit" : ""})`,
          detail: dayName(ctx, date),
        };
      }
      // "clear" (or null) takes the value off, e.g. a score entered by mistake
      if (raw.value === null || /^(clear|none|reset|remove|delete)$/i.test(s(raw.value, 10))) {
        if (!["score", "steps", "sleep_minutes", "instagram_minutes"].includes(field)) throw new UserError("field must be score, steps, sleep_minutes or instagram_minutes.");
        const what = field === "sleep_minutes" ? "sleep" : field === "instagram_minutes" ? "Instagram time" : field;
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
      if (field === "instagram_minutes") {
        if (value < 0 || value > 1440) throw new UserError("instagram_minutes is 0 to 1440.");
        const m = Math.round(value);
        return { kind, params: { field, date, value: m }, label: `Instagram ${m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`}${m > 60 ? " (over the 1h limit)" : ""}`, detail: dayName(ctx, date) };
      }
      throw new UserError("field must be score, steps, sleep_minutes, sleep_quality, instagram_minutes or worked_minutes.");
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
      const at = s(raw.time, 10);
      if (at && !/^\d{1,2}:\d{2}$/.test(at)) throw new UserError("time must look like 15:30.");
      return { kind, params: { type_id: type.id, amount, time: at || null }, label: `💪 ${amount}${type.unit === "seconds" ? "s" : ""} ${type.name}`, detail: at ? `today, the ${at} slot` : "today, next free slot" };
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

// ---------------------------------------------------------------- apply

/** What each action may touch, taken before it runs. */
async function scopesFor(ctx: Ctx, p: Prepared): Promise<Scope[]> {
  const pr = p.params;
  if (!isBase(p.kind)) return MORE[p.kind].scopes(ctx, pr);
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
  if (!isBase(p.kind)) return { result: await MORE[p.kind].run(ctx, pr, undo), undo };
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
        kind: (pr.kind as SegmentKind | undefined) ?? seg.kind, start: new Date(pr.start as string), end: pr.end ? new Date(pr.end as string) : null,
      });
      result = "Times updated.";
      break;
    }
    case "set_day": {
      const d = pr.date as DateStr;
      const v = pr.value as number | null;
      if (pr.field === "score") await setScore(d, v);
      else if (pr.field === "steps") await setSteps(d, v);
      else if (pr.field === "instagram_minutes") await setInstagram(d, v);
      else if (pr.field === "worked_minutes") await setWorkedOverride(d, v);
      else if (pr.field === "sleep_quality") await setSleep(d, (await getDay(d))?.sleep_minutes ?? null, v);
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
      // a named slot ("the 15:30 one") takes the exercise even if it already holds another one
      const wanted = pr.time ? localTime(ctx, pr.time, ctx.today).getTime() : null;
      const named = wanted === null ? null : slots.reduce<Date | null>((b, x) => (!b || Math.abs(x.getTime() - wanted) < Math.abs(b.getTime() - wanted) ? x : b), null);
      if (named && Math.abs(named.getTime() - wanted!) > 20 * 60_000) throw new UserError(`No exercise slot near ${pr.time}.`);
      const slot = named ?? (current && !taken.has(current.getTime()) ? current : null)
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
      // registry actions keep the request as asked, so a tap later re-checks it from the same words
      const { type: _t, ...asked } = raw as Record<string, unknown>;
      const stored = isBase(p.kind) ? p.params : { ...p.params, $raw: asked };
      const [row] = await q<ActionRow>(
        "insert into assistant_actions (chat_id, kind, params, label, detail) values ($1, $2, $3, $4, $5) returning *",
        [chatId, p.kind, JSON.stringify(stored), p.label.slice(0, 200), p.detail?.slice(0, 300) ?? null],
      );
      items.push(toItem(row));
    } catch (e) {
      if (!(e instanceof UserError)) console.error("[assistant] action check failed:", (e as Error).message);
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
    const asked = (row.params.$raw ?? row.params) as Record<string, unknown>;
    const p = await prepareAction(ctx, { ...asked, type: row.kind });
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
