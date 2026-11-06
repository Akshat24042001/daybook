import { beforeEach, describe, expect, it } from "vitest";
import { q } from "@/lib/db";
import { reorderEntries, entriesForDate } from "@/lib/services/entries";
import { setInstagram } from "@/lib/services/days";
import { add, ctxAt, resetDb } from "./helpers";

beforeEach(resetDb);

describe("drag-and-drop ordering", () => {
  it("saves the dragged order and leaves other entries where they were", async () => {
    const ctx = await ctxAt("2026-09-19 09:00");
    for (const t of ["alpha", "bravo", "charlie", "delta"]) await add(ctx, t);
    const before = await entriesForDate(ctx.today);
    expect(before.map((e) => e.title)).toEqual(["alpha", "bravo", "charlie", "delta"]);
    const ids = before.map((e) => e.id);
    // drag delta to the top of bravo..delta: alpha stays first
    await reorderEntries(ctx.today, [ids[3], ids[1], ids[2]]);
    expect((await entriesForDate(ctx.today)).map((e) => e.title)).toEqual(["alpha", "delta", "bravo", "charlie"]);
  });

  it("works when entries share a sort value, and rejects ids from another day", async () => {
    const ctx = await ctxAt("2026-09-19 09:00");
    for (const t of ["one", "two", "three"]) await add(ctx, t);
    await q("update day_entries set sort = 0");
    const ids = (await entriesForDate(ctx.today)).map((e) => e.id);
    await reorderEntries(ctx.today, [ids[2], ids[0], ids[1]]);
    expect((await entriesForDate(ctx.today)).map((e) => e.title)).toEqual(["three", "one", "two"]);
    await expect(reorderEntries("2026-09-20", [ids[0], ids[1]])).rejects.toThrow(/changed/);
  });
});

describe("instagram time", () => {
  it("stores minutes for a day, clears them, and rejects nonsense", async () => {
    await setInstagram("2026-09-19", 75);
    expect((await q<{ m: number }>("select instagram_minutes as m from days where date = '2026-09-19'"))[0].m).toBe(75);
    await setInstagram("2026-09-19", null);
    expect((await q<{ m: number | null }>("select instagram_minutes as m from days where date = '2026-09-19'"))[0].m).toBeNull();
    await expect(setInstagram("2026-09-19", 2000)).rejects.toThrow();
    await expect(setInstagram("2026-09-19", -5)).rejects.toThrow();
  });
});
