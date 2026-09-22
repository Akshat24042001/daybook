"use server";

import { revalidatePath } from "next/cache";
import { one, q, UserError } from "@/lib/db";
import { describeParsed, parseQuickAdd, type ParsedQuickAdd, type TaskType } from "@/lib/parser";
import { makeCtx, updateSettings, type Ctx, type SettingsPatch } from "@/lib/settings";
import { zonedInstant, addDays, atLogical, parseHM, type DateStr, type TargetPeriod } from "@/lib/time";
import { describeTimeLog, looksLikeTimeLog, parseTimeLog, resolveSegments } from "@/lib/timelog";
import type { EntryStatus } from "@/lib/types";
import {
  addEntry, clearMinutes, getEntry, logMinutes, moveEntry, removeEntry, RETRY_HOURS, scheduleTaskPing,
  setEntryStatus, setMustDo,
} from "@/lib/services/entries";
import { setScore, setSteps, setWorkedOverride } from "@/lib/services/days";
import { reorderSomeday, snoozeCadence } from "@/lib/services/goals";
import {
  createExerciseType, logExercise, updateExerciseType, type ExerciseTypeInput,
} from "@/lib/services/health";
import { finishPlan, triageEntry, type TriageAction } from "@/lib/services/plan";
import {
  createSegment, createSegments, deleteSegment, endOpenSegment, switchState, updateSegment, workedForDate,
  type StateKind,
} from "@/lib/services/segments";
import {
  appendNote, createFromParsed, deleteTask, ensurePerson, ensureProject, findDuplicates, getTask, updateTask,
  type TaskPatch,
} from "@/lib/services/tasks";
import { sendMessage, telegramConfigured } from "@/lib/telegram/api";
import { inline, urlBtn } from "@/lib/telegram/ui";
import { aiConfigured, interpretTaskInput } from "@/lib/ai";

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };
export type ActionResult<T = object> = Ok<T> | Fail;

async function run<T extends object = object>(
  fn: (ctx: Ctx) => Promise<T | void>,
  paths?: string[],
): Promise<ActionResult<T>> {
  try {
    const ctx = await makeCtx();
    const data = (await fn(ctx)) ?? ({} as T);
    // Revalidate only the paths that changed, not the entire layout tree.
    for (const p of paths ?? []) revalidatePath(p);
    return { ok: true, ...data } as Ok<T>;
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error("[action] failed:", (e as Error).name, (e as Error).message);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

/** Reads without revalidating the page (used by live previews). */
async function peek<T extends object>(fn: (ctx: Ctx) => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, ...(await fn(await makeCtx())) } as Ok<T>;
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    return { ok: false, error: "Something went wrong." };
  }
}

// ------------------------------------------------------------------ quick add

export async function duplicatesAction(title: string, project: string | null) {
  return peek(async () => ({ matches: await findDuplicates({ title, project }) }));
}

export type QuickAddMode = "add" | "tomorrow" | "someday" | "existing";

export async function quickAddAction(text: string, opts: { defaultDate?: DateStr; mode?: QuickAddMode; existingTaskId?: number }) {
  return run(async (ctx) => {
    const day = opts.defaultDate ?? ctx.today;
    if (opts.mode === "existing") {
      if (!opts.existingTaskId) throw new UserError("Pick a task.");
      const t = await getTask(opts.existingTaskId);
      if (!t || t.state !== "active") throw new UserError("That task is no longer active.");
      const parsed = parseQuickAdd(text, { now: ctx.now, tz: ctx.tz, boundaryMin: ctx.boundaryMin, defaultDate: day });
      await addEntry(ctx, t.id, day, { mustDo: parsed.mustDo, source: "planned" });
      return { taskId: t.id, message: `Added "${t.title}" to ${day === ctx.today ? "today" : day}.` };
    }
    const parsed = parseQuickAdd(text, { now: ctx.now, tz: ctx.tz, boundaryMin: ctx.boundaryMin, defaultDate: day });
    const created = await createFromParsed(ctx, parsed, {
      ...(opts.mode === "tomorrow" ? { targetDate: addDays(ctx.today, 1) } : {}),
      ...(opts.mode === "someday" ? { type: "someday" as TaskType } : {}),
    });
    const where = created.entry ? (created.entry.date === ctx.today ? "today" : created.entry.date) : opts.mode === "someday" || created.task.type === "someday" ? "the Someday pool" : "your list";
    return { taskId: created.task.id, message: `Added "${created.task.title}" to ${where}.` };
  }, ["/today", "/goals"]);
}

/** Converts natural language to Daybook quick-add syntax using AI (OpenRouter). */
export async function aiInterpretAction(text: string): Promise<ActionResult<{ syntax: string }>> {
  try {
    if (!aiConfigured()) return { ok: false, error: "AI is not configured. Add OPENROUTER_API_KEY to your environment." };
    const syntax = await interpretTaskInput(text);
    return { ok: true, syntax };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Explains a typed/spoken line as a time entry, with the calculated hours, without saving anything. */
export async function timePreviewAction(text: string) {
  return peek(async (ctx) => {
    if (!looksLikeTimeLog(text)) return { isTimeLog: false as const };
    const parsed = parseTimeLog(text, { now: ctx.now, tz: ctx.tz, boundaryMin: ctx.boundaryMin });
    if (!parsed) return { isTimeLog: false as const };
    const d = describeTimeLog(parsed);
    return { isTimeLog: true as const, date: parsed.date, lines: d.lines, workedMin: d.workedMin, errors: parsed.errors };
  });
}

export async function timeSaveAction(text: string) {
  return run(async (ctx) => {
    const tctx = { now: ctx.now, tz: ctx.tz, boundaryMin: ctx.boundaryMin };
    const parsed = parseTimeLog(text, tctx);
    if (!parsed) throw new UserError("I could not find times in that.");
    if (parsed.errors.length) throw new UserError(parsed.errors[0]);
    await createSegments(ctx, resolveSegments(parsed, tctx));
    const worked = await workedForDate(ctx, parsed.date);
    return { date: parsed.date, workedMin: worked };
  }, ["/today"]);
}

// ------------------------------------------------------------------ entries

export async function setStatusAction(entryId: number, status: EntryStatus) {
  return run(async (ctx) => {
    const r = await setEntryStatus(ctx, entryId, status);
    return { taskClosed: r.taskClosed };
  }, ["/today", "/plan"]);
}

export async function logMinutesAction(entryId: number, minutes: number) {
  return run(async (ctx) => {
    const e = await getEntry(entryId);
    if (!e) throw new UserError("That entry no longer exists.");
    await logMinutes(ctx, e.task_id, e.date, minutes, "web");
  }, ["/today"]);
}

export async function clearMinutesAction(entryId: number) {
  return run(async () => {
    const e = await getEntry(entryId);
    if (!e) throw new UserError("That entry no longer exists.");
    await clearMinutes(e.task_id, e.date);
  }, ["/today"]);
}

export async function toggleMustAction(entryId: number, on: boolean) {
  return run(async (ctx) => {
    await setMustDo(ctx, entryId, on);
  }, ["/today", "/plan"]);
}

export async function moveEntryAction(entryId: number, date: DateStr) {
  return run(async (ctx) => {
    await moveEntry(ctx, entryId, date);
  }, ["/today", "/plan"]);
}

export async function removeEntryAction(entryId: number) {
  return run(async () => {
    await removeEntry(entryId);
  }, ["/today", "/plan"]);
}

export async function retryAction(entryId: number, choice: "2h" | "am" | "pm" | { date: DateStr }) {
  return run(async (ctx) => {
    const e = await getEntry(entryId);
    if (!e) throw new UserError("That entry no longer exists.");
    if (choice === "2h") {
      await scheduleTaskPing("task_retry", e.id, new Date(ctx.now.getTime() + 2 * 3_600_000));
      return { message: "I will bring it back in 2 hours (Telegram)." };
    }
    const date = typeof choice === "object" ? choice.date : addDays(ctx.today, 1);
    const hour = typeof choice === "object" ? RETRY_HOURS.tam : RETRY_HOURS[choice === "am" ? "tam" : "tpm"];
    if (date <= e.date) throw new UserError("Pick a later date.");
    const next = await addEntry(ctx, e.task_id, date, { source: "planned" });
    await scheduleTaskPing("task_retry", next.id, atLogical(date, hour * 60, ctx.tz, ctx.boundaryMin));
    return { message: `Retry set for ${date}.` };
  }, ["/today", "/plan"]);
}

// ------------------------------------------------------------------ time tracking

export async function switchStateAction(kind: StateKind) {
  return run(async (ctx) => {
    const r = await switchState(ctx, kind);
    return { changed: r.changed };
  }, ["/today"]);
}

export async function endOpenSegmentAction(minutesAgo: number) {
  return run(async (ctx) => {
    await endOpenSegment(ctx, minutesAgo);
  }, ["/today"]);
}

function localToInstant(ctx: Ctx, value: string): Date {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new UserError("Enter a valid date and time.");
  return zonedInstant(m[1], +m[2], +m[3], ctx.tz);
}

export interface SegmentForm {
  kind: "office" | "outside" | "break";
  start: string;
  end: string | null;
}

export async function createSegmentAction(f: SegmentForm) {
  return run(async (ctx) => {
    await createSegment(ctx, { kind: f.kind, start: localToInstant(ctx, f.start), end: f.end ? localToInstant(ctx, f.end) : null });
  }, ["/today"]);
}
export async function updateSegmentAction(id: number, f: SegmentForm) {
  return run(async (ctx) => {
    await updateSegment(ctx, id, { kind: f.kind, start: localToInstant(ctx, f.start), end: f.end ? localToInstant(ctx, f.end) : null });
  }, ["/today"]);
}
export async function deleteSegmentAction(id: number) {
  return run(async () => {
    await deleteSegment(id);
  }, ["/today"]);
}

export async function setScoreAction(date: DateStr, score: number | null) {
  return run(async () => {
    await setScore(date, score);
  }, ["/today"]);
}
export async function setStepsAction(date: DateStr, steps: number | null) {
  return run(async () => {
    await setSteps(date, steps);
  }, ["/today"]);
}
export async function setWorkedOverrideAction(date: DateStr, minutes: number | null) {
  return run(async () => {
    await setWorkedOverride(date, minutes);
  }, ["/today"]);
}

// ------------------------------------------------------------------ plan and goals

export async function triageAction(entryId: number, action: TriageAction, planDate: DateStr, pickDate?: DateStr) {
  return run(async (ctx) => {
    await triageEntry(ctx, entryId, action, planDate, pickDate);
  }, ["/plan", "/today"]);
}

export async function addToDayAction(taskId: number, date: DateStr, mustDo = false) {
  return run(async (ctx) => {
    await addEntry(ctx, taskId, date, { mustDo, source: "planned" });
  }, ["/today", "/plan", "/goals"]);
}

export async function finishPlanAction(date: DateStr) {
  return run(async (ctx) => {
    await finishPlan(ctx, date);
  }, ["/plan"]);
}

export async function reorderSomedayAction(id: number, dir: "up" | "down") {
  return run(async () => {
    await reorderSomeday(id, dir);
  }, ["/goals"]);
}

export async function snoozeCadenceAction(id: number) {
  return run(async (ctx) => {
    await snoozeCadence(ctx, id);
  }, ["/goals"]);
}

// ------------------------------------------------------------------ health

export async function logExerciseCellAction(slotIso: string, status: "done" | "skipped", typeId: number | null, amount: number | null) {
  return run(async (ctx) => {
    await logExercise(ctx, new Date(slotIso), status, typeId, amount);
  }, ["/health"]);
}
export async function createExerciseTypeAction(input: ExerciseTypeInput) {
  return run(async () => {
    await createExerciseType(input);
  }, ["/health"]);
}
export async function updateExerciseTypeAction(id: number, input: ExerciseTypeInput & { active?: boolean }) {
  return run(async () => {
    await updateExerciseType(id, input);
  }, ["/health"]);
}

// ------------------------------------------------------------------ tasks

export async function updateTaskAction(id: number, patch: TaskPatch) {
  return run(async (ctx) => {
    await updateTask(ctx, id, patch);
  }, ["/today", "/goals"]);
}

export async function deleteTaskAction(id: number) {
  return run(async () => {
    await deleteTask(id);
  }, ["/today", "/goals"]);
}

export async function appendNoteAction(taskId: number, text: string) {
  return run(async (ctx) => {
    await appendNote(ctx, taskId, text);
  }, []);
}

export interface NewTaskForm {
  title: string;
  type: TaskType;
  project: string | null;
  person: string | null;
  personRole: "with" | "requested_by" | null;
  via: string | null;
  isPersonal: boolean;
  estimateMin: number | null;
  date: DateStr | null;
  time: string | null;
  mustDo: boolean;
  cadenceDays: number | null;
  rrule: string | null;
  targetPeriod: TargetPeriod | null;
  goalMin: number | null;
  notes: string | null;
  pendingId?: number | null;
}

export async function createTaskAction(f: NewTaskForm) {
  return run(async (ctx) => {
    const targetDate = f.date ?? ctx.today;
    const parsed: ParsedQuickAdd = {
      raw: f.title,
      title: f.title.trim(),
      project: f.project?.trim() || null,
      mustDo: f.mustDo,
      type: f.type,
      date: f.date,
      targetDate,
      timeMin: f.time ? parseHM(f.time) : null,
      dueAt: f.time ? atLogical(targetDate, parseHM(f.time), ctx.tz, ctx.boundaryMin) : null,
      estimateMin: f.estimateMin,
      cadenceDays: f.type === "cadence" ? f.cadenceDays ?? 7 : null,
      rrule: f.type === "recurring" ? f.rrule : null,
      targetPeriod: f.type === "target" ? f.targetPeriod ?? "week" : null,
      goalMin: f.type === "target" ? f.goalMin : null,
      person: f.person?.trim() || null,
      personRole: f.person?.trim() ? f.personRole ?? "with" : null,
      via: f.via?.trim() || null,
      isPersonal: f.isPersonal,
      notes: [],
      errors: [],
    };
    if (f.type === "recurring" && !f.rrule) throw new UserError("Pick how often this repeats.");
    const { task } = await createFromParsed(ctx, parsed);
    if (f.notes?.trim()) await q("update tasks set notes = $2 where id = $1", [task.id, f.notes.trim()]);
    if (f.pendingId) await q("delete from pending_adds where id = $1", [f.pendingId]);
    return { taskId: task.id };
  }, ["/today", "/goals"]);
}

// ------------------------------------------------------------------ settings

export async function updateSettingsAction(patch: SettingsPatch) {
  return run(async () => {
    await updateSettings(patch);
  }, ["/settings"]);
}

export async function updateProjectAction(id: number, patch: { name?: string; color?: string; archived?: boolean }) {
  return run(async () => {
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new UserError("Project name cannot be empty.");
      const clash = await one("select 1 from projects where lower(name) = lower($1) and id <> $2", [name, id]);
      if (clash) throw new UserError("Another project already has that name.");
      await q("update projects set name = $2 where id = $1", [id, name]);
    }
    if (patch.color !== undefined) {
      if (!/^#[0-9a-fA-F]{6}$/.test(patch.color)) throw new UserError("Colour must look like #22aa88.");
      await q("update projects set color = $2 where id = $1", [id, patch.color]);
    }
    if (patch.archived !== undefined) await q("update projects set archived = $2 where id = $1", [id, patch.archived]);
  }, ["/settings", "/goals"]);
}

export async function createProjectAction(name: string) {
  return run(async () => {
    if (!name.trim()) throw new UserError("Project name cannot be empty.");
    await ensureProject(name);
  }, ["/settings", "/goals"]);
}

export async function createPersonAction(name: string, relation: string | null) {
  return run(async () => {
    if (!name.trim()) throw new UserError("Name cannot be empty.");
    const id = await ensurePerson(name, relation);
    if (relation !== null) await q("update people set relation = $2 where id = $1", [id, relation || null]);
  }, ["/settings"]);
}

export async function updatePersonAction(id: number, patch: { name?: string; relation?: string | null }) {
  return run(async () => {
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new UserError("Name cannot be empty.");
      await q("update people set name = $2 where id = $1", [id, patch.name.trim()]);
    }
    if (patch.relation !== undefined) await q("update people set relation = $2 where id = $1", [id, patch.relation?.trim() || null]);
  }, ["/settings"]);
}

export async function testNotificationAction() {
  return run(async (ctx) => {
    if (!telegramConfigured()) throw new UserError("Telegram is not set up: TELEGRAM_BOT_TOKEN is missing.");
    const env = Number((process.env.TELEGRAM_OWNER_CHAT_ID ?? "").trim());
    const chat = (Number.isFinite(env) && env !== 0 ? env : null) ?? ctx.s.telegram_chat_id;
    if (!chat) throw new UserError("Send /start to your bot in Telegram first, so it can link to your chat.");
    try {
      await sendMessage(chat, "✅ <b>Test notification</b> from Daybook. If you can read this, the bot is connected.", inline([[urlBtn("Open Today", "/today")]]));
    } catch (e) {
      throw new UserError(`Telegram rejected the message: ${(e as Error).message.replace(/^Telegram \w+: /, "")}`);
    }
  });
}

/** Mark a target task as done (completed). */
export async function markTargetDoneAction(id: number) {
  return run(async (ctx) => {
    await q("update tasks set state = 'done', closed_at = $2 where id = $1 and state = 'active'", [id, ctx.now]);
  }, ["/goals"]);
}

/** Close a task as dropped (keeps its history) or bring it back. */
export async function setTaskStateAction(id: number, state: "active" | "dropped") {
  return run(async (ctx) => {
    if (state === "dropped") {
      await q("update tasks set state = 'dropped', closed_at = $2 where id = $1 and state = 'active'", [id, ctx.now]);
      await q("delete from day_entries where task_id = $1 and date > $2 and status = 'open'", [id, ctx.today]);
    } else {
      await q("update tasks set state = 'active', closed_at = null where id = $1", [id]);
    }
  }, ["/goals", "/today"]);
}

import { createContact, updateContact, deleteContact, type Contact } from "@/lib/services/contacts";

export async function createContactAction(data: Omit<Contact, "id" | "created_at">) {
  return run(async () => {
    if (!data.name.trim()) throw new UserError("Name cannot be empty.");
    await createContact({ ...data, name: data.name.trim() });
  }, ["/contacts"]);
}

export async function updateContactAction(id: number, data: Partial<Omit<Contact, "id" | "created_at">>) {
  return run(async () => {
    if (data.name !== undefined && !data.name.trim()) throw new UserError("Name cannot be empty.");
    await updateContact(id, data);
  }, ["/contacts"]);
}

export async function deleteContactAction(id: number) {
  return run(async () => {
    await deleteContact(id);
  }, ["/contacts"]);
}

import { createRef, updateRef, deleteRef, type Ref } from "@/lib/services/refs";

export async function createRefAction(data: Omit<Ref, "id" | "created_at">) {
  return run(async () => {
    if (!data.title.trim()) throw new UserError("Title cannot be empty.");
    await createRef(data);
  }, ["/refs"]);
}

export async function updateRefAction(id: number, data: Partial<Omit<Ref, "id" | "created_at">>) {
  return run(async () => {
    if (data.title !== undefined && !data.title.trim()) throw new UserError("Title cannot be empty.");
    await updateRef(id, data);
  }, ["/refs"]);
}

export async function deleteRefAction(id: number) {
  return run(async () => {
    await deleteRef(id);
  }, ["/refs"]);
}
