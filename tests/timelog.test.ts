import { describe, expect, it } from "vitest";
import { describeTimeLog, looksLikeTimeLog, parseTimeLog, resolveSegments, type TimeLogContext } from "@/lib/timelog";
import { fmtHM } from "@/lib/time";

const TZ = "Asia/Kolkata";
// Saturday 19 Sep 2026, 20:00 IST
const ctx: TimeLogContext = { now: new Date("2026-09-19T14:30:00Z"), tz: TZ, boundaryMin: 240 };
const p = (s: string) => parseTimeLog(s, ctx)!;
const simple = (s: string) => p(s).segments.map((x) => [x.kind, x.startMin, x.endMin]);
const H = (h: number, m = 0) => h * 60 + m;

describe("manual time entry parser", () => {
  it("office 10:45 to 1:30 = 10:45 to 13:30, 2h 45m", () => {
    expect(simple("office 10:45 to 1:30")).toEqual([["office", H(10, 45), H(13, 30)]]);
    expect(describeTimeLog(p("office 10:45 to 1:30")).workedMin).toBe(165);
  });

  it("understands the natural phrasing from the request", () => {
    for (const s of [
      "I entered office at 10:45 and left at 1:30",
      "entered the office at 10:45 and left at 1:30 pm",
      "in at 10:45 out at 1:30 office",
      "Entered office at 10:45 a.m. and left at 1:30 p.m.",
    ]) {
      expect(simple(s), s).toEqual([["office", H(10, 45), H(13, 30)]]);
    }
  });

  it("handles several segments with lunch and an outside visit", () => {
    const r = p("office 10:45 to 1:30, break 1:30 to 2:15, outside 2:15 to 6");
    expect(r.segments).toEqual([
      { kind: "office", startMin: H(10, 45), endMin: H(13, 30) },
      { kind: "break", startMin: H(13, 30), endMin: H(14, 15) },
      { kind: "outside", startMin: H(14, 15), endMin: H(18) },
    ]);
    const d = describeTimeLog(r);
    expect(d.workedMin).toBe(165 + 225); // break excluded
    expect(d.lines[1]).toContain("Break 13:30 to 14:15 = 45m");
  });

  it("applies the same bare-hour rules as quick-add: 1-7 are PM, 8-11 are AM", () => {
    expect(simple("office 9 to 5")).toEqual([["office", H(9), H(17)]]);
    expect(simple("office 10 to 6")).toEqual([["office", H(10), H(18)]]);
    expect(simple("office 8:30 to 4:30")).toEqual([["office", H(8, 30), H(16, 30)]]);
  });

  it("uses explicit am/pm and 24-hour times as given", () => {
    expect(simple("office 9am to 5:30pm")).toEqual([["office", H(9), H(17, 30)]]);
    expect(simple("office 10:00 to 19:15")).toEqual([["office", H(10), H(19, 15)]]);
    expect(simple("work 12pm to 1pm")).toEqual([["office", H(12), H(13)]]);
  });

  it("rolls an end that lands before the start forward (past midnight)", () => {
    expect(simple("office 10pm to 1am")).toEqual([["office", H(22), H(25)]]);
    expect(simple("office 22:00 to 1:00")).toEqual([["office", H(22), H(25)]]);
    const r = p("office 10pm to 1:30am");
    const inst = resolveSegments(r, ctx)[0];
    expect(fmtHM(inst.start, TZ)).toBe("22:00");
    expect(fmtHM(inst.end!, TZ)).toBe("01:30");
    expect(inst.end!.getTime() - inst.start.getTime()).toBe(3.5 * 3600_000);
    expect(describeTimeLog(r).lines[0]).toContain("(past midnight)");
  });

  it("supports yesterday, weekdays and explicit dates", () => {
    expect(p("yesterday office 10 to 6").date).toBe("2026-09-18");
    expect(p("office 10 to 6 yesterday").date).toBe("2026-09-18");
    expect(p("on monday office 10 to 6").date).toBe("2026-09-14");
    expect(p("office 10 to 6 on 12 sep").date).toBe("2026-09-12");
    expect(p("office 10 to 6").date).toBe("2026-09-19");
  });

  it("creates an open segment from a lone start time when it reads like a clock-in", () => {
    expect(simple("entered office at 10:45")).toEqual([["office", H(10, 45), null]]);
    expect(p("10:45").errors.length + (p("10:45")?.segments.length ?? 0)).toBeGreaterThan(0);
  });

  it("rejects absurd durations", () => {
    expect(p("office 9am to 11pm").errors).toEqual([]); // 14h is long but plausible
    expect(p("office 6am to 11pm").errors.join(" ")).toMatch(/17h 00m in one go\. Check the times/);
  });

  it("does not mistake dates or plain numbers for times", () => {
    expect(parseTimeLog("call 3 people about the 18 sep meeting", ctx)).toBeNull();
    expect(parseTimeLog("buy milk", ctx)).toBeNull();
  });

  it("accepts /log and spoken-transcript punctuation", () => {
    expect(simple("/log office 10:45 to 1:30")).toEqual([["office", H(10, 45), H(13, 30)]]);
    expect(simple("I worked from 10:45 to 1:30.")).toEqual([["office", H(10, 45), H(13, 30)]]);
  });
});

describe("deciding between a time entry and a task", () => {
  it("recognises time entries", () => {
    for (const s of [
      "office 10:45 to 1:30",
      "I entered office at 10:45 and left at 1:30",
      "lunch 1:30 to 2:15",
      "office 10 to 1, break 1 to 1:45, outside 1:45 to 6",
      "/log 10 to 6",
    ]) {
      expect(looksLikeTimeLog(s), s).toBe(true);
    }
  });
  it("leaves tasks alone, including timed ones and quick-add syntax", () => {
    for (const s of [
      "Karmit callback @5pm",
      "Prepare deck 10 to 11",
      "Vector: Insights !! ~2h",
      "Call Bob about the 18 sep event",
      "buy milk",
      "Office cleaning @tom 10am >>",
    ]) {
      expect(looksLikeTimeLog(s), s).toBe(false);
    }
  });
});
