import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const replies: string[] = [];
vi.mock("@/lib/ai", () => ({
  aiConfigured: () => true,
  openModels: () => ["test/model:free"],
  chatWithModel: vi.fn(async () => {
    const text = replies.shift();
    if (text === undefined) throw new Error("no scripted reply left");
    return { text, model: "test/model:free" };
  }),
}));

import { applyStoredAction, prepareAction, proposeActions, undoStoredAction } from "@/lib/assistant/actions";
import { runAgent } from "@/lib/assistant/agent";
import { closePool, q, UserError } from "@/lib/db";
import type { Ctx } from "@/lib/settings";
import { ctxAt, ist, resetDb, seedExercises } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await q("truncate assistant_chats, assistant_actions, diary_entries, contacts, scratch_items restart identity cascade");
  replies.length = 0;
});
afterAll(closePool);

/** Proposes, applies and returns the stored action, the way a tap does. */
async function tap(ctx: Ctx, raw: Record<string, unknown>) {
  const { items, rejected } = await proposeActions(ctx, null, [raw]);
  if (!items.length) throw new Error(rejected[0]);
  return applyStoredAction(ctx, items[0].id);
}

async function seedTasks() {
  await q("insert into projects (name) values ('Aivaura')");
  await q("insert into tasks (title, project_id) values ('Send GST invoice', 1), ('Pitch deck', 1)");
  await q(`insert into day_entries (task_id, date, status, must_do) values (1, '2026-09-25', 'open', true), (2, '2026-09-25', 'open', false)`);
}

const snapshotOf = async () => ({
  tasks: await q("select id, state, carry_count, closed_at, last_done_at from tasks order by id"),
  entries: await q("select id, task_id, date, status, reason from day_entries order by id"),
  logs: await q("select task_id, minutes from time_logs order by id"),
});

describe("assistant actions", () => {
  it("labels come from the database, not the model, and bad ids are refused", async () => {
    await seedTasks();
    const ctx = await ctxAt("2026-09-25 16:00");
    const p = await prepareAction(ctx, { type: "task_status", entry_id: 1, status: "done", title: "Something else entirely" });
    expect(p.label).toBe("✓ Done: Send GST invoice");
    expect(p.detail).toBe("today");
    await expect(prepareAction(ctx, { type: "task_status", entry_id: 999, status: "done" })).rejects.toThrow(/no longer exists/);
    await expect(prepareAction(ctx, { type: "drop_database" })).rejects.toThrow(/Unknown action/);
    await expect(prepareAction(ctx, { type: "set_day", field: "score", value: 14 })).rejects.toThrow(/0 to 10/);
    await expect(prepareAction(ctx, { type: "set_day", field: "steps", value: 100, date: "tomorrow" })).rejects.toThrow(/today or earlier/);
  });

  it("marks a task done and undo restores the task, its entries and nothing else", async () => {
    await seedTasks();
    const ctx = await ctxAt("2026-09-25 16:00");
    const before = await snapshotOf();
    const item = await tap(ctx, { type: "task_status", entry_id: 1, status: "done" });
    expect(item.status).toBe("applied");
    expect((await q("select state from tasks where id = 1"))[0]).toEqual({ state: "done" });
    // an unrelated change after the action survives the undo
    await q("update day_entries set status = 'progressed' where id = 2");
    await undoStoredAction(item.id);
    const after = await snapshotOf();
    expect(after.tasks).toEqual(before.tasks);
    expect(after.entries).toEqual(before.entries.map((e) => (e.id === 2 ? { ...e, status: "progressed" } : e)));
  });

  it("Not today with a reason, then undo takes the carry count back", async () => {
    await seedTasks();
    const ctx = await ctxAt("2026-09-25 16:00");
    const item = await tap(ctx, { type: "task_status", entry_id: 2, status: "skipped", reason: "low_energy" });
    expect(item.label).toBe("✗ Not today: Pitch deck");
    expect((await q("select status, reason from day_entries where id = 2"))[0]).toEqual({ status: "skipped", reason: "low_energy" });
    expect((await q("select carry_count from tasks where id = 2"))[0]).toEqual({ carry_count: 1 });
    await undoStoredAction(item.id);
    expect((await q("select status, reason from day_entries where id = 2"))[0]).toEqual({ status: "open", reason: null });
    expect((await q("select carry_count from tasks where id = 2"))[0]).toEqual({ carry_count: 0 });
  });

  it("logs time, adds a task, sets steps, each undone cleanly", async () => {
    await seedTasks();
    const ctx = await ctxAt("2026-09-25 16:00");
    const log = await tap(ctx, { type: "log_time", task_id: 1, minutes: 45 });
    expect(log.label).toBe("⏱ Log 45 min on Send GST invoice");
    const add = await tap(ctx, { type: "add_task", text: "Aivaura: Call the CA ~30m @tom" });
    expect(add.label).toBe("+ Add task: Call the CA");
    const steps = await tap(ctx, { type: "set_day", field: "steps", value: 9100 });
    expect((await q("select steps from days where date = '2026-09-25'"))[0]).toEqual({ steps: 9100 });

    await undoStoredAction(log.id);
    await undoStoredAction(add.id);
    await undoStoredAction(steps.id);
    expect(await q("select * from time_logs")).toEqual([]);
    expect((await q("select title from tasks order by id")).map((r) => r.title)).toEqual(["Send GST invoice", "Pitch deck"]);
    expect(await q("select * from days where date = '2026-09-25'")).toEqual([]);
  });

  it("switches state and undo puts the running segment back", async () => {
    const ctx = await ctxAt("2026-09-25 16:00");
    await q("insert into work_segments (date, kind, start_at) values ('2026-09-25', 'office', $1)", [ist("2026-09-25 10:00")]);
    const item = await tap(ctx, { type: "switch_state", kind: "break" });
    expect(item.label).toBe("● Switch to Break");
    expect((await q("select kind, end_at is null as running from work_segments order by id"))).toEqual([
      { kind: "office", running: false }, { kind: "break", running: true },
    ]);
    await undoStoredAction(item.id);
    expect((await q("select id, kind, end_at from work_segments order by id"))).toEqual([{ id: 1, kind: "office", end_at: null }]);
  });

  it("edits a segment's start, moving the touching neighbour, and undo restores both", async () => {
    const ctx = await ctxAt("2026-09-25 16:30");
    await q(`insert into work_segments (date, kind, start_at, end_at) values ('2026-09-25', 'commute', $1, $2)`, [ist("2026-09-25 15:10"), ist("2026-09-25 15:52")]);
    await q(`insert into work_segments (date, kind, start_at) values ('2026-09-25', 'office', $1)`, [ist("2026-09-25 15:52")]);
    const item = await tap(ctx, { type: "edit_segment", segment_id: 2, start: "15:50" });
    expect(item.label).toBe("◷ At office: 15:52–now → 15:50–now");
    expect((await q("select end_at from work_segments where id = 1"))[0]).toEqual({ end_at: ist("2026-09-25 15:50") });
    await undoStoredAction(item.id);
    expect(await q("select id, start_at, end_at from work_segments order by id")).toEqual([
      { id: 1, start_at: ist("2026-09-25 15:10"), end_at: ist("2026-09-25 15:52") },
      { id: 2, start_at: ist("2026-09-25 15:52"), end_at: null },
    ]);
  });

  it("logs exercise into the current free slot, diary notes and contact touches, all undoable", async () => {
    await seedExercises();
    await q("insert into contacts (name, touch_snoozed_until) values ('Rahul', '2026-10-01')");
    const ctx = await ctxAt("2026-09-25 16:10");
    const ex = await tap(ctx, { type: "log_exercise", exercise: "squat", amount: 25 });
    expect(ex.label).toBe("💪 25 Squats");
    expect(await q("select amount, status, slot_at from exercise_logs")).toEqual([{ amount: 25, status: "done", slot_at: ist("2026-09-25 16:00") }]);
    const note = await tap(ctx, { type: "diary_note", text: "Felt sharp after the walk." });
    const touch = await tap(ctx, { type: "contact_touch", contact_id: 1, kind: "call", note: "about the pilot" });
    expect(touch.label).toBe("☎ Called Rahul");
    expect((await q("select touch_snoozed_until from contacts"))[0]).toEqual({ touch_snoozed_until: null });

    for (const it of [ex, note, touch]) await undoStoredAction(it.id);
    expect(await q("select * from exercise_logs")).toEqual([]);
    expect(await q("select * from diary_entries")).toEqual([]);
    expect(await q("select * from contact_touches")).toEqual([]);
    expect((await q("select touch_snoozed_until from contacts"))[0]).toEqual({ touch_snoozed_until: "2026-10-01" });
  });

  it("re-checks at tap time, applies once, and only undoes what was applied", async () => {
    await seedTasks();
    const ctx = await ctxAt("2026-09-25 16:00");
    const { items } = await proposeActions(ctx, null, [{ type: "log_time", task_id: 2, minutes: 30 }]);
    await expect(undoStoredAction(items[0].id)).rejects.toBeInstanceOf(UserError);
    await applyStoredAction(ctx, items[0].id);
    await applyStoredAction(ctx, items[0].id); // a double tap
    expect(await q("select minutes from time_logs")).toEqual([{ minutes: 30 }]);

    const later = await proposeActions(ctx, null, [{ type: "task_status", entry_id: 1, status: "done" }]);
    await q("delete from tasks where id = 1");
    await expect(applyStoredAction(ctx, later.items[0].id)).rejects.toThrow(/no longer exists/);
    expect((await q("select status, error from assistant_actions where id = $1", [later.items[0].id]))[0]).toEqual({
      status: "failed", error: "That task entry no longer exists.",
    });
  });
});

describe("assistant proposing actions", () => {
  it("feeds rejected actions back once, so the model can look up the right id", async () => {
    await seedTasks();
    replies.push(
      JSON.stringify({ answer: "Tap to apply.", actions: [{ type: "task_status", entry_id: 77, status: "done" }] }),
      JSON.stringify({ queries: [{ name: "q1", sql: "select entry_id from v_task_days where title ilike '%invoice%'" }] }),
      JSON.stringify({ answer: "Tap to apply.", actions: [{ type: "task_status", entry_id: 1, status: "done" }, { type: "switch_state", kind: "nap" }] }),
    );
    const ctx = await ctxAt("2026-09-25 16:00");
    const r = await runAgent({
      ctx, question: "mark the invoice done", history: [], memory: [], snapshot: "", deadline: Date.now() + 60_000,
      emit: { status: () => undefined, query: () => undefined },
      checkAction: async (raw) => {
        try {
          await prepareAction(ctx, raw);
          return null;
        } catch (e) {
          return (e as Error).message;
        }
      },
    });
    // the second rejection is not retried again: the bad action is dropped and the good one kept
    expect(r.actions).toEqual([{ type: "task_status", entry_id: 1, status: "done" }]);
    expect(await q("select status from day_entries where id = 1")).toEqual([{ status: "open" }]); // proposing changes nothing
  });
});
