import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, one, q } from "@/lib/db";
import { logMinutes } from "@/lib/services/entries";
import { setScore, setSleep } from "@/lib/services/days";
import { listEntries } from "@/lib/services/diary";
import {
  generateReview, getReview, parseReviewJson, periodBounds, periodLabel, reviewData, setIntentions, shiftPeriod,
} from "@/lib/services/review";
import { setProjectTimeGoal, timeGoals } from "@/lib/services/time-goals";
import { runNightlyReview } from "@/lib/telegram/tick";
import { add, ctxAt, ist, resetDb } from "./helpers";

const AI_REVIEW = {
  headline: "Solid, steady week",
  grade: 7.24,
  narrative: "You kept a steady rhythm.",
  wins: ["Shipped the proposal"],
  patterns: ["Late starts on Monday"],
  drivers: ["Better days followed 7h+ sleep"],
  decisions: ["Start before 10", "Protect Wednesday", "Walk daily", "extra one is dropped"],
};

beforeAll(async () => {
  await listEntries("2000-01-01"); // diary tables in an older test DB
});
beforeEach(async () => {
  await resetDb();
  await getReview("week", "2000-01-03"); // creates the table in an older test DB
  await q("truncate reviews");
  await q("truncate diary_entries, diary_summaries restart identity");
  delete process.env.OPENROUTER_API_KEY;
});
afterEach(() => vi.unstubAllGlobals());
afterAll(closePool);

function stubAi() {
  process.env.OPENROUTER_API_KEY = "sk-or-TEST-not-real";
  const prompts: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
    prompts.push(JSON.parse(String(init.body)).messages[1].content);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(AI_REVIEW) } }] }), { status: 200 });
  }));
  return prompts;
}

describe("periods", () => {
  it("weeks run Monday to Sunday, months step across years", () => {
    expect(periodBounds("week", "2026-09-24")).toEqual({ start: "2026-09-21", end: "2026-09-27" });
    expect(periodBounds("month", "2026-02-10")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(shiftPeriod("month", "2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftPeriod("month", "2026-01-01", -1)).toBe("2025-12-01");
    expect(shiftPeriod("week", "2026-09-21", -1)).toBe("2026-09-14");
    expect(periodLabel("month", "2026-09-01")).toBe("September 2026");
  });
});

describe("time goals", () => {
  it("scales the weekly budget and judges progress against the share of the week gone", async () => {
    const ctx = await ctxAt("2026-09-23 12:00"); // Wednesday: 3 of 7 days
    const t = await add(ctx, "Aivaura: Write proposal");
    const pid = t.task.project_id!;
    await setProjectTimeGoal(pid, 14 * 60); // 14h a week
    await logMinutes(ctx, t.task.id, "2026-09-21", 120, "web");
    await logMinutes(ctx, t.task.id, "2026-09-23", 60, "web");

    const week = await timeGoals(ctx, "2026-09-21", "2026-09-27");
    expect(week.elapsed).toBeCloseTo(3 / 7);
    expect(week.goals[0]).toMatchObject({ name: "Aivaura", targetMin: 840, actualMin: 180, expectedMin: 360, status: "behind" });

    await logMinutes(ctx, t.task.id, "2026-09-23", 180, "web");
    expect((await timeGoals(ctx, "2026-09-21", "2026-09-27")).goals[0].status).toBe("on_track");

    // a month budget is the weekly budget times the number of weeks in it
    const month = await timeGoals(ctx, "2026-09-01", "2026-09-30");
    expect(month.goals[0].targetMin).toBe(Math.round((840 * 30) / 7));

    await expect(setProjectTimeGoal(pid, 20000)).rejects.toThrow(/168 hours/);
    await setProjectTimeGoal(pid, null);
    expect((await timeGoals(ctx, "2026-09-21", "2026-09-27")).goals).toEqual([]);
  });
});

describe("review data", () => {
  it("compares the running week with the same days of earlier weeks", async () => {
    const ctx = await ctxAt("2026-09-23 20:00"); // Wed
    await setScore("2026-09-21", 8);
    await setScore("2026-09-22", 6);
    await setScore("2026-09-14", 5); // last Monday: inside the same-days window
    await setScore("2026-09-19", 1); // last Saturday: outside it, must not count
    await setSleep("2026-09-22", 420, 4);

    const d = await reviewData(ctx, "week", "2026-09-21");
    expect(d.inProgress).toBe(true);
    expect(d.measuredTo).toBe("2026-09-23");
    expect(d.days.map((x) => x.date)).toEqual(["2026-09-21", "2026-09-22", "2026-09-23"]);
    expect(d.current.avgScore).toBe(7);
    expect(d.previous.avgScore).toBe(5);
    expect(d.current.avgSleepH).toBe(7);
    expect(d.review).toBeNull();
  });
});

describe("AI review and intentions", () => {
  it("writes the review from numbers and diary summaries, and keeps only three decisions", async () => {
    const prompts = stubAi();
    const ctx = await ctxAt("2026-09-28 09:00");
    await setScore("2026-09-22", 8);
    const r = await generateReview(ctx, "week", "2026-09-21");
    expect(r).toMatchObject({ headline: "Solid, steady week", grade: 7.2 });
    expect(r.decisions).toEqual(["Start before 10", "Protect Wednesday", "Walk daily"]);
    expect(prompts[0]).toContain("Average day score /10: this week 8");
    expect(prompts[0]).toContain("DAY BY DAY");
  });

  it("intentions are saved per period, trimmed to five, and survive regenerating the review", async () => {
    stubAi();
    const ctx = await ctxAt("2026-09-28 09:00");
    await setIntentions("week", "2026-09-28", [
      { text: "  Deep work before noon ", done: null }, { text: "", done: null },
      ...["b", "c", "d", "e", "f"].map((t) => ({ text: t, done: null })),
    ]);
    let row = await getReview("week", "2026-09-28");
    expect(row!.intentions.map((i) => i.text)).toEqual(["Deep work before noon", "b", "c", "d", "e"]);
    expect(row!.end_date).toBe("2026-10-04");
    expect(row!.headline).toBeNull(); // intentions alone, no review yet

    await setIntentions("week", "2026-09-28", row!.intentions.map((i, k) => ({ ...i, done: k === 0 ? true : i.done })));
    await generateReview(ctx, "week", "2026-09-28");
    row = await getReview("week", "2026-09-28");
    expect(row!.intentions[0]).toEqual({ text: "Deep work before noon", done: true });
    expect(row!.headline).toBe("Solid, steady week");
  });

  it("parses messy model output and rejects answers without substance", () => {
    expect(parseReviewJson("Here you go:\n```json\n" + JSON.stringify(AI_REVIEW) + "\n```").grade).toBe(7.2);
    expect(() => parseReviewJson(JSON.stringify({ ...AI_REVIEW, narrative: "" }))).toThrow();
  });
});

describe("nightly review", () => {
  it("on Monday morning writes last week's review once; other days do nothing", async () => {
    stubAi();
    expect(await runNightlyReview(ist("2026-09-29 09:00"))).toBe("not-today"); // Tuesday
    expect(await runNightlyReview(ist("2026-09-28 04:40"))).toBe("not-yet"); // before boundary + 90 min
    expect(await runNightlyReview(ist("2026-09-28 05:31"))).toBe("reviewed week:2026-09-21");
    expect(await runNightlyReview(ist("2026-09-28 06:00"))).toBe("done-already");
    expect(await one("select headline from reviews where period = 'week' and start_date = '2026-09-21'")).toEqual({ headline: "Solid, steady week" });
  });
});
