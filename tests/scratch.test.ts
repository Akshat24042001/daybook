import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, q } from "@/lib/db";
import { copyItem, createItem, deleteItem, itemCountsInRange, listItems, updateItem } from "@/lib/services/scratch";
import { searchAll } from "@/lib/services/search";
import { resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await q("delete from scratch_items").catch(() => undefined);
});
afterAll(closePool);

describe("scratchpad", () => {
  it("files items under their day, newest first, with empty starting data", async () => {
    const a = await createItem("2026-09-28", "note");
    const b = await createItem("2026-09-28", "sketch");
    await createItem("2026-09-27", "calc");
    const today = await listItems("2026-09-28");
    expect(today.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(a.data).toEqual({ text: "" });
    expect(b.data).toEqual({ h: 560, bg: "grid", strokes: [] });
    const counts = await itemCountsInRange("2026-09-20", "2026-09-28");
    expect(counts.get("2026-09-28")).toMatchObject({ note: 1, sketch: 1, calc: 0, graph: 0, file: 0 });
    expect(counts.get("2026-09-27")?.calc).toBe(1);
  });

  it("saves edits and cleans what it is sent", async () => {
    const s = await createItem("2026-09-28", "sketch");
    const r = await updateItem(s.id, {
      title: "  flow  ",
      data: {
        h: 99999, bg: "nope", junk: 1,
        strokes: [
          { t: "pen", c: "red", w: 4, p: [1.4, 2.6, 10, 20] },
          { t: "laser", c: "red", w: 4, p: [1, 2] },
          { t: "text", c: "blue", w: 28, p: [5, 5], x: "API" },
          { t: "text", c: "blue", w: 28, p: [5, 5], x: "   " },
          { t: "rect", c: "hotpink", w: 3, p: [0, 0, 50] },
        ],
      },
    });
    expect(r.title).toBe("flow");
    expect(r.data).toEqual({
      h: 4000, bg: "grid",
      strokes: [
        { t: "pen", c: "red", w: 4, p: [1, 3, 10, 20] },
        { t: "text", c: "blue", w: 28, p: [5, 5], x: "API" },
      ],
    });
  });

  it("refuses unknown kinds and missing items", async () => {
    await expect(createItem("2026-09-28", "video")).rejects.toThrow(/Unknown scratchpad item/);
    await expect(updateItem(999999, { title: "x" })).rejects.toThrow(/no longer exists/);
  });

  it("copies an item to another day and deletes", async () => {
    const c = await createItem("2026-09-25", "calc", "budget", { lines: ["rent = 18000", "rent * 12"] });
    const copy = await copyItem(c.id, "2026-09-28");
    expect(copy.date).toBe("2026-09-28");
    expect(copy.title).toBe("budget");
    expect(copy.data).toEqual({ lines: ["rent = 18000", "rent * 12"] });
    await deleteItem(c.id);
    expect(await listItems("2026-09-25")).toEqual([]);
  });

  it("is found by search on the words written, not the JSON keys", async () => {
    await createItem("2026-09-28", "note", "", { text: "call the plumber about the geyser" });
    await createItem("2026-09-28", "sketch", "", { h: 560, bg: "grid", strokes: [{ t: "text", c: "ink", w: 20, p: [1, 1], x: "geyser wiring" }] });
    const hits = (await searchAll("geyser")).filter((h) => h.kind === "scratch");
    expect(hits.map((h) => h.title).sort()).toEqual(["call the plumber about the geyser", "geyser wiring"]);
    expect((await searchAll("strokes")).filter((h) => h.kind === "scratch")).toEqual([]);
  });
});
