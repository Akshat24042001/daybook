"use client";

import {
  Building2, ChevronDown, Coffee, Flag, Car, Target, Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { setScoreAction, setStatusAction, setStepsAction, setWorkedOverrideAction, switchStateAction, toggleMustAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import { SECTION_LABEL, SECTION_ORDER, type SectionKey } from "@/lib/sections";
import { fmtDuration, type DateStr } from "@/lib/time";
import type { EntryStatus } from "@/lib/types";
import type { RowData, SegmentData } from "@/lib/view-types";
import { useToast } from "../toast";
import { Button, Card, Empty, Input, EmptyState, prefillQuickAdd } from "../ui";
import { EntryRow } from "./entry-row";
import { EntrySheet } from "./entry-sheet";
import { SegmentsSheet } from "./segments-sheet";

type Kind = "office" | "outside" | "break" | "off";

const STATES: { kind: Kind; label: string; Icon: typeof Building2 }[] = [
  { kind: "office", label: "At office", Icon: Building2 },
  { kind: "outside", label: "Out on work", Icon: Car },
  { kind: "break", label: "Break", Icon: Coffee },
  { kind: "off", label: "Day end", Icon: Flag },
];

const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function TodayView(props: {
  date: DateStr;
  dateLabel: string;
  sections: Record<SectionKey, RowData[]>;
  state: { kind: Kind; sinceLabel: string | null };
  workedAtLoad: number;
  workedOverride: number | null;
  score: number | null;
  steps: number | null;
  stepGoal: number;
  mustCap: number;
  segments: SegmentData[];
  newSegmentDefault: string;
  voiceEnabled: boolean;
  /** extra cards for the right rail (the diary) */
  aside?: React.ReactNode;
  /** cards above the end-of-day card (sleep, this week's intentions) */
  asideTop?: React.ReactNode;
  targets: { id: number; title: string; met: boolean; behind: boolean; hasGoal: boolean; period: string }[];
  projects: { id: number; name: string }[];
}) {
  const { sections, state, date } = props;
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [optimisticScore, setOptimisticScore] = useOptimistic<number | null>(props.score);
  const [optimisticKind, setOptimisticKind] = useOptimistic<Kind>(props.state.kind);
  // Optimistic entry status: entryId → status, cleared on router.refresh()
  const [optimisticStatus, setOptimisticStatus] = useOptimistic<Record<number, EntryStatus>>({});
  const [optimisticMust, setOptimisticMust] = useOptimistic<Record<number, boolean>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [segmentsOpen, setSegmentsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ personal: true, done: true });

  // live worked time: server snapshot plus minutes elapsed since it was rendered
  const loadedAt = useRef(Date.now());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    loadedAt.current = Date.now();
    setTick(0);
  }, [props.workedAtLoad, state.kind]);
  useEffect(() => {
    if (optimisticKind !== "office" && optimisticKind !== "outside") return;
    const id = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, [optimisticKind]);
  void tick;
  const working = optimisticKind === "office" || optimisticKind === "outside";
  // If user set hours manually, use that; otherwise use segment-based live calculation
  const worked = props.workedOverride !== null
    ? props.workedOverride
    : props.workedAtLoad + (working ? (Date.now() - loadedAt.current) / 60000 : 0);

  const all = SECTION_ORDER.flatMap((k) => sections[k]);
  const selectedRow = all.find((r) => r.id === selected) ?? null;
  const mustCount = sections.must.length + all.filter((r) => r.mustDo && !sections.must.includes(r) && r.status !== "dropped").length;

  function switchTo(kind: Kind) {
    start(async () => {
      setOptimisticKind(kind);
      const r = await switchStateAction(kind);
      if (!r.ok) toast(r.error, "error");
      else router.refresh();
    });
  }

  function quick(row: RowData) {
    const next: EntryStatus = row.type === "ongoing" ? "progressed" : "done";
    start(async () => {
      setOptimisticStatus((prev) => ({ ...prev, [row.id]: next }));
      const r = await setStatusAction(row.id, next);
      if (!r.ok) toast(r.error, "error");
      else router.refresh();
    });
  }

  function toggleMust(row: RowData) {
    const on = !(optimisticMust[row.id] ?? row.mustDo);
    start(async () => {
      setOptimisticMust((prev) => ({ ...prev, [row.id]: on }));
      const r = await toggleMustAction(row.id, on);
      if (!r.ok) toast(r.error, "error");
      else router.refresh();
    });
  }

  const empty = all.length === 0;
  const stateLabel = STATES.find((s) => s.kind === optimisticKind)?.label ?? "Off";

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
    <div className="min-w-0 space-y-5">
      {/* header */}
      <section aria-label="Today">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl leading-none">{props.dateLabel.split(",")[0]}</h1>
            <p className="mt-1 text-sm text-subtle">{props.dateLabel.split(", ").slice(1).join(", ")}</p>
          </div>
          <div className="text-right">
            <button
              type="button"
              onClick={() => setSegmentsOpen(true)}
              className="rounded-xl px-2 py-1 text-right transition-colors hover:bg-muted"
              aria-label="Worked time today. Click to view and edit time segments"
            >
              <span className="block text-[11px] font-medium uppercase tracking-wide text-subtle">
                Worked{props.workedOverride !== null ? " ✎" : ""}
              </span>
              <span className="tabular block text-2xl font-medium leading-tight">{fmtDuration(worked)}</span>
            </button>
            {props.workedOverride !== null ? (
              <button
                type="button"
                className="text-[10px] text-subtle underline-offset-2 hover:underline"
                onClick={() => start(async () => { await setWorkedOverrideAction(date, null); router.refresh(); })}
              >
                reset to auto
              </button>
            ) : null}
          </div>
        </div>

        {/* where you are right now: a compact status bar; ending the day is a separate action, not a place */}
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-1.5 shadow-[var(--shadow-sm)]">
          <span className="flex items-center gap-2 px-2 text-xs text-subtle">
            <span
              className={cn("inline-block h-2 w-2 rounded-full", working ? "bg-good" : optimisticKind === "break" ? "bg-warn" : "bg-subtle/50")}
              style={working ? { animation: "pulse-dot 2s infinite" } : undefined}
              aria-hidden
            />
            <span className="whitespace-nowrap">
              {optimisticKind === "off" ? "Not working" : `${stateLabel} since ${state.sinceLabel}`}
            </span>
          </span>
          <div className="ml-auto flex items-center gap-1" role="group" aria-label="Where are you working">
            {STATES.filter((s) => s.kind !== "off").map(({ kind, label, Icon }) => {
              const on = optimisticKind === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  disabled={pending}
                  aria-pressed={on}
                  onClick={() => switchTo(kind)}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors",
                    on ? "bg-accent text-accent-fg shadow-sm" : "text-fg hover:bg-muted",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{label}</span>
                  <span className="sm:hidden">{label.split(" ")[0] === "At" ? "Office" : label.split(" ")[0] === "Out" ? "Outside" : label}</span>
                </button>
              );
            })}
            {optimisticKind !== "off" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => switchTo("off")}
                className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-semibold text-subtle transition-colors hover:border-bad/40 hover:bg-bad-muted hover:text-bad"
              >
                <Flag className="h-4 w-4" /> End day
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {empty ? (
        <EmptyState
          icon={Sparkles}
          title="A clear day"
          actions={[
            { label: "Add a task", onClick: () => prefillQuickAdd("") },
            { label: "Plan from your lists", onClick: () => router.push("/plan"), primary: false },
          ]}
        >
          Add what matters most today, or pull in tasks you already have on Plan.
        </EmptyState>
      ) : null}

      {SECTION_ORDER.map((key) => {
        const rows = sections[key];
        if (!rows.length) return null;
        const collapsible = key === "personal" || key === "done";
        const isCollapsed = collapsible && collapsed[key];
        return (
          <section key={key} aria-label={SECTION_LABEL[key]}>
            <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-subtle">
              {collapsible ? (
                <button
                  type="button"
                  className="flex items-center gap-1.5"
                  aria-expanded={!isCollapsed}
                  onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
                >
                  <ChevronDown className={cn("h-4 w-4 transition-transform", isCollapsed && "-rotate-90")} />
                  {SECTION_LABEL[key]}
                </button>
              ) : (
                SECTION_LABEL[key]
              )}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-fg">{rows.length}</span>
            </h2>
            {!isCollapsed ? (
              <ul className="space-y-1.5">
                {rows.map((r) => {
                  const optStatus = optimisticStatus[r.id];
                  const optMust = optimisticMust[r.id];
                  const rowWithOpt = {
                    ...r,
                    ...(optStatus ? { status: optStatus } : null),
                    ...(optMust !== undefined ? { mustDo: optMust } : null),
                  };
                  return (
                    <EntryRow
                      key={r.id}
                      row={rowWithOpt}
                      onOpen={() => setSelected(r.id)}
                      onQuickAction={() => quick(r)}
                      onToggleMust={() => toggleMust(r)}
                    />
                  );
                })}
              </ul>
            ) : null}
          </section>
        );
      })}


      {/* targets: after the day's tasks */}
      {props.targets.length > 0 ? (
        <section aria-label="Targets">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">
              <Target className="h-3.5 w-3.5" /> Targets
            </h2>
            <Link href="/goals" className="text-xs text-subtle hover:text-fg underline-offset-2 hover:underline">View all</Link>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {props.targets.map((t) => (
              <Link
                key={t.id}
                href={`/task/${t.id}`}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  t.met
                    ? "bg-good/15 text-good"
                    : t.behind
                    ? "bg-warn/15 text-warn"
                    : "bg-accent/10 text-accent hover:bg-accent/20",
                )}
              >
                {t.met ? "✓ " : t.behind ? "⚠ " : ""}{t.title}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

    </div>

    {/* right rail on wide screens, below the list on phones */}
    <aside className="space-y-4 xl:sticky xl:top-4" aria-label="Your day">
      {props.asideTop}
      <Card className="p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">End of day</h2>
        <p className="mt-2 text-sm font-medium">How was today, out of 10?</p>
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Score">
          {SCORES.map((n) => {
            const on = optimisticScore !== null && Math.floor(optimisticScore) === n;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  start(async () => {
                    const half = optimisticScore !== null && Math.floor(optimisticScore) === n && Number.isInteger(optimisticScore) && n < 10;
                    const next = half ? n + 0.5 : n;
                    setOptimisticScore(next);
                    const r = await setScoreAction(date, next);
                    if (!r.ok) toast(r.error, "error");
                    else router.refresh();
                  })
                }
                className={cn(
                  "h-9 w-9 rounded-xl border text-sm font-medium tabular transition-colors",
                  on ? "border-accent bg-accent text-accent-fg" : "border-border hover:bg-muted",
                )}
              >
                {n}
              </button>
            );
          })}
          {optimisticScore !== null ? (
            <Button size="sm" variant="ghost" onClick={() => start(async () => { setOptimisticScore(null); await setScoreAction(date, null); router.refresh(); })}>
              Clear
            </Button>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-subtle">Tap the same number again for a half point.{optimisticScore !== null ? ` Now ${optimisticScore}.` : ""}</p>
        <div className="mt-4 flex items-baseline justify-between gap-2">
          <label htmlFor="today-steps" className="text-sm font-medium">Steps</label>
          <span className="tabular text-xs text-subtle">
            {props.steps !== null ? `${props.steps.toLocaleString("en-US")} of ` : "goal "}
            {props.stepGoal.toLocaleString("en-US")}
          </span>
        </div>
        {props.steps !== null ? (
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className={cn("h-full rounded-full", props.steps >= props.stepGoal ? "bg-good" : "bg-accent")}
              style={{ width: `${Math.min(100, (props.steps / Math.max(1, props.stepGoal)) * 100)}%` }}
            />
          </div>
        ) : null}
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = new FormData(e.currentTarget).get("steps");
            const n = v === null || v === "" ? null : Math.round(Number(v));
            start(async () => {
              const r = await setStepsAction(date, n);
              if (!r.ok) toast(r.error, "error");
              else {
                toast("Steps saved.");
                router.refresh();
              }
            });
          }}
        >
          <Input id="today-steps" name="steps" type="number" inputMode="numeric" min={0} defaultValue={props.steps ?? ""} key={props.steps ?? "none"} placeholder="e.g. 8000" className="h-10" />
          <Button type="submit" variant="outline" disabled={pending}>Save</Button>
        </form>
      </Card>
      {props.aside}
    </aside>

      <EntrySheet row={selectedRow} onClose={() => setSelected(null)} today={date} voiceEnabled={props.voiceEnabled} projects={props.projects} />
      <SegmentsSheet
        open={segmentsOpen}
        onClose={() => setSegmentsOpen(false)}
        segments={props.segments}
        workedMin={worked}
        workedOverride={props.workedOverride}
        newDefault={props.newSegmentDefault}
        date={date}
      />
    </div>
  );
}
