"use server";

import { revalidatePath } from "next/cache";
import { UserError } from "@/lib/db";
import { actionRows, undoAction } from "@/lib/undo";
import { deletedRows, restoreDeleted } from "@/lib/bin";

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

/** Puts a deletion back from the Deleted page. */
export async function restoreDeletedAction(grp: string): Promise<Result<{ label: string; restored: number; skipped: number }>> {
  try {
    if (typeof grp !== "string" || !/^[at]\d{1,20}$/.test(grp)) throw new UserError("Pick something to restore.");
    const r = await restoreDeleted(grp);
    revalidatePath("/", "layout");
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error("[deleted] restore failed:", (e as Error).name, (e as Error).message);
    return { ok: false, error: "Could not restore that. Try again." };
  }
}

/** What a deletion holds, for the Deleted page's "what is in it" view. */
export async function deletedDetailsAction(grp: string): Promise<Result<{ rows: Awaited<ReturnType<typeof deletedRows>> }>> {
  try {
    if (typeof grp !== "string" || !/^[at]\d{1,20}$/.test(grp)) throw new UserError("Pick a deletion.");
    return { ok: true, rows: await deletedRows(grp) };
  } catch {
    return { ok: false, error: "Could not load the details." };
  }
}
