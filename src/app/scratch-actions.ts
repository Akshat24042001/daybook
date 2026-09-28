"use server";

import { revalidatePath } from "next/cache";
import { UserError } from "@/lib/db";
import { makeCtx } from "@/lib/settings";
import type { DateStr } from "@/lib/time";
import { copyItem, createItem, deleteItem, updateItem } from "@/lib/services/scratch";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof UserError) return { ok: false, error: e.message };
  console.error("[scratch] action failed:", (e as Error).name, (e as Error).message);
  return { ok: false, error: "Something went wrong. Try again." };
}

async function checkDate(date: DateStr) {
  if (!DATE.test(date)) throw new UserError("Pick a valid date.");
  const ctx = await makeCtx();
  if (date > ctx.today) throw new UserError("The scratchpad cannot hold a future day.");
}

export async function createScratchAction(date: DateStr, kind: string, data?: unknown): Promise<Result<{ id: number }>> {
  try {
    await checkDate(date);
    const row = await createItem(date, kind, "", data);
    revalidatePath("/scratch");
    return { ok: true, id: row.id };
  } catch (e) {
    return fail(e);
  }
}

/** Autosave target: no revalidate, the editor already shows what was saved. */
export async function saveScratchAction(id: number, patch: { title?: string; data?: unknown }): Promise<Result> {
  try {
    await updateItem(id, patch);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteScratchAction(id: number): Promise<Result> {
  try {
    await deleteItem(id);
    revalidatePath("/scratch");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function copyScratchToTodayAction(id: number): Promise<Result<{ date: DateStr }>> {
  try {
    const ctx = await makeCtx();
    await copyItem(id, ctx.today);
    revalidatePath("/scratch");
    return { ok: true, date: ctx.today };
  } catch (e) {
    return fail(e);
  }
}
