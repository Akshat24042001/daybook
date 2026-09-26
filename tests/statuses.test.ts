import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, q } from "@/lib/db";
import { endWaiting, entryForTask, setEntryStatus, setSkipReason, setWaiting } from "@/lib/services/entries";
import { rolloverIfNeeded } from "@/lib/services/rollover";
import { getTask } from "@/lib/services/tasks";
import { closeUnfinished, waitingTasks } from "@/lib/services/unfinished";
import { add, ctxAt, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(closePool);

describe("task statuses", () => {
  it("Progressed one-offs come back tomorrow without adding to the carry count", async () => {
    const mon = await ctxAt("2026-09-21 10:00");
    const { task, entry } = await add(mon, "Write report");
    await setEntryStatus(mon, entry!.id, "progressed");
    await rolloverIfNeeded(await ctxAt("2026-09-22 10:00"));
    expect(await entryForTask(task.id, "2026-09-22")).not.toBeNull();
    expect((await getTask(task.id))!.carry_count).toBe(0);
  });

  it("Waiting parks the task until the check-back date, then it returns flagged; no carry, no penalty", async () => {
    const mon = await ctxAt("2026-09-21 10:00");
    const { task, entry } = await add(mon, "Get approval from Vinit");
    const w = await setWaiting(mon, entry!.id, "2026-09-24", "Vinit");
    expect(w.status).toBe("waiting");
    expect(w.waiting_on).toBe("Vinit");

    // not carried in between, and not counted as a carry
    await rolloverIfNeeded(await ctxAt("2026-09-22 10:00"));
    expect(await entryForTask(task.id, "2026-09-22")).toBeNull();
    expect((await getTask(task.id))!.carry_count).toBe(0);
    expect((await waitingTasks("2026-09-22")).map((t) => t.waitingOn)).toEqual(["Vinit"]);

    // back on the check-back day as an open entry that still knows who it was waiting on
    const back = (await entryForTask(task.id, "2026-09-24"))!;
    expect(back.status).toBe("open");
    expect(back.waiting_until).toBe("2026-09-24");

    // answering it ends the wait
    const thu = await ctxAt("2026-09-24 10:00");
    await setEntryStatus(thu, back.id, "progressed");
    expect((await getTask(task.id))!.waiting_on).toBeNull();
  });

  it("reopening a waiting entry removes the check-back entry; ending a wait early brings it to today", async () => {
    const mon = await ctxAt("2026-09-21 10:00");
    const a = await add(mon, "Wait then reopen");
    await setWaiting(mon, a.entry!.id, "2026-09-25", null);
    await setEntryStatus(mon, a.entry!.id, "open");
    expect(await entryForTask(a.task.id, "2026-09-25")).toBeNull();
    expect((await getTask(a.task.id))!.waiting_until).toBeNull();

    const b = await add(mon, "Wait then come back early");
    await setWaiting(mon, b.entry!.id, "2026-09-28", "Client");
    const wed = await ctxAt("2026-09-23 10:00");
    await endWaiting(wed, b.task.id);
    expect(await entryForTask(b.task.id, "2026-09-23")).not.toBeNull();
    expect(await entryForTask(b.task.id, "2026-09-28")).toBeNull();
  });

  it("dropping a waiting task also removes its check-back entry", async () => {
    const mon = await ctxAt("2026-09-21 10:00");
    const { task, entry } = await add(mon, "Parked then dropped");
    await setWaiting(mon, entry!.id, "2026-09-24", null);
    await closeUnfinished(await ctxAt("2026-09-22 10:00"), [task.id], "dropped");
    expect(await entryForTask(task.id, "2026-09-24")).toBeNull();
  });

  it("the check-back date must be after the task's day", async () => {
    const mon = await ctxAt("2026-09-21 10:00");
    const { entry } = await add(mon, "Bad date");
    await expect(setWaiting(mon, entry!.id, "2026-09-21", null)).rejects.toThrow(/after/);
  });

  it("Not today keeps an optional reason, cleared when the status changes", async () => {
    const mon = await ctxAt("2026-09-21 10:00");
    const { entry } = await add(mon, "Gym plan");
    await setEntryStatus(mon, entry!.id, "skipped");
    await setSkipReason(entry!.id, "low_energy");
    expect((await q<{ reason: string }>("select reason from day_entries where id = $1", [entry!.id]))[0].reason).toBe("low_energy");
    await setEntryStatus(mon, entry!.id, "progressed");
    expect((await q<{ reason: string | null }>("select reason from day_entries where id = $1", [entry!.id]))[0].reason).toBeNull();
  });
});
