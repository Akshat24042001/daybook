"use server";

import { revalidatePath } from "next/cache";
import { UserError } from "@/lib/db";
import { makeCtx } from "@/lib/settings";
import type { DateStr } from "@/lib/time";
import {
  addEntry, deleteEntry, summarizeDay, updateEntry, type DiarySource, type DiarySummary,
} from "@/lib/services/diary";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PATHS = ["/diary", "/today", "/stats"];

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof UserError) return { ok: false, error: e.message };
  console.error("[diary] action failed:", (e as Error).name, (e as Error).message);
  return { ok: false, error: "Something went wrong. Try again." };
}

function refresh() {
  for (const p of PATHS) revalidatePath(p);
}

/**
 * Saves a note and, when asked, refreshes the day's AI summary. A failed summary never loses the note:
 * the result is still ok, with `summaryError` set.
 */
export async function addDiaryEntryAction(
  date: DateStr,
  body: string,
  source: DiarySource,
  summarize = true,
): Promise<Result<{ summary: DiarySummary | null; summaryError: string | null }>> {
  try {
    if (!DATE.test(date)) throw new UserError("Pick a valid date.");
    const ctx = await makeCtx();
    if (date > ctx.today) throw new UserError("You cannot write the diary for a future day.");
    await addEntry(date, body, source === "voice" || source === "telegram" ? source : "text");
    let summary: DiarySummary | null = null;
    let summaryError: string | null = null;
    if (summarize) {
      try {
        summary = await summarizeDay(ctx, date);
      } catch (e) {
        summaryError = e instanceof UserError ? e.message : "The summary could not be made right now.";
      }
    }
    refresh();
    return { ok: true, summary, summaryError };
  } catch (e) {
    return fail(e);
  }
}

export async function updateDiaryEntryAction(id: number, body: string): Promise<Result> {
  try {
    const row = await updateEntry(id, body);
    if (!row) throw new UserError("That note no longer exists.");
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteDiaryEntryAction(id: number): Promise<Result> {
  try {
    await deleteEntry(id);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function summarizeDiaryAction(date: DateStr): Promise<Result<{ summary: DiarySummary }>> {
  try {
    if (!DATE.test(date)) throw new UserError("Pick a valid date.");
    const ctx = await makeCtx();
    const summary = await summarizeDay(ctx, date);
    refresh();
    return { ok: true, summary };
  } catch (e) {
    return fail(e);
  }
}
