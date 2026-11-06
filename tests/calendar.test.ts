import { beforeEach, describe, expect, it } from "vitest";
import { q } from "@/lib/db";
import { rangeFor, shiftDate } from "@/lib/calendar-range";
import { calendarData } from "@/lib/services/calendar";
import { setEntryStatus, entriesForDate } from "@/lib/services/entries";
import { add, ctxAt, resetDb } from "./helpers";

describe("which days each view needs", () => {
  it("covers whole weeks for a month, starting on Monday", () => {
    expect(rangeFor("month", "2026-11-15", "2026-11-06")).toEqual({ from: "2026-10-26", to: "2026-12-06" });
    expect(rangeFor("month", "2026-02-10", "2026-11-06")).toEqual({ from: "2026-01-26", to: "2026-03-01" });
    expect(rangeFor("week", "2026-11-06", "2026-11-06")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(rangeFor("week", "2026-11-08", "2026-11-06")).toEqual({ from: "2026-11-02", to: "2026-11-08" }); // Sunday belongs to the week before
    expect(rangeFor("year", "2026-11-06", "2026-11-06")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(rangeFor("agenda", "2026-01-01", "2026-11-06")).toEqual({ from: "2026-11-06", to: "2026-12-05" });
    expect(rangeFor("day", "2026-11-06", "2026-11-06")).toEqual({ from: "2026-11-06", to: "2026-11-06" });
  });

  it("moves by the right amount, without falling off the end of a short month", () => {
    expect(shiftDate("month", "2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftDate("month", "2026-01-15", -1)).toBe("2025-12-15");
    expect(shiftDate("month", "2026-12-15", 1)).toBe("2027-01-15");
    expect(shiftDate("week", "2026-11-06", 1)).toBe("2026-11-13");
    expect(shiftDate("day", "2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("year", "2028-02-29", 1)).toBe("2029-02-28");
  });
});

describe("the calendar's data", () => {
  beforeEach(async () => {
    await resetDb();
    await q("truncate sales_meetings, sales_payments, sales_moves, sales_deals restart identity cascade").catch(() => {});
  });

  it("shows what happened on past days and how they went", async () => {
    const past = await ctxAt("2026-09-16 10:00");
    const a = await add(past, "Finished thing");
    await add(past, "Skipped thing");
    const [first, second] = await entriesForDate(past.today);
    await setEntryStatus(past, first.id, "done");
    await setEntryStatus(past, second.id, "skipped");
    await q("insert into days (date, score) values ('2026-09-16', 8)");
    expect(a.entry).toBeTruthy();
    const now = await ctxAt("2026-09-19 10:00");
    const cal = await calendarData(now, "week", "2026-09-17");
    const day = cal.days.find((d) => d.date === "2026-09-16");
    expect(cal.from).toBe("2026-09-14");
    expect(day).toMatchObject({ score: 8, counts: { total: 2, done: 1, skipped: 1, open: 0, projected: 0 } });
    expect(day!.tasks.map((t) => [t.title, t.status]).sort()).toEqual([["Finished thing", "done"], ["Skipped thing", "skipped"]]);
    expect(cal.summary).toMatchObject({ done: 1, planned: 2, avgScore: 8 });
  });

  it("is read-only: looking at any range writes nothing", async () => {
    const ctx = await ctxAt("2026-09-16 10:00");
    await add(ctx, "Some task");
    await add(ctx, "Water the plants every mon");
    const before = JSON.stringify(await q("select task_id, date, status, source from day_entries order by id"));
    const carryBefore = JSON.stringify(await q("select id, carry_count from tasks order by id"));
    for (const v of ["day", "week", "month", "year", "agenda"] as const) await calendarData(ctx, v, "2026-10-12");
    expect(JSON.stringify(await q("select task_id, date, status, source from day_entries order by id"))).toBe(before);
    expect(JSON.stringify(await q("select id, carry_count from tasks order by id"))).toBe(carryBefore);
  });

  it("projects repeating tasks onto coming days without saving them, and marks them", async () => {
    const ctx = await ctxAt("2026-09-16 10:00"); // Wednesday
    await add(ctx, "Team review every mon");
    const cal = await calendarData(ctx, "week", "2026-09-21");
    const monday = cal.days.find((d) => d.date === "2026-09-21")!;
    expect(monday.tasks.map((t) => [t.title, t.projected])).toEqual([["Team review", true]]);
    expect(monday.counts.projected).toBe(1);
    expect(cal.days.find((d) => d.date === "2026-09-22")!.tasks).toHaveLength(0);
    expect(await q("select 1 from day_entries where date = '2026-09-21'")).toHaveLength(0);
  });

  it("lists meetings, payments and due cadence tasks as events, and keeps a year small", async () => {
    const ctx = await ctxAt("2026-09-16 10:00");
    const deal = (await q<{ id: number }>("insert into sales_deals (title, stage_id) select 'Acme deal', id from sales_stages order by id limit 1 returning id"))[0];
    await q("insert into sales_meetings (title, starts_at, deal_id) values ('Kickoff call', '2026-09-18 08:30:00+00', $1)", [deal.id]);
    await q("insert into sales_payments (deal_id, label, amount, currency, due_on) values ($1, 'Advance', 5000, 'USD', '2026-09-20')", [deal.id]);
    await add(ctx, "Post on LinkedIn *3d");
    const week = await calendarData(ctx, "week", "2026-09-17");
    const events = week.days.flatMap((d) => d.eventList.map((e) => `${d.date}:${e.kind}`));
    expect(events).toEqual(expect.arrayContaining(["2026-09-18:meeting", "2026-09-20:payment", "2026-09-19:cadence"]));
    const year = await calendarData(ctx, "year", "2026-09-17");
    expect(year.days).toHaveLength(365);
    expect(year.days.every((d) => d.tasks.length === 0 && d.eventList.length === 0)).toBe(true);
    expect(year.days.find((d) => d.date === "2026-09-18")!.events).toBeGreaterThan(0);
  });

  it("summarises only the days that have already happened", async () => {
    const ctx = await ctxAt("2026-09-19 10:00");
    await q("insert into days (date, score) values ('2026-09-15', 6), ('2026-09-16', 9), ('2026-09-25', 10)");
    const cal = await calendarData(ctx, "month", "2026-09-19");
    expect(cal.summary.avgScore).toBe(7.5); // the future 10 is ignored
    expect(cal.summary.best).toEqual({ date: "2026-09-16", score: 9 });
    expect(cal.summary.scoredDays).toBe(2);
  });
});
