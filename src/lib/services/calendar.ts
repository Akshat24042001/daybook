/**
 * Everything the Calendar shows, read-only: what you did and scored on past days, what is on each coming day (saved
 * entries plus what your repeating rules will put there), and the events that matter (meetings, payments due, sales
 * moves, deal revisit dates, targets ending, repeating tasks coming due). Looking at a calendar never changes anything.
 */
import { q } from "../db";
import { rruleMatches } from "../recurrence";
import { dueFor } from "../sections";
import { isWorkingDay, type Ctx } from "../settings";
import type { TaskType } from "../parser";
import { addDays, dateRange, fmtHM, logicalDate, periodEnd, type DateStr, type TargetPeriod } from "../time";
import { rangeFor, type CalView } from "../calendar-range";
export { CAL_VIEWS, rangeFor, shiftDate, type CalView } from "../calendar-range";
import type { EntryStatus, EntryView, TaskRow } from "../types";
import { VIEW_SELECT } from "./entries";
import { namesItsDays } from "./plan";
import { workedByDay } from "./stats";

export interface CalTask {
  key: string;
  entryId: number | null;
  taskId: number;
  title: string;
  status: EntryStatus | "planned";
  mustDo: boolean;
  type: TaskType;
  project: string | null;
  color: string | null;
  time: string | null;
  estimateMin: number | null;
  minutes: number;
  /** not saved yet: your repeating rules will put it here */
  projected: boolean;
  carry: number;
}
export interface CalEvent {
  key: string;
  kind: "meeting" | "payment" | "move" | "revisit" | "target" | "cadence" | "waiting";
  title: string;
  time: string | null;
  href: string;
  note?: string;
}
export interface CalDay {
  date: DateStr;
  score: number | null;
  steps: number | null;
  sleepMin: number | null;
  workedMin: number;
  counts: { total: number; done: number; open: number; skipped: number; projected: number };
  events: number;
  tasks: CalTask[];
  eventList: CalEvent[];
}
export interface CalSummary {
  /** past days only */
  days: number;
  scoredDays: number;
  avgScore: number | null;
  done: number;
  planned: number;
  workedMin: number;
  best: { date: DateStr; score: number } | null;
}
export interface CalendarData {
  view: CalView;
  date: DateStr;
  from: DateStr;
  to: DateStr;
  today: DateStr;
  days: CalDay[];
  summary: CalSummary;
}

// ------------------------------------------------------------------ building the days

const hm = (d: Date | null, ctx: Ctx) => (d ? fmtHM(d, ctx.tz) : null);

function toCalTask(e: EntryView, ctx: Ctx): CalTask {
  return {
    key: `e${e.id}`, entryId: e.id, taskId: e.task_id, title: e.title, status: e.status, mustDo: e.must_do, type: e.type, project: e.project_name,
    color: e.project_color, time: hm(dueFor(e, ctx.tz, ctx.boundaryMin), ctx), estimateMin: e.estimate_min, minutes: e.minutes_today, projected: false, carry: e.carry_count,
  };
}

export async function calendarData(ctx: Ctx, view: CalView, date: DateStr): Promise<CalendarData> {
  const { from, to } = rangeFor(view, date, ctx.today);
  const detail = view !== "year";
  const dates = dateRange(from, to);
  const [entries, dayRows, worked] = await Promise.all([
    q<EntryView>(`${VIEW_SELECT} where e.date between $1 and $2 order by e.date, e.must_do desc, e.sort, e.id limit 6000`, [from, to]),
    q<{ date: DateStr; score: number | null; steps: number | null; sleep_minutes: number | null }>("select date, score, steps, sleep_minutes from days where date between $1 and $2", [from, to]),
    from <= ctx.today ? workedByDay(ctx, from, to > ctx.today ? ctx.today : to) : Promise.resolve(new Map<DateStr, number>()),
  ]);
  const byDay = new Map<DateStr, CalDay>(dates.map((d) => {
    const r = dayRows.find((x) => x.date === d);
    return [d, { date: d, score: r?.score ?? null, steps: r?.steps ?? null, sleepMin: r?.sleep_minutes ?? null, workedMin: worked.get(d) ?? 0, counts: { total: 0, done: 0, open: 0, skipped: 0, projected: 0 }, events: 0, tasks: [], eventList: [] }];
  }));
  const onDay = new Set<string>();
  for (const e of entries) {
    const day = byDay.get(e.date);
    if (!day) continue;
    onDay.add(`${e.task_id}:${e.date}`);
    day.counts.total += 1;
    if (e.status === "done" || e.status === "progressed") day.counts.done += 1;
    else if (e.status === "skipped" || e.status === "dropped") day.counts.skipped += 1;
    else if (e.status === "open" || e.status === "attempted" || e.status === "waiting") day.counts.open += 1;
    if (detail) day.tasks.push(toCalTask(e, ctx));
  }

  if (detail) {
    const future = dates.filter((d) => d > ctx.today);
    if (future.length) await projectFuture(ctx, future, byDay, onDay);
    await addEvents(ctx, from, to, byDay);
  } else {
    // a year: only the counts, so the page stays small
    const ev = await q<{ d: DateStr; n: number }>(
      `select d::text as d, count(*)::int as n from (
         select (starts_at at time zone $3)::date as d from sales_meetings where not cancelled and starts_at >= $1::date and starts_at < ($2::date + 1)
         union all select due_on from sales_payments where status = 'due' and due_on between $1 and $2
         union all select revisit_on from sales_deals where revisit_on between $1 and $2) x group by d`,
      [from, to, ctx.tz],
    ).catch(() => []);
    for (const r of ev) {
      const d = byDay.get(r.d);
      if (d) d.events += r.n;
    }
  }
  for (const d of byDay.values()) d.events = Math.max(d.events, d.eventList.length);

  const days = [...byDay.values()];
  return { view, date, from, to, today: ctx.today, days, summary: summarize(days, ctx.today) };
}

/** Puts on each coming day what your rules will put there, without saving anything. */
async function projectFuture(ctx: Ctx, future: DateStr[], byDay: Map<DateStr, CalDay>, onDay: Set<string>): Promise<void> {
  const tasks = await q<TaskRow & { project_name: string | null; project_color: string | null }>(
    `select t.*, p.name as project_name, p.color as project_color from tasks t left join projects p on p.id = t.project_id
     where t.state = 'active' and t.type in ('recurring','ongoing','one_off','follow_up') order by t.id`,
  );
  const make = (t: (typeof tasks)[number], d: DateStr, time: string | null): CalTask => ({
    key: `p${t.id}:${d}`, entryId: null, taskId: t.id, title: t.title, status: "planned", mustDo: false, type: t.type as TaskType, project: t.project_name,
    color: t.project_color, time, estimateMin: t.estimate_min, minutes: 0, projected: true, carry: t.carry_count,
  });
  for (const t of tasks) {
    const created = logicalDate(t.created_at, ctx.tz, ctx.boundaryMin);
    for (const d of future) {
      if (onDay.has(`${t.id}:${d}`)) continue;
      const day = byDay.get(d)!;
      let hit = false;
      if (t.type === "recurring") {
        hit = created <= d && (isWorkingDay(ctx, d) || namesItsDays(t.rrule)) && rruleMatches(t.rrule, d, created);
      } else if (t.type === "ongoing") {
        hit = isWorkingDay(ctx, d) && (t.due_date ?? created) <= d;
      } else if (t.due_date === d) {
        hit = true;
      }
      if (!hit) continue;
      day.tasks.push(make(t, d, t.type === "recurring" && t.due_at ? fmtHM(t.due_at, ctx.tz) : null));
      day.counts.projected += 1;
    }
  }
  for (const d of future) byDay.get(d)!.tasks.sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));
}

async function addEvents(ctx: Ctx, from: DateStr, to: DateStr, byDay: Map<DateStr, CalDay>): Promise<void> {
  const push = (d: DateStr, e: CalEvent) => {
    const day = byDay.get(d);
    if (day && !day.eventList.some((x) => x.key === e.key)) day.eventList.push(e);
  };
  const [meetings, payments, moves, revisits, waiting, cadence, targets] = await Promise.all([
    q<{ id: number; title: string; starts_at: Date; deal_id: number | null }>("select id, title, starts_at, deal_id from sales_meetings where not cancelled and starts_at >= ($1::date - 1) and starts_at < ($2::date + 2) order by starts_at", [from, to]).catch(() => []),
    q<{ id: number; label: string; amount: number; currency: string; due_on: DateStr; deal_id: number; deal: string | null }>("select p.id, p.label, p.amount, p.currency, p.due_on, p.deal_id, d.title as deal from sales_payments p left join sales_deals d on d.id = p.deal_id where p.status = 'due' and p.due_on between $1 and $2", [from, to]).catch(() => []),
    q<{ id: number; title: string; due_at: Date; deal_id: number | null; kind: string }>("select id, title, due_at, deal_id, kind from sales_moves where status = 'open' and kind <> 'radar' and due_at >= ($1::date - 1) and due_at < ($2::date + 2) order by due_at limit 300", [from, to]).catch(() => []),
    q<{ id: number; title: string; revisit_on: DateStr }>("select id, title, revisit_on from sales_deals where revisit_on between $1 and $2", [from, to]).catch(() => []),
    q<{ id: number; title: string; waiting_until: DateStr; waiting_on: string | null }>("select id, title, waiting_until, waiting_on from tasks where state = 'active' and waiting_until between $1 and $2", [from, to]).catch(() => []),
    q<TaskRow>("select * from tasks where state = 'active' and type = 'cadence'").catch(() => [] as TaskRow[]),
    q<TaskRow>("select * from tasks where state = 'active' and type = 'target' and target_period is not null and period_start is not null").catch(() => [] as TaskRow[]),
  ]);
  const local = (d: Date) => logicalDate(d, ctx.tz, ctx.boundaryMin);
  for (const m of meetings) push(local(m.starts_at), { key: `m${m.id}`, kind: "meeting", title: m.title, time: fmtHM(m.starts_at, ctx.tz), href: m.deal_id ? `/sales/deal/${m.deal_id}` : "/sales" });
  for (const p of payments) push(p.due_on, { key: `pay${p.id}`, kind: "payment", title: `${p.currency} ${Number(p.amount).toLocaleString("en-IN")} due: ${p.label}`, time: null, href: `/sales/deal/${p.deal_id}`, note: p.deal ?? undefined });
  for (const mv of moves) push(local(mv.due_at), { key: `mv${mv.id}`, kind: "move", title: mv.title, time: null, href: mv.deal_id ? `/sales/deal/${mv.deal_id}` : "/sales" });
  for (const r of revisits) push(r.revisit_on, { key: `rv${r.id}`, kind: "revisit", title: `Revisit ${r.title}`, time: null, href: `/sales/deal/${r.id}` });
  for (const w of waiting) push(w.waiting_until, { key: `w${w.id}`, kind: "waiting", title: `${w.title}: back on your list`, time: null, href: `/task/${w.id}`, note: w.waiting_on ? `waiting on ${w.waiting_on}` : undefined });
  // a repeating "every N days" task comes due N days after it was last done
  for (const c of cadence) {
    const anchor = logicalDate(c.last_done_at ?? c.created_at, ctx.tz, ctx.boundaryMin);
    const due = addDays(anchor, c.cadence_days ?? 7);
    const when = due < ctx.today ? ctx.today : due;
    push(when, { key: `c${c.id}`, kind: "cadence", title: `${c.title} is due`, time: null, href: `/task/${c.id}`, note: `every ${c.cadence_days ?? 7} days` });
  }
  for (const t of targets) {
    const end = periodEnd(t.period_start as DateStr, t.target_period as TargetPeriod);
    push(end, { key: `t${t.id}`, kind: "target", title: `Target ends: ${t.title}`, time: null, href: `/task/${t.id}` });
  }
  for (const day of byDay.values()) day.eventList.sort((a, b) => (a.time ?? "00:00").localeCompare(b.time ?? "00:00"));
}

function summarize(days: CalDay[], today: DateStr): CalSummary {
  const past = days.filter((d) => d.date <= today);
  const scored = past.filter((d) => d.score !== null);
  let best: CalSummary["best"] = null;
  for (const d of scored) if (!best || d.score! > best.score) best = { date: d.date, score: d.score! };
  return {
    days: past.length,
    scoredDays: scored.length,
    avgScore: scored.length ? Math.round((scored.reduce((a, d) => a + d.score!, 0) / scored.length) * 10) / 10 : null,
    done: past.reduce((a, d) => a + d.counts.done, 0),
    planned: past.reduce((a, d) => a + d.counts.total, 0),
    workedMin: past.reduce((a, d) => a + d.workedMin, 0),
    best,
  };
}
