import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, q } from "@/lib/db";
import { removeEntry, setEntryStatus } from "@/lib/services/entries";
import { rolloverIfNeeded } from "@/lib/services/rollover";
import { bringToToday, closeUnfinished, unfinishedCount, unfinishedTasks } from "@/lib/services/unfinished";
import { add, ctxAt, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(closePool);

describe("unfinished tasks", () => {
  it("finds tasks that fell off the lists and lets them come back to today", async () => {
    const mon = await ctxAt("2026-09-21 10:00");
    const progressed = await add(mon, "Draft proposal");
    const removed = await add(mon, "Call bank");
    const done = await add(mon, "Pay rent");
    const carried = await add(mon, "Untouched task");
    await setEntryStatus(mon, progressed.entry!.id, "progressed"); // progressed never carries
    await removeEntry(removed.entry!.id); // removed from the day
    await setEntryStatus(mon, done.entry!.id, "done");

    const tue = await ctxAt("2026-09-22 10:00");
    await rolloverIfNeeded(tue); // carries the untouched one onto today

    const list = await unfinishedTasks(tue.today);
    expect(list.map((t) => t.title).sort()).toEqual(["Call bank", "Draft proposal"]);
    const p = list.find((t) => t.title === "Draft proposal")!;
    expect(p.lastDate).toBe("2026-09-21");
    expect(p.lastStatus).toBe("progressed");
    expect(list.find((t) => t.title === "Call bank")!.lastDate).toBeNull();
    expect(await unfinishedCount(tue.today)).toBe(2);
    expect(list.some((t) => t.taskId === carried.task.id)).toBe(false);

    expect(await bringToToday(tue, [progressed.task.id], true)).toBe(1);
    const e = await q<{ must_do: boolean; source: string; carried_from: string }>(
      "select must_do, source, carried_from from day_entries where task_id = $1 and date = '2026-09-22'",
      [progressed.task.id],
    );
    expect(e[0]).toMatchObject({ must_do: true, source: "carried", carried_from: "2026-09-21" });

    await closeUnfinished(tue, [removed.task.id], "dropped");
    expect(await unfinishedTasks(tue.today)).toEqual([]);
  });
});
