"use server";

import { revalidatePath } from "next/cache";
import { applyStoredAction, proposeActions, undoStoredAction } from "@/lib/assistant/actions";
import { getDay } from "@/lib/services/days";
import { entriesForDate } from "@/lib/services/entries";
import { listExerciseTypes } from "@/lib/services/health";
import { currentState } from "@/lib/services/segments";
import { fmtHM } from "@/lib/time";
import type { ActionItem, ChatSummary, MemoryFact, MessageView } from "@/lib/assistant/types";
import { UserError } from "@/lib/db";
import { makeCtx } from "@/lib/settings";
import {
  addMemory, deleteChat, deleteMemory, listChats, listMemory, messagesFor, renameChat, setChatModel, setChatPinned,
} from "@/lib/services/assistant";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof UserError) return { ok: false, error: e.message };
  console.error("[assistant] action failed:", (e as Error).name, (e as Error).message);
  return { ok: false, error: "Something went wrong. Try again." };
}

export async function loadChatAction(id: number): Promise<Result<{ messages: MessageView[] }>> {
  try {
    return { ok: true, messages: await messagesFor(id) };
  } catch (e) {
    return fail(e);
  }
}

/** Pages whose data an assistant action can change. */
function refreshAll() {
  for (const p of ["/today", "/plan", "/diary", "/health", "/stats", "/scratch", "/contacts", "/unfinished", "/goals", "/refs", "/projects", "/settings", "/review"]) revalidatePath(p);
  revalidatePath("/task/[id]", "page");
}

export async function applyAssistantAction(id: number): Promise<Result<{ item: ActionItem }>> {
  try {
    const item = await applyStoredAction(await makeCtx(), id);
    refreshAll();
    return { ok: true, item };
  } catch (e) {
    return fail(e);
  }
}

export async function undoAssistantAction(id: number): Promise<Result<{ item: ActionItem }>> {
  try {
    const item = await undoStoredAction(id);
    refreshAll();
    return { ok: true, item };
  } catch (e) {
    return fail(e);
  }
}

export interface QuickContext {
  today: string;
  state: { kind: string; since: string | null };
  entries: { id: number; taskId: number; title: string; project: string | null; status: string; mustDo: boolean; minutes: number }[];
  exercises: { id: number; name: string; unit: string; amount: number }[];
  day: { steps: number | null; score: number | null; sleep: number | null; instagram: number | null };
}

/** What the quick bar shows: current state, today's list, exercise types, today's numbers. */
export async function quickContextAction(): Promise<Result<{ data: QuickContext }>> {
  try {
    const ctx = await makeCtx();
    const [state, entries, types, day] = await Promise.all([
      currentState(), entriesForDate(ctx.today), listExerciseTypes(true), getDay(ctx.today),
    ]);
    return {
      ok: true,
      data: {
        today: ctx.today,
        state: { kind: state.kind, since: state.since ? fmtHM(state.since, ctx.tz) : null },
        entries: entries
          .filter((e) => e.status !== "waiting")
          .map((e) => ({
            id: e.id, taskId: e.task_id, title: e.title, project: e.project_name, status: e.status, mustDo: e.must_do, minutes: e.minutes_today,
          })),
        exercises: types.map((t) => ({ id: t.id, name: t.name, unit: t.unit, amount: t.default_amount })),
        day: { steps: day?.steps ?? null, score: day?.score ?? null, sleep: day?.sleep_minutes ?? null, instagram: day?.instagram_minutes ?? null },
      },
    };
  } catch (e) {
    return fail(e);
  }
}

/** A one-tap update from the quick bar: checked and applied like an assistant action, so it can be undone. */
export async function quickAction(raw: Record<string, unknown>): Promise<Result<{ item: ActionItem }>> {
  try {
    const ctx = await makeCtx();
    const { items, rejected } = await proposeActions(ctx, null, [raw]);
    if (!items.length) throw new UserError(rejected[0]?.replace(/^[\w-]+: /, "") ?? "That could not be done.");
    const item = await applyStoredAction(ctx, items[0].id);
    refreshAll();
    return { ok: true, item };
  } catch (e) {
    return fail(e);
  }
}

export async function listChatsAction(): Promise<Result<{ chats: ChatSummary[] }>> {
  try {
    return { ok: true, chats: await listChats() };
  } catch (e) {
    return fail(e);
  }
}

export async function renameChatAction(id: number, title: string): Promise<Result> {
  try {
    await renameChat(id, title);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function pinChatAction(id: number, pinned: boolean): Promise<Result> {
  try {
    await setChatPinned(id, pinned);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setChatModelAction(id: number, model: string | null): Promise<Result> {
  try {
    await setChatModel(id, model);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteChatAction(id: number): Promise<Result> {
  try {
    await deleteChat(id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function listMemoryAction(): Promise<Result<{ memory: MemoryFact[] }>> {
  try {
    return { ok: true, memory: await listMemory() };
  } catch (e) {
    return fail(e);
  }
}

export async function addMemoryAction(fact: string): Promise<Result<{ memory: MemoryFact[] }>> {
  try {
    if (!fact.trim()) return { ok: false, error: "Write the fact first." };
    await addMemory([fact], null);
    return { ok: true, memory: await listMemory() };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteMemoryAction(id: number): Promise<Result<{ memory: MemoryFact[] }>> {
  try {
    await deleteMemory([id]);
    return { ok: true, memory: await listMemory() };
  } catch (e) {
    return fail(e);
  }
}
