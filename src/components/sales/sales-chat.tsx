"use client";

import { Loader2, MessageCircle, RotateCcw, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { loadChatAction } from "@/app/assistant-actions";
import { Blocks } from "@/components/assistant/blocks";
import { Markdown } from "@/components/assistant/markdown";
import { Button, Sheet, Textarea } from "@/components/ui";
import { VoiceButton } from "@/components/voice-button";
import type { MessageView, StreamEvent } from "@/lib/assistant/types";

type Focus = { area: "sales" } | { deal_id: number } | { radar_item_id: number };

const STARTERS = {
  sales: ["Who needs me most today?", "Which deals are stuck, and why?", "What did I win and lose this month?", "Add a lead: Riya Shah, Glowyug, 2 lakh website"],
  deal: ["What's the latest with them, and what should I do next?", "Write my next message to them", "Budget is 2 lakh, next step: call on Friday", "Move it to proposal"],
  radar: ["What exactly do they need, in two lines?", "Who are they and how do I reach them?", "Is it worth my time? Budget and red flags", "Write a short reply I can send now"],
};

/**
 * Chat about Sales, or about one lead. Same assistant as the Assistant page (it reads everything and answers with
 * the numbers), told what this chat is about. Changes come back as buttons: nothing changes until you tap one, and
 * each can be undone. Type or speak.
 */
export function SalesChat({ focus, title, voiceEnabled, label = "Chat" }: { focus: Focus; title: string; voiceEnabled: boolean; label?: string }) {
  const key = "deal_id" in focus ? `sales-chat:deal:${focus.deal_id}` : "radar_item_id" in focus ? `sales-chat:radar:${focus.radar_item_id}` : "sales-chat:sales";
  const [open, setOpen] = useState(false);
  const [chatId, setChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // pick up the last conversation for this page when the panel opens
  useEffect(() => {
    if (!open || chatId) return;
    let saved: number | null = null;
    try {
      saved = Number(localStorage.getItem(key)) || null;
    } catch {
      /* private mode */
    }
    if (!saved) return;
    void loadChatAction(saved).then((r) => {
      if (r.ok) {
        setChatId(saved);
        setMessages(r.messages);
      } else {
        try { localStorage.removeItem(key); } catch { /* ignore */ }
      }
    });
  }, [open, chatId, key]);
  // (a block body: newer browsers return a Promise from scrollIntoView, and an effect must not return one)
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  const fresh = () => {
    setChatId(null);
    setMessages([]);
    setError(null);
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  };

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || status) return;
    setInput("");
    setError(null);
    setMessages((m) => [...m, { id: -Date.now(), role: "user", content: question, blocks: [], steps: [], model: null, createdAt: new Date().toISOString() }]);
    setStatus("Thinking…");
    try {
      const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, message: question, focus }) });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? "The assistant could not start.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as StreamEvent;
          if (ev.t === "chat") {
            setChatId(ev.chatId);
            try { localStorage.setItem(key, String(ev.chatId)); } catch { /* ignore */ }
          } else if (ev.t === "status") setStatus(ev.text);
          else if (ev.t === "query") setStatus("Looking it up…");
          else if (ev.t === "done") {
            finished = true;
            setMessages((m) => [...m, ev.message]);
          } else if (ev.t === "error") {
            finished = true;
            setError(ev.error);
          }
        }
      }
      if (!finished) setError("The answer was cut off. Try again.");
    } catch (e) {
      setError((e as Error).message || "Could not reach the server.");
    } finally {
      setStatus(null);
    }
  };

  const starters = "deal_id" in focus ? STARTERS.deal : "radar_item_id" in focus ? STARTERS.radar : STARTERS.sales;
  return (
    <>
      <Button size="sm" variant="outline" className="shrink-0 whitespace-nowrap" onClick={() => setOpen(true)} aria-label={label}>
        <MessageCircle className="h-4 w-4" /> {label}
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title={title} description="Ask anything or say what changed. Changes wait for your tap." wide>
        <div className="flex min-h-[60vh] flex-col">
          <div className="flex-1 space-y-4 pb-3" aria-live="polite">
            {!messages.length ? (
              <div className="space-y-2">
                <p className="text-sm text-subtle">Try:</p>
                <div className="flex flex-wrap gap-2">
                  {starters.map((s) => (
                    <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-border px-3 py-1.5 text-left text-[13px] hover:border-accent hover:text-accent">{s}</button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-accent-fg">{m.content}</p>
                </div>
              ) : (
                <div key={m.id} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent"><Sparkles className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1 space-y-3">
                    <Markdown text={m.content} />
                    <Blocks blocks={i === messages.length - 1 ? m.blocks : m.blocks.filter((b) => b.type !== "followups")} onAsk={(q) => void send(q)} onChanged={() => router.refresh()} />
                  </div>
                </div>
              ),
            )}
            {status ? <p className="flex items-center gap-2 text-sm text-subtle"><Loader2 className="h-4 w-4 animate-spin" /> {status}</p> : null}
            {error ? <p role="alert" className="rounded-lg bg-bad-muted px-3 py-2 text-sm text-bad">{error}</p> : null}
            <div ref={end} />
          </div>
          <form
            className="sticky bottom-0 space-y-2 border-t border-border bg-surface pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={"deal_id" in focus ? "Ask about this lead, or say what changed…" : "Ask about your sales, or update a lead…"}
              aria-label="Message"
              className="min-h-[64px]"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            <div className="flex items-center gap-2">
              <VoiceButton enabled={voiceEnabled} onText={(t) => setInput((cur) => (cur ? `${cur} ${t}` : t))} showLabel label="Speak" />
              {messages.length ? (
                <Button type="button" size="sm" variant="ghost" onClick={fresh}><RotateCcw className="h-3.5 w-3.5" /> New chat</Button>
              ) : null}
              {chatId ? <Link href={`/assistant?c=${chatId}`} className="text-xs text-subtle hover:text-fg">Open in Assistant</Link> : null}
              <Button type="submit" size="sm" variant="primary" className="ml-auto" disabled={!!status || !input.trim()}>
                <Send className="h-4 w-4" /> Send
              </Button>
            </div>
          </form>
        </div>
      </Sheet>
    </>
  );
}
