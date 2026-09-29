import { describe, expect, it } from "vitest";
import {
  describeRrule, formatRepeat, nextOccurrences, parseRepeat, parseRepeatPhrase, repeatProblem, rruleMatches,
} from "@/lib/recurrence";
import { parseQuickAdd } from "@/lib/parser";
import { ist } from "./helpers";

const next = (rrule: string, from: string, n = 5, start = from) => nextOccurrences(parseRepeat(rrule)!, from, n, start);
const phrase = (p: string) => {
  const r = parseRepeatPhrase(p);
  return "error" in r ? r.error : formatRepeat(r.repeat);
};

describe("repeat rules", () => {
  it("reads old rules exactly as before", () => {
    expect(rruleMatches("FREQ=WEEKLY;BYDAY=MO", "2026-09-28")).toBe(true);
    expect(rruleMatches("FREQ=WEEKLY;BYDAY=MO", "2026-09-29")).toBe(false);
    expect(rruleMatches("FREQ=MONTHLY;BYMONTHDAY=31", "2026-09-30")).toBe(true); // short month: its last day
    expect(rruleMatches("FREQ=DAILY", "2026-09-27")).toBe(true);
    expect(rruleMatches(null, "2026-09-27")).toBe(false);
  });

  it("every day except Sunday, weekdays, and every other day from the start", () => {
    // 2026-09-26 is a Saturday
    expect(next("FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR,SA", "2026-09-26", 3)).toEqual(["2026-09-26", "2026-09-28", "2026-09-29"]);
    expect(next("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "2026-09-26", 2)).toEqual(["2026-09-28", "2026-09-29"]);
    expect(next("FREQ=DAILY;INTERVAL=2", "2026-09-27", 3, "2026-09-26")).toEqual(["2026-09-28", "2026-09-30", "2026-10-02"]);
  });

  it("every 2 weeks, the last Friday, the 1st and 15th, and a yearly date", () => {
    expect(next("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;DTSTART=20260929", "2026-09-28", 3)).toEqual(["2026-09-29", "2026-10-13", "2026-10-27"]);
    expect(next("FREQ=MONTHLY;BYDAY=-1FR", "2026-09-01", 3)).toEqual(["2026-09-25", "2026-10-30", "2026-11-27"]);
    expect(next("FREQ=MONTHLY;BYDAY=1MO", "2026-09-01", 2)).toEqual(["2026-09-07", "2026-10-05"]);
    expect(next("FREQ=MONTHLY;BYMONTHDAY=1,15,-1", "2026-09-10", 4)).toEqual(["2026-09-15", "2026-09-30", "2026-10-01", "2026-10-15"]);
    expect(next("FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=12", "2026-09-29", 2)).toEqual(["2027-03-12", "2028-03-12"]);
  });

  it("starts, ends, skips dates, pauses, and stops after a count", () => {
    const r = "FREQ=DAILY;DTSTART=20260929;UNTIL=20261005;EXDATE=20261001;X-PAUSE=20261003";
    // a pause covers everything up to its day; the skipped date and the end date still apply
    expect(next(r, "2026-09-01", 10)).toEqual(["2026-10-04", "2026-10-05"]);
    expect(next("FREQ=DAILY;DTSTART=20260929;UNTIL=20261005;EXDATE=20261001", "2026-09-01", 10))
      .toEqual(["2026-09-29", "2026-09-30", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]);
    expect(next("FREQ=WEEKLY;BYDAY=MO;DTSTART=20260928;COUNT=2", "2026-09-28", 5)).toEqual(["2026-09-28", "2026-10-05"]);
  });

  it("round-trips and says what it means", () => {
    const r = "FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR,SA;X-MISSED=CARRY";
    expect(formatRepeat(parseRepeat(r)!)).toBe(r);
    expect(parseRepeat(r)!.missed).toBe("carry");
    expect(describeRrule("FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR,SA")).toBe("Every day except Sunday");
    expect(describeRrule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")).toBe("Every weekday");
    expect(describeRrule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH")).toBe("Every 2 weeks on Monday and Thursday");
    expect(describeRrule("FREQ=MONTHLY;BYDAY=-1FR")).toBe("Monthly on the last Friday");
    expect(describeRrule("FREQ=MONTHLY;BYMONTHDAY=1,15")).toBe("Monthly on the 1st and the 15th");
    expect(describeRrule("FREQ=DAILY;UNTIL=20261231")).toBe("Every day, until 31 Dec 2026");
    expect(repeatProblem(parseRepeat("FREQ=WEEKLY")!)).toBe("Pick at least one day of the week.");
  });

  it("reads typed phrases", () => {
    expect(phrase("day")).toBe("FREQ=DAILY");
    expect(phrase("other day")).toBe("FREQ=DAILY;INTERVAL=2");
    expect(phrase("3 days")).toBe("FREQ=DAILY;INTERVAL=3");
    expect(phrase("weekday")).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(phrase("day except sun")).toBe("FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR,SA");
    expect(phrase("mon, wed and fri")).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
    expect(phrase("2 weeks on tue")).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU");
    expect(phrase("week")).toBe("FREQ=WEEKLY");
    expect(phrase("1st and 15th")).toBe("FREQ=MONTHLY;BYMONTHDAY=1,15");
    expect(phrase("last day")).toBe("FREQ=MONTHLY;BYMONTHDAY=-1");
    expect(phrase("last fri")).toBe("FREQ=MONTHLY;BYDAY=-1FR");
    expect(phrase("month on the 2nd mon")).toBe("FREQ=MONTHLY;BYDAY=2MO");
    expect(phrase("year on 12 mar")).toBe("FREQ=YEARLY;BYMONTHDAY=12;BYMONTH=3");
    expect(phrase("banana")).toMatch(/could not read/);
  });

  it("quick-add understands repeats and leaves the rest of the title alone", () => {
    const ctx = { now: ist("2026-09-29 09:00"), tz: "Asia/Kolkata", boundaryMin: 240 };
    const a = parseQuickAdd("Meditate every day except sun ~15m", ctx);
    expect([a.title, a.type, a.rrule, a.estimateMin]).toEqual(["Meditate", "recurring", "FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR,SA", 15]);
    const b = parseQuickAdd("Standup notes daily", ctx);
    expect([b.title, b.rrule]).toEqual(["Standup notes", "FREQ=DAILY"]);
    const c = parseQuickAdd("Pay rent every 1st", ctx);
    expect([c.title, c.rrule]).toEqual(["Pay rent", "FREQ=MONTHLY;BYMONTHDAY=1"]);
    const d = parseQuickAdd("Review numbers every mon wed", ctx);
    expect([d.title, d.rrule]).toEqual(["Review numbers", "FREQ=WEEKLY;BYDAY=MO,WE"]);
    const e = parseQuickAdd("Gym every day and night", ctx);
    expect([e.title, e.rrule]).toEqual(["Gym and night", "FREQ=DAILY"]);
  });
});
