"use server";

import type { ChatSummary, MemoryFact, MessageView } from "@/lib/assistant/types";
import {
  addMemory, deleteChat, deleteMemory, listChats, listMemory, messagesFor, renameChat, setChatModel, setChatPinned,
} from "@/lib/services/assistant";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
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
