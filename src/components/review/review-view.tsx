"use client";

import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Check, ChevronLeft, ChevronRight, Compass, Loader2, Minus, Pencil, Plus,
  RefreshCw, Repeat, Sparkles, Target, Trophy, X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { generateReviewAction, markIntentionAction, setIntentionsAction } from "@/app/review-actions";
import { cn } from "@/lib/cn";
import { ratingTone } from "@/lib/rating-tone";
import type { Intention, Metrics, ReviewData } from "@/lib/services/review";
import { fmtDateShort, weekdayName, type DateStr } from "@/lib/time";
import { TimeGoalsCard } from "../goals/time-goals-card";
import { useToast } from "../toast";
import { Button, Card } from "../ui";

// ------------------------------------------------------------------ scorecard

interface MetricDef {
  label: string;
  get: (m: Metrics) => number | null;
  fmt: (v: number) => string;
  /** higher is better (true), lower is better (false), or neither (null) */
  up: boolean | null;
  digits: number;
  /** unit for the change: "pt" for percentages, "h" for hours */
  delta?: string;
}

const pct = (v: number | null) => (v === null ? null : v * 100);
const METRICS: MetricDef[] = [
  { label: "Day score", get: (m) => m.avgScore, fmt: (v) => v.toFixed(1), up: true, digits: 1 },
  { label: "AI day rating", get: (m) => m.avgDiaryRating, fmt: (v) => v.toFixed(1), up: true, digits: 1 },
  { label: "Hours / day", get: (m) => m.avgWorkedHours, fmt: (v) => `${v.toFixed(1)}h`, up: null, digits: 1, delta: "h" },
  { label: "Tasks done", get: (m) => m.tasksDone, fmt: (v) => String(Math.round(v)), up: true, digits: 0 },
  { label: "Must-do hit", get: (m) => pct(m.mustDoHitRate), fmt: (v) => `${Math.round(v)}%`, up: true, digits: 0, delta: " pts" },
  { label: "Completion", get: (m) => pct(m.completionRate), fmt: (v) => `${Math.round(v)}%`, up: true, digits: 0, delta: " pts" },
  { label: "Unaccounted", get: (m) => m.unaccountedPct, fmt: (v) => `${Math.round(v)}%`, up: false, digits: 0, delta: " pts" },
  { label: "Sleep", get: (m) => m.avgSleepH, fmt: (v) => `${v.toFixed(1)}h`, up: true, digits: 1, delta: "h" },
  { label: "Steps / day", get: (m) => m.avgSteps, fmt: (v) => Math.round(v).toLocaleString("en-US"), up: true, digits: 0 },
  { label: "Exercise sets", get: (m) => m.exerciseSets, fmt: (v) => String(Math.round(v)), up: true, digits: 0 },
];

function Change({ cur, ref, def, vs }: { cur: number | null; ref: number | null; def: MetricDef; vs: string }) {
  if (cur === null || ref === null) return <span className="text-[10px] text-subtle/70">no {vs} data</span>;
  const d = cur - ref;
  const tiny = Math.abs(d) < Math.pow(10, -def.digits) / 2;
  const good = def.up === null || tiny ? null : def.up ? d > 0 : d < 0;
  const Icon = tiny ? Minus : d > 0 ? ArrowUpRight : ArrowDownRight;
  const mag = def.digits === 0 ? Math.round(Math.abs(d)).toLocaleString("en-US") : Math.abs(d).toFixed(def.digits);
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-semibold", good === null ? "text-subtle" : good ? "text-good" : "text-bad")}>
      <Icon className="h-3 w-3" />
      {tiny ? "same" : `${mag}${def.delta ?? ""}`} <span className="font-normal text-subtle">vs {vs}</span>
    </span>
  );
}

function Scorecard({ data }: { data: ReviewData }) {
  const unit = data.period;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {METRICS.map((def) => {
        const cur = def.get(data.current);
        return (
          <div key={def.label} className="rounded-2xl border border-border bg-surface px-4 py-3 shadow-[var(--shadow-sm)]">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{def.label}</p>
            <p className="tabular font-display text-2xl leading-tight">{cur === null ? "–" : def.fmt(cur)}</p>
            <div className="mt-1 flex flex-col gap-0.5">
              <Change cur={cur} ref={def.get(data.previous)} def={def} vs={`last ${unit}`} />
              <Change cur={cur} ref={def.get(data.baseline)} def={def} vs="4-avg" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ AI review

function ReviewList({ icon: Icon, title, items, tone }: { icon: typeof Trophy; title: string; items: string[]; tone: string }) {
  if (!items.length) return null;
  return (
    <div>
      <p className={cn("mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide", tone)}>
        <Icon className="h-3.5 w-3.5" /> {title}
      </p>
      <ul className="space-y-1.5 text-sm">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-current opacity-50" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AiReview({ data, aiEnabled, onUseDecisions }: { data: ReviewData; aiEnabled: boolean; onUseDecisions: (d: string[]) => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const r = data.review?.generated_at ? data.review : null;
  const noun = data.period === "week" ? "week" : "month";

  async function generate() {
    setBusy(true);
    const res = await generateReviewAction(data.period, data.start);
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    toast("Review written.");
    router.refresh();
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
          <Sparkles className="h-3.5 w-3.5 text-accent" /> {data.inProgress ? `The ${noun} so far` : `Your ${noun} in review`}
        </p>
        {aiEnabled ? (
          <Button size="sm" variant={r ? "ghost" : "primary"} onClick={generate} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : r ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
            {busy ? "Writing…" : r ? "Refresh" : `Review this ${noun}`}
          </Button>
        ) : null}
      </div>

      {busy && !r ? (
        <div className="space-y-3" aria-busy>
          <div className="h-16 animate-pulse rounded-2xl bg-muted" />
          <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
          <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
        </div>
      ) : r ? (
        <div className="space-y-5">
          <div className="flex items-start gap-4">
            <div className={cn("flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl", ratingTone(r.grade))}>
              <span className="tabular text-2xl font-bold leading-none">{r.grade ?? "–"}</span>
              <span className="text-[9px] font-semibold uppercase opacity-80">grade</span>
            </div>
            <div className="min-w-0">
              <p className="font-display text-xl leading-snug">{r.headline}</p>
              <p className="mt-2 text-sm leading-relaxed text-fg/90">{r.narrative}</p>
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            <ReviewList icon={Trophy} title="Wins" items={r.wins} tone="text-good" />
            <ReviewList icon={Repeat} title="Patterns" items={r.patterns} tone="text-warn" />
            <ReviewList icon={Compass} title="What drove good days" items={r.drivers} tone="text-accent" />
          </div>
          {r.decisions.length ? (
            <div className="rounded-xl bg-hl/60 p-4">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
                <Target className="h-3.5 w-3.5" /> Decisions for next {noun}
              </p>
              <ol className="space-y-1.5 text-sm">
                {r.decisions.map((d, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="tabular flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface text-[11px] font-bold text-accent">{i + 1}</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ol>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => onUseDecisions(r.decisions)}>
                <ArrowRight className="h-3.5 w-3.5" /> Make these next {noun}&apos;s intentions
              </Button>
            </div>
          ) : null}
          {r.model ? <p className="text-[11px] text-subtle">Written by {r.model.replace(/:free$/, "")} from your numbers and daily diary summaries.</p> : null}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Sparkles className="h-8 w-8 text-accent/40" />
          <p className="text-sm font-medium">{data.inProgress ? `How is the ${noun} going?` : `No review for this ${noun} yet`}</p>
          <p className="max-w-md text-xs text-subtle">
            {aiEnabled
              ? `The AI reads your numbers and every day's diary summary, then writes what went well, what keeps repeating, and three decisions for next ${noun}. Reviews are written automatically every Monday and on the 1st.`
              : "AI reviews need OPENROUTER_API_KEY in the environment."}
          </p>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ intentions

function IntentionsEditor({ initial, onSave, onCancel }: { initial: string[]; onSave: (items: string[]) => void; onCancel: () => void }) {
  const [items, setItems] = useState<string[]>(initial.length ? initial : [""]);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(items.map((t) => t.trim()).filter(Boolean));
      }}
    >
      {items.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="tabular w-4 shrink-0 text-right text-xs font-semibold text-subtle">{i + 1}</span>
          <input
            value={t}
            autoFocus={i === items.length - 1}
            onChange={(e) => setItems((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder={i === 0 ? "e.g. Deep work on Aivaura before noon, 4 days" : "Another intention"}
            aria-label={`Intention ${i + 1}`}
            maxLength={200}
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
          />
          <button type="button" aria-label="Remove" onClick={() => setItems((l) => (l.length > 1 ? l.filter((_, j) => j !== i) : [""]))} className="rounded-md p-1 text-subtle hover:bg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1">
        {items.length < 5 ? (
          <button type="button" onClick={() => setItems((l) => [...l, ""])} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            <Plus className="h-3.5 w-3.5" /> Add one
          </button>
        ) : <span />}
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" variant="primary" type="submit">Save</Button>
        </div>
      </div>
    </form>
  );
}

function IntentionRow({ it, onMark }: { it: Intention; onMark: (done: boolean | null) => void }) {
  return (
    <li className="flex items-start gap-2.5">
      <div className="flex shrink-0 gap-1 pt-0.5">
        <button
          type="button"
          aria-label="Mark done"
          aria-pressed={it.done === true}
          onClick={() => onMark(it.done === true ? null : true)}
          className={cn("flex h-6 w-6 items-center justify-center rounded-lg border transition-colors", it.done === true ? "border-good bg-good text-white" : "border-border text-subtle hover:border-good hover:text-good")}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Mark not done"
          aria-pressed={it.done === false}
          onClick={() => onMark(it.done === false ? null : false)}
          className={cn("flex h-6 w-6 items-center justify-center rounded-lg border transition-colors", it.done === false ? "border-bad bg-bad text-white" : "border-border text-subtle hover:border-bad hover:text-bad")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <span className={cn("pt-0.5 text-sm", it.done === true && "text-subtle line-through decoration-good/60", it.done === false && "text-subtle")}>{it.text}</span>
    </li>
  );
}

function IntentionsCard({
  title, subtitle, period, start, items, markable, editing, setEditing, seed,
}: {
  title: string;
  subtitle: string;
  period: ReviewData["period"];
  start: DateStr;
  items: Intention[];
  markable: boolean;
  editing: boolean;
  setEditing: (v: boolean) => void;
  seed?: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start_] = useTransition();
  const done = items.filter((i) => i.done === true).length;

  function save(texts: string[]) {
    start_(async () => {
      const keep = texts.map((t) => items.find((i) => i.text === t) ?? { text: t, done: null });
      const r = await setIntentionsAction(period, start, keep);
      if (!r.ok) return toast(r.error, "error");
      setEditing(false);
      router.refresh();
    });
  }
  function mark(i: number, v: boolean | null) {
    start_(async () => {
      const r = await markIntentionAction(period, start, i, v);
      if (!r.ok) toast(r.error, "error");
      else router.refresh();
    });
  }

  return (
    <Card className={cn("p-4", pending && "opacity-70")}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-subtle">{subtitle}</p>
        </div>
        {markable && items.length ? <span className="tabular rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-subtle">{done}/{items.length} done</span> : null}
        {!editing && items.length ? (
          <button type="button" onClick={() => setEditing(true)} aria-label="Edit intentions" className="rounded-md p-1 text-subtle hover:bg-muted hover:text-fg">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {editing ? (
        <IntentionsEditor initial={seed ?? items.map((i) => i.text)} onSave={save} onCancel={() => setEditing(false)} />
      ) : items.length ? (
        <ul className="space-y-2.5">
          {items.map((it, i) =>
            markable ? (
              <IntentionRow key={i} it={it} onMark={(v) => mark(i, v)} />
            ) : (
              <li key={i} className="flex gap-2 text-sm">
                <span className="tabular flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-muted text-[11px] font-bold text-accent">{i + 1}</span>
                {it.text}
              </li>
            ),
          )}
        </ul>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-4 py-4 text-sm font-medium text-accent transition-colors hover:border-accent/50 hover:bg-accent-muted/40"
        >
          <Plus className="h-4 w-4" /> Set up to 5 intentions
        </button>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ day strip

function DayStrip({ data, today }: { data: ReviewData; today: DateStr }) {
  const cols = data.period === "week" ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7" : "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7";
  return (
    <div className={cn("grid gap-2", cols)}>
      {data.days.map((d) => (
        <Link
          key={d.date}
          href={d.date === today ? "/diary" : `/diary?date=${d.date}`}
          className="group flex min-h-[112px] flex-col rounded-xl border border-border bg-surface p-3 transition-all hover:border-accent/40 hover:shadow-[var(--shadow-md)]"
        >
          <div className="flex items-baseline justify-between gap-1">
            <span className="text-[11px] font-semibold uppercase text-subtle">{weekdayName(d.date).slice(0, 3)}</span>
            <span className="tabular text-[11px] text-subtle">{fmtDateShort(d.date)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="tabular text-lg font-bold leading-none" title="Your score">{d.score ?? "–"}</span>
            {d.rating !== null ? <span className={cn("tabular rounded-md px-1.5 py-0.5 text-[10px] font-bold", ratingTone(d.rating))} title="AI day rating">AI {d.rating}</span> : null}
          </div>
          <p className="tabular mt-1 text-[11px] text-subtle">
            {d.workedH ? `${d.workedH}h work` : "no work"}{d.sleepH !== null ? ` · ${d.sleepH}h sleep` : ""}
          </p>
          {d.headline ? <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-fg/80 group-hover:text-fg">{d.headline}</p> : null}
        </Link>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ page

export function ReviewView({
  data, label, isCurrent, prevStart, nextStart, nextLabel, nextIntentions, lastReview, aiEnabled, today,
}: {
  data: ReviewData;
  label: string;
  isCurrent: boolean;
  prevStart: DateStr;
  nextStart: DateStr | null;
  nextLabel: string;
  nextIntentions: Intention[];
  lastReview: { start: DateStr; label: string; headline: string; grade: number | null } | null;
  aiEnabled: boolean;
  today: DateStr;
}) {
  const noun = data.period;
  const [editingThis, setEditingThis] = useState(false);
  const [editingNext, setEditingNext] = useState(false);
  const [seed, setSeed] = useState<string[] | undefined>(undefined);
  const href = (p: string, d?: string) => `/review?p=${p}${d ? `&d=${d}` : ""}`;
  const dayNo = data.days.length;
  const totalDays = data.period === "week" ? 7 : Number(data.end.slice(8));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-subtle">{noun === "week" ? "Weekly review" : "Monthly review"}</p>
          <h1 className="font-display text-2xl">{isCurrent ? (noun === "week" ? "This week" : "This month") : label}</h1>
          <p className="text-sm text-subtle">
            {isCurrent ? `${label} · day ${dayNo} of ${totalDays}` : label}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex h-9 rounded-xl bg-muted p-0.5" role="group" aria-label="Period">
            {(["week", "month"] as const).map((p) => (
              <Link
                key={p}
                href={href(p)}
                aria-current={noun === p ? "page" : undefined}
                className={cn("flex items-center rounded-[10px] px-3 text-xs font-semibold capitalize", noun === p ? "bg-surface text-fg shadow-sm" : "text-subtle hover:text-fg")}
              >
                {p}
              </Link>
            ))}
          </div>
          <Link href={href(noun, prevStart)} aria-label={`Previous ${noun}`} className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-subtle hover:bg-muted hover:text-fg">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          {!isCurrent ? (
            <Link href={href(noun)} className="flex h-9 items-center rounded-xl border border-border bg-surface px-3 text-sm font-medium hover:bg-muted">
              {noun === "week" ? "This week" : "This month"}
            </Link>
          ) : null}
          {nextStart ? (
            <Link href={href(noun, nextStart)} aria-label={`Next ${noun}`} className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-subtle hover:bg-muted hover:text-fg">
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : null}
        </div>
      </div>

      {lastReview ? (
        <Link
          href={href(noun, lastReview.start)}
          className="flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent-muted/50 px-4 py-3 transition-colors hover:bg-accent-muted"
        >
          <span className={cn("tabular rounded-lg px-2 py-1 text-sm font-bold", ratingTone(lastReview.grade))}>{lastReview.grade ?? "–"}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-subtle">Last {noun}&apos;s review · {lastReview.label}</span>
            <span className="block truncate text-sm font-medium">{lastReview.headline}</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-accent" />
        </Link>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AiReview
            data={data}
            aiEnabled={aiEnabled}
            onUseDecisions={(d) => {
              setSeed(d);
              setEditingNext(true);
              document.getElementById("next-intentions")?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          />
        </div>
        <div className="space-y-4">
          <IntentionsCard
            title={`Intentions for ${isCurrent ? `this ${noun}` : label}`}
            subtitle={data.inProgress ? "Tick them off as you go." : "Did you do what you said?"}
            period={noun}
            start={data.start}
            items={data.review?.intentions ?? []}
            markable
            editing={editingThis}
            setEditing={setEditingThis}
          />
          <div id="next-intentions">
            <IntentionsCard
              title={`Next ${noun}`}
              subtitle={`${nextLabel} · what will you focus on?`}
              period={noun}
              start={data.period === "week" ? addWeek(data.start) : addMonth(data.start)}
              items={nextIntentions}
              markable={false}
              editing={editingNext}
              setEditing={(v) => {
                setEditingNext(v);
                if (!v) setSeed(undefined);
              }}
              seed={seed}
            />
          </div>
        </div>
      </div>

      <section className="space-y-3" aria-label="Numbers">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Numbers {data.inProgress ? "so far" : ""} <span className="font-normal normal-case tracking-normal">· compared over the same number of days</span>
        </h2>
        <Scorecard data={data} />
      </section>

      <TimeGoalsCard report={data.goals} title={`Time goals · ${isCurrent ? `this ${noun}` : label}`} />

      <section className="space-y-3" aria-label="Day by day">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">Day by day</h2>
        <DayStrip data={data} today={today} />
      </section>
    </div>
  );
}

function addWeek(start: DateStr): DateStr {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}
function addMonth(start: DateStr): DateStr {
  const [y, m] = start.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
