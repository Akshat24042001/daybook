"use client";

import {
  ArrowUp, Bot, Brain, Check, ChevronDown, Cpu, Database, Loader2, Menu, MessageSquarePlus, Pencil, Pin, PinOff, RefreshCw,
  Search, Sparkles, Trash2, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addMemoryAction, deleteChatAction, deleteMemoryAction, listMemoryAction, loadChatAction, pinChatAction, renameChatAction,
  setChatModelAction,
} from "@/app/assistant-actions";
import { cn } from "@/lib/cn";
import type { ChatSummary, FreeModel, MemoryFact, MessageView, Step, StreamEvent } from "@/lib/assistant/types";
import { Button, Input, Sheet } from "../ui";
import { useToast } from "../toast";
import { VoiceButton } from "../voice-button";
import { Blocks } from "./blocks";
import { Markdown } from "./markdown";
import { QuickBar } from "./quick-bar";

const SUGGESTIONS: { group: string; items: string[] }[] = [
  { group: "Today", items: ["How is my day going so far?", "What is still pending today, most important first?"] },
  { group: "Performance", items: ["Grade my last 7 days against the 30 days before. Be brutal.", "Which tasks keep getting carried and why?"] },
  { group: "Patterns", items: ["At what time of day do I get the most done?", "Does my sleep change how my day goes?"] },
  { group: "Body", items: ["How consistent is my exercise this month?", "Steps and sleep trend for the last 30 days"] },
  { group: "Work", items: ["Hours per project this week vs my goals", "Where did my worked hours go last week?"] },
  { group: "People & mind", items: ["Who should I reconnect with this week?", "What have I been writing about in my diary lately?"] },
  { group: "Do it for me", items: ["Close out today: offer buttons for everything still open", "I started office at 9:40 today, fix my time"] },
];

const fmtCtx = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// ---------------------------------------------------------------- queries disclosure

function StepsList({ steps, live }: { steps: Step[]; live?: boolean }) {
  return (
    <ol className="space-y-1.5">
      {steps.map((s, i) => (
        <li key={i} className="rounded-xl border border-border bg-muted/30 p-2">
          <div className="flex items-center gap-2 text-xs">
            <span className={cn("font-mono font-semibold", s.error ? "text-bad" : "text-accent")}>{s.name}</span>
            <span className="min-w-0 flex-1 truncate text-subtle">{s.why}</span>
            <span className="shrink-0 tabular-nums text-subtle">
              {s.error ? "failed" : `${s.rows ?? 0} rows${s.ms !== undefined ? ` · ${s.ms} ms` : ""}`}
            </span>
          </div>
          {!live ? <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-subtle">{s.sql}</pre> : null}
          {s.error ? <p className="mt-1 text-[11px] text-bad">{s.error}</p> : null}
        </li>
      ))}
    </ol>
  );
}

function Message({ m, onAsk, isLast, onChanged }: { m: MessageView; onAsk: (q: string) => void; isLast: boolean; onChanged: () => void }) {
  const [showSteps, setShowSteps] = useState(false);
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-accent-fg">{m.content}</p>
      </div>
    );
  }
  const blocks = isLast ? m.blocks : m.blocks.filter((b) => b.type !== "followups");
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <Markdown text={m.content} />
        <Blocks blocks={blocks} onAsk={onAsk} onChanged={onChanged} />
        {m.steps.length || m.model ? (
          <div>
            <button onClick={() => setShowSteps(!showSteps)} className="flex items-center gap-1.5 text-[11px] text-subtle hover:text-fg">
              <Database className="h-3 w-3" />
              {m.steps.length ? `${m.steps.length} ${m.steps.length === 1 ? "query" : "queries"}` : "no queries"}
              {m.model ? <span>· {m.model.replace(/:free$/, "")}</span> : null}
              {m.steps.length ? <ChevronDown className={cn("h-3 w-3 transition-transform", showSteps && "rotate-180")} /> : null}
            </button>
            {showSteps && m.steps.length ? <div className="mt-2"><StepsList steps={m.steps} /></div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- model picker

function ModelSheet({
  open, onClose, value, onPick,
}: { open: boolean; onClose: () => void; value: string | null; onPick: (id: string | null) => void }) {
  const [models, setModels] = useState<FreeModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/assistant/models${refresh ? "?refresh=1" : ""}`);
      const j = (await r.json()) as { ok: boolean; models: FreeModel[]; error?: string };
      if (!j.ok) setError(j.error ?? "Could not load models.");
      setModels(j.models ?? []);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !models) void load();
  }, [open, models, load]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (models ?? []).filter((m) => !f || m.name.toLowerCase().includes(f) || m.id.toLowerCase().includes(f));
  }, [models, filter]);

  const row = (active: boolean) =>
    cn("w-full rounded-xl border p-2.5 text-left transition-colors", active ? "border-accent bg-accent-muted" : "border-border hover:bg-muted");

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Model for this chat" description="Free models on OpenRouter, live. If the one you pick is busy, the assistant falls back to the next free model.">
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or vendor" className="h-9 pl-8" />
          </div>
          <Button size="sm" variant="outline" onClick={() => load(true)} disabled={loading} title="Reload from OpenRouter">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
        <button className={row(value === null)} onClick={() => { onPick(null); onClose(); }}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Auto</span>
            <span className="rounded-full bg-good-muted px-1.5 py-0.5 text-[10px] font-semibold text-good">Recommended</span>
            {value === null ? <Check className="ml-auto h-4 w-4 text-accent" /> : null}
          </div>
          <p className="mt-0.5 text-xs text-subtle">Tries the app&apos;s tested free models in order and uses the first that answers.</p>
        </button>
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {!models && loading ? <p className="flex items-center gap-2 text-sm text-subtle"><Loader2 className="h-4 w-4 animate-spin" /> Loading free models…</p> : null}
        {models ? <p className="text-xs text-subtle">{shown.length} of {models.length} free models</p> : null}
        <ul className="space-y-1.5">
          {shown.map((m) => (
            <li key={m.id}>
              <button className={row(value === m.id)} onClick={() => { onPick(m.id); onClose(); }} title={m.description}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold">{m.name}</span>
                  {m.recommended ? <span className="shrink-0 rounded-full bg-good-muted px-1.5 py-0.5 text-[10px] font-semibold text-good">in Auto</span> : null}
                  {value === m.id ? <Check className="ml-auto h-4 w-4 shrink-0 text-accent" /> : null}
                </div>
                <p className="truncate font-mono text-[11px] text-subtle">{m.id}</p>
                <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-medium">
                  <span className="rounded-md bg-muted px-1.5 py-0.5">{fmtCtx(m.context)} context</span>
                  {m.maxOutput ? <span className="rounded-md bg-muted px-1.5 py-0.5">{fmtCtx(m.maxOutput)} out</span> : null}
                  {m.created ? <span className="rounded-md bg-muted px-1.5 py-0.5">{m.created}</span> : null}
                  {m.tools ? <span className="rounded-md bg-accent-muted px-1.5 py-0.5 text-accent">tools</span> : null}
                  {m.reasoning ? <span className="rounded-md bg-accent-muted px-1.5 py-0.5 text-accent">reasoning</span> : null}
                  {m.structured ? <span className="rounded-md bg-accent-muted px-1.5 py-0.5 text-accent">JSON mode</span> : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- memory

function MemorySheet({
  open, onClose, memory, setMemory,
}: { open: boolean; onClose: () => void; memory: MemoryFact[]; setMemory: (m: MemoryFact[]) => void }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="What the assistant remembers" description="Used in every chat. It adds facts when you say “remember…” or state a lasting goal; you can add or remove them here.">
      <div className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await addMemoryAction(draft);
            if (!r.ok) return toast(r.error);
            setMemory(r.memory);
            setDraft("");
          }}
        >
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. My goal this quarter is 25 focused hours a week" className="h-9 flex-1" maxLength={500} />
          <Button type="submit" size="sm" variant="primary" disabled={!draft.trim()}>Add</Button>
        </form>
        {memory.length ? (
          <ul className="space-y-1.5">
            {memory.map((m) => (
              <li key={m.id} className="group flex items-start gap-2 rounded-xl border border-border p-2.5 text-sm">
                <Brain className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span className="flex-1">{m.fact}</span>
                <button
                  aria-label="Forget this"
                  title="Forget this"
                  className="rounded-md p-1 text-subtle opacity-60 hover:bg-muted hover:text-bad group-hover:opacity-100"
                  onClick={async () => {
                    const r = await deleteMemoryAction(m.id);
                    if (r.ok) setMemory(r.memory);
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-subtle">Nothing yet. Tell it things like “remember I want to be in bed by 23:30”.</p>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- chat list

function ChatList({
  chats, activeId, onOpen, onNew, onChange,
}: {
  chats: ChatSummary[];
  activeId: number | null;
  onOpen: (id: number) => void;
  onNew: () => void;
  onChange: (next: ChatSummary[]) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const shown = chats.filter((c) => !filter.trim() || c.title.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="flex h-full flex-col gap-2">
      <Button variant="primary" size="sm" onClick={onNew} className="w-full">
        <MessageSquarePlus className="h-4 w-4" /> New chat
      </Button>
      {chats.length > 6 ? (
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a chat" className="h-8 text-xs" />
      ) : null}
      <ul className="-mx-1 flex-1 space-y-0.5 overflow-y-auto px-1">
        {shown.map((c) => (
          <li key={c.id}>
            {editing === c.id ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const t = name.trim() || c.title;
                  onChange(chats.map((x) => (x.id === c.id ? { ...x, title: t } : x)));
                  setEditing(null);
                  await renameChatAction(c.id, t);
                }}
              >
                <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setEditing(null)} className="h-8 text-sm" maxLength={120} />
              </form>
            ) : (
              <div
                className={cn(
                  "group flex items-center gap-1 rounded-xl px-2 py-1.5 text-sm transition-colors",
                  c.id === activeId ? "bg-accent-muted text-accent" : "hover:bg-muted",
                )}
              >
                <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(c.id)}>
                  <span className="flex items-center gap-1">
                    {c.pinned ? <Pin className="h-3 w-3 shrink-0 opacity-70" /> : null}
                    <span className="truncate">{c.title}</span>
                  </span>
                  <span className="block text-[10px] text-subtle">{timeAgo(c.updatedAt)}{c.model ? ` · ${c.model.split("/")[1]?.replace(/:free$/, "")}` : ""}</span>
                </button>
                <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
                  <button
                    className="rounded-md p-1 text-subtle hover:bg-surface hover:text-fg"
                    title={c.pinned ? "Unpin" : "Pin"}
                    aria-label={c.pinned ? "Unpin chat" : "Pin chat"}
                    onClick={async () => {
                      const next = chats.map((x) => (x.id === c.id ? { ...x, pinned: !x.pinned } : x));
                      onChange([...next].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)));
                      await pinChatAction(c.id, !c.pinned);
                    }}
                  >
                    {c.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  </button>
                  <button className="rounded-md p-1 text-subtle hover:bg-surface hover:text-fg" title="Rename" aria-label="Rename chat" onClick={() => { setEditing(c.id); setName(c.title); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className={cn("rounded-md p-1 text-subtle hover:bg-surface hover:text-bad", confirm === c.id && "bg-bad/10 px-1.5 text-[11px] font-medium text-bad")}
                    title="Delete"
                    aria-label={confirm === c.id ? "Tap again to delete" : "Delete chat"}
                    onClick={async () => {
                      if (confirm !== c.id) {
                        setConfirm(c.id);
                        setTimeout(() => setConfirm((v) => (v === c.id ? null : v)), 3000);
                        return;
                      }
                      onChange(chats.filter((x) => x.id !== c.id));
                      await deleteChatAction(c.id);
                      if (c.id === activeId) onNew();
                    }}
                  >
                    {confirm === c.id ? "Delete?" : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </span>
              </div>
            )}
          </li>
        ))}
        {!chats.length ? <li className="px-2 py-3 text-xs text-subtle">Your chats will be kept here.</li> : null}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- app

export function AssistantApp({
  initialChats,
  initialChatId,
  initialMessages,
  initialMemory,
  initialAsk,
  voiceEnabled,
  aiEnabled,
}: {
  initialChats: ChatSummary[];
  initialChatId: number | null;
  initialMessages: MessageView[];
  initialMemory: MemoryFact[];
  initialAsk: string | null;
  voiceEnabled: boolean;
  aiEnabled: boolean;
}) {
  const { toast } = useToast();
  const [chats, setChats] = useState(initialChats);
  const [activeId, setActiveId] = useState<number | null>(initialChatId);
  const [messages, setMessages] = useState<MessageView[]>(initialMessages);
  const [memory, setMemory] = useState(initialMemory);
  const [model, setModel] = useState<string | null>(initialChats.find((c) => c.id === initialChatId)?.model ?? null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<{ status: string; steps: Step[] } | null>(null);
  const [error, setError] = useState<{ text: string; question: string } | null>(null);
  const [sheet, setSheet] = useState<"chats" | "memory" | "model" | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = !!pending;
  // anything that changes data (quick bar, applied actions, a finished answer) refreshes the quick bar
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, pending?.steps.length, pending?.status]);

  // grow the composer with its text
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(200, el.scrollHeight)}px`;
  }, [input]);

  const setUrl = (id: number | null) => {
    const url = id ? `/assistant?c=${id}` : "/assistant";
    window.history.replaceState(null, "", url);
  };

  const openChat = async (id: number) => {
    setSheet(null);
    if (id === activeId || busy) return;
    setError(null);
    setActiveId(id);
    setModel(chats.find((c) => c.id === id)?.model ?? null);
    setMessages([]);
    setUrl(id);
    const r = await loadChatAction(id);
    if (r.ok) setMessages(r.messages);
    else toast(r.error);
  };

  const newChat = () => {
    setSheet(null);
    if (busy) return;
    setActiveId(null);
    setMessages([]);
    setError(null);
    setUrl(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const pickModel = async (id: string | null) => {
    setModel(id);
    if (activeId) {
      setChats((cs) => cs.map((c) => (c.id === activeId ? { ...c, model: id } : c)));
      await setChatModelAction(activeId, id);
    }
  };

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setInput("");
    setError(null);
    const temp: MessageView = { id: -Date.now(), role: "user", content: question, blocks: [], steps: [], model: null, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, temp]);
    setPending({ status: "Thinking…", steps: [] });
    let chatId = activeId;
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, message: question, model }),
      });
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
            chatId = ev.chatId;
            if (!activeId) {
              setActiveId(ev.chatId);
              setUrl(ev.chatId);
              setChats((cs) => [{ id: ev.chatId, title: ev.title, pinned: false, model, updatedAt: new Date().toISOString() }, ...cs.filter((c) => c.id !== ev.chatId)]);
            }
          } else if (ev.t === "status") {
            setPending((p) => (p ? { ...p, status: ev.text } : p));
          } else if (ev.t === "query") {
            setPending((p) => (p ? { ...p, steps: [...p.steps, ev.step] } : p));
          } else if (ev.t === "done") {
            finished = true;
            setMessages((m) => [...m, ev.message]);
            bump();
            setChats((cs) => {
              const cur = cs.find((c) => c.id === chatId);
              if (!cur) return cs;
              const updated = { ...cur, title: ev.title ?? cur.title, updatedAt: new Date().toISOString() };
              return [updated, ...cs.filter((c) => c.id !== chatId)].sort((a, b) => Number(b.pinned) - Number(a.pinned));
            });
            if (ev.memoryChanged) {
              toast("Memory updated.");
              const r = await listMemoryAction();
              if (r.ok) setMemory(r.memory);
            }
          } else if (ev.t === "error") {
            finished = true;
            setError({ text: ev.error, question });
          }
        }
      }
      if (!finished) setError({ text: "The answer was cut off. Try again.", question });
    } catch (e) {
      setError({ text: (e as Error).message || "Could not reach the server.", question });
    } finally {
      setPending(null);
    }
  };

  // /assistant?q=… (from the command palette): ask straight away, once
  const asked = useRef(false);
  useEffect(() => {
    if (initialAsk && !asked.current) {
      asked.current = true;
      window.history.replaceState(null, "", initialChatId ? `/assistant?c=${initialChatId}` : "/assistant");
      void send(initialAsk);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modelLabel = model ? model.split("/")[1]?.replace(/:free$/, "") ?? model : "Auto";
  const title = chats.find((c) => c.id === activeId)?.title ?? "New chat";

  return (
    <div className="mx-auto flex h-[calc(100dvh-9.5rem)] max-w-6xl gap-4 md:h-[calc(100dvh-7rem)]">
      <aside className="hidden w-64 shrink-0 md:block">
        <ChatList chats={chats} activeId={activeId} onOpen={openChat} onNew={newChat} onChange={setChats} />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <button className="rounded-lg p-1.5 text-subtle hover:bg-muted hover:text-fg md:hidden" onClick={() => setSheet("chats")} aria-label="Chats">
            <Menu className="h-4 w-4" />
          </button>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</p>
          <button
            onClick={() => setSheet("model")}
            className="flex max-w-[45%] items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-subtle hover:bg-muted hover:text-fg"
            title="Choose the AI model for this chat"
          >
            <Cpu className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{modelLabel}</span>
            <ChevronDown className="h-3 w-3 shrink-0" />
          </button>
          <button
            onClick={() => setSheet("memory")}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-subtle hover:bg-muted hover:text-fg"
            title="What the assistant remembers"
          >
            <Brain className="h-3.5 w-3.5" />
            <span className="tabular-nums">{memory.length}</span>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-5">
          {!aiEnabled ? (
            <p className="mb-3 rounded-xl border border-warn/40 bg-warn-muted px-3 py-2 text-sm text-warn">The assistant needs OPENROUTER_API_KEY set on the server.</p>
          ) : null}
          {messages.length === 0 && !pending ? (
            <div className="mx-auto max-w-3xl py-4">
              <div className="mb-5 flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-muted text-accent"><Bot className="h-6 w-6" /></span>
                <div>
                  <p className="font-display text-lg">Ask anything about your Daybook</p>
                  <p className="text-sm text-subtle">It reads your tasks, time, projects, exercise, sleep, diary and contacts, and answers with the numbers.</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {SUGGESTIONS.map((g) => (
                  <div key={g.group}>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">{g.group}</p>
                    <div className="space-y-1.5">
                      {g.items.map((s) => (
                        <button
                          key={s}
                          onClick={() => send(s)}
                          disabled={!aiEnabled}
                          className="w-full rounded-xl border border-border px-3 py-2 text-left text-sm transition-colors hover:border-accent/40 hover:bg-muted disabled:opacity-50"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6">
              {messages.map((m, i) => (
                <Message key={m.id} m={m} onAsk={send} isLast={i === messages.length - 1 && !pending} onChanged={bump} />
              ))}
              {pending ? (
                <div className="flex gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-sm text-subtle" aria-live="polite">{pending.status}</p>
                    {pending.steps.length ? <StepsList steps={pending.steps} live /> : null}
                  </div>
                </div>
              ) : null}
              {error ? (
                <div className="flex items-center gap-2 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
                  <span className="flex-1">{error.text}</span>
                  <Button size="sm" variant="outline" onClick={() => { const q = error.question; setMessages((m) => (m[m.length - 1]?.content === q && m[m.length - 1].role === "user" ? m.slice(0, -1) : m)); void send(q); }}>
                    Retry
                  </Button>
                </div>
              ) : null}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <form
          className="border-t border-border p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <div className="mx-auto mb-1.5 max-w-3xl">
            <QuickBar refreshKey={refreshKey} onChanged={bump} />
          </div>
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border bg-bg/50 p-1.5 focus-within:border-accent/60">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder={busy ? "Working on it…" : "Ask about your day, tasks, habits, projects, people…"}
              disabled={!aiEnabled}
              className="max-h-[200px] min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-subtle/70"
              aria-label="Message"
            />
            <VoiceButton enabled={voiceEnabled && aiEnabled && !busy} onText={(t) => setInput((cur) => (cur ? `${cur} ${t}` : t))} className="h-9 w-9 shrink-0" />
            <button
              type="submit"
              disabled={!input.trim() || busy || !aiEnabled}
              aria-label="Send"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg transition-opacity disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
          <p className="mx-auto mt-1 max-w-3xl px-1 text-[10px] text-subtle">It reads everything; it changes something only when you tap a suggested change, and every change can be undone. Enter to send, Shift+Enter for a new line.</p>
        </form>
      </section>

      <Sheet open={sheet === "chats"} onOpenChange={(o) => !o && setSheet(null)} title="Chats">
        <div className="h-[70vh]">
          <ChatList chats={chats} activeId={activeId} onOpen={openChat} onNew={newChat} onChange={setChats} />
        </div>
      </Sheet>
      <MemorySheet open={sheet === "memory"} onClose={() => setSheet(null)} memory={memory} setMemory={setMemory} />
      <ModelSheet open={sheet === "model"} onClose={() => setSheet(null)} value={model} onPick={pickModel} />
    </div>
  );
}
