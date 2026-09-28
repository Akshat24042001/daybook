import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, q } from "@/lib/db";
import { createSegment, updateSegment } from "@/lib/services/segments";
import { ctxAt, ist, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(closePool);

async function seg(kind: string, start: Date, end: Date | null) {
  const r = await q<{ id: number }>(
    "insert into work_segments (date, kind, start_at, end_at) values ('2026-09-25', $1, $2, $3) returning id",
    [kind, start, end],
  );
  return r[0].id;
}
const sec = (s: string, seconds: number) => new Date(ist(s).getTime() + seconds * 1000);

describe("editing segments with minute-precision forms", () => {
  it("shortening a segment whose start was tapped mid-minute saves (no false overlap)", async () => {
    const ctx = await ctxAt("2026-09-25 19:30");
    await seg("outside", ist("2026-09-25 14:52"), sec("2026-09-25 15:43", 27));
    const office = await seg("office", sec("2026-09-25 15:43", 27), sec("2026-09-25 19:01", 12));
    await seg("break", sec("2026-09-25 19:01", 12), null);

    // what the form sends: 15:43 (no seconds) to 18:30
    const r = await updateSegment(ctx, office, { kind: "office", start: ist("2026-09-25 15:43"), end: ist("2026-09-25 18:30") });
    expect(r.start_at.getTime()).toBe(sec("2026-09-25 15:43", 27).getTime()); // snapped to where "outside" ended
    expect(r.end_at!.getTime()).toBe(ist("2026-09-25 18:30").getTime());
  });

  it("a new segment typed to end at a tapped minute snaps to it, and the whole away-and-back story fits", async () => {
    const ctx = await ctxAt("2026-09-25 19:30");
    const office = await seg("office", ist("2026-09-25 15:43"), sec("2026-09-25 19:01", 12));
    const brk = await seg("break", sec("2026-09-25 19:01", 12), null);

    // left at 18:30, back at 19:00: shorten office, make the running break 18:30-19:00, add office from 19:00
    await updateSegment(ctx, office, { kind: "office", start: ist("2026-09-25 15:43"), end: ist("2026-09-25 18:30") });
    await updateSegment(ctx, brk, { kind: "break", start: ist("2026-09-25 18:30"), end: ist("2026-09-25 19:00") });
    const back = await createSegment(ctx, { kind: "office", start: ist("2026-09-25 19:00"), end: null });
    expect(back.end_at).toBeNull();
    const rows = await q<{ kind: string }>("select kind from work_segments order by start_at");
    expect(rows.map((r) => r.kind)).toEqual(["office", "break", "office"]);
  });

  it("moving the start of a running segment earlier pulls back the end of the segment it was tapped after", async () => {
    const ctx = await ctxAt("2026-09-28 16:30");
    const commute = await seg("commute", ist("2026-09-28 15:10"), sec("2026-09-28 15:52", 8));
    const office = await seg("office", sec("2026-09-28 15:52", 8), null);

    const r = await updateSegment(ctx, office, { kind: "office", start: ist("2026-09-28 15:50"), end: null });
    expect(r.start_at.getTime()).toBe(ist("2026-09-28 15:50").getTime());
    expect(r.end_at).toBeNull();
    const [c] = await q<{ end_at: Date }>("select end_at from work_segments where id = $1", [commute]);
    expect(c.end_at.getTime()).toBe(ist("2026-09-28 15:50").getTime());
  });

  it("moving an end later pushes the start of the segment that followed it", async () => {
    const ctx = await ctxAt("2026-09-28 16:30");
    const commute = await seg("commute", ist("2026-09-28 15:10"), ist("2026-09-28 15:52"));
    const office = await seg("office", ist("2026-09-28 15:52"), null);

    await updateSegment(ctx, commute, { kind: "commute", start: ist("2026-09-28 15:10"), end: ist("2026-09-28 15:55") });
    const [o] = await q<{ start_at: Date }>("select start_at from work_segments where id = $1", [office]);
    expect(o.start_at.getTime()).toBe(ist("2026-09-28 15:55").getTime());
  });

  it("a shared edge is not moved past the neighbour's other end", async () => {
    const ctx = await ctxAt("2026-09-28 16:30");
    await seg("commute", ist("2026-09-28 15:40"), ist("2026-09-28 15:52"));
    const office = await seg("office", ist("2026-09-28 15:52"), null);
    await expect(updateSegment(ctx, office, { kind: "office", start: ist("2026-09-28 15:30"), end: null }))
      .rejects.toThrow(/overlaps Commute 15:40–15:52/);
  });

  it("a real overlap is refused and names the segment in the way", async () => {
    const ctx = await ctxAt("2026-09-25 19:30");
    await seg("office", ist("2026-09-25 15:43"), ist("2026-09-25 18:50"));
    const brk = await seg("break", ist("2026-09-25 19:01"), null);
    await expect(updateSegment(ctx, brk, { kind: "break", start: ist("2026-09-25 18:30"), end: null }))
      .rejects.toThrow(/overlaps At office 15:43–18:50/);
  });
});
