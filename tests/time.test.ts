import { describe, expect, it } from "vitest";
import {
  addDays, atLogical, calendarDate, dayWindow, diffDays, fmtDuration, fmtHM, isoDow,
  logicalDate, parseHM, periodEnd, periodStart, weekStart, zonedInstant,
} from "@/lib/time";

const TZ = "Asia/Kolkata";
const B = 240; // 04:00

describe("timezone + day boundary", () => {
  it("converts UTC to IST for display", () => {
    // 2026-09-19 08:30Z = 14:00 IST
    expect(fmtHM(new Date("2026-09-19T08:30:00Z"), TZ)).toBe("14:00");
    expect(calendarDate(new Date("2026-09-18T20:00:00Z"), TZ)).toBe("2026-09-19"); // 01:30 IST next day
  });

  it("keeps late-night work on the right day (04:00 boundary)", () => {
    // 01:30 IST on the 20th -> still the 19th
    expect(logicalDate(new Date("2026-09-19T20:00:00Z"), TZ, B)).toBe("2026-09-19");
    // 03:59 IST on the 20th -> still the 19th
    expect(logicalDate(new Date("2026-09-19T22:29:00Z"), TZ, B)).toBe("2026-09-19");
    // 04:00 IST on the 20th -> the 20th
    expect(logicalDate(new Date("2026-09-19T22:30:00Z"), TZ, B)).toBe("2026-09-20");
    // 23:59 IST on the 19th -> the 19th
    expect(logicalDate(new Date("2026-09-19T18:29:00Z"), TZ, B)).toBe("2026-09-19");
  });

  it("day window runs boundary to boundary in UTC", () => {
    const w = dayWindow("2026-09-19", TZ, B);
    expect(w.start.toISOString()).toBe("2026-09-18T22:30:00.000Z"); // 04:00 IST on the 19th
    expect(w.end.toISOString()).toBe("2026-09-19T22:30:00.000Z");
  });

  it("respects a different boundary setting", () => {
    expect(logicalDate(new Date("2026-09-19T20:00:00Z"), TZ, 0)).toBe("2026-09-20");
    expect(logicalDate(new Date("2026-09-19T20:00:00Z"), TZ, 60)).toBe("2026-09-20"); // 01:30 >= 01:00
    expect(logicalDate(new Date("2026-09-19T20:00:00Z"), TZ, 120)).toBe("2026-09-19"); // 01:30 < 02:00
  });

  it("places wall-clock times before the boundary on the next calendar date", () => {
    expect(atLogical("2026-09-19", parseHM("17:00"), TZ, B).toISOString()).toBe("2026-09-19T11:30:00.000Z");
    // 01:30 belongs to logical 19th, so it is on calendar 20th
    expect(atLogical("2026-09-19", parseHM("01:30"), TZ, B).toISOString()).toBe("2026-09-19T20:00:00.000Z");
  });

  it("builds zoned instants", () => {
    expect(zonedInstant("2026-09-19", 9, 30, TZ).toISOString()).toBe("2026-09-19T04:00:00.000Z");
  });

  it("works for timezones other than IST", () => {
    // New York, EDT (UTC-4) in September
    expect(logicalDate(new Date("2026-09-19T07:00:00Z"), "America/New_York", B)).toBe("2026-09-18"); // 03:00 local
    expect(logicalDate(new Date("2026-09-19T08:00:00Z"), "America/New_York", B)).toBe("2026-09-19"); // 04:00 local
  });
});

describe("date arithmetic", () => {
  it("adds days across month and year", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("diffs days", () => {
    expect(diffDays("2026-09-19", "2026-09-12")).toBe(7);
    expect(diffDays("2026-09-12", "2026-09-19")).toBe(-7);
  });
  it("gives ISO weekdays", () => {
    expect(isoDow("2026-09-19")).toBe(6); // Saturday
    expect(isoDow("2026-09-20")).toBe(7);
    expect(isoDow("2026-09-21")).toBe(1);
  });
  it("finds period bounds", () => {
    expect(weekStart("2026-09-19")).toBe("2026-09-14");
    expect(periodStart("2026-09-19", "month")).toBe("2026-09-01");
    expect(periodStart("2026-09-19", "quarter")).toBe("2026-07-01");
    expect(periodEnd("2026-07-01", "quarter")).toBe("2026-09-30");
    expect(periodEnd("2026-02-01", "month")).toBe("2026-02-28");
    expect(periodEnd("2026-09-14", "week")).toBe("2026-09-20");
  });
  it("formats durations", () => {
    expect(fmtDuration(194)).toBe("3h 14m");
    expect(fmtDuration(45)).toBe("45m");
    expect(fmtDuration(0)).toBe("0m");
  });
});
