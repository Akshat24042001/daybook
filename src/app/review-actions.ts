"use server";

import { revalidatePath } from "next/cache";
import { UserError } from "@/lib/db";
import { makeCtx } from "@/lib/settings";
import type { DateStr } from "@/lib/time";
import { generateReview, getReview, setIntentions, type Intention, type ReviewPeriod } from "@/lib/services/review";
import { setProjectTimeGoal } from "@/lib/services/time-goals";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIODS: ReviewPeriod[] = ["week", "month"];

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof UserError) return { ok: false, error: e.message };
  console.error("[review] action failed:", (e as Error).name, (e as Error).message);
  return { ok: false, error: "Something went wrong. Try again." };
}

function check(period: ReviewPeriod, start: DateStr) {
  if (!PERIODS.includes(period) || !DATE.test(start)) throw new UserError("Pick a valid period.");
}

export async function generateReviewAction(period: ReviewPeriod, start: DateStr): Promise<Result> {
  try {
    check(period, start);
    await generateReview(await makeCtx(), period, start);
    revalidatePath("/review");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setIntentionsAction(period: ReviewPeriod, start: DateStr, items: Intention[]): Promise<Result<{ intentions: Intention[] }>> {
  try {
    check(period, start);
    const intentions = await setIntentions(period, start, items);
    revalidatePath("/review");
    revalidatePath("/today");
    return { ok: true, intentions };
  } catch (e) {
    return fail(e);
  }
}

/** Ticks one intention done / not done / unmarked without resending the whole list from the client. */
export async function markIntentionAction(period: ReviewPeriod, start: DateStr, index: number, done: boolean | null): Promise<Result> {
  try {
    check(period, start);
    const r = await getReview(period, start);
    const list = r?.intentions ?? [];
    if (!list[index]) throw new UserError("That intention no longer exists.");
    list[index] = { ...list[index], done };
    await setIntentions(period, start, list);
    revalidatePath("/review");
    revalidatePath("/today");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setProjectTimeGoalAction(projectId: number, weeklyHours: number | null): Promise<Result> {
  try {
    await setProjectTimeGoal(projectId, weeklyHours === null ? null : weeklyHours * 60);
    for (const p of ["/projects", "/goals", "/review", "/stats"]) revalidatePath(p);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
