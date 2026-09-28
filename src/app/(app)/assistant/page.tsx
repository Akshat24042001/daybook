import type { Metadata } from "next";
import { AssistantApp } from "@/components/assistant/assistant-app";
import { aiConfigured } from "@/lib/ai";
import { voiceConfigured } from "@/lib/deepgram";
import { listChats, listMemory, messagesFor } from "@/lib/services/assistant";

export const metadata: Metadata = { title: "Assistant" };
export const dynamic = "force-dynamic";

export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const [chats, memory] = await Promise.all([listChats(), listMemory()]);
  const wanted = Number(one(sp.c));
  const chatId = chats.some((c) => c.id === wanted) ? wanted : null;
  const messages = chatId ? await messagesFor(chatId) : [];
  const ask = one(sp.q)?.trim().slice(0, 4000) || null;

  return (
    <AssistantApp
      initialChats={chats}
      initialChatId={chatId}
      initialMessages={messages}
      initialMemory={memory}
      initialAsk={ask}
      voiceEnabled={voiceConfigured()}
      aiEnabled={aiConfigured()}
    />
  );
}
