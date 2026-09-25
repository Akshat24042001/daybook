"use client";

import { Clock, CornerDownLeft, Plus, Sparkles } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { aiInterpretAction, duplicatesAction, quickAddAction, timeSaveAction, type QuickAddMode } from "@/app/actions";
import { cn } from "@/lib/cn";
import type { Match } from "@/lib/fuzzy";
import { describeParsed, parseQuickAdd } from "@/lib/parser";
import { logicalDate, fmtDuration } from "@/lib/time";
import { describeTimeLog, looksLikeTimeLog, parseTimeLog } from "@/lib/timelog";
import { voiceToQuickAdd } from "@/lib/voice";
import { applySuggestion, insertChip, suggestionsFor, SYNTAX_CHIPS, type Suggestion } from "@/lib/quick-add-hints";
import { useToast } from "./toast";
import { Button, Chip, ErrorNote } from "./ui";
import { VoiceButton } from "./voice-button";

/**
 * One input line, always at the top (PRD section 5). It understands quick-add syntax
 * ("Vector: Insights !! @5pm ~2h"), shows how the line was understood before saving, guards against
 * duplicates, and also takes manual time entries ("office 10:45 to 1:30"), typed or spoken.
 */
export function QuickAdd({ tz, boundaryMin, voiceEnabled, aiEnabled }: { tz: string; boundaryMin: number; voiceEnabled: boolean; aiEnabled: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [aiPending, setAiPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // helper: syntax chips while focused, autocomplete for the word at the caret
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(0);
  const [names, setNames] = useState<{ projects: string[]; people: string[] } | null>(null);
  const [sugIndex, setSugIndex] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!focused || names) return;
    fetch("/api/quick-add/lookup")
      .then((r) => r.json())
      .then((j: { projects: string[]; people: string[] }) => setNames({ projects: j.projects ?? [], people: j.people ?? [] }))
      .catch(() => setNames({ projects: [], people: [] }));
  }, [focused, names]);

  const suggestions: Suggestion[] = useMemo(
    () => (focused && names && dismissedAt !== text ? suggestionsFor(text, caret, names) : []),
    [focused, names, text, caret, dismissedAt],
  );
  useEffect(() => setSugIndex(0), [suggestions.length, text]);

  function accept(sg: Suggestion) {
    const r = applySuggestion(text, caret, sg);
    setText(r.text);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(r.caret, r.caret);
      setCaret(r.caret);
    });
  }
  const syncCaret = () => setCaret(inputRef.current?.selectionStart ?? text.length);

  // empty states elsewhere prefill the bar ("daybook:quickadd"), caret at the start for the title
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const t = (e as CustomEvent<string>).detail ?? "";
      setText(t);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        el.focus();
        el.setSelectionRange(0, 0);
        setCaret(0);
      });
    };
    window.addEventListener("daybook:quickadd", onPrefill);
    return () => window.removeEventListener("daybook:quickadd", onPrefill);
  }, []);

  const defaultDate = pathname.startsWith("/plan") ? (search.get("date") ?? undefined) : undefined;

  const view = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const now = new Date();
    const today = logicalDate(now, tz, boundaryMin);
    if (looksLikeTimeLog(trimmed)) {
      const parsed = parseTimeLog(trimmed, { now, tz, boundaryMin });
      if (parsed) return { kind: "time" as const, parsed, described: describeTimeLog(parsed) };
    }
    const parsed = parseQuickAdd(trimmed, { now, tz, boundaryMin, defaultDate });
    return { kind: "task" as const, parsed, lines: describeParsed(parsed, { tz, today }) };
  }, [text, tz, boundaryMin, defaultDate]);

  // Duplicate guard: ask the server for close matches once the title settles.
  const taskTitle = view?.kind === "task" ? view.parsed.title : "";
  const taskProject = view?.kind === "task" ? view.parsed.project : null;
  useEffect(() => {
    setMatches([]);
    if (taskTitle.length < 3) return;
    const t = setTimeout(async () => {
      const r = await duplicatesAction(taskTitle, taskProject);
      if (r.ok) setMatches(r.matches);
    }, 300);
    return () => clearTimeout(t);
  }, [taskTitle, taskProject]);

  async function interpretWithAI() {
    if (!text.trim() || aiPending) return;
    setAiPending(true);
    setError(null);
    try {
      const r = await aiInterpretAction(text.trim());
      if (r.ok) {
        setText(r.syntax);
        inputRef.current?.focus();
      } else {
        setError(r.error);
      }
    } finally {
      setAiPending(false);
    }
  }

  function submit(mode: QuickAddMode, existingTaskId?: number) {
    if (!text.trim()) return;
    setError(null);
    start(async () => {
      const r =
        view?.kind === "time" && mode === "add"
          ? await timeSaveAction(text)
          : await quickAddAction(text, { defaultDate, mode, existingTaskId });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if ("message" in r && typeof r.message === "string") toast(r.message);
      else if ("workedMin" in r) toast(`Time logged. Worked ${fmtDuration(r.workedMin as number)}.`);
      setText("");
      setMatches([]);
      router.refresh();
      inputRef.current?.focus();
    });
  }

  const showDup = view?.kind === "task" && matches.length > 0;
  const blocked = view?.kind === "task" ? view.parsed.errors.length > 0 : view?.kind === "time" ? view.parsed.errors.length > 0 : true;
  const dayWord = defaultDate ? "this day" : "today";

  return (
    <div className="rounded-2xl border border-border bg-surface p-2 shadow-sm">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!showDup && !blocked) submit("add");
        }}
      >
        <div className="relative min-w-0 flex-1">
          <input
            ref={inputRef}
            id="quick-add-input"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
            }}
            onSelect={syncCaret}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="quick-add-suggestions"
            aria-autocomplete="list"
            onKeyDown={(e) => {
              if (suggestions.length) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setSugIndex((i) => (i + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
                  return;
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.nativeEvent.isComposing)) {
                  e.preventDefault();
                  accept(suggestions[sugIndex]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setDismissedAt(text);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!pending && !showDup && !blocked) submit("add");
              }
            }}
            placeholder="Add a task, or say: office 10:45 to 1:30"
            aria-label="Quick add"
            enterKeyHint="done"
            autoComplete="off"
            autoCapitalize="sentences"
            className="h-11 w-full rounded-xl bg-muted px-3 pr-10 text-[15px] outline-none placeholder:text-subtle/70 focus:ring-2 focus:ring-accent/50"
          />
          {text ? (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-subtle">
              <CornerDownLeft className="h-4 w-4" />
            </span>
          ) : null}
          {suggestions.length ? (
            <ul
              id="quick-add-suggestions"
              role="listbox"
              className="dropdown-in absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-lg)]"
            >
              {suggestions.map((sg, i) => (
                <li
                  key={sg.replace}
                  role="option"
                  aria-selected={i === sugIndex}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    accept(sg);
                  }}
                  onPointerMove={() => setSugIndex(i)}
                  className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm", i === sugIndex ? "bg-accent-muted" : "hover:bg-muted")}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{sg.label}</span>
                  {sg.hint ? <span className="shrink-0 text-xs text-subtle">{sg.hint}</span> : null}
                  {i === sugIndex ? <kbd className="shrink-0 rounded border border-border px-1 text-[10px] text-subtle">Tab</kbd> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <VoiceButton
          enabled={voiceEnabled}
          className="h-11"
          onText={(t) => {
            const next = looksLikeTimeLog(t) ? t : voiceToQuickAdd(t);
            setText(next);
            inputRef.current?.focus();
          }}
        />
        {aiEnabled ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-11 px-0"
            disabled={aiPending || !text.trim()}
            aria-label="Interpret with AI"
            title="Let AI understand what you typed"
            onClick={interpretWithAI}
          >
            {aiPending ? (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </Button>
        ) : null}
        <Button type="submit" variant="primary" className="h-11 w-11 px-0" disabled={pending || blocked || showDup} aria-label="Add">
          <Plus className="h-5 w-5" />
        </Button>
      </form>

      {focused && !suggestions.length ? (
        <div className="mt-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" aria-label="Quick-add syntax">
          {SYNTAX_CHIPS.map((c) => (
            <button
              key={c.insert}
              type="button"
              title={c.hint}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                const next = insertChip(text, c);
                setText(next);
                requestAnimationFrame(() => {
                  inputRef.current?.focus();
                  inputRef.current?.setSelectionRange(next.length, next.length);
                  setCaret(next.length);
                });
              }}
              className="shrink-0 whitespace-nowrap rounded-lg border border-border bg-bg px-2 py-1 font-mono text-[11px] text-subtle transition-colors hover:border-accent/40 hover:bg-accent-muted hover:text-accent"
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}

      {view ? (
        <div className="mt-2 space-y-2 px-1 pb-1">
          {view.kind === "task" ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
                <span className="mr-1 text-sm font-medium">{view.parsed.title || "…"}</span>
                {view.lines.map((l) => (
                  <Chip key={l}>{l}</Chip>
                ))}
              </div>
              {view.parsed.notes.map((n) => (
                <p key={n} className="text-xs text-warn">{n}</p>
              ))}
              {view.parsed.errors.map((n) => (
                <p key={n} className="text-xs text-bad">{n}</p>
              ))}
            </>
          ) : (
            <div className="space-y-1 rounded-xl bg-muted px-3 py-2 text-sm" aria-live="polite">
              <p className="flex items-center gap-1.5 font-medium">
                <Clock className="h-4 w-4" /> Log time for {view.parsed.date === logicalDate(new Date(), tz, boundaryMin) ? "today" : view.parsed.date}
              </p>
              {view.described.lines.map((l) => (
                <p key={l} className="tabular text-subtle">{l}</p>
              ))}
              <p className="tabular font-medium">Worked: {fmtDuration(view.described.workedMin)}</p>
              {view.parsed.errors.map((n) => (
                <p key={n} className="text-xs text-bad">{n}</p>
              ))}
            </div>
          )}

          {showDup ? (
            <div className="rounded-xl border border-warn/40 bg-warn/10 p-2.5 text-sm">
              <p>
                Already on your list: <span className="font-medium">{matches[0].projectName ? `${matches[0].projectName}: ` : ""}{matches[0].title}</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="primary" size="sm" disabled={pending} onClick={() => submit("existing", matches[0].id)}>
                  Add existing task to {dayWord}
                </Button>
                <Button variant="outline" size="sm" disabled={pending} onClick={() => setMatches([])}>
                  Add as new
                </Button>
              </div>
            </div>
          ) : (
            <div className={cn("flex flex-wrap gap-2", blocked && "opacity-50")}>
              {view.kind === "task" ? (
                <>
                  <Button size="sm" variant="outline" disabled={pending || blocked} onClick={() => submit("tomorrow")}>
                    Add for tomorrow
                  </Button>
                  <Button size="sm" variant="outline" disabled={pending || blocked} onClick={() => submit("someday")}>
                    Someday
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="primary" disabled={pending || blocked} onClick={() => submit("add")}>
                  Save time
                </Button>
              )}
            </div>
          )}
          <ErrorNote message={error} />
        </div>
      ) : null}
    </div>
  );
}
