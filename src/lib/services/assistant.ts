/** Storage for the assistant: chats, messages and memory facts. */
import { getPool, one, q, type Db } from "../db";
import type { Block, ChatSummary, MemoryFact, MessageView, Step } from "../assistant/types";

interface ChatRow { id: number; title: string; pinned: boolean; model: string | null; created_at: Date; updated_at: Date }
interface MessageRow {
  id: number; chat_id: number; role: "user" | "assistant"; content: string; blocks: Block[]; steps: Step[];
  model: string | null; created_at: Date;
}

const toChat = (r: ChatRow): ChatSummary => ({
  id: r.id, title: r.title, pinned: r.pinned, model: r.model, updatedAt: r.updated_at.toISOString(),
});
export const toMessage = (r: MessageRow): MessageView => ({
  id: r.id, role: r.role, content: r.content, blocks: r.blocks ?? [], steps: r.steps ?? [], model: r.model,
  createdAt: r.created_at.toISOString(),
});

export async function listChats(db: Db = getPool()): Promise<ChatSummary[]> {
  const rows = await q<ChatRow>("select * from assistant_chats order by pinned desc, updated_at desc limit 200", [], db);
  return rows.map(toChat);
}

export async function getChat(id: number, db: Db = getPool()): Promise<ChatSummary | null> {
  const r = await one<ChatRow>("select * from assistant_chats where id = $1", [id], db);
  return r ? toChat(r) : null;
}

export async function createChat(title: string, model: string | null = null, db: Db = getPool()): Promise<ChatSummary> {
  const r = await one<ChatRow>("insert into assistant_chats (title, model) values ($1, $2) returning *", [cleanTitle(title), cleanModel(model)], db);
  return toChat(r!);
}

/** OpenRouter ids look like "vendor/name:variant"; anything else means automatic. */
export function cleanModel(m: unknown): string | null {
  return typeof m === "string" && /^[\w.-]+\/[\w.:+-]+$/.test(m) && m.length <= 200 ? m : null;
}

export async function setChatModel(id: number, model: string | null, db: Db = getPool()): Promise<void> {
  await q("update assistant_chats set model = $2 where id = $1", [id, cleanModel(model)], db);
}

export function cleanTitle(t: string): string {
  const s = t.replace(/\s+/g, " ").trim();
  return (s.length > 60 ? `${s.slice(0, 57).trimEnd()}…` : s) || "New chat";
}

export async function renameChat(id: number, title: string, db: Db = getPool()): Promise<void> {
  await q("update assistant_chats set title = $2 where id = $1", [id, cleanTitle(title)], db);
}

export async function setChatPinned(id: number, pinned: boolean, db: Db = getPool()): Promise<void> {
  await q("update assistant_chats set pinned = $2 where id = $1", [id, pinned], db);
}

export async function deleteChat(id: number, db: Db = getPool()): Promise<void> {
  await q("delete from assistant_chats where id = $1", [id], db);
}

export async function messagesFor(chatId: number, db: Db = getPool()): Promise<MessageView[]> {
  const rows = await q<MessageRow>("select * from assistant_messages where chat_id = $1 order by id", [chatId], db);
  return rows.map(toMessage);
}

export async function addMessage(
  chatId: number,
  m: { role: "user" | "assistant"; content: string; blocks?: Block[]; steps?: Step[]; model?: string | null },
  db: Db = getPool(),
): Promise<MessageView> {
  const r = await one<MessageRow>(
    `insert into assistant_messages (chat_id, role, content, blocks, steps, model) values ($1, $2, $3, $4, $5, $6) returning *`,
    [chatId, m.role, m.content, JSON.stringify(m.blocks ?? []), JSON.stringify(m.steps ?? []), m.model ?? null],
    db,
  );
  await q("update assistant_chats set updated_at = now() where id = $1", [chatId], db);
  return toMessage(r!);
}

export async function listMemory(db: Db = getPool()): Promise<MemoryFact[]> {
  const rows = await q<{ id: number; fact: string; created_at: Date }>("select * from assistant_memory order by id", [], db);
  return rows.map((r) => ({ id: r.id, fact: r.fact, createdAt: r.created_at.toISOString() }));
}

/** Adds facts, skipping ones already known (case- and space-insensitive). Returns how many were new. */
export async function addMemory(facts: string[], chatId: number | null, db: Db = getPool()): Promise<number> {
  const known = new Set((await listMemory(db)).map((m) => norm(m.fact)));
  let added = 0;
  for (const raw of facts) {
    const fact = raw.replace(/\s+/g, " ").trim().slice(0, 500);
    if (!fact || known.has(norm(fact))) continue;
    await q("insert into assistant_memory (fact, chat_id) values ($1, $2)", [fact, chatId], db);
    known.add(norm(fact));
    added++;
  }
  return added;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function deleteMemory(ids: number[], db: Db = getPool()): Promise<number> {
  const clean = ids.filter((n) => Number.isInteger(n));
  if (!clean.length) return 0;
  const rows = await q("delete from assistant_memory where id = any($1::int[]) returning id", [clean], db);
  return rows.length;
}
