"use client";

import { BookOpen, Check, CircleDot, Dumbbell, ListChecks, Loader2, Moon, Plus, Star, Footprints } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { quickAction, quickContextAction, undoAssistantAction, type QuickContext } from "@/app/assistant-actions";
import { ACTIVITIES, ACTIVITY } from "@/lib/activity";
import { cn } from "@/lib/cn";
import { Button, Input, Sheet, Textarea } from "../ui";
import { useToast } from "../toast";

type Panel = "state" | "tasks" | "steps" | "score" | "sleep" | "exercise" | "task" | "diary" | null;

const chip = "flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs font-medium text-subtle transition-colors hover:border-accent/40 hover:text-fg disabled:opacity-50";

const STATUS_BTNS: { status: string; label: string; tone: string }[] = [
  { status: "done", label: "Done", tone: "bg-good text-white" },
  { status: "progressed", label: "Progressed", tone: "bg-accent text-accent-fg" },
  { status: "skipped", label: "Not today", tone: "border border-border bg-surface text-fg" },
];

/**
 * One-tap updates without asking the AI: switch state, close tasks, log time, steps, score, sleep, exercise, a task,
 * a diary note. Each goes through the same checked, undoable path as the assistant's own actions.
 */
export function QuickBar({ refreshKey, onChanged }: { refreshKey: number; onChanged?: () => void }) {
  const { toast } = useToast();
  const [data, setData] = useState<QuickContext | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState("");

  const load = useCallback(async () => {
    const r = await quickContextAction();
    if (r.ok) setData(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const act = async (key: string, raw: Record<string, unknown>, close = true) => {
    setBusy(key);
    const r = await quickAction(raw);
    setBusy(null);
    if (!r.ok) return toast(r.error, "error");
    const id = r.item.id;
    toast(r.item.label, "ok", {
      label: "Undo",
      onClick: async () => {
        const u = await undoAssistantAction(id);
        if (u.ok) {
          toast("Undone.");
          void load();
          onChanged?.();
        } else toast(u.error, "error");
      },
    });
    if (close) {
      setPanel(null);
      setText("");
    }
    void load();
    onChanged?.();
  };

  const open = (p: Panel, prefill = "") => {
    setText(prefill);
    setPanel(p);
  };

  if (!data) return <div className="h-8" />;
  const stateMeta = data.state.kind === "off" ? null : ACTIVITY[data.state.kind as keyof typeof ACTIVITY];
  const openTasks = data.entries.filter((e) => ["open", "progressed", "attempted"].includes(e.status));

  return (
    <>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        <button className={cn(chip, stateMeta && "text-fg")} onClick={() => open("state")} title="Switch state">
          <span className="h-2 w-2 rounded-full" style={{ background: stateMeta?.color ?? "hsl(var(--subtle))" }} />
          {stateMeta ? `${stateMeta.emoji} ${stateMeta.short}${data.state.since ? ` · ${data.state.since}` : ""}` : "Off"}
        </button>
        <button className={chip} onClick={() => open("tasks")}>
          <ListChecks className="h-3.5 w-3.5" /> Tasks <span className="tabular-nums text-fg">{openTasks.length}</span>
        </button>
        <button className={chip} onClick={() => open("exercise")}><Dumbbell className="h-3.5 w-3.5" /> Exercise</button>
        <button className={chip} onClick={() => open("steps", data.day.steps ? String(data.day.steps) : "")}>
          <Footprints className="h-3.5 w-3.5" /> {data.day.steps ? data.day.steps.toLocaleString("en-IN") : "Steps"}
        </button>
        <button className={chip} onClick={() => open("score")}>
          <Star className="h-3.5 w-3.5" /> {data.day.score !== null ? `${data.day.score}/10` : "Score"}
        </button>
        <button className={chip} onClick={() => open("sleep", data.day.sleep ? String(Math.round((data.day.sleep / 60) * 10) / 10) : "")}>
          <Moon className="h-3.5 w-3.5" /> {data.day.sleep ? `${Math.floor(data.day.sleep / 60)}h${data.day.sleep % 60 ? ` ${data.day.sleep % 60}m` : ""}` : "Sleep"}
        </button>
        <button className={chip} onClick={() => open("task")}><Plus className="h-3.5 w-3.5" /> Task</button>
        <button className={chip} onClick={() => open("diary")}><BookOpen className="h-3.5 w-3.5" /> Diary</button>
      </div>

      <Sheet open={panel === "state"} onOpenChange={(o) => !o && setPanel(null)} title="Switch state" description="Closes the running segment now and starts the new one.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ACTIVITIES.map((a) => (
            <button
              key={a.kind}
              disabled={!!busy}
              onClick={() => act(`s-${a.kind}`, { type: "switch_state", kind: a.kind })}
              className={cn(
                "flex items-center gap-2 rounded-xl border p-2.5 text-left text-sm transition-colors disabled:opacity-50",
                data.state.kind === a.kind ? "border-accent bg-accent-muted" : "border-border hover:bg-muted",
              )}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />
              <span className="flex-1">{a.emoji} {a.label}</span>
              {busy === `s-${a.kind}` ? <Loader2 className="h-4 w-4 animate-spin" /> : data.state.kind === a.kind ? <CircleDot className="h-4 w-4 text-accent" /> : null}
            </button>
          ))}
          <button
            disabled={!!busy || data.state.kind === "off"}
            onClick={() => act("s-off", { type: "switch_state", kind: "off" })}
            className="flex items-center gap-2 rounded-xl border border-border p-2.5 text-left text-sm hover:bg-muted disabled:opacity-50"
          >
            ■ Day end
          </button>
        </div>
      </Sheet>

      <Sheet open={panel === "tasks"} onOpenChange={(o) => !o && setPanel(null)} title="Today's tasks" description="One tap each. Every change can be undone from the toast.">
        {data.entries.length ? (
          <ul className="space-y-2">
            {data.entries.map((e) => {
              const closed = !["open", "progressed", "attempted"].includes(e.status);
              return (
                <li key={e.id} className={cn("rounded-xl border border-border p-2.5", closed && "opacity-60")}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{e.mustDo ? <span className="text-bad">!! </span> : null}{e.title}</p>
                      <p className="text-xs text-subtle">
                        {[e.project, e.status === "skipped" ? "not today" : e.status, e.minutes ? `${e.minutes} min logged` : null].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {busy?.startsWith(`t-${e.id}-`) ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-subtle" /> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {closed ? (
                      <button className="h-7 rounded-lg border border-border px-2.5 text-xs" disabled={!!busy} onClick={() => act(`t-${e.id}-open`, { type: "task_status", entry_id: e.id, status: "open" }, false)}>
                        Reopen
                      </button>
                    ) : (
                      STATUS_BTNS.map((b) => (
                        <button
                          key={b.status}
                          disabled={!!busy || e.status === b.status}
                          onClick={() => act(`t-${e.id}-${b.status}`, { type: "task_status", entry_id: e.id, status: b.status }, false)}
                          className={cn("h-7 rounded-lg px-2.5 text-xs font-medium disabled:opacity-40", b.tone)}
                        >
                          {e.status === b.status ? <Check className="mr-1 inline h-3 w-3" /> : null}{b.label}
                        </button>
                      ))
                    )}
                    {[15, 30, 60].map((m) => (
                      <button
                        key={m}
                        disabled={!!busy}
                        onClick={() => act(`t-${e.id}-m${m}`, { type: "log_time", task_id: e.taskId, minutes: m }, false)}
                        className="h-7 rounded-lg border border-border bg-surface px-2 text-xs tabular-nums text-subtle hover:text-fg"
                        title={`Log ${m} minutes`}
                      >
                        +{m >= 60 ? "1h" : `${m}m`}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-subtle">Nothing on today&apos;s list.</p>
        )}
      </Sheet>

      <Sheet open={panel === "exercise"} onOpenChange={(o) => !o && setPanel(null)} title="Log exercise" description="Goes into the current exercise slot, or the next free one.">
        {data.exercises.length ? (
          <div className="space-y-2">
            {data.exercises.map((x) => (
              <div key={x.id} className="flex items-center gap-2 rounded-xl border border-border p-2.5">
                <span className="flex-1 text-sm font-medium">{x.name}</span>
                {[x.amount, Math.round(x.amount * 1.5), x.amount * 2].filter((v, i, a) => a.indexOf(v) === i).map((amt) => (
                  <button
                    key={amt}
                    disabled={!!busy}
                    onClick={() => act(`x-${x.id}-${amt}`, { type: "log_exercise", exercise: x.name, amount: amt })}
                    className="h-8 min-w-[3rem] rounded-lg border border-border bg-surface px-2 text-sm tabular-nums hover:bg-muted disabled:opacity-50"
                  >
                    {amt}{x.unit === "seconds" ? "s" : ""}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-subtle">Add exercise types on the Health page first.</p>
        )}
      </Sheet>

      <Sheet open={panel === "score"} onOpenChange={(o) => !o && setPanel(null)} title="Score today" description="How was the day, 0 to 10?">
        <div className="grid grid-cols-6 gap-2">
          {Array.from({ length: 11 }, (_, i) => i).map((v) => (
            <button
              key={v}
              disabled={!!busy}
              onClick={() => act(`score-${v}`, { type: "set_day", field: "score", value: v })}
              className={cn("h-11 rounded-xl border text-base font-semibold tabular-nums disabled:opacity-50", data.day.score === v ? "border-accent bg-accent-muted text-accent" : "border-border hover:bg-muted")}
            >
              {v}
            </button>
          ))}
        </div>
        {data.day.score !== null ? (
          <Button className="mt-3" size="sm" variant="ghost" disabled={!!busy} onClick={() => act("score-clear", { type: "set_day", field: "score", value: "clear" })}>
            Clear today&apos;s score
          </Button>
        ) : null}
      </Sheet>

      {(["steps", "sleep", "task", "diary"] as const).map((p) => {
        const meta = {
          steps: { title: "Steps today", hint: "e.g. 9200", button: "Save steps" },
          sleep: { title: "Sleep last night", hint: "hours, e.g. 7.5", button: "Save sleep" },
          task: { title: "Add a task", hint: "Project: title ~30m !! @tom @5pm", button: "Add task" },
          diary: { title: "Diary note", hint: "What happened, how it felt…", button: "Add to diary" },
        }[p];
        const submit = () => {
          const t = text.trim();
          if (!t) return;
          if (p === "steps") return act("steps", { type: "set_day", field: "steps", value: Number(t.replace(/[,\s]/g, "")) });
          if (p === "sleep") return act("sleep", { type: "set_day", field: "sleep_minutes", value: Math.round(Number(t) * 60) });
          if (p === "task") return act("task", { type: "add_task", text: t });
          return act("diary", { type: "diary_note", text: t });
        };
        return (
          <Sheet key={p} open={panel === p} onOpenChange={(o) => !o && setPanel(null)} title={meta.title}>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              {p === "diary" ? (
                <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={meta.hint} />
              ) : (
                <Input
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={meta.hint}
                  inputMode={p === "steps" || p === "sleep" ? "decimal" : "text"}
                />
              )}
              <div className="flex gap-2">
                <Button type="submit" variant="primary" size="sm" disabled={!text.trim() || !!busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {meta.button}
                </Button>
                {(p === "steps" && data.day.steps !== null) || (p === "sleep" && data.day.sleep !== null) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => act(`${p}-clear`, { type: "set_day", field: p === "steps" ? "steps" : "sleep_minutes", value: "clear" })}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </form>
          </Sheet>
        );
      })}
    </>
  );
}
