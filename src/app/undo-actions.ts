"use server";

import { revalidatePath } from "next/cache";
import { UserError } from "@/lib/db";
import { actionRows, undoAction } from "@/lib/undo";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Undoes an action, or redoes an undo. Everything on screen is refreshed. */
export async function undoChangeAction(id: number): Promise<Result<{ label: string }>> {
  try {
    if (!Number.isInteger(id)) throw new UserError("Pick a change to undo.");
    const r = await undoAction(id);
    revalidatePath("/", "layout");
    return { ok: true, label: r.label };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error("[undo] failed:", (e as Error).name, (e as Error).message);
    return { ok: false, error: "Could not undo that. Try again." };
  }
}

/** The rows an action touched, for the History page's "what changed" view. */
export async function changeDetailsAction(id: number): Promise<Result<{ rows: Awaited<ReturnType<typeof actionRows>> }>> {
  try {
    return { ok: true, rows: await actionRows(id) };
  } catch {
    return { ok: false, error: "Could not load the details." };
  }
}
