"use client";

import {
  Bell, Briefcase, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Hourglass, Repeat, RotateCw, Target, Video, Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { HUE, type Hue } from "@/lib/hue";
import { CAL_VIEWS, shiftDate, type CalView } from "@/lib/calendar-range";
import type { CalDay, CalEvent, CalTask, CalendarData } from "@/lib/services/calendar";
import { addDays, fmtDuration, parseDateStr, type DateStr } from "@/lib/time";
import { Button, Card, prefillQuickAdd, Sheet } from "../ui";
import { PageHeader } from "../page-header";
import { StatusGlyph } from "../today/entry-row";

const VIEW_LABEL: Record<CalView, string> = { day: "Day", week: "Week", month: "Month", year: "Year", agenda: "Upcoming" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// fixed formatting (not the browser's locale) so the server and the browser always print the same thing
const utc = (d: DateStr) => { const { y, m, d: dd } = parseDateStr(d); return new Date(Date.UTC(y, m - 1, dd)); };
const dayNum = (d: DateStr) => parseDateStr(d).d;
const longDay = (d: DateStr) => `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][utc(d).getUTCDay()]} ${dayNum(d)} ${MONTHS[parseDateStr(d).m - 1]}`;
const shortDay = (d: DateStr) => `${WEEKDAYS[(utc(d).getUTCDay() + 6) % 7]} ${dayNum(d)} ${MONTHS[parseDateStr(d).m - 1].slice(0, 3)}`;

function rangeLabel(view: CalView, date: DateStr, from: DateStr, to: DateStr): string {
  const { y, m } = parseDateStr(date);
  switch (view) {
    case "day": return longDay(date);
    case "week": return `${shortDay(from)} to ${shortDay(to)}`;
    case "month": return `${MONTHS[m - 1]} ${y}`;
    case "year": return String(y);
    case "agenda": return "The next 30 days";
  }
}

/** How a day went, as a pastel: green for a great day down to rose for a rough one. */
function scoreTone(score: number | null): { bg: string; ink: string } {
  if (score === null) return { bg: "", ink: "text-subtle" };
  if (score >= 8) return { bg: "bg-p-mint", ink: "text-p-mint-fg" };
  if (score >= 6) return { bg: "bg-p-sky", ink: "text-p-sky-fg" };
  if (score >= 4) return { bg: "bg-p-butter", ink: "text-p-butter-fg" };
  return { bg: "bg-p-rose", ink: "text-p-rose-fg" };
}

const EVENT_STYLE: Record<CalEvent["kind"], { icon: React.ComponentType<{ className?: string }>; hue: Hue; label: string }> = {
  meeting: { icon: Video, hue: "sky", label: "Meeting" },
  payment: { icon: Wallet, hue: "mint", label: "Payment due" },
  move: { icon: Briefcase, hue: "peach", label: "Sales move" },
  revisit: { icon: RotateCw, hue: "lilac", label: "Revisit" },
  target: { icon: Target, hue: "butter", label: "Target ends" },
  cadence: { icon: Repeat, hue: "teal", label: "Due" },
  waiting: { icon: Hourglass, hue: "pink", label: "Back" },
};

const isEveryDay = (t: CalTask) => t.projected && t.type === "ongoing";

function quickAddFor(date: DateStr): string {
  const { m, d } = parseDateStr(date);
  return `@${d}${MONTHS[m - 1].slice(0, 3).toLowerCase()} `;
}

// ------------------------------------------------------------------ a day, in full

function TaskRow({ t }: { t: CalTask }) {
  const closed = t.status === "done" || t.status === "dropped";
  return (
    <li>
      <Link
        href={`/task/${t.taskId}`}
        className="flex items-center gap-3 rounded-2xl border border-l-[5px] border-border bg-surface px-3 py-2 hover:bg-muted"
        style={{ borderLeftColor: t.color ?? undefined }}
      >
        {t.projected ? <span className="h-6 w-6 shrink-0 rounded-full border-2 border-dashed border-subtle/60" aria-hidden /> : <StatusGlyph status={t.status as never} className="h-6 w-6 shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm font-medium", closed && "text-subtle line-through")}>{t.title}</span>
          <span className="block truncate text-xs text-subtle">
            {[t.time, t.project, t.estimateMin ? `est ${fmtDuration(t.estimateMin)}` : null, t.minutes ? `${fmtDuration(t.minutes)} logged` : null, t.projected ? "from your repeat rule" : null].filter(Boolean).join(" · ")}
          </span>
        </span>
        {t.mustDo ? <span className="text-p-butter-fg" aria-label="Must-do">★</span> : null}
      </Link>
    </li>
  );
}

function EventRow({ e }: { e: CalEvent }) {
  const s = EVENT_STYLE[e.kind];
  const h = HUE[s.hue];
  return (
    <li>
      <Link href={e.href} className={cn("flex items-center gap-3 rounded-2xl px-3 py-2 hover:brightness-95", h.tint, h.ink)}>
        <s.icon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{e.time ? `${e.time} · ` : ""}{e.title}</span>
          <span className="block truncate text-xs opacity-80">{[s.label, e.note].filter(Boolean).join(" · ")}</span>
        </span>
      </Link>
    </li>
  );
}

function DayAgenda({ day, today }: { day: CalDay; today: DateStr }) {
  const isFuture = day.date > today;
  const tone = scoreTone(day.score);
  const every = day.tasks.filter(isEveryDay);
  const tasks = day.tasks.filter((t) => !isEveryDay(t));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {day.score !== null ? <span className={cn("rounded-full px-2.5 py-1 font-semibold", tone.bg, tone.ink)}>Scored {day.score}/10</span> : !isFuture ? <span className="rounded-full bg-muted px-2.5 py-1 text-subtle">Not scored</span> : null}
        {day.workedMin > 0 ? <span className="tabular rounded-full bg-p-teal px-2.5 py-1 font-medium text-p-teal-fg">{fmtDuration(day.workedMin)} worked</span> : null}
        {day.steps ? <span className="tabular rounded-full bg-p-mint px-2.5 py-1 text-p-mint-fg">{day.steps.toLocaleString("en-US")} steps</span> : null}
        {day.sleepMin ? <span className="tabular rounded-full bg-p-lilac px-2.5 py-1 text-p-lilac-fg">{fmtDuration(day.sleepMin)} sleep</span> : null}
        {!isFuture && day.counts.total > 0 ? <span className="tabular rounded-full bg-muted px-2.5 py-1">{day.counts.done} of {day.counts.total} done</span> : null}
      </div>

      {day.eventList.length ? (
        <section aria-label="Events">
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-subtle">Events</h3>
          <ul className="space-y-1.5">{day.eventList.map((e) => <EventRow key={e.key} e={e} />)}</ul>
        </section>
      ) : null}

      <section aria-label="Tasks">
        <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-subtle">{isFuture ? "Planned" : "Tasks"} · {tasks.length}</h3>
        {tasks.length ? <ul className="space-y-1.5">{tasks.map((t) => <TaskRow key={t.key} t={t} />)}</ul> : <p className="rounded-2xl border border-dashed border-border px-3 py-4 text-center text-sm text-subtle">{isFuture ? "Nothing planned for this day yet." : "No tasks were on this day."}</p>}
      </section>

      {every.length ? (
        <p className="rounded-2xl bg-p-teal px-3 py-2 text-xs text-p-teal-fg">
          <b>Every working day:</b> {every.map((t) => t.title).join(", ")}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button size="sm" variant="primary" onClick={() => prefillQuickAdd(quickAddFor(day.date))}><CalendarPlus className="h-4 w-4" /> Add a task to this day</Button>
        <Link href={`/plan?date=${day.date}`} className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-surface px-3 text-xs font-semibold hover:bg-muted">Plan this day</Link>
        {day.date === today ? <Link href="/today" className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-surface px-3 text-xs font-semibold hover:bg-muted">Open Today</Link> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ month

function MonthGrid({ data, onPick }: { data: CalendarData; onPick: (d: DateStr) => void }) {
  const month = parseDateStr(data.date).m;
  return (
    <Card className="overflow-hidden p-2 sm:p-3">
      <div className="grid grid-cols-7 gap-1 pb-1 text-center text-xs font-bold uppercase tracking-wider text-subtle sm:gap-1.5">
        {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {data.days.map((d) => {
          const other = parseDateStr(d.date).m !== month;
          const past = d.date < data.today;
          const tone = past ? scoreTone(d.score) : { bg: "", ink: "" };
          const isToday = d.date === data.today;
          const chips = d.tasks.filter((t) => !isEveryDay(t));
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => onPick(d.date)}
              aria-label={`${longDay(d.date)}: ${d.counts.total + d.counts.projected} tasks${d.events ? `, ${d.events} events` : ""}`}
              className={cn(
                "group flex min-h-[3.6rem] flex-col rounded-xl border p-1 text-left transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] sm:min-h-[6.6rem] sm:rounded-2xl sm:p-1.5",
                tone.bg || "bg-surface", isToday ? "border-2 border-[hsl(var(--accent-fill))] ring-2 ring-[hsl(var(--lilac-fill))]" : "border-border", other && "opacity-45",
              )}
            >
              <span className="flex items-start justify-between">
                <span className={cn("tabular flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-bold", isToday ? "bg-accent text-accent-fg" : "")}>{dayNum(d.date)}</span>
                {past && d.score !== null ? <span className={cn("tabular hidden rounded-full bg-surface/70 px-1.5 text-[10px] font-bold sm:inline", tone.ink)}>{d.score}</span> : null}
              </span>
              {/* phone: dots. desktop: the first few tasks */}
              <span className="mt-auto flex flex-wrap gap-0.5 sm:hidden">
                {chips.slice(0, 4).map((t) => <span key={t.key} className={cn("h-1.5 w-1.5 rounded-full", t.status === "done" ? "bg-good" : t.projected ? "bg-subtle/40" : "bg-accent")} />)}
                {d.events ? <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--peach-fill))]" /> : null}
              </span>
              <span className="mt-1 hidden min-w-0 flex-1 flex-col gap-0.5 sm:flex">
                {chips.slice(0, 3).map((t) => (
                  <span key={t.key} className="flex items-center gap-1 truncate rounded-md bg-surface/80 px-1 py-0.5 text-xs leading-tight">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: t.color ?? "hsl(var(--accent-fill))" }} />
                    <span className={cn("truncate", (t.status === "done" || t.status === "dropped") && "text-subtle line-through", t.projected && "italic text-subtle")}>{t.title}</span>
                  </span>
                ))}
                {chips.length > 3 ? <span className="px-1 text-xs font-medium text-subtle">+{chips.length - 3} more</span> : null}
                {d.eventList.slice(0, 2).map((e) => {
                  const s = EVENT_STYLE[e.kind];
                  return <span key={e.key} className={cn("flex items-center gap-1 truncate rounded-md px-1 py-0.5 text-xs leading-tight", HUE[s.hue].tint, HUE[s.hue].ink)}><s.icon className="h-3 w-3 shrink-0" /><span className="truncate">{e.title}</span></span>;
                })}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ week

function WeekGrid({ data, onPick }: { data: CalendarData; onPick: (d: DateStr) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-7">
      {data.days.map((d) => {
        const past = d.date < data.today;
        const tone = past ? scoreTone(d.score) : { bg: "", ink: "" };
        const isToday = d.date === data.today;
        const tasks = d.tasks.filter((t) => !isEveryDay(t));
        return (
          <section key={d.date} className={cn("min-w-0 rounded-3xl border p-2.5", tone.bg || "bg-surface", isToday ? "border-2 border-[hsl(var(--accent-fill))] ring-2 ring-[hsl(var(--lilac-fill))]" : "border-border")}>
            <button type="button" onClick={() => onPick(d.date)} className="mb-2 flex w-full items-center justify-between text-left">
              <span><span className="block text-xs font-bold uppercase tracking-wider text-subtle">{WEEKDAYS[(utc(d.date).getUTCDay() + 6) % 7]}</span><span className={cn("font-display text-xl", isToday && "text-accent")}>{dayNum(d.date)}</span></span>
              {past && d.score !== null ? <span className={cn("tabular rounded-full bg-surface/80 px-2 py-0.5 text-xs font-bold", tone.ink)}>{d.score}/10</span> : null}
            </button>
            <ul className="space-y-1">
              {d.eventList.map((e) => {
                const s = EVENT_STYLE[e.kind];
                return <li key={e.key}><Link href={e.href} className={cn("flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-medium", HUE[s.hue].tint, HUE[s.hue].ink)}><s.icon className="h-3 w-3 shrink-0" /><span className="truncate">{e.time ? `${e.time} ` : ""}{e.title}</span></Link></li>;
              })}
              {tasks.map((t) => (
                <li key={t.key}>
                  <Link href={`/task/${t.taskId}`} className="flex items-center gap-1.5 rounded-lg bg-surface/85 px-1.5 py-1 text-xs hover:bg-surface" style={{ borderLeft: `3px solid ${t.color ?? "hsl(var(--accent-fill))"}` }}>
                    <span className={cn("min-w-0 flex-1 truncate", (t.status === "done" || t.status === "dropped") && "text-subtle line-through", t.projected && "italic text-subtle")}>{t.time ? `${t.time} ` : ""}{t.title}</span>
                    {t.mustDo ? <span className="text-p-butter-fg">★</span> : null}
                  </Link>
                </li>
              ))}
              {!tasks.length && !d.eventList.length ? <li className="px-1 py-2 text-xs text-subtle">Nothing</li> : null}
            </ul>
            {d.workedMin > 0 ? <p className="tabular mt-2 text-xs text-subtle">{fmtDuration(d.workedMin)} worked</p> : null}
          </section>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ year

function YearGrid({ data, onMonth, onDay }: { data: CalendarData; onMonth: (d: DateStr) => void; onDay: (d: DateStr) => void }) {
  const year = parseDateStr(data.date).y;
  const byDate = new Map(data.days.map((d) => [d.date, d]));
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {MONTHS.map((name, i) => {
        const first = `${year}-${String(i + 1).padStart(2, "0")}-01` as DateStr;
        const lead = (utc(first).getUTCDay() + 6) % 7;
        const count = new Date(Date.UTC(year, i + 1, 0)).getUTCDate();
        return (
          <Card key={name} className="p-3">
            <button type="button" onClick={() => onMonth(first)} className="font-display mb-2 text-base hover:underline">{name}</button>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: lead }).map((_, k) => <span key={`l${k}`} />)}
              {Array.from({ length: count }).map((_, k) => {
                const date = `${year}-${String(i + 1).padStart(2, "0")}-${String(k + 1).padStart(2, "0")}` as DateStr;
                const d = byDate.get(date);
                const past = date <= data.today;
                const t = past ? scoreTone(d?.score ?? null) : { bg: "", ink: "" };
                const busy = !past && d && (d.counts.total > 0 || d.events > 0);
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => onDay(date)}
                    aria-label={`${longDay(date)}${d?.score != null ? `, scored ${d.score}` : ""}`}
                    className={cn(
                      "tabular aspect-square rounded-md text-[10px] font-medium leading-none transition-transform hover:scale-110",
                      t.bg || (busy ? "bg-p-lilac text-p-lilac-fg" : "bg-muted text-subtle"), t.ink, date === data.today && "ring-2 ring-[hsl(var(--accent-fill))]",
                    )}
                  >
                    {k + 1}
                  </button>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ the next 30 days

function Agenda({ data }: { data: CalendarData }) {
  // a rule that fires every few days would fill the list with the same line: say it once at the top instead
  const isRule = (t: CalTask) => t.projected && (t.type === "recurring" || t.type === "ongoing");
  const busy = data.days.filter((d) => d.tasks.some((t) => !isRule(t)) || d.eventList.length);
  const rules = new Map<string, number>();
  for (const d of data.days) for (const t of d.tasks.filter(isRule)) rules.set(t.title, (rules.get(t.title) ?? 0) + 1);
  const label = (d: DateStr) => (d === data.today ? "Today" : d === addDays(data.today, 1) ? "Tomorrow" : shortDay(d));
  return (
    <div className="space-y-4">
      {rules.size ? (
        <p className="rounded-3xl bg-p-teal px-4 py-3 text-sm text-p-teal-fg">
          <b>Repeating:</b> {[...rules].map(([title, n]) => `${title} (${n}×)`).join(", ")}. These come on their own, so they are not listed day by day.
        </p>
      ) : null}
      {busy.length === 0 ? <Card className="p-8 text-center text-sm text-subtle">Nothing else is planned or scheduled for the next 30 days.</Card> : null}
      {busy.map((d) => (
        <section key={d.date} aria-label={label(d.date)} className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <h3 className={cn("font-display pt-2 text-lg", d.date === data.today && "text-accent")}>{label(d.date)}<span className="block text-xs font-normal text-subtle">{d.date === data.today || d.date === addDays(data.today, 1) ? shortDay(d.date) : ""}</span></h3>
          <ul className="space-y-1.5">
            {d.eventList.map((e) => <EventRow key={e.key} e={e} />)}
            {d.tasks.filter((t) => !isRule(t)).map((t) => <TaskRow key={t.key} t={t} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ the page

export function CalendarView({ data }: { data: CalendarData }) {
  const router = useRouter();
  const [picked, setPicked] = useState<DateStr | null>(null);
  const go = (view: CalView, date: DateStr) => router.push(`/calendar?view=${view}&date=${date}`);
  const s = data.summary;
  const day = picked ? data.days.find((d) => d.date === picked) ?? null : null;
  const pastRange = data.from <= data.today;
  const donePct = s.planned ? Math.round((s.done / s.planned) * 100) : null;
  const scoreBand = scoreTone(s.avgScore);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        icon={CalendarDays}
        hue="lilac"
        title="Calendar"
        subtitle="How your days went, and what is coming. Tap any day to open it."
        actions={
          <Button variant="primary" size="sm" onClick={() => prefillQuickAdd("")}><CalendarPlus className="h-4 w-4" /> Add a task</Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Previous" onClick={() => go(data.view, shiftDate(data.view, data.date, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" aria-label="Next" onClick={() => go(data.view, shiftDate(data.view, data.date, 1))}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => go(data.view, data.today)}>Today</Button>
        </div>
        <h2 className="font-display min-w-0 flex-1 truncate text-xl sm:text-2xl">{rangeLabel(data.view, data.date, data.from, data.to)}</h2>
        <div role="tablist" aria-label="View" className="flex overflow-x-auto rounded-full border border-border bg-surface p-1">
          {CAL_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={data.view === v}
              onClick={() => go(v, data.view === "agenda" || v === "agenda" ? data.today : data.date)}
              className={cn("shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors", data.view === v ? "bg-[linear-gradient(135deg,hsl(var(--accent-fill)),hsl(var(--lilac-fill)))] text-accent-fg" : "text-subtle hover:text-fg")}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      {data.view !== "agenda" && pastRange && s.days > 0 ? (
        <section aria-label="Performance" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className={cn("rounded-3xl border border-border p-3", scoreBand.bg || "bg-surface")}>
            <p className="text-xs font-bold uppercase tracking-wider text-subtle">Average score</p>
            <p className={cn("font-display text-2xl tabular", scoreBand.ink)}>{s.avgScore ?? "–"}<span className="text-sm font-normal text-subtle">{s.avgScore !== null ? " / 10" : ""}</span></p>
            <p className="text-xs text-subtle">{s.scoredDays} of {s.days} days scored</p>
          </div>
          <div className="rounded-3xl border border-border bg-p-mint p-3 text-p-mint-fg">
            <p className="text-xs font-bold uppercase tracking-wider">Tasks done</p>
            <p className="font-display text-2xl tabular">{s.done}<span className="text-sm font-normal opacity-80"> of {s.planned}</span></p>
            <p className="text-xs opacity-80">{donePct !== null ? `${donePct}% of what you planned` : "nothing planned"}</p>
          </div>
          <div className="rounded-3xl border border-border bg-p-teal p-3 text-p-teal-fg">
            <p className="text-xs font-bold uppercase tracking-wider">Time worked</p>
            <p className="font-display text-2xl tabular">{fmtDuration(s.workedMin)}</p>
            <p className="text-xs opacity-80">{s.days > 0 ? `${fmtDuration(Math.round(s.workedMin / s.days))} a day` : ""}</p>
          </div>
          <div className="rounded-3xl border border-border bg-p-butter p-3 text-p-butter-fg">
            <p className="text-xs font-bold uppercase tracking-wider">Best day</p>
            <p className="font-display text-2xl tabular">{s.best ? `${s.best.score}/10` : "–"}</p>
            <p className="text-xs opacity-80">{s.best ? shortDay(s.best.date) : "score a day to see it"}</p>
          </div>
        </section>
      ) : null}

      {data.view === "month" ? <MonthGrid data={data} onPick={setPicked} /> : null}
      {data.view === "week" ? <WeekGrid data={data} onPick={(d) => go("day", d)} /> : null}
      {data.view === "year" ? <YearGrid data={data} onMonth={(d) => go("month", d)} onDay={(d) => go("day", d)} /> : null}
      {data.view === "agenda" ? <Agenda data={data} /> : null}
      {data.view === "day" && data.days[0] ? <Card className="p-4"><DayAgenda day={data.days[0]} today={data.today} /></Card> : null}

      {data.view === "month" || data.view === "week" ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-p-mint" /> great day</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-p-sky" /> good</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-p-butter" /> so-so</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-p-rose" /> rough</span>
          <span className="flex items-center gap-1.5"><span className="italic">italic</span> = from a repeat rule, not saved yet</span>
          <span className="flex items-center gap-1.5"><Bell className="h-3 w-3" /> events: meetings, payments, sales moves, revisits, targets</span>
        </p>
      ) : null}

      <Sheet open={!!day} onOpenChange={(o) => !o && setPicked(null)} title={day ? longDay(day.date) : ""} description={day?.date === data.today ? "Today" : day && day.date > data.today ? "Coming up" : "Looking back"} wide>
        {day ? (
          <div className="space-y-3">
            <DayAgenda day={day} today={data.today} />
            <div className="flex justify-between border-t border-border pt-3 text-xs">
              <button type="button" className="font-semibold text-subtle hover:text-fg" onClick={() => setPicked(addDays(day.date, -1) >= data.from ? addDays(day.date, -1) : null)}>← Previous day</button>
              <button type="button" className="font-semibold text-accent hover:underline" onClick={() => go("day", day.date)}>Open as a full day</button>
              <button type="button" className="font-semibold text-subtle hover:text-fg" onClick={() => setPicked(addDays(day.date, 1) <= data.to ? addDays(day.date, 1) : null)}>Next day →</button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
