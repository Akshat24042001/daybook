import { describe, expect, it } from "vitest";
import { findOverlap, unaccounted, workedMinutes, type Segment } from "@/lib/hours";
import { dayWindow } from "@/lib/time";

const TZ = "Asia/Kolkata";
const B = 240;
// IST helper: "2026-09-19 10:00" -> Date
const ist = (s: string) => new Date(new Date(s.replace(" ", "T") + ":00Z").getTime() - 330 * 60_000);
const seg = (kind: Segment["kind"], a: string, b: string | null): Segment => ({
  kind,
  start: ist(a),
  end: b ? ist(b) : null,
});
const win19 = dayWindow("2026-09-19", TZ, B);
const win20 = dayWindow("2026-09-20", TZ, B);
const NOW = ist("2026-09-19 23:00");

describe("workedMinutes", () => {
  it("sums office and outside, ignores breaks (lunch)", () => {
    const segs = [
      seg("office", "2026-09-19 10:00", "2026-09-19 13:00"), // 180
      seg("break", "2026-09-19 13:00", "2026-09-19 14:00"), // not counted
      seg("office", "2026-09-19 14:00", "2026-09-19 16:00"), // 120
      seg("outside", "2026-09-19 16:00", "2026-09-19 18:30"), // 150
    ];
    expect(workedMinutes(segs, win19, NOW)).toBe(450);
  });

  it("returns 0 with no segments or only breaks", () => {
    expect(workedMinutes([], win19, NOW)).toBe(0);
    expect(workedMinutes([seg("break", "2026-09-19 12:00", "2026-09-19 13:00")], win19, NOW)).toBe(0);
  });

  it("counts an open segment up to now", () => {
    const segs = [seg("office", "2026-09-19 10:02", null)];
    expect(workedMinutes(segs, win19, ist("2026-09-19 13:16"))).toBe(194); // 3h 14m
  });

  it("keeps a segment running past midnight on the same day (before 04:00)", () => {
    const segs = [seg("office", "2026-09-19 22:00", "2026-09-20 01:30")];
    expect(workedMinutes(segs, win19, NOW)).toBe(210);
    expect(workedMinutes(segs, win20, ist("2026-09-20 12:00"))).toBe(0);
  });

  it("splits a segment that crosses the 04:00 boundary between two days", () => {
    const segs = [seg("office", "2026-09-20 02:00", "2026-09-20 06:00")]; // 2h in the 19th, 2h in the 20th
    expect(workedMinutes(segs, win19, ist("2026-09-20 12:00"))).toBe(120);
    expect(workedMinutes(segs, win20, ist("2026-09-20 12:00"))).toBe(120);
  });

  it("caps an open segment at the end of the day window", () => {
    const segs = [seg("office", "2026-09-19 22:00", null)];
    // now is the next afternoon; only time up to 04:00 counts for the 19th
    expect(workedMinutes(segs, win19, ist("2026-09-20 15:00"))).toBe(360);
  });

  it("does not double count overlapping segments", () => {
    const segs = [
      seg("office", "2026-09-19 10:00", "2026-09-19 12:00"),
      seg("outside", "2026-09-19 11:00", "2026-09-19 13:00"),
    ];
    expect(workedMinutes(segs, win19, NOW)).toBe(180);
  });

  it("handles many in/out pairs", () => {
    const segs = [
      seg("office", "2026-09-19 09:00", "2026-09-19 09:30"),
      seg("break", "2026-09-19 09:30", "2026-09-19 09:45"),
      seg("office", "2026-09-19 09:45", "2026-09-19 10:15"),
      seg("outside", "2026-09-19 10:15", "2026-09-19 10:45"),
    ];
    expect(workedMinutes(segs, win19, NOW)).toBe(30 + 30 + 30);
  });
});

describe("unaccounted", () => {
  it("is worked minus logged, never negative", () => {
    expect(unaccounted(450, 300)).toEqual({ minutes: 150, pct: (150 / 450) * 100 });
    expect(unaccounted(100, 130).minutes).toBe(0);
    expect(unaccounted(0, 0)).toEqual({ minutes: 0, pct: 0 });
  });
});

describe("findOverlap", () => {
  const existing = [seg("office", "2026-09-19 10:00", "2026-09-19 12:00"), seg("break", "2026-09-19 12:00", "2026-09-19 13:00")];
  it("rejects overlaps", () => {
    expect(findOverlap(existing, { start: ist("2026-09-19 11:00"), end: ist("2026-09-19 11:30") })).not.toBeNull();
    expect(findOverlap(existing, { start: ist("2026-09-19 09:00"), end: ist("2026-09-19 10:01") })).not.toBeNull();
    expect(findOverlap(existing, { start: ist("2026-09-19 12:30"), end: null })).not.toBeNull();
  });
  it("allows touching segments", () => {
    expect(findOverlap(existing, { start: ist("2026-09-19 13:00"), end: ist("2026-09-19 14:00") })).toBeNull();
    expect(findOverlap(existing, { start: ist("2026-09-19 09:00"), end: ist("2026-09-19 10:00") })).toBeNull();
  });
});
