"use client";

import {
  ArrowRight, BookOpen, Check, Keyboard, Loader2, Mic, Pencil, RefreshCw, Smile, Sparkles, Trash2, TrendingDown, Trophy,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  addDiaryEntryAction, deleteDiaryEntryAction, summarizeDiaryAction, updateDiaryEntryAction,
} from "@/app/diary-actions";
import { cn } from "@/lib/cn";
import { ratingTone } from "@/lib/rating-tone";
import type { DiarySummaryView } from "@/lib/services/diary";
import { Button, Card, Textarea } from "../ui";
import { useToast } from "../toast";
import { VoiceButton } from "../voice-button";

export interface DiaryEntryView {
  id: number;
  body: string;
  source: "voice" | "text" | "telegram";
  timeLabel: string;
}

export type { DiarySummaryView };

export { ratingTone };

function List({ icon: Icon, title, items, tone }: { icon: typeof Trophy; title: string; items: string[]; tone: string }) {
  if (!items.length) return null;
  return (
    <div>
      <p className={cn("mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide", tone)}>
        <Icon className="h-3.5 w-3.5" />
        {title}
      </p>
      <ul className="space-y-1 text-sm">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-current opacity-50" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The AI's read of a day. Used on the Diary page and inside the Stats dialog. */
export function SummaryCard({ s, footer }: { s: DiarySummaryView; footer?: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className={cn("flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl", ratingTone(s.rating))}>
          <span className="tabular text-xl font-bold leading-none">{s.rating ?? "–"}</span>
          <span className="text-[9px] font-semibold uppercase opacity-80">/ 10</span>
        </div>
        <div className="min-w-0">
          <p className="font-display text-lg leading-snug">{s.headline}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {s.mood ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-muted px-2 py-0.5 text-xs font-medium text-accent">
                <Smile className="h-3 w-3" />
                {s.mood}
              </span>
            ) : null}
            {s.tags.map((t) => (
              <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-xs text-subtle">#{t}</span>
            ))}
          </div>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-fg/90">{s.summary}</p>
      {s.highlights.length ? (
        <div className="rounded-xl bg-hl/60 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
            <Sparkles className="h-3.5 w-3.5" />
            Worth remembering
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {s.highlights.map((h, i) => (
              <li key={i} className="rounded-lg bg-surface px-2 py-1 text-sm shadow-[var(--shadow-sm)]">{h}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <List icon={Trophy} title="Wins" items={s.wins} tone="text-good" />
        <List icon={TrendingDown} title="Struggles" items={s.struggles} tone="text-warn" />
        <List icon={ArrowRight} title="Tomorrow" items={s.tomorrow} tone="text-accent" />
      </div>
      {footer}
    </div>
  );
}

function EntryItem({ e }: { e: DiaryEntryView }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(e.body);
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const r = await updateDiaryEntryAction(e.id, text);
      if (!r.ok) return toast(r.error, "error");
      setEditing(false);
      router.refresh();
    });
  }
  function remove() {
    if (!confirm("Delete this note?")) return;
    start(async () => {
      const r = await deleteDiaryEntryAction(e.id);
      if (!r.ok) return toast(r.error, "error");
      router.refresh();
    });
  }

  return (
    <li className="group relative pl-6">
      <span className="absolute left-0 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent-muted text-accent">
        {e.source === "text" ? <Keyboard className="h-2.5 w-2.5" /> : <Mic className="h-2.5 w-2.5" />}
      </span>
      <div className="flex items-center gap-2">
        <span className="tabular text-xs font-medium text-subtle">{e.timeLabel}</span>
        {e.source === "telegram" ? <span className="text-[10px] text-subtle">via Telegram</span> : null}
        {!editing ? (
          <span className="ml-auto flex gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
            <button type="button" onClick={() => setEditing(true)} aria-label="Edit note" className="rounded-md p-1 text-subtle hover:bg-muted hover:text-fg">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={remove} aria-label="Delete note" className="rounded-md p-1 text-subtle hover:bg-bad-muted hover:text-bad">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-1 space-y-2">
          <Textarea value={text} onChange={(ev) => setText(ev.target.value)} rows={4} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setText(e.body); setEditing(false); }}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={save} disabled={pending}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">{e.body}</p>
      )}
    </li>
  );
}

/**
 * Record (or type) today's diary; every saved note refreshes the AI summary.
 * `compact` is the Today-page version: capture only, with a link to the full diary.
 */
export function DiaryPanel({
  date, entries, summary, voiceEnabled, aiEnabled, compact = false, isToday = true,
}: {
  date: string;
  entries: DiaryEntryView[];
  summary: DiarySummaryView | null;
  voiceEnabled: boolean;
  aiEnabled: boolean;
  compact?: boolean;
  isToday?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(!voiceEnabled);
  const [busy, setBusy] = useState<null | "saving" | "summarizing">(null);
  const [recState, setRecState] = useState<"idle" | "recording" | "sending">("idle");
  // English + Hindi is automatic; Gujarati has to be picked (Deepgram cannot detect it). Remembered per device.
  const [lang, setLang] = useState<"multi" | "gu">("multi");
  useEffect(() => {
    try {
      if (localStorage.getItem("daybook-voice-lang") === "gu") setLang("gu");
    } catch {
      /* storage blocked */
    }
  }, []);
  function pickLang(l: "multi" | "gu") {
    setLang(l);
    try {
      localStorage.setItem("daybook-voice-lang", l);
    } catch {
      /* ignore */
    }
  }

  const save = useCallback(async (body: string, source: "voice" | "text") => {
    setBusy(aiEnabled ? "summarizing" : "saving");
    const r = await addDiaryEntryAction(date, body, source, aiEnabled);
    setBusy(null);
    if (!r.ok) {
      toast(r.error, "error");
      if (source === "voice") setDraft((d) => (d ? `${d}\n${body}` : body)); // keep the words so nothing is lost
      return false;
    }
    if (r.summaryError) toast(`Note saved. ${r.summaryError}`, "error");
    else toast(aiEnabled ? "Saved and summarised." : "Note saved.");
    router.refresh();
    return true;
  }, [aiEnabled, date, router, toast]);

  async function regenerate() {
    setBusy("summarizing");
    const r = await summarizeDiaryAction(date);
    setBusy(null);
    if (!r.ok) return toast(r.error, "error");
    toast("Summary updated.");
    router.refresh();
  }

  const recording = recState === "recording";
  const transcribing = recState === "sending";

  const capture = (
    <Card className={cn("overflow-hidden", compact ? "" : "")}>
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-muted text-accent">
          <BookOpen className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{isToday ? "How did today go?" : "Diary notes"}</p>
          <p className="text-xs text-subtle">
            {entries.length
              ? `${entries.length} note${entries.length === 1 ? "" : "s"} saved${aiEnabled ? ", summary updates as you add more" : ""}`
              : "Talk for a minute or ten: what happened, who you met, how you felt."}
          </p>
        </div>
        {compact ? (
          <a href="/diary" className="hidden shrink-0 items-center gap-1 text-xs font-medium text-accent hover:underline sm:inline-flex">
            Open diary <ArrowRight className="h-3 w-3" />
          </a>
        ) : null}
      </div>

      <div className="space-y-3 p-4">
        {!typing ? (
          <div className="flex flex-col items-center gap-2 py-2">
            <VoiceButton
              enabled={voiceEnabled}
              maxSeconds={600}
              language={lang}
              listenFor="daybook:record"
              label={recording ? "Stop" : "Record"}
              showLabel
              onStateChange={setRecState}
              onText={(t) => void save(t, "voice")}
              className={cn(
                "h-14 rounded-full px-7 text-base font-semibold",
                !recording && !transcribing && "border-transparent bg-accent text-accent-fg shadow-[0_2px_10px_hsl(var(--accent)/0.35)] hover:bg-accent hover:text-accent-fg hover:opacity-90",
                recording && "animate-pulse",
              )}
            />
            <div className="inline-flex rounded-lg bg-muted p-0.5 text-[11px] font-semibold" role="group" aria-label="Spoken language">
              {([["multi", "English / हिंदी"], ["gu", "ગુજરાતી"]] as const).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={lang === k}
                  disabled={recording || transcribing}
                  onClick={() => pickLang(k)}
                  className={cn("rounded-md px-2.5 py-1 transition-colors", lang === k ? "bg-surface text-fg shadow-sm" : "text-subtle hover:text-fg")}
                >
                  {l}
                </button>
              ))}
            </div>
            <p className="text-xs text-subtle">
              {recording
                ? "Recording. Tap to stop (10 minute limit)."
                : transcribing
                  ? "Turning your voice into text…"
                  : busy === "summarizing"
                    ? "Saved. Writing your day summary…"
                    : "Tap to record. It is transcribed and saved automatically."}
            </p>
            <button type="button" onClick={() => setTyping(true)} className="inline-flex items-center gap-1 text-xs text-subtle hover:text-fg">
              <Keyboard className="h-3.5 w-3.5" /> Type instead
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={compact ? 3 : 5}
              placeholder="Write about your day…"
              aria-label="Diary note"
            />
            <div className="flex items-center justify-between gap-2">
              {voiceEnabled ? (
                <button type="button" onClick={() => setTyping(false)} className="inline-flex items-center gap-1 text-xs text-subtle hover:text-fg">
                  <Mic className="h-3.5 w-3.5" /> Record instead
                </button>
              ) : <span />}
              <Button
                size="sm"
                variant="primary"
                disabled={!draft.trim() || busy !== null}
                onClick={async () => { if (await save(draft, "text")) setDraft(""); }}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save note
              </Button>
            </div>
          </div>
        )}

        {busy === "summarizing" && typing ? (
          <p className="flex items-center gap-2 text-xs text-subtle"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Writing your day summary…</p>
        ) : null}

        {compact && summary ? (
          <a href="/diary" className="block rounded-xl border border-border bg-bg/60 p-3 transition-colors hover:border-accent/40">
            <div className="flex items-center gap-2">
              <span className={cn("tabular rounded-lg px-1.5 py-0.5 text-xs font-bold", ratingTone(summary.rating))}>{summary.rating ?? "–"}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{summary.headline}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-subtle" />
            </div>
          </a>
        ) : null}
      </div>
    </Card>
  );

  if (compact) return capture;

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-2">
        {capture}
        {entries.length ? (
          <Card className="p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-subtle">Your notes</p>
            <ul className="space-y-4">
              {entries.map((e) => <EntryItem key={e.id} e={e} />)}
            </ul>
          </Card>
        ) : null}
      </div>
      <div className="lg:col-span-3">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
              <Sparkles className="h-3.5 w-3.5 text-accent" /> Day summary
            </p>
            {aiEnabled ? (
              <Button size="sm" variant="ghost" onClick={regenerate} disabled={busy !== null}>
                {busy === "summarizing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {summary ? "Refresh" : "Summarise day"}
              </Button>
            ) : null}
          </div>
          {summary ? (
            <SummaryCard
              s={summary}
              footer={
                <p className="border-t border-border pt-3 text-[11px] text-subtle">
                  Based on {summary.entryCount} note{summary.entryCount === 1 ? "" : "s"} and your tracked tasks, time and health
                  {summary.model ? ` · ${summary.model.replace(/:free$/, "")}` : ""}
                  {summary.entryCount !== entries.length ? " · new notes since, tap Refresh" : ""}
                </p>
              }
            />
          ) : busy === "summarizing" ? (
            <div className="space-y-3">
              <div className="h-14 animate-pulse rounded-2xl bg-muted" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
              <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Sparkles className="h-8 w-8 text-accent/40" />
              <p className="text-sm font-medium">No summary yet</p>
              <p className="max-w-xs text-xs text-subtle">
                {aiEnabled
                  ? "Record a note and the AI reads it with your tasks, hours and health to rate and summarise the day. Or summarise from tracked data alone."
                  : "AI summaries need OPENROUTER_API_KEY in the environment."}
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
