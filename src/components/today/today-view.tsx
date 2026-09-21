"use client";

import { Building2, ChevronDown, Coffee, Flag, Car } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { setScoreAction, setStatusAction, setStepsAction, setWorkedOverrideAction, switchStateAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import { SECTION_LABEL, SECTION_ORDER, type SectionKey } from "@/lib/sections";
import { fmtDuration, type DateStr } from "@/lib/time";
import type { EntryStatus } from "@/lib/types";
import type { RowData, SegmentData } from "@/lib/view-types";
import { useToast } from "../toast";
import { Button, Card, Empty, Input } from "../ui";
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
}) {
  const { sections, state, date } = props;
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [optimisticScore, setOptimisticScore] = useOptimistic<number | null>(props.score);
  const [optimisticKind, setOptimisticKind] = useOptimistic<Kind>(props.state.kind);
  // Optimistic entry status: entryId → status, cleared on router.refresh()
  const [optimisticStatus, setOptimisticStatus] = useOptimistic<Record<number, EntryStatus>>({});
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

  const empty = all.length === 0;
  const stateLabel = STATES.find((s) => s.kind === optimisticKind)?.label ?? "Off";

  return (
    <div className="space-y-5">
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

        <div className="mt-3 grid grid-cols-4 gap-2" role="group" aria-label="Current state">
          {STATES.map(({ kind, label, Icon }) => {
            const on = optimisticKind === kind;
            return (
              <button
                key={kind}
                type="button"
                disabled={pending}
                aria-pressed={on}
                onClick={() => switchTo(kind)}
                className={cn(
                  "flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl border px-1 text-xs font-medium transition-colors",
                  on ? "border-accent bg-accent text-accent-fg shadow-sm" : "border-border bg-surface text-fg hover:bg-muted",
                )}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 flex items-center gap-2 text-xs text-subtle">
          <span className={cn("inline-block h-2 w-2 rounded-full", working ? "bg-good" : optimisticKind === "break" ? "bg-warn" : "bg-subtle/50")} style={working ? { animation: "pulse-dot 2s infinite" } : undefined} />
          {optimisticKind === "off" ? "Off" : `${stateLabel} since ${state.sinceLabel}`}
          {props.score !== null ? <span className="ml-auto font-medium text-fg">Score {props.score}</span> : null}
        </p>
      </section>

      {/* must-do count hint */}
      {sections.must.length > 0 ? (
        <p className="-mb-2 text-xs text-subtle">
          {sections.must.length} must-do{sections.must.length === 1 ? "" : "s"} open
        </p>
      ) : null}

      {empty ? (
        <Empty>Nothing planned for today. Add a task above, or open Plan to build the day from what is already on your list.</Empty>
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
                  const rowWithOpt = optStatus ? { ...r, status: optStatus } : r;
                  return <EntryRow key={r.id} row={rowWithOpt} onOpen={() => setSelected(r.id)} onQuickAction={() => quick(r)} />;
                })}
              </ul>
            ) : null}
          </section>
        );
      })}

      {/* end of day: score and steps */}
      <Card className="p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">End of day</h2>
        <p className="mt-2 text-sm text-subtle">Score the day out of 10</p>
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
        <form
          className="mt-3 flex items-center gap-2"
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
          <Input name="steps" type="number" inputMode="numeric" min={0} defaultValue={props.steps ?? ""} key={props.steps ?? "none"} placeholder={`Steps (goal ${props.stepGoal.toLocaleString("en-US")})`} className="h-10" aria-label="Steps" />
          <Button type="submit" variant="outline" disabled={pending}>Save</Button>
        </form>
      </Card>

      <EntrySheet row={selectedRow} onClose={() => setSelected(null)} today={date} voiceEnabled={props.voiceEnabled} />
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
