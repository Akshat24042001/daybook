import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, q } from "@/lib/db";
import { add, ctxAt, resetDb, seedExercises } from "./helpers";
import { computeInsights, MIN_DAYS, type DayFacts } from "@/lib/insights";
import { computePace, listCadence, listSomeday, listTargets, reorderSomeday, targetsBehind } from "@/lib/services/goals";
import { entryForTask, logMinutes, setEntryStatus } from "@/lib/services/entries";
import { materializeDay } from "@/lib/services/plan";
import { rolloverIfNeeded } from "@/lib/services/rollover";
import { rruleMatches } from "@/lib/recurrence";
import { computeStats, movingAverage, presetRange } from "@/lib/services/stats";
import { exerciseGrid, exerciseSlots, logExercise } from "@/lib/services/health";
import { switchState } from "@/lib/services/segments";
import { setScore } from "@/lib/services/days";
import { addDays } from "@/lib/time";

beforeEach(async () => {
  await resetDb();
  await seedExercises();
});
afterAll(closePool);

describe("recurrence rules", () => {
  it("matches weekly and monthly rules", () => {
    expect(rruleMatches("FREQ=WEEKLY;BYDAY=MO", "2026-09-21")).toBe(true);
    expect(rruleMatches("FREQ=WEEKLY;BYDAY=MO", "2026-09-22")).toBe(false);
    expect(rruleMatches("FREQ=MONTHLY;BYMONTHDAY=1", "2026-10-01")).toBe(true);
    expect(rruleMatches("FREQ=MONTHLY;BYMONTHDAY=1", "2026-10-02")).toBe(false);
    expect(rruleMatches("FREQ=MONTHLY;BYMONTHDAY=31", "2026-02-28")).toBe(true); // last day of a short month
    expect(rruleMatches("FREQ=MONTHLY;BYMONTHDAY=31", "2026-04-30")).toBe(true);
    expect(rruleMatches(null, "2026-09-21")).toBe(false);
  });

  it("expands recurring tasks into entries via the rollover, and Done keeps them active", async () => {
    const created = await ctxAt("2026-09-19 10:00");
    const inv = await add(created, "Monthly invoicing every 1st");
    expect(inv.entry).toBeNull(); // not the 1st today: nothing yet
    const first = await ctxAt("2026-10-01 05:00");
    await rolloverIfNeeded(first);
    const e = await entryForTask(inv.task.id, "2026-10-01");
    expect(e).toMatchObject({ source: "auto" });
    await setEntryStatus(first, e!.id, "done");
    const t = await q<{ state: string }>("select state from tasks where id = $1", [inv.task.id]);
    expect(t[0].state).toBe("active");
    await rolloverIfNeeded(await ctxAt("2026-10-02 05:00"));
    expect(await entryForTask(inv.task.id, "2026-10-02")).toBeNull();
  });
});

describe("Phase 3 acceptance: weekly target shows behind pace mid-week", () => {
  it("is not behind on Monday, behind by Thursday with 1h of 6h, on track with 3h", async () => {
    const mon = await ctxAt("2026-09-14 09:00");
    const { task } = await add(mon, "Anitas Septic proposal #w ~6h");
    expect(task).toMatchObject({ type: "target", target_period: "week", goal_min: 360, period_start: "2026-09-14" });

    const monNow = await ctxAt("2026-09-14 12:00");
    let [p] = (await listTargets(monNow)).week;
    expect(p.elapsed).toBe(0);
    expect(p.behind).toBe(false);

    await logMinutes(monNow, task.id, "2026-09-15", 60, "web");
    const thu = await ctxAt("2026-09-17 12:00"); // Mon-Wed done = 3 of 6 working days
    [p] = (await listTargets(thu)).week;
    expect(p.elapsed).toBeCloseTo(0.5);
    expect(p.minutes).toBe(60);
    expect(p.minFraction).toBeCloseTo(1 / 6);
    expect(p.behind).toBe(true);
    expect((await targetsBehind(thu)).length).toBe(1);

    await logMinutes(thu, task.id, "2026-09-16", 120, "web"); // 3h of 6h at the halfway point
    [p] = (await listTargets(thu)).week;
    expect(p.behind).toBe(false);

    await logMinutes(thu, task.id, "2026-09-17", 200, "web"); // 6h+ met
    [p] = (await listTargets(thu)).week;
    expect(p.met).toBe(true);
  });

  it("pace maths: count goals, both goals, and goal-less targets", () => {
    const base = { minutes: 0, count: 0, goalMin: null, goalCount: null, done: false };
    expect(computePace({ ...base, goalCount: 4, count: 1, elapsed: 0.5 }).behind).toBe(true);
    expect(computePace({ ...base, goalCount: 4, count: 2, elapsed: 0.5 }).behind).toBe(false);
    expect(computePace({ ...base, goalCount: 4, goalMin: 240, count: 4, minutes: 60, elapsed: 0.5 }).behind).toBe(true); // hours lag
    expect(computePace({ ...base, elapsed: 0.4 }).behind).toBe(false); // no goal: only behind once half the period is gone
    expect(computePace({ ...base, elapsed: 0.6 }).behind).toBe(true);
    expect(computePace({ ...base, elapsed: 0.9, done: true }).behind).toBe(false);
  });

  it("closes a target when its period ends: done if the goal was met, dropped if not", async () => {
    const wk = await ctxAt("2026-09-14 09:00");
    const met = (await add(wk, "Met goal #w ~1h")).task;
    const missed = (await add(wk, "Missed goal #w ~5h")).task;
    await logMinutes(wk, met.id, "2026-09-15", 60, "web");
    await logMinutes(wk, missed.id, "2026-09-15", 30, "web");
    const nextWeek = await ctxAt("2026-09-21 05:00");
    await rolloverIfNeeded(nextWeek);
    const rows = await q<{ id: number; state: string }>("select id, state from tasks order by id");
    expect(rows.find((r) => r.id === met.id)!.state).toBe("done");
    expect(rows.find((r) => r.id === missed.id)!.state).toBe("dropped");
  });
});

describe("Phase 3: cadence list and the Someday pool", () => {
  it("shows days since last done against the limit", async () => {
    const t0 = await ctxAt("2026-09-10 10:00");
    await add(t0, "LinkedIn post *7d");
    const c = (await listCadence(await ctxAt("2026-09-19 10:00")))[0];
    expect(c).toMatchObject({ daysSince: 9, limit: 7, overdue: true });
    const fresh = (await listCadence(await ctxAt("2026-09-12 10:00")))[0];
    expect(fresh.overdue).toBe(false);
  });

  it("reorders the Someday pool", async () => {
    const ctx = await ctxAt("2026-09-19 10:00");
    for (const t of ["A ?", "B ?", "C ?"]) await add(ctx, t);
    let titles = (await listSomeday()).map((t) => t.title);
    expect(titles).toEqual(["A", "B", "C"]);
    const c = (await listSomeday())[2];
    await reorderSomeday(c.id, "up");
    titles = (await listSomeday()).map((t) => t.title);
    expect(titles).toEqual(["A", "C", "B"]);
    await reorderSomeday(c.id, "up");
    await reorderSomeday(c.id, "up"); // already first: no-op
    expect((await listSomeday()).map((t) => t.title)).toEqual(["C", "A", "B"]);
  });
});

describe("Health", () => {
  it("builds the 09:30 to 20:30 grid with done / skipped / missed cells", async () => {
    const ctx = await ctxAt("2026-09-19 15:00");
    const slots = exerciseSlots(ctx, "2026-09-19");
    expect(slots.length).toBe(23);
    const types = await q<{ id: number }>("select id from exercise_types order by id");
    await logExercise(ctx, slots[0], "done", types[0].id, 20);
    await logExercise(ctx, slots[1], "skipped", null, null);
    await logExercise(ctx, slots[2], "missed", null, null);
    await logExercise(ctx, slots[2], "done", types[1].id, 15); // a late tap upgrades a missed slot
    await logExercise(ctx, slots[0], "missed", null, null); // but a missed write never downgrades done
    const grid = await exerciseGrid(ctx, "2026-09-19");
    expect(grid[0]).toMatchObject({ status: "done", typeName: "Squats", amount: 20 });
    expect(grid[1].status).toBe("skipped");
    expect(grid[2]).toMatchObject({ status: "done", typeName: "Push-ups", amount: 15 });
    expect(grid[3].status).toBe("pending"); // 10:30 has passed with no log
    expect(grid[22].status).toBe("upcoming"); // 20:30 is later than now
  });
});

describe("insights only appear with enough data", () => {
  const day = (i: number, score: number | null, must: number, worked = 480, un: number | null = 10): DayFacts => ({
    date: addDays("2026-08-01", i), score, mustDoCount: must, workedMin: worked, unaccountedPct: un,
  });

  it("shows the must-do insight only when each group has at least 5 days", () => {
    const few = Array.from({ length: 5 }, (_, i) => day(i, 7, 2));
    const many = Array.from({ length: 5 }, (_, i) => day(10 + i, 3, 5));
    expect(computeInsights([...few, ...many], [])).toEqual([
      "Days with 3 or fewer must-dos averaged score 7.0 vs 3.0 on days with more.",
    ]);
    // one day short in one group -> nothing
    expect(computeInsights([...few, ...many.slice(0, 4)], [])).toEqual([]);
    expect(MIN_DAYS).toBe(5);
    // negligible difference -> nothing
    expect(computeInsights([...few, ...Array.from({ length: 5 }, (_, i) => day(10 + i, 6.8, 5))], [])).toEqual([]);
  });

  it("finds the most skipped exercise slot, needing 5 days of data in the slot", () => {
    const slots = [
      { hour: 11, days: 8, notDone: 1 },
      { hour: 14, days: 8, notDone: 6 },
      { hour: 17, days: 3, notDone: 3 }, // too little data: ignored
    ];
    expect(computeInsights([], slots)).toEqual(["Most skipped exercise slot: 14:00 to 15:00 (not done on 6 of 8 days)."]);
    expect(computeInsights([], [{ hour: 14, days: 4, notDone: 4 }, { hour: 15, days: 4, notDone: 0 }])).toEqual([]);
  });

  it("finds the weekday with the most unaccounted time, only when every weekday group has 5+ days", () => {
    // 6 Saturdays at 40%, 6 Mondays at 10%
    const days: DayFacts[] = [];
    for (let i = 0; i < 6; i++) {
      days.push({ date: addDays("2026-08-01", i * 7), score: null, mustDoCount: 0, workedMin: 480, unaccountedPct: 40 }); // Saturdays
      days.push({ date: addDays("2026-08-03", i * 7), score: null, mustDoCount: 0, workedMin: 480, unaccountedPct: 10 }); // Mondays
    }
    expect(computeInsights(days, [])).toEqual(["Unaccounted time is highest on Saturdays (40% on average)."]);
    expect(computeInsights(days.slice(0, 8), [])).toEqual([]); // 4 days per weekday -> hidden
  });

  it("shows at most 3", () => {
    expect(computeInsights([], []).length).toBeLessThanOrEqual(3);
  });
});

describe("Phase 4 acceptance: stats match the underlying time logs", () => {
  it("filtering by project Vector over 30 days sums exactly the time_logs of Vector tasks", async () => {
    const start = await ctxAt("2026-08-25 10:00");
    const v1 = (await add(start, "Vector: Insights >>")).task;
    const v2 = (await add(start, "Vector: Notifications >>")).task;
    const d1 = (await add(start, "DRAC: Events >>")).task;
    const misc = (await add(start, "Random errand")).task;
    const logs: [number, string, number][] = [
      [v1.id, "2026-09-01", 90], [v1.id, "2026-09-02", 45], [v2.id, "2026-09-02", 30], [v2.id, "2026-09-10", 120],
      [d1.id, "2026-09-03", 60], [misc.id, "2026-09-03", 25], [v1.id, "2026-07-01", 999], // outside the window
    ];
    for (const [id, date, m] of logs) await logMinutes(start, id, date, m, "web");

    const ctx = await ctxAt("2026-09-19 10:00");
    const range = presetRange(ctx, 30);
    const vector = (await q<{ id: number }>("select id from projects where name = 'Vector'"))[0].id;
    const stats = await computeStats(ctx, { ...range, project: String(vector) });
    const truth = await q<{ s: number }>(
      `select sum(l.minutes)::int as s from time_logs l join tasks t on t.id = l.task_id
       where t.project_id = $1 and l.date between $2 and $3`,
      [vector, range.from, range.to],
    );
    expect(truth[0].s).toBe(90 + 45 + 30 + 120);
    expect(stats.totals.minutes).toBe(truth[0].s);
    expect(stats.hoursByProject).toHaveLength(1);
    expect(stats.hoursByProject[0]).toMatchObject({ name: "Vector", minutes: 285 });

    // drill-down timeline lists every task and its minutes per day
    const drilled = await computeStats(ctx, { ...range }, String(vector));
    expect(drilled.drill.map((r) => `${r.date} ${r.title} ${r.minutes}`)).toEqual([
      "2026-09-01 Insights 90",
      "2026-09-02 Insights 45",
      "2026-09-02 Notifications 30",
      "2026-09-10 Notifications 120",
    ]);
    // unfiltered: all projects plus "No project"
    const all = await computeStats(ctx, range);
    expect(all.hoursByProject.map((h) => h.name).sort()).toEqual(["DRAC", "No project", "Vector"]);
    expect(all.totals.minutes).toBe(285 + 60 + 25);
  });

  it("applies work/personal, type and via filters", async () => {
    const ctx0 = await ctxAt("2026-09-10 10:00");
    const a = (await add(ctx0, "Client build ^J")).task;
    const b = (await add(ctx0, "Buy medicines /p")).task;
    await logMinutes(ctx0, a.id, "2026-09-10", 100, "web");
    await logMinutes(ctx0, b.id, "2026-09-10", 20, "web");
    const ctx = await ctxAt("2026-09-19 10:00");
    const r = presetRange(ctx, 30);
    expect((await computeStats(ctx, { ...r, scope: "work" })).totals.minutes).toBe(100);
    expect((await computeStats(ctx, { ...r, scope: "personal" })).totals.minutes).toBe(20);
    expect((await computeStats(ctx, { ...r, via: "j" })).totals.minutes).toBe(100);
    expect((await computeStats(ctx, { ...r, type: "someday" })).totals.minutes).toBe(0);
  });

  it("computes the dashboard: averages, deltas against the previous period, trends and attention items", async () => {
    // previous 7 days (Sep 6-12): weak; current 7 days (Sep 13-19): better
    const ctx0 = await ctxAt("2026-09-06 09:00");
    const t = (await add(ctx0, "Vector: Insights >>")).task;
    for (let i = 0; i < 7; i++) {
      const date = addDays("2026-09-06", i);
      await setScore(date, 4);
      await logMinutes(ctx0, t.id, date, 60, "web");
    }
    for (let i = 0; i < 7; i++) {
      const date = addDays("2026-09-13", i);
      await setScore(date, 8);
      await logMinutes(ctx0, t.id, date, 240, "web");
      const e = await q<{ id: number }>("insert into day_entries (task_id, date, status) values ($1, $2, 'done') on conflict (task_id, date) do update set status = 'done' returning id", [t.id, date]);
      expect(e.length).toBe(1);
    }
    // worked time for the current period: 8h on the 19th only
    await switchState(await ctxAt("2026-09-19 09:00"), "office");
    await switchState(await ctxAt("2026-09-19 17:00"), "off");

    const ctx = await ctxAt("2026-09-19 18:00");
    const s = await computeStats(ctx, presetRange(ctx, 7));
    expect(s.summary.current.avgScore).toBe(8);
    expect(s.summary.previous.avgScore).toBe(4);
    expect(s.summary.current.tasksDone).toBe(7);
    expect(s.summary.previous.tasksDone).toBe(0);
    expect(s.previousRange).toEqual({ from: "2026-09-06", to: "2026-09-12" });
    expect(s.series).toHaveLength(7);
    expect(s.series.at(-1)).toMatchObject({ date: "2026-09-19", score: 8, done: 1, hours: 8 });
    expect(s.series.at(-1)!.scoreAvg).toBe(8);
    expect(s.weekday.find((w) => w.label === "Sat")).toMatchObject({ avgScore: 8, days: 1 });
    // logged 240m on a day with 480m worked -> 50% unaccounted; flagged as needing attention
    expect(s.summary.current.unaccountedPct).toBeCloseTo(50);
    expect(s.attention.some((a) => a.id === "unaccounted")).toBe(true);
    expect(s.efficiency.utilizationPct).toBeCloseTo(50);
  });

  it("moving average ignores gaps", () => {
    expect(movingAverage([1, null, 3, 5], 3)).toEqual([1, 1, 2, 4]);
  });

  it("materializing a day never duplicates entries (idempotent)", async () => {
    const ctx = await ctxAt("2026-09-21 05:00");
    await add(ctx, "Vector: Insights >>");
    await materializeDay(ctx, "2026-09-21");
    await materializeDay(ctx, "2026-09-21");
    expect((await q("select * from day_entries where date = '2026-09-21'")).length).toBe(1);
  });
});
