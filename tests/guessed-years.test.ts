// A year the screenshot or chat does not show is never believed: "4 Nov" is this year (or last, if that is ahead).
import { describe, expect, it, vi } from "vitest";
import { trustYear } from "@/lib/sales/ingest";
import { ago } from "@/components/sales/format";

const now = new Date("2026-11-17T09:00:00Z");

describe("years the AI guesses", () => {
  it("moves a guessed year to the latest one that is not in the future", () => {
    expect(trustYear("2024-11-04 10:00", "CHAT WITH: Pankaj, APP: LinkedIn\n4 Nov\nTHEM: Hi", now)).toBe("2026-11-04 10:00");
    expect(trustYear("2024-12-20 10:00", "20 Dec\nTHEM: Hi", now)).toBe("2025-12-20 10:00"); // 20 Dec 2026 is still ahead
    expect(trustYear("2026-11-16 18:02", "Yesterday", now)).toBe("2026-11-16 18:02");
  });
  it("keeps a year the source really shows", () => {
    expect(trustYear("2024-11-04 10:00", "Nov 4, 2024\nTHEM: Hi", now)).toBe("2024-11-04 10:00");
    expect(trustYear("2024-11-04 10:00", "[04/11/24, 10:00] Pankaj: Hi", now)).toBe("2024-11-04 10:00");
    expect(trustYear(null, "x", now)).toBeNull();
  });
});

describe("how long ago, in words", () => {
  it("reads long spans as months and years, not hundreds of days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(ago(new Date(now.getTime() - 5 * 86_400_000))).toBe("5d ago");
    expect(ago(new Date(now.getTime() - 90 * 86_400_000))).toBe("3mo ago");
    expect(ago(new Date(now.getTime() - 743 * 86_400_000))).toBe("2y ago");
    expect(ago(new Date(now.getTime() - 500 * 86_400_000))).toBe("1.4y ago");
    vi.useRealTimers();
  });
});
