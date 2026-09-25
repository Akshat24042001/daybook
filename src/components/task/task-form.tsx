"use client";

import { ArrowLeft, MessageSquarePlus, Save, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createTaskAction, createRemarkAction, deleteRemarkAction, deleteTaskAction, setTaskStateAction, updateTaskAction, type NewTaskForm,
} from "@/app/actions";
import { TASK_TYPE_LABEL, type TaskType } from "@/lib/parser";
import { fmtDuration, fmtDay } from "@/lib/time";
import { useToast } from "../toast";
import { Button, Card, Chip, ErrorNote, Field, Input, Select, Textarea, ComboInput } from "../ui";
import { VoiceButton } from "../voice-button";

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
}

const DAYS = [["MO", "Monday"], ["TU", "Tuesday"], ["WE", "Wednesday"], ["TH", "Thursday"], ["FR", "Friday"], ["SA", "Saturday"], ["SU", "Sunday"]] as const;

function parseRule(rrule: string): { kind: "weekly" | "monthly"; day: string; monthDay: string } {
  const w = /BYDAY=(\w\w)/.exec(rrule);
  const m = /BYMONTHDAY=(\d+)/.exec(rrule);
  if (m) return { kind: "monthly", day: "MO", monthDay: m[1] };
  return { kind: "weekly", day: w?.[1] ?? "MO", monthDay: "1" };
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
  const rule0 = parseRule(task.rrule);
  const [ruleKind, setRuleKind] = useState(rule0.kind);
  const [ruleDay, setRuleDay] = useState(rule0.day);
  const [ruleMonthDay, setRuleMonthDay] = useState(rule0.monthDay);
  const [estimate, setEstimate] = useState(task.estimateMin === null ? "" : String(task.estimateMin));
  const [lead, setLead] = useState(task.leadMin === null ? "" : String(task.leadMin));
  const [cadence, setCadence] = useState(task.cadenceDays === null ? "7" : String(task.cadenceDays));
  const [goalHours, setGoalHours] = useState(task.goalMin === null ? "" : String(Math.round((task.goalMin / 60) * 10) / 10));
  const [goalCount, setGoalCount] = useState(task.goalCount === null ? "" : String(task.goalCount));
  const [mustDo, setMustDo] = useState(!!task.mustDo);
  const [remarkList, setRemarkList] = useState(remarks);
  const [newRemark, setNewRemark] = useState("");
  const set = <K extends keyof TaskFormData>(k: K, v: TaskFormData[K]) => setF((cur) => ({ ...cur, [k]: v }));

  const rrule = f.type === "recurring" ? (ruleKind === "weekly" ? `FREQ=WEEKLY;BYDAY=${ruleDay}` : `FREQ=MONTHLY;BYMONTHDAY=${Math.min(31, Math.max(1, Number(ruleMonthDay) || 1))}`) : "";

  function save() {
    setError(null);
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
      });
      if (!r.ok) return setError(r.error);
      toast("Saved.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/today" className="inline-flex items-center gap-1 text-sm text-subtle hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="font-display mt-2 text-3xl leading-tight">{mode === "new" ? "New task" : f.title || "Task"}</h1>
        {mode === "edit" ? (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-subtle">
            <Chip>{TASK_TYPE_LABEL[task.type]}</Chip>
            {task.state !== "active" ? <Chip className="bg-warn/15 text-warn">{task.state}</Chip> : null}
            {task.carry > 0 ? <Chip>carried {task.carry}×</Chip> : null}
            <span>added {task.createdDay}</span>
            {totals.minutes ? <span className="tabular">· {fmtDuration(totals.minutes)} logged over {totals.days} {totals.days === 1 ? "day" : "days"}</span> : null}
          </p>
        ) : null}
      </div>

      <Card className="space-y-4 p-4">
        <Field label="Title">
          <Input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="What needs doing?" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <Select value={f.type} onChange={(e) => set("type", e.target.value as TaskType)}>
              {(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((t) => (
                <option key={t} value={t}>{TASK_TYPE_LABEL[t]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Project" hint="Typing a new name creates it.">
            <ComboInput value={f.project} onChange={(v) => set("project", v)} suggestions={projects} placeholder="None" aria-label="Project" newHint="new project" />
          </Field>
          <Field label="Person">
            <ComboInput value={f.person} onChange={(v) => set("person", v)} suggestions={people} placeholder="None" aria-label="Person" newHint="new person" />
          </Field>
          <Field label="Person is">
            <Select value={f.personRole} onChange={(e) => set("personRole", e.target.value as "with" | "requested_by")} disabled={!f.person}>
              <option value="with">Someone I follow up with</option>
              <option value="requested_by">Someone who requested it</option>
            </Select>
          </Field>
          <Field label="Via (referrer)">
            <Input value={f.via} onChange={(e) => set("via", e.target.value)} placeholder="e.g. J" />
          </Field>
          <Field label="Estimate (minutes)">
            <Input inputMode="numeric" value={estimate} onChange={(e) => setEstimate(e.target.value.replace(/\D/g, ""))} placeholder="Optional" />
          </Field>
          <Field label={mode === "new" ? "Date" : "Due date"}>
            <Input type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
          </Field>
          <Field label="Time" hint="A reminder is sent before it.">
            <Input type="time" value={f.dueTime} onChange={(e) => set("dueTime", e.target.value)} />
          </Field>
          {mode === "edit" ? (
            <Field label="Reminder lead (minutes)" hint="Blank uses the default from Settings.">
              <Input inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value.replace(/\D/g, ""))} placeholder="Default" />
            </Field>
          ) : (
            <Field label="Must-do" hint="Counts toward the daily cap.">
              <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={mustDo} onChange={(e) => setMustDo(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--accent))]" /> Must-do that day</label>
            </Field>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.isPersonal} onChange={(e) => set("isPersonal", e.target.checked)} className="h-4 w-4 accent-[hsl(var(--accent))]" />
          Personal (shown separately, excluded from work hours)
        </label>

        {f.type === "cadence" ? (
          <Field label="Repeat every (days)" hint="You are nudged when this many days pass since it was last done.">
            <Input inputMode="numeric" value={cadence} onChange={(e) => setCadence(e.target.value.replace(/\D/g, ""))} className="max-w-[10rem]" />
          </Field>
        ) : null}

        {f.type === "recurring" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Repeats">
              <Select value={ruleKind} onChange={(e) => setRuleKind(e.target.value as "weekly" | "monthly")}>
                <option value="weekly">Every week on…</option>
                <option value="monthly">Every month on day…</option>
              </Select>
            </Field>
            {ruleKind === "weekly" ? (
              <Field label="Day">
                <Select value={ruleDay} onChange={(e) => setRuleDay(e.target.value)}>
                  {DAYS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
            ) : (
              <Field label="Day of month">
                <Input inputMode="numeric" value={ruleMonthDay} onChange={(e) => setRuleMonthDay(e.target.value.replace(/\D/g, ""))} />
              </Field>
            )}
          </div>
        ) : null}

        {f.type === "target" ? (
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

        {mode === "edit" ? (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-subtle">Remarks</p>
            {remarkList.length === 0 ? (
              <p className="text-sm text-subtle">No remarks yet.</p>
            ) : (
              <ul className="space-y-2">
                {remarkList.map((r) => {
                  const dt = new Date(r.createdAt);
                  const local = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
                  const label = `${fmtDay(local)} · ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
                  return (
                    <li key={r.id} className="rounded-xl border border-border bg-surface p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-subtle tabular-nums">{label}</span>
                        <button
                          type="button"
                          aria-label="Delete remark"
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
                      <p className="text-sm whitespace-pre-wrap">{r.body}</p>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex items-start gap-2">
              <Textarea
                value={newRemark}
                onChange={(e) => setNewRemark(e.target.value)}
                placeholder="Add a remark…"
                className="min-h-[72px]"
              />
              <div className="flex flex-col gap-1">
                <VoiceButton enabled={voiceEnabled} onText={(t) => setNewRemark((cur) => cur ? `${cur}\n${t}` : t)} />
                <button
                  type="button"
                  disabled={pending || !newRemark.trim()}
                  title="Save remark"
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-subtle hover:text-fg disabled:opacity-40"
                  onClick={() =>
                    start(async () => {
                      const body = newRemark.trim();
                      if (!body) return;
                      const res = await createRemarkAction(f.id, body);
                      if (!res.ok) { toast(res.error ?? "Could not save.", "error"); return; }
                      setNewRemark("");
                      setRemarkList((cur) => [{ id: Date.now(), body, createdAt: new Date().toISOString() }, ...cur]);
                      toast("Remark saved.");
                    })
                  }
                >
                  <MessageSquarePlus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <Field label="Notes" hint="Shown after the task is created.">
            <div className="flex items-start gap-2">
              <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything worth remembering" className="min-h-[110px]" />
              <VoiceButton enabled={voiceEnabled} onText={(t) => set("notes", f.notes ? `${f.notes}\n${t}` : t)} />
            </div>
          </Field>
        )}

        <ErrorNote message={error} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={save} disabled={pending || !f.title.trim()}>
            <Save className="h-4 w-4" /> {mode === "new" ? "Create task" : "Save changes"}
          </Button>
          {mode === "edit" ? (
            <>
              <Button
                variant="outline"
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
                disabled={pending}
                onClick={() => {
                  if (!window.confirm("Delete this task and all of its history and logged time? This cannot be undone.")) return;
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
            </>
          ) : null}
        </div>
      </Card>

      {history.length > 0 ? (
        <section aria-label="History" className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">Recent days</h2>
          <div className="flex flex-wrap gap-1.5">
            {history.map((h) => (
              <Chip key={h.date + h.status}>{h.date}: {h.status}{h.mustDo ? " ★" : ""}</Chip>
            ))}
          </div>
        </section>
      ) : null}
      <p className="text-xs text-subtle">Today is {today}.</p>
    </div>
  );
}
