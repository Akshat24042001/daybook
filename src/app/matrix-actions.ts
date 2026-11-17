"use server";
// Priorities board: place, order, AI-sort, add to today, drop. Every write is one undoable action.
import { revalidatePath } from "next/cache";
import { UserError } from "@/lib/db";
import { makeCtx, type Ctx } from "@/lib/settings";
import { journaled } from "@/lib/undo";
import { addToDay } from "@/lib/services/goals";
import {
  applySuggestions, BOXES, dropTasks, orderBox, placeTask, suggestBoxes, type Box, type Mode, type Suggestion,
} from "@/lib/services/matrix";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const PATHS = ["/priorities", "/today", "/tasks"];

async function run<T extends object = object>(fn: (ctx: Ctx) => Promise<T | void>, write = true): Promise<Result<T>> {
  try {
    const ctx = await makeCtx();
    const value = write ? (await journaled("web", async () => (await fn(ctx)) ?? ({} as T))).value : ((await fn(ctx)) ?? ({} as T));
    if (write) for (const p of PATHS) revalidatePath(p);
    return { ok: true, ...(value as T) };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error("[priorities] failed:", (e as Error).name, (e as Error).message);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

const mode = (m: unknown): Mode => {
  if (m === "value" || m === "eisen") return m;
  throw new UserError("Pick a board.");
};
const ids = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 1000) : []);
const box = (m: Mode, b: unknown): Box | null => {
  if (b === null) return null;
  if (BOXES[m].some((x) => x.key === b)) return b as Box;
  throw new UserError("Pick one of the four boxes.");
};

export async function placeTaskAction(id: number, m: Mode, b: Box | null, order?: number[]) {
  return run(async () => { const md = mode(m); await placeTask(Number(id), md, box(md, b), order ? ids(order) : undefined); });
}

export async function orderBoxAction(m: Mode, order: number[]) {
  return run(async () => { await orderBox(mode(m), ids(order)); });
}

export async function suggestBoxesAction(m: Mode, only?: number[]): Promise<Result<{ items: Suggestion[] }>> {
  return run(async (ctx) => ({ items: await suggestBoxes(ctx, mode(m), only ? ids(only) : undefined) }), false);
}

export async function applySuggestionsAction(m: Mode, items: { id: number; box: Box; why?: string }[]) {
  return run(async () => {
    const md = mode(m);
    const clean = (Array.isArray(items) ? items : []).map((x) => ({ id: Number(x.id), box: box(md, x.box)!, why: typeof x.why === "string" ? x.why.slice(0, 140) : undefined }))
      .filter((x) => Number.isInteger(x.id) && x.box);
    return { placed: await applySuggestions(md, clean) };
  });
}

export async function addTasksToTodayAction(taskIds: number[]) {
  return run(async (ctx) => {
    let n = 0;
    for (const id of ids(taskIds).slice(0, 30)) {
      await addToDay(ctx, id, ctx.today);
      n++;
    }
    return { added: n };
  });
}

export async function dropTasksAction(taskIds: number[]) {
  return run(async () => ({ dropped: await dropTasks(ids(taskIds)) }));
}
