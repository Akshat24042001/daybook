"use server";

import { revalidatePath } from "next/cache";
import { UserError } from "@/lib/db";
import { makeCtx } from "@/lib/settings";
import { logTouch, setTouchInterval, snoozeTouch, type TouchKind } from "@/lib/services/keep-in-touch";

type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<void>): Promise<Result> {
  try {
    await fn();
    revalidatePath("/contacts");
    revalidatePath("/today");
    return { ok: true };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error("[contacts] action failed:", (e as Error).name, (e as Error).message);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

export async function logTouchAction(contactId: number, kind: TouchKind, note?: string | null): Promise<Result> {
  return run(async () => logTouch(contactId, (await makeCtx()).today, kind, note));
}

export async function setTouchIntervalAction(contactId: number, days: number | null): Promise<Result> {
  return run(() => setTouchInterval(contactId, days));
}

export async function snoozeTouchAction(contactId: number, days = 7): Promise<Result> {
  return run(async () => {
    await snoozeTouch(contactId, (await makeCtx()).today, days);
  });
}
