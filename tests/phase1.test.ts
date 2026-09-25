import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, one, q, UserError } from "@/lib/db";
import { makeCtx, updateSettings } from "@/lib/settings";
import { add, ctxAt, ist, resetDb } from "./helpers";
import {
  entriesForDate, entryForTask, moveEntry, setEntryStatus, setMustDo, logMinutes,
} from "@/lib/services/entries";
import { rolloverIfNeeded } from "@/lib/services/rollover";
import { finishPlan, materializeDay, planView, triageEntry, unresolvedEntries, computeCapacity } from "@/lib/services/plan";
import {
  createSegment, dayTimeSummary, switchState, updateSegment, workedForDate, endOpenSegment, segmentsForDate,
} from "@/lib/services/segments";
import { getTask, findDuplicates } from "@/lib/services/tasks";
import { getDay, planningStreak } from "@/lib/services/days";

beforeEach(resetDb);
afterAll(closePool);

describe("Phase 1: a task added on day 1 appears on day 2 without retyping", () => {
  it("carries an untouched task into the next day via rollover, flagged and counted", async () => {
    const day1 = await ctxAt("2026-09-19 14:00"); // Saturday
    const { task, entry } = await add(day1, "Industry study");
    expect(entry?.date).toBe("2026-09-19");

    // Sunday 04:30 IST: the tick runs the rollover once
    const day2 = await ctxAt("2026-09-20 04:30");
    expect(day2.today).toBe("2026-09-20");
    const r = await rolloverIfNeeded(day2);
    expect(r).toMatchObject({ ran: true, carried: 1 });

    const e2 = await entryForTask(task.id, "2026-09-20");
    expect(e2).toMatchObject({ source: "auto", carried_from: "2026-09-19", status: "open" });
    expect((await getTask(task.id))!.carry_count).toBe(1);

    // Running the rollover again does nothing (idempotent)
    expect((await rolloverIfNeeded(day2)).ran).toBe(false);
    expect((await getTask(task.id))!.carry_count).toBe(1);
    expect((await entriesForDate("2026-09-20")).length).toBe(1);
  });

  it("does not carry a task that was resolved, and skipped tasks are not double counted", async () => {
    const day1 = await ctxAt("2026-09-19 14:00");
    const done = (await add(day1, "Write invoice")).task;
    const skipped = (await add(day1, "Vinit Suryavanshi follow up")).task;
    const e1 = (await entryForTask(done.id, "2026-09-19"))!;
    await setEntryStatus(day1, e1.id, "done");
    const e2 = (await entryForTask(skipped.id, "2026-09-19"))!;
    await setEntryStatus(day1, e2.id, "skipped");
    expect((await getTask(skipped.id))!.carry_count).toBe(1);

    const day2 = await ctxAt("2026-09-20 05:00");
    await rolloverIfNeeded(day2);
    expect(await entryForTask(done.id, "2026-09-20")).toBeNull();
    expect(await entryForTask(skipped.id, "2026-09-20")).not.toBeNull();
    expect((await getTask(skipped.id))!.carry_count).toBe(1); // skip already counted it
  });

  it("Ongoing tasks appear on every working day until Done, not on Sunday", async () => {
    const sat = await ctxAt("2026-09-19 10:00");
    const { task, entry } = await add(sat, "Vector: Notifications >>");
    await setEntryStatus(sat, entry!.id, "progressed"); // worked on it Saturday: normal daily state

    const sunCtx = await ctxAt("2026-09-20 05:00");
    await rolloverIfNeeded(sunCtx);
    expect(await entryForTask(task.id, "2026-09-20")).toBeNull(); // Sunday is not a working day

    const monCtx = await ctxAt("2026-09-21 05:00");
    await rolloverIfNeeded(monCtx);
    const mon = await entryForTask(task.id, "2026-09-21");
    expect(mon).toMatchObject({ source: "auto", status: "open" }); // appeared without retyping
    await setEntryStatus(monCtx, mon!.id, "progressed");
    expect((await getTask(task.id))!.state).toBe("active");

    const tueCtx = await ctxAt("2026-09-22 05:00");
    await rolloverIfNeeded(tueCtx);
    const tue = await entryForTask(task.id, "2026-09-22");
    expect(tue).not.toBeNull();
    expect((await getTask(task.id))!.carry_count).toBe(0); // progressing every day is not carrying
    await setEntryStatus(tueCtx, tue!.id, "done");
    const t = (await getTask(task.id))!;
    expect(t.state).toBe("done");
    expect(t.closed_at).not.toBeNull();

    const wedCtx = await ctxAt("2026-09-23 05:00");
    await rolloverIfNeeded(wedCtx);
    expect(await entryForTask(task.id, "2026-09-23")).toBeNull(); // finished: stops appearing
  });
});

// The owner removed the must-do cap on purpose (commit d865bdc): any number of must-dos per day.
describe("Phase 1: must-dos", () => {
  it("allows any number of must-dos, and they can be turned on and off", async () => {
    const ctx = await ctxAt("2026-09-19 09:00");
    for (const t of ["One", "Two", "Three", "Four", "Five"]) await add(ctx, `${t} !!`);
    expect((await entriesForDate("2026-09-19")).filter((e) => e.must_do).length).toBe(5);

    const six = (await add(ctx, "Six")).entry!;
    await setMustDo(ctx, six.id, true);
    expect((await entriesForDate("2026-09-19")).filter((e) => e.must_do).length).toBe(6);
    await setMustDo(ctx, six.id, false);
    expect((await entriesForDate("2026-09-19")).filter((e) => e.must_do).length).toBe(5);
  });

  it("dropped must-dos free up room", async () => {
    const ctx = await ctxAt("2026-09-19 09:00");
    const a = await add(ctx, "A !!");
    await add(ctx, "B !!");
    await add(ctx, "C !!");
    await setEntryStatus(ctx, a.entry!.id, "dropped");
    await add(ctx, "D !!"); // now allowed
  });
});

describe("Phase 1: status rules", () => {
  it("Skipped adds carry, Attempted does not, repeated taps do not double count", async () => {
    const ctx = await ctxAt("2026-09-19 12:00");
    const { task, entry } = await add(ctx, "Harsh Joshi HR flow +HarshJoshi");
    await setEntryStatus(ctx, entry!.id, "attempted");
    expect((await getTask(task.id))!.carry_count).toBe(0);
    await setEntryStatus(ctx, entry!.id, "skipped");
    await setEntryStatus(ctx, entry!.id, "skipped");
    expect((await getTask(task.id))!.carry_count).toBe(1);
    await setEntryStatus(ctx, entry!.id, "progressed"); // undo the skip
    expect((await getTask(task.id))!.carry_count).toBe(0);
  });

  it("Done closes a one-off; a cadence task stays active and remembers last_done_at", async () => {
    const ctx = await ctxAt("2026-09-19 12:00");
    const oneOff = await add(ctx, "Pay rent");
    await setEntryStatus(ctx, oneOff.entry!.id, "done");
    expect((await getTask(oneOff.task.id))!.state).toBe("done");

    const cad = await add(ctx, "LinkedIn post *7d @today");
    await setEntryStatus(ctx, cad.entry!.id, "done");
    const t = (await getTask(cad.task.id))!;
    expect(t.state).toBe("active");
    expect(t.last_done_at).not.toBeNull();
  });

  it("Dropped closes the task and keeps history; reopening restores it", async () => {
    const ctx = await ctxAt("2026-09-19 12:00");
    const { task, entry } = await add(ctx, "Old idea");
    await setEntryStatus(ctx, entry!.id, "dropped");
    expect((await getTask(task.id))!.state).toBe("dropped");
    expect((await entryForTask(task.id, "2026-09-19"))!.status).toBe("dropped");
    await setEntryStatus(ctx, entry!.id, "open");
    expect((await getTask(task.id))!.state).toBe("active");
  });

  it("one entry per task per day, and moving to tomorrow does not add carry", async () => {
    const ctx = await ctxAt("2026-09-19 12:00");
    const { task, entry } = await add(ctx, "Industry study");
    await materializeDay(ctx, "2026-09-19");
    expect((await q("select * from day_entries where task_id = $1", [task.id])).length).toBe(1);
    const moved = await moveEntry(ctx, entry!.id, "2026-09-20");
    expect(moved.date).toBe("2026-09-20");
    expect((await entriesForDate("2026-09-19")).length).toBe(0);
    expect((await getTask(task.id))!.carry_count).toBe(0);
  });

  it("logs minutes per day and rolls them into the entry view", async () => {
    const ctx = await ctxAt("2026-09-19 12:00");
    const { task, entry } = await add(ctx, "Vector: Insights >>");
    await logMinutes(ctx, task.id, "2026-09-19", 30, "web");
    await logMinutes(ctx, task.id, "2026-09-19", 45, "telegram");
    expect((await entryForTask(task.id, "2026-09-19"))!.minutes_today).toBe(75);
    await expect(logMinutes(ctx, task.id, "2026-09-19", 0, "web")).rejects.toThrow();
    expect(entry).not.toBeNull();
  });
});

describe("Phase 1: Plan with triage and capacity bar", () => {
  // Plan carries unresolved tasks forward automatically (owner's choice); the per-task triage actions still work.
  it("carries every unresolved entry to the plan date automatically, counting each carry once", async () => {
    const today = await ctxAt("2026-09-19 21:00");
    const a = await add(today, "Task A");
    const b = await add(today, "Task B");
    const done = await add(today, "Task Done");
    await setEntryStatus(today, done.entry!.id, "done");
    const tomorrow = "2026-09-20";

    let plan = await planView(today, tomorrow);
    expect(plan.triage.length).toBe(0);
    expect(plan.entries.map((x) => x.title).sort()).toEqual(["Task A", "Task B"]);
    expect((await entryForTask(a.task.id, tomorrow))!.source).toBe("carried");
    expect((await unresolvedEntries(tomorrow)).length).toBe(0);

    // opening Plan again must not carry or count twice
    plan = await planView(today, tomorrow);
    expect(plan.entries.length).toBe(2);
    expect((await getTask(a.task.id))!.carry_count).toBe(1);
    expect((await getTask(b.task.id))!.carry_count).toBe(1);

    await finishPlan(today, tomorrow);
    expect((await getDay(tomorrow))!.planned_at).not.toBeNull();
  });

  it("pre-fills tomorrow with Ongoing, Recurring and overdue Cadence items", async () => {
    const start = await ctxAt("2026-09-01 10:00");
    await add(start, "LinkedIn post *7d"); // created Sep 1, never done: 18 days overdue by the 19th
    const today = await ctxAt("2026-09-19 21:00"); // Saturday evening; Monday is the 21st
    const ongoing = await add(today, "Vector: Insights >>");
    await setEntryStatus(today, ongoing.entry!.id, "progressed");
    await add(today, "Team review every mon");
    const plan = await planView(today, "2026-09-21");
    const titles = plan.entries.map((e) => `${e.title}:${e.source}`).sort();
    expect(titles).toEqual(["Insights:auto", "LinkedIn post:auto", "Team review:auto"].sort());
  });

  it("capacity bar is amber at 90% and red above 100% with the exact message", () => {
    const mk = (min: number) => [{ estimate_min: min, is_personal: false, status: "open" as const }];
    expect(computeCapacity(mk(60), 9).level).toBe("ok");
    expect(computeCapacity(mk(486), 9).level).toBe("amber"); // 90%
    expect(computeCapacity(mk(540), 9).level).toBe("amber"); // exactly 100%
    const red = computeCapacity(mk(541), 9);
    expect(red.level).toBe("red");
    expect(red.message).toBe("You are planning more than you can do.");
    // personal tasks are not counted against work capacity
    expect(computeCapacity([{ estimate_min: 900, is_personal: true, status: "open" as const }], 9).level).toBe("ok");
  });

  it("planning before the day boundary counts toward the planning streak", async () => {
    for (const [nowStr, date] of [
      ["2026-09-17 21:00", "2026-09-18"],
      ["2026-09-18 21:00", "2026-09-19"],
    ] as const) {
      const c = await ctxAt(nowStr);
      await finishPlan(c, date);
    }
    // Sat 19th 10:00: yesterday (18th) and today (19th) both planned in time
    const now = await ctxAt("2026-09-19 10:00");
    expect(await planningStreak(now)).toBe(2);
    // planning tomorrow in the evening counts straight away
    await finishPlan(await ctxAt("2026-09-19 21:00"), "2026-09-20");
    expect(await planningStreak(await ctxAt("2026-09-19 21:05"))).toBe(3);
    // the 21st was never planned ahead, so on the 21st the plan for tomorrow is what counts and the streak restarts
    const late = await ctxAt("2026-09-21 09:00");
    await finishPlan(late, "2026-09-21"); // planned the 21st at 09:00 on the 21st: too late
    expect(await planningStreak(await ctxAt("2026-09-21 10:00"))).toBe(0); // broken
    await finishPlan(await ctxAt("2026-09-21 21:00"), "2026-09-22");
    expect(await planningStreak(await ctxAt("2026-09-21 21:05"))).toBe(1);
    // and a day with no plan breaks the streak
    expect(await planningStreak(await ctxAt("2026-09-24 10:00"))).toBe(0);
  });
});

describe("Phase 1: segments and the hours calculation", () => {
  it("worked time = office + outside, excluding breaks (lunch)", async () => {
    const at = async (t: string) => ctxAt(t);
    await switchState(await at("2026-09-19 10:00"), "office");
    await switchState(await at("2026-09-19 13:00"), "break"); // 3h office
    await switchState(await at("2026-09-19 14:00"), "office"); // 1h break
    await switchState(await at("2026-09-19 16:00"), "outside"); // 2h office
    const end = await switchState(await at("2026-09-19 18:30"), "off"); // 2.5h outside
    expect(end.workedMin).toBe(180 + 120 + 150);
    const ctx = await at("2026-09-19 19:00");
    expect(await workedForDate(ctx, "2026-09-19")).toBe(450);
    const day = await getDay("2026-09-19");
    expect(day!.closed_at).not.toBeNull();
  });

  it("shows live time for an open segment (3h 14m so far)", async () => {
    await switchState(await ctxAt("2026-09-19 10:02"), "office");
    expect(await workedForDate(await ctxAt("2026-09-19 13:16"), "2026-09-19")).toBe(194);
  });

  it("keeps a past-midnight session on the same day and closes it correctly", async () => {
    await switchState(await ctxAt("2026-09-19 22:00"), "office");
    const off = await switchState(await ctxAt("2026-09-20 01:30"), "off");
    expect(off.date).toBe("2026-09-19"); // 01:30 still belongs to the 19th
    expect(off.workedMin).toBe(210);
    const next = await ctxAt("2026-09-20 10:00");
    expect(await workedForDate(next, "2026-09-20")).toBe(0);
  });

  it("splits a session that runs across the 04:00 boundary", async () => {
    await switchState(await ctxAt("2026-09-20 02:00"), "office");
    await switchState(await ctxAt("2026-09-20 06:00"), "off");
    const ctx = await ctxAt("2026-09-20 12:00");
    expect(await workedForDate(ctx, "2026-09-19")).toBe(120);
    expect(await workedForDate(ctx, "2026-09-20")).toBe(120);
  });

  it("tapping the same state twice is a no-op", async () => {
    await switchState(await ctxAt("2026-09-19 10:00"), "office");
    const again = await switchState(await ctxAt("2026-09-19 10:05"), "office");
    expect(again.changed).toBe(false);
    expect((await segmentsForDate(await ctxAt("2026-09-19 11:00"), "2026-09-19")).length).toBe(1);
  });

  it("rejects overlapping edits with a clear message and allows touching segments", async () => {
    const ctx = await ctxAt("2026-09-19 20:00");
    const s1 = await createSegment(ctx, { kind: "office", start: ist("2026-09-19 10:00"), end: ist("2026-09-19 12:00") });
    await createSegment(ctx, { kind: "break", start: ist("2026-09-19 12:00"), end: ist("2026-09-19 13:00") });
    await expect(
      createSegment(ctx, { kind: "office", start: ist("2026-09-19 11:30"), end: ist("2026-09-19 12:30") }),
    ).rejects.toThrow(/overlaps At office 10:00–12:00/);
    await expect(
      updateSegment(ctx, s1.id, { kind: "office", start: ist("2026-09-19 10:00"), end: ist("2026-09-19 12:30") }),
    ).rejects.toThrow(/overlaps/);
    await expect(
      createSegment(ctx, { kind: "office", start: ist("2026-09-19 15:00"), end: ist("2026-09-19 14:00") }),
    ).rejects.toThrow(/end time must be after/);
    await createSegment(ctx, { kind: "office", start: ist("2026-09-19 13:00"), end: ist("2026-09-19 15:00") });
    expect(await workedForDate(ctx, "2026-09-19")).toBe(120 + 120);
  });

  it("forgotten close: End now / Ended 1h ago / Ended 2h ago", async () => {
    await switchState(await ctxAt("2026-09-19 10:00"), "office");
    const at2230 = await ctxAt("2026-09-19 22:30");
    const r = await endOpenSegment(at2230, 60);
    expect(r.ended).toBe(true);
    expect(r.workedMin).toBe(11.5 * 60); // 10:00 -> 21:30
    expect((await getDay("2026-09-19"))!.closed_at).not.toBeNull();
    expect((await endOpenSegment(at2230, 0)).ended).toBe(false); // nothing left open
  });

  it("unaccounted time = worked minus logged work minutes (personal excluded)", async () => {
    const t0 = await ctxAt("2026-09-19 10:00");
    await switchState(t0, "office");
    await switchState(await ctxAt("2026-09-19 14:00"), "off"); // 240 worked
    const work = (await add(t0, "Vector: Insights >>")).task;
    const personal = (await add(t0, "Buy medicines /p")).task;
    await logMinutes(t0, work.id, "2026-09-19", 150, "web");
    await logMinutes(t0, personal.id, "2026-09-19", 40, "web");
    const s = await dayTimeSummary(await ctxAt("2026-09-19 15:00"), "2026-09-19");
    expect(s).toMatchObject({ worked: 240, logged: 150, minutes: 90 });
    expect(s.pct).toBeCloseTo(37.5);
  });
});

describe("duplicate guard against real tasks", () => {
  it("finds the existing active task instead of allowing a second copy", async () => {
    const ctx = await ctxAt("2026-09-19 09:00");
    const { task } = await add(ctx, "Vector: Insights >>");
    const parsed = { title: "Insights", project: "Vector" };
    const dups = await findDuplicates(parsed);
    expect(dups.map((d) => d.id)).toEqual([task.id]);
    expect(await findDuplicates({ title: "Groceries", project: null })).toEqual([]);
  });
});

describe("row-level security", () => {
  it("hides every row from anyone who is not the owner's auth user", async () => {
    const ctx = await ctxAt("2026-09-19 09:00");
    await add(ctx, "Secret task");
    const owner = "11111111-1111-1111-1111-111111111111";
    await q("update settings set owner_user_id = $1", [owner]);
    await q("do $$ begin if not exists (select from pg_roles where rolname = 'rls_tester') then create role rls_tester nologin; end if; end $$");
    await q("grant usage on schema public, auth to rls_tester");
    await q("grant all on all tables in schema public to rls_tester");
    await q("grant all on all sequences in schema public to rls_tester");
    await q("grant execute on all functions in schema public to rls_tester");
    await q("grant execute on function auth.uid() to rls_tester");

    const { getPool } = await import("@/lib/db");
    const c = await getPool().connect();
    try {
      await c.query("set role rls_tester");
      await c.query("select set_config('request.jwt.claim.sub', '', false)");
      expect((await c.query("select * from tasks")).rowCount).toBe(0); // anonymous
      await c.query("select set_config('request.jwt.claim.sub', $1, false)", ["22222222-2222-2222-2222-222222222222"]);
      expect((await c.query("select * from tasks")).rowCount).toBe(0); // some other user
      expect((await c.query("select * from settings")).rowCount).toBe(0);
      await expect(c.query("insert into tasks (title) values ('x')")).rejects.toThrow(/row-level security/);
      await c.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
      expect((await c.query("select * from tasks")).rowCount).toBe(1); // the owner
    } finally {
      await c.query("reset role");
      c.release();
    }
  });
});

describe("misc", () => {
  it("uses the injected clock for the logical date", async () => {
    const c = await makeCtx(ist("2026-09-20 01:30"));
    expect(c.today).toBe("2026-09-19");
    expect(await one("select 1 as x")).toEqual({ x: 1 });
  });
});
