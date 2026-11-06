"use server";

import { revalidatePath } from "next/cache";
import { UserError } from "@/lib/db";
import { journaled } from "@/lib/undo";
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

async function generateReviewActionImpl(period: ReviewPeriod, start: DateStr): Promise<Result> {
  try {
    check(period, start);
    await generateReview(await makeCtx(), period, start);
    revalidatePath("/review");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

async function setIntentionsActionImpl(period: ReviewPeriod, start: DateStr, items: Intention[]): Promise<Result<{ intentions: Intention[] }>> {
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
async function markIntentionActionImpl(period: ReviewPeriod, start: DateStr, index: number, done: boolean | null): Promise<Result> {
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

async function setProjectTimeGoalActionImpl(projectId: number, weeklyHours: number | null): Promise<Result> {
  try {
    await setProjectTimeGoal(projectId, weeklyHours === null ? null : weeklyHours * 60);
    for (const p of ["/projects", "/goals", "/review", "/stats"]) revalidatePath(p);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// Every action here is undoable: see lib/undo.ts
export async function generateReviewAction(...args: Parameters<typeof generateReviewActionImpl>): ReturnType<typeof generateReviewActionImpl> {
  return (await journaled("web", () => generateReviewActionImpl(...args))).value;
}
export async function setIntentionsAction(...args: Parameters<typeof setIntentionsActionImpl>): ReturnType<typeof setIntentionsActionImpl> {
  return (await journaled("web", () => setIntentionsActionImpl(...args))).value;
}
export async function markIntentionAction(...args: Parameters<typeof markIntentionActionImpl>): ReturnType<typeof markIntentionActionImpl> {
  return (await journaled("web", () => markIntentionActionImpl(...args))).value;
}
export async function setProjectTimeGoalAction(...args: Parameters<typeof setProjectTimeGoalActionImpl>): ReturnType<typeof setProjectTimeGoalActionImpl> {
  return (await journaled("web", () => setProjectTimeGoalActionImpl(...args))).value;
}
