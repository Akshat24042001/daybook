// Priorities: every open task on a Value x Effort board and an Urgent x Important (Eisenhower) board.
import { beforeEach, describe, expect, it } from "vitest";
import { one, q } from "@/lib/db";
import {
  applySuggestions, boxOf, BOXES, dropTasks, effortFromEstimate, heuristic, matrixTasks, placeTask, urgencyFromDue,
} from "@/lib/services/matrix";
import { addToDay } from "@/lib/services/goals";
import { journaled, listActions, undoAction } from "@/lib/undo";
import { add, ctxAt, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await q("truncate change_actions restart identity cascade");
});

const base = { value_level: null, effort_level: null, importance: null, urgency: null, due_date: null } as const;

describe("the two boards", () => {
  it("puts each pair of levels in the box the method names", () => {
    expect(boxOf({ ...base, value_level: "high", effort_level: "low" }, "value", "2026-11-17")?.box).toBe("quick");
    expect(boxOf({ ...base, value_level: "high", effort_level: "high" }, "value", "2026-11-17")?.box).toBe("big");
    expect(boxOf({ ...base, value_level: "low", effort_level: "low" }, "value", "2026-11-17")?.box).toBe("fill");
    expect(boxOf({ ...base, value_level: "low", effort_level: "high" }, "value", "2026-11-17")?.box).toBe("sink");
    expect(boxOf({ ...base, value_level: "high" }, "value", "2026-11-17")).toBeNull();
    expect(boxOf({ ...base, importance: "high", urgency: "high" }, "eisen", "2026-11-17")?.box).toBe("do");
    expect(boxOf({ ...base, importance: "high", urgency: "low" }, "eisen", "2026-11-17")?.box).toBe("schedule");
    expect(boxOf({ ...base, importance: "low", urgency: "high" }, "eisen", "2026-11-17")?.box).toBe("delegate");
    expect(boxOf({ ...base, importance: "low", urgency: "low" }, "eisen", "2026-11-17")?.box).toBe("drop");
    // reading order: the first box of each board is the one to do first
    expect(BOXES.value[0].key).toBe("quick");
    expect(BOXES.eisen[0].key).toBe("do");
  });

  it("reads urgency from the due date until you set it", () => {
    expect(urgencyFromDue("2026-11-19", "2026-11-17")).toBe("high");
    expect(urgencyFromDue("2026-11-20", "2026-11-17")).toBe("low");
    expect(urgencyFromDue("2026-11-10", "2026-11-17")).toBe("high");
    expect(urgencyFromDue(null, "2026-11-17")).toBeNull();
    const t = { ...base, importance: "high" as const, due_date: "2026-11-18" };
    expect(boxOf(t, "eisen", "2026-11-17")).toEqual({ box: "do", autoUrgency: true });
    expect(boxOf({ ...t, due_date: null }, "eisen", "2026-11-17")).toEqual({ box: "schedule", autoUrgency: true });
    expect(boxOf({ ...t, urgency: "low" }, "eisen", "2026-11-17")).toEqual({ box: "schedule", autoUrgency: false });
  });

  it("never guesses value without the AI; only dates count", () => {
    const todo = [{ id: 1, title: "A", due_date: "2026-11-18", estimate_min: 20 }, { id: 2, title: "B", due_date: null, estimate_min: 300 }];
    expect(heuristic(todo, "value", "2026-11-17")).toEqual([]);
    expect(heuristic(todo, "eisen", "2026-11-17").map((s) => [s.id, s.box])).toEqual([[1, "do"]]);
    expect(effortFromEstimate(150)).toBe("high");
    expect(effortFromEstimate(30)).toBe("low");
    expect(effortFromEstimate(60)).toBeNull();
  });
});

describe("placing tasks", () => {
  it("shows every open task, places, orders, and takes off a board", async () => {
    const ctx = await ctxAt("2026-11-17 10:00");
    await add(ctx, "Send Udaipur proposal");
    await add(ctx, "Redesign website");
    await add(ctx, "Clean inbox");
    const all = await matrixTasks(ctx);
    expect(all.length).toBe(3);
    const id = (title: string) => all.find((t) => t.title === title)!.id;
    await placeTask(id("Send Udaipur proposal"), "value", "quick");
    await placeTask(id("Clean inbox"), "value", "quick", [id("Clean inbox"), id("Send Udaipur proposal")]);
    const rows = await q<{ title: string; value_level: string; effort_level: string; value_rank: number }>(
      "select title, value_level, effort_level, value_rank from tasks where value_level is not null order by value_rank");
    expect(rows.map((r) => r.title)).toEqual(["Clean inbox", "Send Udaipur proposal"]);
    expect(rows[0]).toMatchObject({ value_level: "high", effort_level: "low" });
    // the other board is untouched
    expect((await one<{ importance: string | null }>("select importance from tasks where id = $1", [id("Clean inbox")]))!.importance).toBeNull();
    await placeTask(id("Clean inbox"), "value", null);
    expect((await one<{ value_level: string | null; value_rank: number | null }>("select value_level, value_rank from tasks where id = $1", [id("Clean inbox")]))).toEqual({ value_level: null, value_rank: null });
  });

  it("knows what is already on Today, and refuses closed tasks", async () => {
    const ctx = await ctxAt("2026-11-17 10:00");
    await q("insert into tasks (title) values ('Call the CA')");
    const [t] = await matrixTasks(ctx);
    expect(t.on_today).toBe(false);
    await addToDay(ctx, t.id, ctx.today);
    expect((await matrixTasks(ctx))[0].on_today).toBe(true);
    await q("update tasks set state = 'done' where id = $1", [t.id]);
    expect(await matrixTasks(ctx)).toEqual([]);
    await expect(placeTask(t.id, "value", "quick")).rejects.toThrow(/closed/);
  });

  it("AI placements keep their reason until you move the card", async () => {
    const ctx = await ctxAt("2026-11-17 10:00");
    await add(ctx, "Write case study");
    const [t] = await matrixTasks(ctx);
    expect(await applySuggestions("value", [{ id: t.id, box: "big", why: "Wins clients, takes a day" }])).toBe(1);
    expect((await matrixTasks(ctx))[0]).toMatchObject({ value_level: "high", effort_level: "high", matrix_why: "AI: Wins clients, takes a day" });
    await placeTask(t.id, "value", "quick");
    expect((await matrixTasks(ctx))[0].matrix_why).toBeNull();
  });

  it("History names the move, and Undo puts it back; dropping a box can be undone too", async () => {
    const ctx = await ctxAt("2026-11-17 10:00");
    await add(ctx, "Renew domain");
    await add(ctx, "Reorganise old photos");
    const all = await matrixTasks(ctx);
    const renew = all.find((t) => t.title === "Renew domain")!;
    const photos = all.find((t) => t.title === "Reorganise old photos")!;
    const { undo } = await journaled("web", () => placeTask(renew.id, "eisen", "do"));
    expect(undo?.label).toBe("Moved “Renew domain” to Do now");
    await undoAction(undo!.id);
    expect((await one<{ importance: string | null }>("select importance from tasks where id = $1", [renew.id]))!.importance).toBeNull();
    const d = await journaled("web", () => dropTasks([photos.id]));
    expect(d.value).toBe(1);
    expect((await matrixTasks(ctx)).map((t) => t.title)).toEqual(["Renew domain"]);
    await undoAction(d.undo!.id);
    expect((await matrixTasks(ctx)).length).toBe(2);
    expect((await listActions()).length).toBeGreaterThan(0);
  });
});
