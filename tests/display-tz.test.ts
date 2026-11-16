import { describe, expect, it } from "vitest";
import { displayTz, fmtZoned, fromZonedInput, setDisplayTz, toZonedInput } from "../src/lib/display-tz";
import { fmtWhen } from "../src/components/sales/deal-rich";
import { noteTime } from "../src/lib/assistant/actions-sales";

describe("dates on screen use the owner's zone, not the machine's", () => {
  it("a log at 18:25 IST reads 6:25 pm whatever the server clock", () => {
    setDisplayTz("Asia/Kolkata");
    expect(fmtWhen("2026-11-16T12:55:00.000Z")).toBe("16 Nov 2026, 6:25 pm");
    expect(fmtZoned("2026-11-16T12:32:00.000Z", { hour: "numeric", minute: "2-digit" })).toBe("6:02 pm");
  });
  it("datetime inputs read and write the owner's clock", () => {
    setDisplayTz("Asia/Kolkata");
    expect(fromZonedInput("2026-11-16T18:02")).toBe("2026-11-16T12:32:00.000Z");
    expect(toZonedInput("2026-11-16T12:32:00.000Z")).toBe("2026-11-16T18:02");
    expect(fromZonedInput(toZonedInput("2026-11-16T12:32:00.000Z"))).toBe("2026-11-16T12:32:00.000Z");
    expect(fromZonedInput("")).toBeNull();
  });
  it("follows the zone in Settings and ignores a bad one", () => {
    setDisplayTz("America/New_York");
    expect(fmtZoned("2026-11-16T12:55:00.000Z", { hour: "numeric", minute: "2-digit" }, "en-US")).toBe("7:55 AM");
    setDisplayTz("Not/AZone");
    expect(displayTz()).toBe("America/New_York");
    setDisplayTz("Asia/Kolkata");
  });
  it("a note logged from the chat keeps its time on the owner's clock", () => {
    const now = new Date("2026-11-16T13:00:00.000Z");
    expect(noteTime("2026-11-16 18:02", "Asia/Kolkata", now)).toBe("2026-11-16T12:32:00.000Z");
    expect(noteTime("2026-11-16", "Asia/Kolkata", now)).toBeNull();
    expect(noteTime("2026-11-14", "Asia/Kolkata", now)).toBe("2026-11-14T06:30:00.000Z");
  });
});
