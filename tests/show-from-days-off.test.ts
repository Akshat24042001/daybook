import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, q } from "@/lib/db";
import { sectionize } from "@/lib/sections";
import { entriesForDate, setEntryStatus } from "@/lib/services/entries";
import { computeStats } from "@/lib/services/stats";
import { cleanShowFrom } from "@/lib/services/tasks";
import { ctxAt, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(closePool);

describe("show from: a task stays off Today until its time", () => {
  it("reads times the way people write them", () => {
    expect(cleanShowFrom("18:00")).toBe("18:00");
    expect(cleanShowFrom("6pm")).toBe("18:00");
    expect(cleanShowFrom("6:30 pm")).toBe("18:30");
    expect(cleanShowFrom("12am")).toBe("00:00");
    expect(cleanShowFrom("")).toBeNull();
    expect(() => cleanShowFrom("evening")).toThrow();
  });

  it("holds the task in 'later' before the time and lists it after", async () => {
    await q("insert into tasks (title, show_from) values ('Evening walk', '18:00'), ('Inbox zero', null)");
    await q("insert into day_entries (task_id, date) values (1, '2026-09-25'), (2, '2026-09-25')");
    const noon = await ctxAt("2026-09-25 12:00");
    let sec = sectionize(await entriesForDate("2026-09-25"), noon.tz, noon.boundaryMin, noon.now);
    expect(sec.later.map((e) => e.title)).toEqual(["Evening walk"]);
    expect(sec.other.map((e) => e.title)).toEqual(["Inbox zero"]);

    const evening = await ctxAt("2026-09-25 18:05");
    sec = sectionize(await entriesForDate("2026-09-25"), evening.tz, evening.boundaryMin, evening.now);
    expect(sec.later).toEqual([]);
    expect(sec.other.map((e) => e.title).sort()).toEqual(["Evening walk", "Inbox zero"]);

    // done early anyway: it is not hidden
    await setEntryStatus(noon, (await entriesForDate("2026-09-25"))[0].id, "done");
    sec = sectionize(await entriesForDate("2026-09-25"), noon.tz, noon.boundaryMin, noon.now);
    expect(sec.later).toEqual([]);
  });
});

describe("days off in Stats", () => {
  it("an idle Sunday is left out of the daily series, rates and weekday pattern; a worked one counts", async () => {
    // Fri 25 and Sat 26 worked days; Sun 27 off with an untouched carried task
    await q("insert into tasks (title) values ('A'), ('B'), ('C')");
    await q(`insert into day_entries (task_id, date, status) values
      (1, '2026-09-25', 'done'), (2, '2026-09-26', 'done'), (3, '2026-09-27', 'open')`);
    const ctx = await ctxAt("2026-09-28 10:00");
    let s = await computeStats(ctx, { from: "2026-09-25", to: "2026-09-27" });
    expect(s.series.map((x) => x.date)).toEqual(["2026-09-25", "2026-09-26"]);
    expect(s.summary.current.completionRate).toBe(1); // the open Sunday entry is not a miss
    expect(s.weekday.map((w) => w.label)).not.toContain("Sun");
    expect(s.heatmap.find((h) => h.date === "2026-09-27")?.off).toBe(true);

    // finishing something on Sunday brings the day back in
    await q("update day_entries set status = 'done' where task_id = 3");
    s = await computeStats(ctx, { from: "2026-09-25", to: "2026-09-27" });
    expect(s.series.map((x) => x.date)).toContain("2026-09-27");
    expect(s.weekday.map((w) => w.label)).toContain("Sun");
  });
});
