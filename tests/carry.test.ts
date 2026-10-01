import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, q } from "@/lib/db";
import { setEntryStatus } from "@/lib/services/entries";
import { listTargets } from "@/lib/services/goals";
import { planView } from "@/lib/services/plan";
import { rolloverIfNeeded } from "@/lib/services/rollover";
import { ctxAt, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(closePool);

const carry = async (id: number) => (await q<{ carry_count: number }>("select carry_count from tasks where id = $1", [id]))[0].carry_count;
const entries = async (id: number) => q<{ date: string; status: string; source: string }>(
  "select date, status, source from day_entries where task_id = $1 order by date", [id],
);

describe("carrying", () => {
  it("a daily task done every day is never carried, whenever tomorrow is planned", async () => {
    await q("insert into tasks (title, type, rrule, created_at) values ('Meditate', 'recurring', 'FREQ=DAILY', '2026-09-20T00:00:00Z')");
    for (const day of ["2026-09-24", "2026-09-25", "2026-09-26"]) {
      const morning = await ctxAt(`${day} 09:00`);
      await rolloverIfNeeded(morning);
      // plan tomorrow in the afternoon, before today's occurrence is done
      await planView(await ctxAt(`${day} 15:00`), (await import("@/lib/time")).addDays(day, 1));
      const [today] = await q<{ id: number }>("select id from day_entries where task_id = 1 and date = $1", [day]);
      await setEntryStatus(await ctxAt(`${day} 20:00`), today.id, "done");
    }
    expect(await carry(1)).toBe(0);
    expect((await entries(1)).filter((e) => e.source === "carried")).toEqual([]);
  });

  it("a missed or skipped day of a repeating task is just missed", async () => {
    await q("insert into tasks (title, type, rrule, created_at) values ('Read 20 pages', 'recurring', 'FREQ=DAILY', '2026-09-20T00:00:00Z')");
    await rolloverIfNeeded(await ctxAt("2026-09-24 09:00"));
    const [e] = await q<{ id: number }>("select id from day_entries where task_id = 1 and date = '2026-09-24'");
    await setEntryStatus(await ctxAt("2026-09-24 18:00"), e.id, "skipped");
    await rolloverIfNeeded(await ctxAt("2026-09-25 09:00")); // yesterday skipped, today's own occurrence arrives
    await rolloverIfNeeded(await ctxAt("2026-09-26 09:00")); // yesterday ignored entirely
    expect(await carry(1)).toBe(0);
    expect((await entries(1)).map((x) => [x.date, x.status, x.source])).toEqual([
      ["2026-09-24", "skipped", "auto"], ["2026-09-25", "open", "auto"], ["2026-09-26", "open", "auto"],
    ]);
  });

  it("a day off skips plain daily tasks but keeps rules that name that day", async () => {
    await q("insert into tasks (title, type, rrule, created_at) values ('Read 20 pages', 'recurring', 'FREQ=DAILY', '2026-09-20T00:00:00Z')");
    await q("insert into tasks (title, type, rrule, created_at) values ('Weekly review', 'recurring', 'FREQ=WEEKLY;BYDAY=SU', '2026-09-20T00:00:00Z')");
    await rolloverIfNeeded(await ctxAt("2026-09-27 09:00")); // Sunday, off by default
    expect((await q<{ task_id: number }>("select task_id from day_entries where date = '2026-09-27'")).map((r) => r.task_id)).toEqual([2]);
    await rolloverIfNeeded(await ctxAt("2026-09-28 09:00")); // Monday: the daily one is back, nothing carried
    expect((await q<{ task_id: number }>("select task_id from day_entries where date = '2026-09-28'")).map((r) => r.task_id)).toEqual([1]);
    expect(await carry(1)).toBe(0);
  });

  it("a repeating task set to 'keep it until done' carries like a one-off", async () => {
    await q(`insert into tasks (title, type, rrule, created_at)
             values ('Pay rent', 'recurring', 'FREQ=MONTHLY;BYMONTHDAY=25;X-MISSED=CARRY', '2026-09-20T00:00:00Z')`);
    await rolloverIfNeeded(await ctxAt("2026-09-25 09:00"));
    await rolloverIfNeeded(await ctxAt("2026-09-26 09:00"));
    expect(await carry(1)).toBe(1);
    expect((await entries(1)).map((x) => [x.date, x.source])).toEqual([["2026-09-25", "auto"], ["2026-09-26", "auto"]]);
  });

  it("a one-off still open today shows in tomorrow's plan but counts as carried only at the day boundary", async () => {
    await q("insert into tasks (title) values ('Send invoice')");
    await q("insert into day_entries (task_id, date) values (1, '2026-09-25')");
    await planView(await ctxAt("2026-09-25 15:00"), "2026-09-26");
    expect((await entries(1)).map((x) => x.date)).toEqual(["2026-09-25", "2026-09-26"]);
    expect(await carry(1)).toBe(0);
    await rolloverIfNeeded(await ctxAt("2026-09-26 09:00"));
    expect(await carry(1)).toBe(1);
    await rolloverIfNeeded(await ctxAt("2026-09-26 11:00")); // the rollover runs once a day
    expect(await carry(1)).toBe(1);
  });
});

describe("targets", () => {
  it("one day's Done is a session, not the end of a 50-hour month", async () => {
    await q(`insert into tasks (title, type, target_period, period_start, goal_min, goal_count)
             values ('Stock market learning', 'target', 'month', '2026-09-01', 3000, 25)`);
    await q("insert into day_entries (task_id, date) values (1, '2026-09-25')");
    const [e] = await q<{ id: number }>("select id from day_entries");
    const r = await setEntryStatus(await ctxAt("2026-09-25 18:00"), e.id, "done");
    expect(r.taskClosed).toBe(false);
    expect((await q("select state from tasks"))[0]).toEqual({ state: "active" });
    const t = (await listTargets(await ctxAt("2026-09-29 10:00"))).month[0];
    expect([t.count, t.met]).toEqual([1, false]);
  });

  it("a target closed before its numbers are reached is not 'met'", async () => {
    await q(`insert into tasks (title, type, target_period, period_start, goal_min, state, closed_at)
             values ('Stock market learning', 'target', 'month', '2026-09-01', 3000, 'done', now())`);
    const t = (await listTargets(await ctxAt("2026-09-29 10:00"))).month[0];
    expect([t.met, t.behind]).toEqual([false, false]);
  });
});
