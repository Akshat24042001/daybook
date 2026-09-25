import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, q } from "@/lib/db";
import { healthOverview } from "@/lib/services/health";
import { ist, resetDb, seedExercises } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await seedExercises();
});
afterAll(closePool);

async function set(date: string, hm: string, amount = 20) {
  await q(
    "insert into exercise_logs (date, slot_at, exercise_type_id, amount, status) values ($1, $2, (select id from exercise_types where name = 'Squats'), $3, 'done')",
    [date, ist(`${date} ${hm}`), amount],
  );
}

describe("health overview", () => {
  it("counts the active-day streak from sets or the step goal, and today only helps once it is active", async () => {
    await set("2026-09-16", "10:00");
    await q("insert into days (date, steps) values ('2026-09-17', 9000)"); // step goal counts too
    await set("2026-09-18", "10:00");

    let o = await healthOverview("2026-09-19", 8000);
    expect(o.streak).toBe(3); // Sat morning, nothing yet: the streak is not broken
    expect(o.activeToday).toBe(false);

    await set("2026-09-19", "10:00", 25);
    await set("2026-09-19", "11:00", 15);
    o = await healthOverview("2026-09-19", 8000);
    expect(o.streak).toBe(4);
    expect(o.totals).toEqual([{ name: "Squats", unit: "reps", amount: 40, sets: 2 }]);
    expect(o.week.map((d) => d.sets)).toEqual([0, 0, 0, 1, 0, 1, 2]);
    expect(o.week[4].steps).toBe(9000);

    // a gap resets it
    o = await healthOverview("2026-09-22", 8000);
    expect(o.streak).toBe(0);
  });
});
