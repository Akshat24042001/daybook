import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, q } from "@/lib/db";
import { workedMinutes } from "@/lib/hours";
import { dayTimelines } from "@/lib/services/stats";
import { currentState, switchState, workedForDate } from "@/lib/services/segments";
import { describeTimeLog, parseTimeLog } from "@/lib/timelog";
import { ctxAt, ist, resetDb, TZ } from "./helpers";

beforeEach(resetDb);
afterAll(closePool);

const H = (h: number, m = 0) => h * 60 + m;

describe("more activities than office, outside and break", () => {
  it("only work kinds count towards worked time", () => {
    const win = { start: ist("2026-09-25 04:00"), end: ist("2026-09-26 04:00") };
    const segs = [
      { kind: "office" as const, start: ist("2026-09-25 09:00"), end: ist("2026-09-25 12:00") },
      { kind: "meal" as const, start: ist("2026-09-25 12:00"), end: ist("2026-09-25 13:00") },
      { kind: "remote" as const, start: ist("2026-09-25 13:00"), end: ist("2026-09-25 14:00") },
      { kind: "personal" as const, start: ist("2026-09-25 14:00"), end: ist("2026-09-25 15:00") },
      { kind: "exercise" as const, start: ist("2026-09-25 18:00"), end: ist("2026-09-25 18:30") },
      { kind: "commute" as const, start: ist("2026-09-25 18:30"), end: ist("2026-09-25 19:00") },
    ];
    expect(workedMinutes(segs, win, ist("2026-09-25 23:00"))).toBe(240);
  });

  it("switching to a new activity saves it, and a personal errand after Day end does not reopen the day", async () => {
    const ctx = await ctxAt("2026-09-25 09:00");
    await switchState(ctx, "office");
    await switchState(await ctxAt("2026-09-25 13:00"), "meal");
    await switchState(await ctxAt("2026-09-25 13:45"), "office");
    await switchState(await ctxAt("2026-09-25 18:00"), "off");
    await switchState(await ctxAt("2026-09-25 18:30"), "personal");
    expect((await currentState()).kind).toBe("personal");
    const day = await q<{ closed_at: Date | null }>("select closed_at from days where date = '2026-09-25'");
    expect(day[0].closed_at).not.toBeNull();
    expect(await workedForDate(await ctxAt("2026-09-25 19:00"), "2026-09-25")).toBe(H(4) + H(4, 15));
  });

  it("the time-log parser knows meals, commute, exercise, personal time and working from home", () => {
    const now = ist("2026-09-25 22:00");
    const r = parseTimeLog(
      "commute 8:30 to 9, office 9 to 1, lunch 1 to 1:45, wfh 2 to 5, gym 6 to 7, personal 7 to 8",
      { now, tz: TZ, boundaryMin: 240 },
    )!;
    expect(r.segments.map((s) => s.kind)).toEqual(["commute", "office", "meal", "remote", "exercise", "personal"]);
    expect(describeTimeLog(r).workedMin).toBe(H(4) + H(3));
    expect(r.segments[3]).toMatchObject({ startMin: H(14), endMin: H(17) });
  });

  it("day timelines lay each day's segments out on a clock, newest first", async () => {
    await q(
      `insert into work_segments (date, kind, start_at, end_at) values
       ('2026-09-24', 'office', $1, $2), ('2026-09-25', 'office', $3, $4), ('2026-09-25', 'break', $4, $5), ('2026-09-25', 'outside', $5, null)`,
      [ist("2026-09-24 10:00"), ist("2026-09-24 18:00"), ist("2026-09-25 09:00"), ist("2026-09-25 12:00"), ist("2026-09-25 14:00")],
    );
    const ctx = await ctxAt("2026-09-25 16:00");
    const days = await dayTimelines(ctx, "2026-09-23", "2026-09-25");
    expect(days.map((d) => d.date)).toEqual(["2026-09-25", "2026-09-24", "2026-09-23"]);
    expect(days[0].spans).toEqual([
      { kind: "office", startMin: H(9), endMin: H(12), open: false },
      { kind: "break", startMin: H(12), endMin: H(14), open: false },
      { kind: "outside", startMin: H(14), endMin: H(16), open: true },
    ]);
    expect(days[0].workedMin).toBe(H(5));
    expect(days[1].spans).toHaveLength(1);
    expect(days[2].spans).toEqual([]);
  });
});
