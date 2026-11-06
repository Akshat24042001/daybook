"use client";

import { ArrowLeft, CheckCircle2, Layers, MessageCircle, MessageSquarePlus, RefreshCw, Repeat, Save, Target, Trash2, X, CircleDot, CloudMoon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createTaskAction, createRemarkAction, deleteRemarkAction, deleteTaskAction, setTaskStateAction, updateTaskAction, type NewTaskForm,
} from "@/app/actions";
import { TASK_TYPE_LABEL, type TaskType } from "@/lib/parser";
import { cn } from "@/lib/cn";
import { HUE } from "@/lib/hue";
import { TASK_TYPE_INFO } from "@/lib/task-types";
import { fmtDuration, fmtDay } from "@/lib/time";
import { useToast } from "../toast";
import { Button, Card, Chip, ErrorNote, Field, Input, Select, Textarea, ComboInput } from "../ui";
import { VoiceButton } from "../voice-button";
import { RepeatEditor } from "./repeat-editor";

export interface TaskFormData {
  id: number;
  title: string;
  notes: string;
  type: TaskType;
  project: string;
  person: string;
  personRole: "with" | "requested_by";
  via: string;
  isPersonal: boolean;
  estimateMin: number | null;
  dueDate: string;
  dueTime: string;
  leadMin: number | null;
  cadenceDays: number | null;
  rrule: string;
  targetPeriod: import("@/lib/time").TargetPeriod | null;
  goalMin: number | null;
  goalCount: number | null;
  state: "active" | "done" | "dropped";
  carry: number;
  createdDay: string;
  mustDo?: boolean;
  /** HH:MM or "" */
  showFrom: string;
}

const num = (v: string): number | null => (v.trim() === "" ? null : Math.max(0, Math.round(Number(v))) || null);

export function TaskForm({
  mode, task, projects, people, voiceEnabled, history, totals, pendingId = null, today, remarks = [],
}: {
  mode: "new" | "edit";
  task: TaskFormData;
  projects: string[];
  people: string[];
  voiceEnabled: boolean;
  history: { date: string; status: string; mustDo: boolean }[];
  totals: { minutes: number; days: number };
  pendingId?: number | null;
  today: string;
  remarks?: { id: number; body: string; createdAt: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(task);
  const [rule, setRule] = useState(task.rrule || "FREQ=DAILY");
  const [ruleProblem, setRuleProblem] = useState<string | null>(null);
  const [estimate, setEstimate] = useState(task.estimateMin === null ? "" : String(task.estimateMin));
  const [lead, setLead] = useState(task.leadMin === null ? "" : String(task.leadMin));
  const [cadence, setCadence] = useState(task.cadenceDays === null ? "7" : String(task.cadenceDays));
  const [goalHours, setGoalHours] = useState(task.goalMin === null ? "" : String(Math.round((task.goalMin / 60) * 10) / 10));
  const [goalCount, setGoalCount] = useState(task.goalCount === null ? "" : String(task.goalCount));
  const [mustDo, setMustDo] = useState(!!task.mustDo);
  const [remarkList, setRemarkList] = useState(remarks);
  const [newRemark, setNewRemark] = useState("");
  const set = <K extends keyof TaskFormData>(k: K, v: TaskFormData[K]) => setF((cur) => ({ ...cur, [k]: v }));

  const rrule = f.type === "recurring" ? rule : "";

  function save() {
    setError(null);
    if (f.type === "recurring" && ruleProblem) return setError(ruleProblem);
    start(async () => {
      if (mode === "new") {
        const form: NewTaskForm = {
          title: f.title,
          type: f.type,
          project: f.project || null,
          person: f.person || null,
          personRole: f.person ? f.personRole : null,
          via: f.via || null,
          isPersonal: f.isPersonal,
          estimateMin: num(estimate),
          date: f.dueDate || null,
          time: f.dueTime || null,
          mustDo,
          cadenceDays: num(cadence),
          rrule: rrule || null,
          targetPeriod: f.type === "target" ? f.targetPeriod ?? "week" : null,
          goalMin: goalHours ? Math.round(Number(goalHours) * 60) : null,
          notes: f.notes || null,
          pendingId,
          showFrom: f.showFrom || null,
        };
        const r = await createTaskAction(form);
        if (!r.ok) return setError(r.error);
        toast("Task created.");
        router.push("/today");
        return;
      }
      const r = await updateTaskAction(f.id, {
        title: f.title,
        notes: f.notes,
        type: f.type,
        project: f.project || null,
        person: f.person || null,
        person_role: f.person ? f.personRole : null,
        via: f.via || null,
        is_personal: f.isPersonal,
        estimate_min: num(estimate),
        due_date: f.dueDate || null,
        due_time: f.dueTime || null,
        lead_min: lead === "" ? null : Math.max(0, Math.round(Number(lead))),
        cadence_days: f.type === "cadence" ? num(cadence) : null,
        rrule: f.type === "recurring" ? rrule : null,
        target_period: f.type === "target" ? f.targetPeriod ?? "week" : null,
        goal_min: f.type === "target" && goalHours ? Math.round(Number(goalHours) * 60) : null,
        goal_count: f.type === "target" ? num(goalCount) : null,
        show_from: f.showFrom || null,
      });
      if (!r.ok) return setError(r.error);
      toast("Saved.");
      router.refresh();
    });
  }

  const info = TASK_TYPE_INFO[f.type];
  const hue = HUE[info.hue];
  const TypeIcon = { one_off: CircleDot, ongoing: Layers, follow_up: MessageCircle, cadence: RefreshCw, recurring: Repeat, someday: CloudMoon, target: Target }[f.type];
  const showPeople = info.fields.people || !!f.person;
  const STATUS_TONE: Record<string, string> = { done: "bg-good", progressed: "bg-teal-fill", skipped: "bg-butter-fill", attempted: "bg-butter-fill", waiting: "bg-accent", dropped: "bg-bad", open: "bg-border" };

  const dateField = info.fields.date ? (
    <Field label={info.fields.date}>
      <Input type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
    </Field>
  ) : null;

  return (
    <div className="space-y-5">
      <header>
        <Link href="/today" className="inline-flex items-center gap-1 text-sm text-subtle hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="mt-3 flex items-start gap-3">
          <span className={cn("mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", hue.fill, "text-fg/80 shadow-[var(--shadow-sm)]")}><TypeIcon className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <input
              value={f.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="What needs doing?"
              aria-label="Title"
              className="font-display w-full rounded-xl bg-transparent text-2xl leading-tight outline-none placeholder:text-subtle/60 focus:bg-surface/70 sm:text-3xl"
            />
            {mode === "edit" ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-subtle">
                <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", hue.tint, hue.ink)}>{TASK_TYPE_LABEL[f.type]}</span>
                {f.project ? <Chip>{f.project}</Chip> : null}
                {task.state !== "active" ? <span className="rounded-full bg-p-rose px-2.5 py-0.5 text-xs font-semibold text-p-rose-fg">{task.state}</span> : null}
                {task.carry > 0 ? <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", task.carry >= 3 ? "bg-p-rose text-p-rose-fg" : "bg-p-butter text-p-butter-fg")}>carried {task.carry}×</span> : null}
                <span>Added {fmtDay(task.createdDay)}</span>
                {totals.minutes ? <span className="tabular">{fmtDuration(totals.minutes)} logged over {totals.days} {totals.days === 1 ? "day" : "days"}</span> : null}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card className="space-y-4 p-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-subtle">What</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Kind of task">
                <Select value={f.type} onChange={(e) => set("type", e.target.value as TaskType)}>
                  {(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((t) => (
                    <option key={t} value={t}>{TASK_TYPE_LABEL[t]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Project" hint="Typing a new name creates it.">
                <ComboInput value={f.project} onChange={(v) => set("project", v)} suggestions={projects} placeholder="None" aria-label="Project" newHint="new project" />
              </Field>
              <Field label="Estimate" hint="Minutes. Used to size your day on Plan.">
                <Input inputMode="numeric" value={estimate} onChange={(e) => setEstimate(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 30" />
              </Field>
              {mode === "new" ? (
                <Field label="Must-do" hint="Counts toward the daily cap.">
                  <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={mustDo} onChange={(e) => setMustDo(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--accent))]" /> Must-do that day</label>
                </Field>
              ) : null}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.isPersonal} onChange={(e) => set("isPersonal", e.target.checked)} className="h-4 w-4 accent-[hsl(var(--accent))]" />
              Personal: shown separately and left out of work hours
            </label>
          </Card>

          {(dateField || info.fields.time || info.fields.repeat !== "none") ? (
            <Card className="space-y-4 p-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-subtle">When</h2>
              {dateField || info.fields.time ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {dateField}
                  {info.fields.time ? (
                    <Field label="At" hint="A reminder is sent before it.">
                      <Input type="time" value={f.dueTime} onChange={(e) => set("dueTime", e.target.value)} />
                    </Field>
                  ) : null}
                </div>
              ) : null}

              {info.fields.repeat === "cadence" ? (
                <Field label="Nudge me every" hint="It shows on Today as a nudge once this many days have passed since you last did it.">
                  <div className="flex items-center gap-2"><Input inputMode="numeric" value={cadence} onChange={(e) => setCadence(e.target.value.replace(/\D/g, ""))} className="max-w-[6rem]" /> <span className="text-sm text-subtle">days</span></div>
                </Field>
              ) : null}

              {info.fields.repeat === "rule" ? (
                <RepeatEditor
                  value={rule}
                  today={today}
                  startDefault={task.createdDay || today}
                  onChange={(v, problem) => {
                    setRule(v);
                    setRuleProblem(problem);
                  }}
                />
              ) : null}

              {info.fields.repeat === "target" ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Period">
                    <Select value={f.targetPeriod ?? "week"} onChange={(e) => set("targetPeriod", e.target.value as import("@/lib/time").TargetPeriod)}>
                      <option value="week">This week</option>
                      <option value="month">This month</option>
                      <option value="quarter">This quarter</option>
                      <option value="year">This year</option>
                    </Select>
                  </Field>
                  <Field label="Hours goal" hint="Optional">
                    <Input inputMode="decimal" value={goalHours} onChange={(e) => setGoalHours(e.target.value.replace(/[^\d.]/g, ""))} />
                  </Field>
                  {mode === "edit" ? (
                    <Field label="Sessions goal" hint="Days with Done or Progressed">
                      <Input inputMode="numeric" value={goalCount} onChange={(e) => setGoalCount(e.target.value.replace(/\D/g, ""))} />
                    </Field>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ) : null}

          {showPeople ? (
            <Card className="space-y-4 p-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-subtle">Who</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Person">
                  <ComboInput value={f.person} onChange={(v) => set("person", v)} suggestions={people} placeholder="None" aria-label="Person" newHint="new person" />
                </Field>
                <Field label="They are">
                  <Select value={f.personRole} onChange={(e) => set("personRole", e.target.value as "with" | "requested_by")} disabled={!f.person}>
                    <option value="with">Someone I follow up with</option>
                    <option value="requested_by">Someone who asked for it</option>
                  </Select>
                </Field>
              </div>
            </Card>
          ) : null}

          <details className="rounded-3xl border border-border bg-surface/70 p-4" open={!!(f.via || f.showFrom || lead) || undefined}>
            <summary className="cursor-pointer text-sm font-semibold">More options</summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {!showPeople ? (
                <Field label="Person" hint="Who it is with. Makes it a follow-up when added from quick-add.">
                  <ComboInput value={f.person} onChange={(v) => set("person", v)} suggestions={people} placeholder="None" aria-label="Person" newHint="new person" />
                </Field>
              ) : null}
              <Field label="Via (referrer)">
                <Input value={f.via} onChange={(e) => set("via", e.target.value)} placeholder="e.g. J" />
              </Field>
              <Field label="Show on Today from" hint="Hidden from Today until this time, e.g. an evening task. Blank means all day.">
                <div className="flex gap-2">
                  <Input type="time" value={f.showFrom} onChange={(e) => set("showFrom", e.target.value)} />
                  {f.showFrom ? <Button variant="ghost" onClick={() => set("showFrom", "")}>Clear</Button> : null}
                </div>
              </Field>
              {mode === "edit" ? (
                <Field label="Remind me before" hint="Minutes. Blank uses the default from Settings.">
                  <Input inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value.replace(/\D/g, ""))} placeholder="Default" />
                </Field>
              ) : null}
            </div>
          </details>

          {mode === "new" ? (
            <Card className="p-4">
              <Field label="Notes" hint="Shown after the task is created.">
                <div className="flex items-start gap-2">
                  <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything worth remembering" className="min-h-[110px]" />
                  <VoiceButton enabled={voiceEnabled} onText={(t) => set("notes", f.notes ? `${f.notes}\n${t}` : t)} />
                </div>
              </Field>
            </Card>
          ) : null}

          <ErrorNote message={error} />
          <div className="sticky bottom-24 z-10 flex flex-wrap items-center gap-2 rounded-3xl border border-border bg-surface/90 p-3 shadow-[var(--shadow-md)] backdrop-blur md:bottom-4">
            <Button variant="primary" onClick={save} disabled={pending || !f.title.trim()}>
              <Save className="h-4 w-4" /> {mode === "new" ? "Create task" : "Save changes"}
            </Button>
            <Link href="/today" className="inline-flex h-10 items-center rounded-full px-4 text-sm font-medium text-subtle hover:bg-muted hover:text-fg">Cancel</Link>
          </div>
        </div>

        <aside className="space-y-5">
          <section className={cn("rounded-3xl border border-border p-4", hue.soft)} aria-label="How this kind of task works">
            <h2 className={cn("mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider", hue.ink)}><TypeIcon className="h-4 w-4" /> {info.label}: how it works</h2>
            <p className="text-sm"><b>When it shows up.</b> {info.shows}</p>
            <p className="mt-2 text-sm"><b>If you miss it.</b> {info.missed}</p>
          </section>

          {mode === "edit" ? (
            <Card className="space-y-3 p-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-subtle">This task</h2>
              <dl className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-2xl bg-muted px-2 py-2"><dt className="text-xs text-subtle">Days worked</dt><dd className="font-display text-xl tabular">{totals.days}</dd></div>
                <div className="rounded-2xl bg-muted px-2 py-2"><dt className="text-xs text-subtle">Time logged</dt><dd className="font-display text-xl tabular">{totals.minutes ? fmtDuration(totals.minutes) : "0m"}</dd></div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await setTaskStateAction(f.id, f.state === "dropped" ? "active" : "dropped");
                      if (!r.ok) return setError(r.error);
                      toast(f.state === "dropped" ? "Task reopened." : "Task dropped. History is kept.");
                      router.refresh();
                      set("state", f.state === "dropped" ? "active" : "dropped");
                    })
                  }
                >
                  {f.state === "dropped" ? "Reopen" : "Drop task"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm("Delete this task and all of its history and logged time? You can undo this from History.")) return;
                    start(async () => {
                      const r = await deleteTaskAction(f.id);
                      if (!r.ok) return setError(r.error);
                      toast("Task deleted.");
                      router.push("/today");
                    });
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              </div>
            </Card>
          ) : null}

          {mode === "edit" && history.length > 0 ? (
            <Card className="p-4" aria-label="History">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-subtle">History</h2>
              <ol className="space-y-2">
                {history.map((h) => (
                  <li key={h.date + h.status} className="flex items-center gap-3 text-sm">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", STATUS_TONE[h.status] ?? "bg-border")} aria-hidden />
                    <span className="tabular w-24 shrink-0 text-subtle">{h.date}</span>
                    <span className="capitalize">{h.status}{h.mustDo ? " ★" : ""}</span>
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}

          {mode === "edit" ? (
            <Card className="space-y-3 p-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-subtle">Notes</h2>
              {remarkList.length === 0 ? <p className="text-sm text-subtle">No notes yet.</p> : (
                <ul className="space-y-2">
                  {remarkList.map((r) => {
                    const dt = new Date(r.createdAt);
                    const local = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
                    const label = `${fmtDay(local)} · ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
                    return (
                      <li key={r.id} className="space-y-1 rounded-2xl bg-muted p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="tabular text-xs text-subtle">{label}</span>
                          <button
                            type="button"
                            aria-label="Delete note"
                            className="text-subtle hover:text-fg"
                            onClick={() =>
                              start(async () => {
                                const res = await deleteRemarkAction(r.id, f.id);
                                if (!res.ok) { toast(res.error ?? "Could not delete.", "error"); return; }
                                setRemarkList((cur) => cur.filter((x) => x.id !== r.id));
                              })
                            }
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="whitespace-pre-wrap text-sm">{r.body}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex items-start gap-2">
                <Textarea value={newRemark} onChange={(e) => setNewRemark(e.target.value)} placeholder="Add a note…" className="min-h-[72px]" />
                <div className="flex flex-col gap-1">
                  <VoiceButton enabled={voiceEnabled} onText={(t) => setNewRemark((cur) => cur ? `${cur}\n${t}` : t)} />
                  <button
                    type="button"
                    disabled={pending || !newRemark.trim()}
                    title="Save note"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-subtle hover:text-fg disabled:opacity-40"
                    onClick={() =>
                      start(async () => {
                        const body = newRemark.trim();
                        if (!body) return;
                        const res = await createRemarkAction(f.id, body);
                        if (!res.ok) { toast(res.error ?? "Could not save.", "error"); return; }
                        setNewRemark("");
                        setRemarkList((cur) => [{ id: Date.now(), body, createdAt: new Date().toISOString() }, ...cur]);
                        toast("Note saved.");
                      })
                    }
                  >
                    <MessageSquarePlus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
