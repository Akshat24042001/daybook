// A task can be with several people: quick-add "+Krina +Ravi", the task form's list, and every screen shows them all.
import { beforeEach, describe, expect, it } from "vitest";
import { one, q } from "@/lib/db";
import { parseQuickAdd } from "@/lib/parser";
import { entriesForDate } from "@/lib/services/entries";
import { getTask, splitPeople, updateTask } from "@/lib/services/tasks";
import { add, ctxAt, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await q("truncate task_people restart identity cascade");
});

const names = async (taskId: number) => (await q<{ name: string }>(
  "select p.name from task_people tp join people p on p.id = tp.person_id where tp.task_id = $1 order by tp.sort", [taskId])).map((r) => r.name);

describe("a task with several people", () => {
  it("reads every +Name in quick-add", () => {
    const p = parseQuickAdd("Namlink review +Krina +Ravi @tom", { now: new Date("2026-11-17T04:00:00Z"), tz: "Asia/Kolkata", boundaryMin: 240 });
    expect(p.person).toBe("Krina, Ravi");
    expect(p.title).toBe("Namlink review");
    expect(splitPeople("Krina Mehta, Ravi; Sara and Om & Ravi")).toEqual(["Krina Mehta", "Ravi", "Sara", "Om"]);
    expect(splitPeople("Anand")).toEqual(["Anand"]); // "and" inside a name is not a separator
  });

  it("saves them all, shows them all on Today, and edits the list", async () => {
    const ctx = await ctxAt("2026-11-17 10:00");
    await add(ctx, "Namlink review +Krina +Ravi");
    const t = (await one<{ id: number }>("select id from tasks where title = 'Namlink review'"))!;
    expect(await names(t.id)).toEqual(["Krina", "Ravi"]);
    expect((await getTask(t.id))!.person_name).toBe("Krina, Ravi");
    const [e] = await entriesForDate(ctx.today);
    expect(e.person_name).toBe("Krina, Ravi");
    // the form sends the whole list: add one, drop one, reorder
    await updateTask(ctx, t.id, { person: "Ravi, Sara" });
    expect(await names(t.id)).toEqual(["Ravi", "Sara"]);
    expect((await getTask(t.id))!.person_name).toBe("Ravi, Sara");
    expect((await one<{ n: string }>("select p.name as n from tasks t join people p on p.id = t.person_id where t.id = $1", [t.id]))!.n).toBe("Ravi");
    await updateTask(ctx, t.id, { person: "" });
    expect(await names(t.id)).toEqual([]);
    expect((await getTask(t.id))!.person_name).toBeNull();
  });

  it("a single person still works as before", async () => {
    const ctx = await ctxAt("2026-11-17 10:00");
    await add(ctx, "Call back +Krina");
    const t = (await one<{ id: number }>("select id from tasks where title = 'Call back'"))!;
    expect(await names(t.id)).toEqual(["Krina"]);
    expect((await getTask(t.id))!.person_name).toBe("Krina");
  });
});
