import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai", () => ({
  aiConfigured: () => true,
  openModels: () => ["test/model:free"],
  chatWithModel: vi.fn(async () => {
    throw new Error("no AI in this test");
  }),
}));

import { ACTION_TYPES, applyStoredAction, prepareAction, proposeActions, undoStoredAction } from "@/lib/assistant/actions";
import { MORE_DOCS } from "@/lib/assistant/actions-more";
import { closePool, q } from "@/lib/db";
import { getSettings, type Ctx } from "@/lib/settings";
import { ctxAt, resetDb, seedExercises } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await q("truncate assistant_chats, assistant_actions, diary_entries, contacts, scratch_items, refs restart identity cascade");
  await q("delete from reviews");
});
afterAll(closePool);

async function tap(ctx: Ctx, raw: Record<string, unknown>) {
  const { items, rejected } = await proposeActions(ctx, null, [raw]);
  if (!items.length) throw new Error(rejected[0]);
  const applied = await applyStoredAction(ctx, items[0].id);
  return { id: items[0].id, label: items[0].label, detail: items[0].detail, applied };
}
const reason = async (ctx: Ctx, raw: Record<string, unknown>) =>
  (await proposeActions(ctx, null, [raw])).rejected[0] ?? null;

describe("the assistant can change everything the app can", () => {
  it("knows an action for every kind of record, and documents each one", () => {
    for (const t of [
      "update_task", "delete_task", "set_task_state", "must_do", "add_to_day", "remove_from_day", "add_project", "update_project",
      "delete_project", "add_person", "add_contact", "update_contact", "delete_contact", "add_ref", "update_ref", "delete_ref",
      "edit_diary", "delete_diary", "add_scratch", "update_scratch", "delete_scratch", "add_segment", "delete_segment",
      "add_exercise_type", "update_exercise_type", "delete_exercise_type", "delete_exercise_log", "set_intentions",
      "mark_intention", "update_settings",
    ]) {
      expect(ACTION_TYPES, t).toContain(t);
      expect(MORE_DOCS, t).toContain(`- ${t}:`);
    }
  });

  it("edits a task (show-from time, repeat rule, project) and undo restores it exactly", async () => {
    const ctx = await ctxAt("2026-09-25 10:00");
    await q("insert into tasks (title) values ('Evening walk')");
    const before = await q("select * from tasks");
    const r = await tap(ctx, { type: "update_task", task_id: 1, show_from: "6pm", repeat: "every day except sun", project: "Health" });
    expect(r.label).toBe("✎ Edit: Evening walk");
    expect(r.detail).toContain("shows from 18:00");
    const [t] = await q<{ show_from: string; type: string; rrule: string; project_id: number }>("select * from tasks");
    expect(t).toMatchObject({ show_from: "18:00", type: "recurring" });
    expect(t.rrule).toContain("BYDAY=MO,TU,WE,TH,FR,SA");
    expect(t.project_id).not.toBeNull();
    await undoStoredAction(r.id);
    expect(await q("select * from tasks")).toEqual(before);
    expect(await reason(ctx, { type: "update_task", task_id: 1, show_from: "25:99" })).toMatch(/not a valid time|look like/);
    expect(await reason(ctx, { type: "update_task", task_id: 99, title: "x" })).toMatch(/does not exist/);
  });

  it("deletes a task with its history, and undo brings all of it back", async () => {
    const ctx = await ctxAt("2026-09-25 10:00");
    await q("insert into tasks (title) values ('Pitch deck')");
    await q("insert into day_entries (task_id, date, status) values (1, '2026-09-24', 'progressed'), (1, '2026-09-25', 'open')");
    await q("insert into time_logs (task_id, date, minutes, source) values (1, '2026-09-24', 45, 'web')");
    await q("insert into task_remarks (task_id, body) values (1, 'needs the new numbers')");
    const snap = async () => [await q("select * from tasks"), await q("select * from day_entries order by id"), await q("select * from time_logs"), await q("select * from task_remarks")];
    const before = await snap();
    const r = await tap(ctx, { type: "delete_task", task_id: 1 });
    expect(r.label).toBe("🗑 Delete task: Pitch deck");
    expect(r.detail).toContain("2 days of history");
    expect(await q("select * from tasks")).toEqual([]);
    await undoStoredAction(r.id);
    expect(await snap()).toEqual(before);
  });

  it("creates, edits and deletes projects, contacts and references, each undoable", async () => {
    const ctx = await ctxAt("2026-09-25 10:00");
    const p = await tap(ctx, { type: "add_project", name: "Talenlo", weekly_goal_hours: 10 });
    expect((await q<{ name: string; weekly_target_min: number }>("select name, weekly_target_min from projects"))[0]).toEqual({ name: "Talenlo", weekly_target_min: 600 });
    await q("insert into tasks (title, project_id) values ('Hire designer', 1)");
    const del = await tap(ctx, { type: "delete_project", project_id: 1 });
    expect(await q("select * from projects")).toEqual([]);
    expect((await q<{ project_id: number | null }>("select project_id from tasks"))[0].project_id).toBeNull();
    await undoStoredAction(del.id);
    expect((await q<{ project_id: number }>("select project_id from tasks"))[0].project_id).toBe(1);
    await undoStoredAction(p.id);

    const c = await tap(ctx, { type: "add_contact", name: "Rahul Mehta", companies: "Acme, Beta", cities: ["Mumbai"], touch_every_days: 14 });
    const [row] = await q<{ companies: string[]; touch_every_days: number }>("select companies, touch_every_days from contacts");
    expect(row).toEqual({ companies: ["Acme", "Beta"], touch_every_days: 14 });
    await tap(ctx, { type: "contact_touch", contact_id: 1, kind: "call" });
    const before = [await q("select * from contacts"), await q("select * from contact_touches")];
    const gone = await tap(ctx, { type: "delete_contact", contact_id: 1 });
    expect(await q("select * from contacts")).toEqual([]);
    await undoStoredAction(gone.id);
    expect([await q("select * from contacts"), await q("select * from contact_touches")]).toEqual(before);
    expect(c.applied.status).toBe("applied");

    await tap(ctx, { type: "add_ref", title: "Paul Graham: Do things that don't scale", url: "https://paulgraham.com/ds.html", tags: ["startups"] });
    const upd = await tap(ctx, { type: "update_ref", ref_id: 1, pinned: true });
    expect((await q<{ pinned: boolean }>("select pinned from refs"))[0].pinned).toBe(true);
    await undoStoredAction(upd.id);
    expect((await q<{ pinned: boolean }>("select pinned from refs"))[0].pinned).toBe(false);
    expect(await reason(ctx, { type: "add_ref", title: "x", url: "javascript:alert(1)" })).toMatch(/http/);
  });

  it("changes settings, e.g. working days, and undo puts the old ones back", async () => {
    const ctx = await ctxAt("2026-09-25 10:00");
    const r = await tap(ctx, { type: "update_settings", working_days: "mon-fri", step_goal: 9000, lunch_start: "13:00", lunch_end: "14:00" });
    expect(r.detail).toContain("working days Mon Tue Wed Thu Fri");
    expect((await q<{ working_days: number[]; step_goal: number }>("select working_days, step_goal from settings"))[0]).toEqual({ working_days: [1, 2, 3, 4, 5], step_goal: 9000 });
    await undoStoredAction(r.id);
    getSettings.toString(); // cache() is per request; read straight from the table
    expect((await q<{ working_days: number[] }>("select working_days from settings"))[0].working_days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await reason(ctx, { type: "update_settings", telegram_chat_id: 5 })).toMatch(/not a setting/);
  });

  it("sets this week's intentions and marks one; undo restores the review row (composite key)", async () => {
    const ctx = await ctxAt("2026-09-23 10:00");
    const set = await tap(ctx, { type: "set_intentions", period: "week", items: ["Ship the proposal", "Gym 4x"] });
    const mark = await tap(ctx, { type: "mark_intention", period: "week", index: 1, done: true });
    const rows = await q<{ start_date: string; intentions: { text: string; done: boolean | null }[] }>("select start_date, intentions from reviews");
    expect(rows[0].start_date).toBe("2026-09-21");
    expect(rows[0].intentions).toEqual([{ text: "Ship the proposal", done: null }, { text: "Gym 4x", done: true }]);
    await undoStoredAction(mark.id);
    expect((await q<{ intentions: { done: boolean | null }[] }>("select intentions from reviews"))[0].intentions[1].done).toBeNull();
    await undoStoredAction(set.id);
    expect(await q("select * from reviews")).toEqual([]);
  });

  it("adds Instagram time as the day goes on, and logs worked time by hand", async () => {
    const ctx = await ctxAt("2026-09-25 20:00");
    await tap(ctx, { type: "set_day", field: "instagram_minutes", value: 45 });
    const add = await tap(ctx, { type: "set_day", field: "instagram_minutes", value: 30, mode: "add" });
    expect(add.label).toBe("Instagram +30m (= 1h 15m, over the 1h limit)");
    expect((await q<{ instagram_minutes: number }>("select instagram_minutes from days"))[0].instagram_minutes).toBe(75);
    await undoStoredAction(add.id);
    expect((await q<{ instagram_minutes: number }>("select instagram_minutes from days"))[0].instagram_minutes).toBe(45);
    await tap(ctx, { type: "set_day", field: "worked_minutes", value: 450 });
    expect((await q<{ worked_minutes_override: number }>("select worked_minutes_override from days"))[0].worked_minutes_override).toBe(450);
  });

  it("manages exercise types and the timeline", async () => {
    const ctx = await ctxAt("2026-09-25 11:10");
    await seedExercises();
    await tap(ctx, { type: "log_exercise", exercise: "squats", amount: 20 });
    const before = [await q("select * from exercise_types order by id"), await q("select * from exercise_logs")];
    const del = await tap(ctx, { type: "delete_exercise_type", type_id: 1 });
    expect((await q<{ exercise_type_id: number | null }>("select exercise_type_id from exercise_logs"))[0].exercise_type_id).toBeNull();
    await undoStoredAction(del.id);
    expect([await q("select * from exercise_types order by id"), await q("select * from exercise_logs")]).toEqual(before);

    const seg = await tap(ctx, { type: "add_segment", kind: "office", start: "09:30", end: "11:00" });
    expect(seg.label).toBe("◷ At office 09:30–11:00");
    expect(await q("select kind from work_segments")).toEqual([{ kind: "office" }]);
    await undoStoredAction(seg.id);
    expect(await q("select * from work_segments")).toEqual([]);
  });

  it("re-checks a stored registry action from the words that were asked", async () => {
    const ctx = await ctxAt("2026-09-25 10:00");
    await q("insert into tasks (title) values ('Evening walk')");
    const p = await prepareAction(ctx, { type: "update_task", task_id: 1, show_from: "18:30" });
    expect(p.params).toMatchObject({ task_id: 1, patch: { show_from: "18:30" } });
    const { items } = await proposeActions(ctx, null, [{ type: "update_task", task_id: 1, show_from: "18:30" }]);
    await q("delete from tasks");
    await expect(applyStoredAction(ctx, items[0].id)).rejects.toThrow(/does not exist/);
  });
});
