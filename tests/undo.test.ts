import { beforeEach, describe, expect, it } from "vitest";
import { one, q } from "@/lib/db";
import { setEntryStatus, entriesForDate } from "@/lib/services/entries";
import { logTouch, snoozeTouch } from "@/lib/services/keep-in-touch";
import { setInstagram } from "@/lib/services/days";
import { deleteTask } from "@/lib/services/tasks";
import { actionRows, journaled, listActions, recentAction, undoAction } from "@/lib/undo";
import { add, ctxAt, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await q("truncate contacts, contact_touches, change_actions restart identity cascade");
});

const statusOf = async (id: number) => (await one<{ status: string }>("select status from day_entries where id = $1", [id]))!.status;

describe("universal undo", () => {
  it("names a change in plain words and puts it back", async () => {
    const ctx = await ctxAt("2026-09-19 09:00");
    await add(ctx, "Gym session");
    const [e] = await entriesForDate(ctx.today);
    const { undo } = await journaled("web", () => setEntryStatus(ctx, e.id, "done"));
    expect(undo?.label).toBe("Marked “Gym session” done");
    expect(await statusOf(e.id)).toBe("done");
    const back = await undoAction(undo!.id);
    expect(back.label).toBe("Undid: Marked “Gym session” done");
    expect(await statusOf(e.id)).toBe("open");
  });

  it("redo is an undo of the undo", async () => {
    const ctx = await ctxAt("2026-09-19 09:00");
    await add(ctx, "Write report");
    const [e] = await entriesForDate(ctx.today);
    const { undo } = await journaled("web", () => setEntryStatus(ctx, e.id, "skipped"));
    const u = await undoAction(undo!.id);
    expect(await statusOf(e.id)).toBe("open");
    const r = await undoAction(u.id);
    expect(r.label).toBe("Redid: Marked “Write report” skipped");
    expect(await statusOf(e.id)).toBe("skipped");
    // and the original can be undone again
    await undoAction(r.id);
    expect(await statusOf(e.id)).toBe("open");
  });

  it("fixes the 'I tapped Message by mistake' case: the log and the snooze come back", async () => {
    const c = (await one<{ id: number }>("insert into contacts (name) values ('Sarah') returning id"))!;
    await snoozeTouch(c.id, "2026-09-19", 7);
    const before = (await one<{ touch_snoozed_until: string }>("select touch_snoozed_until from contacts where id = $1", [c.id]))!.touch_snoozed_until;
    expect(before).toBeTruthy();
    const { undo } = await journaled("web", () => logTouch(c.id, "2026-09-19", "message"));
    expect(undo?.label).toMatch(/^Logged message with Sarah/);
    expect((await one<{ n: number }>("select count(*)::int as n from contact_touches where contact_id = $1", [c.id]))!.n).toBe(1);
    await undoAction(undo!.id);
    expect((await one<{ n: number }>("select count(*)::int as n from contact_touches where contact_id = $1", [c.id]))!.n).toBe(0);
    expect((await one<{ touch_snoozed_until: string }>("select touch_snoozed_until from contacts where id = $1", [c.id]))!.touch_snoozed_until).toBe(before);
  });

  it("brings back a deleted task together with everything that went with it", async () => {
    const ctx = await ctxAt("2026-09-19 09:00");
    await add(ctx, "Doomed task");
    const [e] = await entriesForDate(ctx.today);
    await q("insert into time_logs (task_id, date, minutes) values ($1, $2, 30)", [e.task_id, ctx.today]);
    const { undo } = await journaled("web", () => deleteTask(e.task_id));
    expect(undo?.label).toMatch(/Deleted task “Doomed task”/);
    expect((await one<{ n: number }>("select count(*)::int as n from tasks"))!.n).toBe(0);
    expect((await one<{ n: number }>("select count(*)::int as n from time_logs"))!.n).toBe(0);
    await undoAction(undo!.id);
    expect((await one<{ n: number }>("select count(*)::int as n from tasks where title = 'Doomed task'"))!.n).toBe(1);
    expect((await one<{ n: number }>("select count(*)::int as n from day_entries where id = $1", [e.id]))!.n).toBe(1);
    expect((await one<{ minutes: number }>("select minutes from time_logs"))!.minutes).toBe(30);
  });

  it("refuses to undo something a newer change built on, until the newer one is undone", async () => {
    await setInstagram("2026-09-19", 10);
    const a = await journaled("web", () => setInstagram("2026-09-19", 40));
    const b = await journaled("web", () => setInstagram("2026-09-19", 90));
    await expect(undoAction(a.undo!.id)).rejects.toThrow(/Newer changes touched the same thing/);
    expect((await listActions()).find((x) => x.id === a.undo!.id)?.blocked_by).toMatch(/Instagram/);
    await undoAction(b.undo!.id);
    await undoAction(a.undo!.id);
    expect((await one<{ m: number }>("select instagram_minutes as m from days where date = '2026-09-19'"))!.m).toBe(10);
  });

  it("an action that changes nothing leaves no trace, and writes outside an action are not recorded", async () => {
    const r = await journaled("web", async () => 5);
    expect(r.undo).toBeNull();
    await setInstagram("2026-09-20", 15); // not inside an action
    expect((await one<{ n: number }>("select count(*)::int as n from change_actions"))!.n).toBe(0);
    expect((await one<{ n: number }>("select count(*)::int as n from change_log"))!.n).toBe(0);
  });

  it("offers the newest undoable action to the pill, and a redo after an undo", async () => {
    const a = await journaled("web", () => setInstagram("2026-09-19", 30));
    expect(await recentAction()).toMatchObject({ id: a.undo!.id, redo: false });
    const u = await undoAction(a.undo!.id);
    expect(await recentAction()).toMatchObject({ id: u.id, redo: true });
    expect((await actionRows(a.undo!.id))[0]).toMatchObject({ tbl: "days", op: "I" });
  });

  it("a failed action keeps what it wrote so that can still be undone", async () => {
    await expect(journaled("web", async () => {
      await setInstagram("2026-09-19", 55);
      throw new Error("boom");
    })).rejects.toThrow("boom");
    const [a] = await listActions();
    expect(a.changes).toBe(1);
    await undoAction(a.id);
    expect(await one("select 1 from days where date = '2026-09-19' and instagram_minutes is not null")).toBeNull();
  });

  it("every data table is journaled, including ones added later", async () => {
    // a migration that adds a table must call journal_install(); this fails if one forgot
    expect((await one<{ n: number }>("select journal_install() as n"))!.n).toBe(0);
  });
});
