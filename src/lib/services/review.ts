/**
 * Weekly and monthly reviews: the numbers for a period against the previous period and the average of the four
 * before it, a day-by-day strip, time goals, an AI "period in review" built from the daily diary summaries, and the
 * intentions set for the period (with a tick for each).
 */
import { aiConfigured, chatWithModel } from "../ai";
import { getPool, one, q, UserError, type Db } from "../db";
import type { Ctx } from "../settings";
import { addDays, dateRange, fmtDateShort, fmtDuration, fmtRange, periodEnd, periodStart, weekdayName, type DateStr } from "../time";
import { summariesInRange } from "./diary";
import { periodMetrics, workedByDay, type PeriodMetrics } from "./stats";
import { timeGoals, type TimeGoalReport } from "./time-goals";

export type ReviewPeriod = "week" | "month";

export interface Intention {
  text: string;
  done: boolean | null;
}

export interface ReviewRow {
  period: ReviewPeriod;
  start_date: DateStr;
  end_date: DateStr;
  headline: string | null;
  narrative: string | null;
  grade: number | null;
  wins: string[];
  patterns: string[];
  drivers: string[];
  decisions: string[];
  intentions: Intention[];
  model: string | null;
  generated_at: Date | null;
}

export interface LifeMetrics {
  avgSleepH: number | null;
  avgSteps: number | null;
  exerciseSets: number;
  avgDiaryRating: number | null;
  diaryDays: number;
}

export type Metrics = PeriodMetrics & LifeMetrics;

export interface ReviewDay {
  date: DateStr;
  score: number | null;
  rating: number | null;
  headline: string | null;
  workedH: number;
  sleepH: number | null;
}

export interface ReviewData {
  period: ReviewPeriod;
  start: DateStr;
  end: DateStr;
  /** the range actually measured: the full period, or up to today while it is running */
  measuredTo: DateStr;
  inProgress: boolean;
  current: Metrics;
  previous: Metrics;
  /** average of the four periods before this one */
  baseline: Metrics;
  days: ReviewDay[];
  goals: TimeGoalReport;
  review: ReviewRow | null;
}

// ------------------------------------------------------------------ periods

export function periodBounds(period: ReviewPeriod, anchor: DateStr): { start: DateStr; end: DateStr } {
  const start = periodStart(anchor, period);
  return { start, end: periodEnd(start, period) };
}

export function shiftPeriod(period: ReviewPeriod, start: DateStr, n: number): DateStr {
  if (period === "week") return addDays(start, 7 * n);
  const [y, m] = start.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`;
}

export function periodLabel(period: ReviewPeriod, start: DateStr): string {
  const end = periodEnd(start, period);
  if (period === "month") {
    const d = new Date(`${start}T00:00:00Z`);
    return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  return fmtRange(start, end);
}

// ------------------------------------------------------------------ storage

let ensured: Promise<void> | null = null;
function ensureTables(db: Db = getPool()): Promise<void> {
  ensured ??= (async () => {
    await db.query(`
      create table if not exists reviews (
        period text not null check (period in ('week','month')),
        start_date date not null,
        end_date date not null,
        headline text,
        narrative text,
        grade numeric(3,1) check (grade is null or (grade >= 0 and grade <= 10)),
        wins jsonb not null default '[]',
        patterns jsonb not null default '[]',
        drivers jsonb not null default '[]',
        decisions jsonb not null default '[]',
        intentions jsonb not null default '[]',
        model text,
        generated_at timestamptz,
        primary key (period, start_date)
      );
      alter table projects add column if not exists weekly_target_min int
        check (weekly_target_min is null or (weekly_target_min > 0 and weekly_target_min <= 10080));`);
  })().catch((e) => {
    ensured = null;
    throw e;
  });
  return ensured;
}

export async function getReview(period: ReviewPeriod, start: DateStr, db: Db = getPool()): Promise<ReviewRow | null> {
  await ensureTables(db);
  return one<ReviewRow>("select * from reviews where period = $1 and start_date = $2", [period, start], db);
}

/** Replaces the intentions for a period (max 5, empty lines dropped). */
export async function setIntentions(period: ReviewPeriod, start: DateStr, items: Intention[]): Promise<Intention[]> {
  await ensureTables();
  const clean = items
    .map((i) => ({ text: i.text.trim().slice(0, 200), done: i.done ?? null }))
    .filter((i) => i.text)
    .slice(0, 5);
  await q(
    `insert into reviews (period, start_date, end_date, intentions) values ($1, $2, $3, $4)
     on conflict (period, start_date) do update set intentions = excluded.intentions`,
    [period, start, periodEnd(start, period), JSON.stringify(clean)],
  );
  return clean;
}

// ------------------------------------------------------------------ numbers

async function lifeMetrics(from: DateStr, to: DateStr): Promise<LifeMetrics> {
  const [life, sets, diary] = await Promise.all([
    one<{ sleep: number | null; steps: number | null }>(
      "select avg(sleep_minutes)::float / 60 as sleep, avg(steps)::float as steps from days where date between $1 and $2",
      [from, to],
    ),
    one<{ n: number }>("select count(*)::int as n from exercise_logs where date between $1 and $2 and status = 'done'", [from, to]),
    summariesInRange(from, to).catch(() => []),
  ]);
  const ratings = diary.map((s) => s.rating).filter((r): r is number => r !== null);
  return {
    avgSleepH: life?.sleep ?? null,
    avgSteps: life?.steps ?? null,
    exerciseSets: sets?.n ?? 0,
    avgDiaryRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    diaryDays: diary.length,
  };
}

async function metricsFor(ctx: Ctx, from: DateStr, to: DateStr): Promise<Metrics> {
  const [pm, life] = await Promise.all([periodMetrics(ctx, { from, to }), lifeMetrics(from, to)]);
  return { ...pm, ...life };
}

/** Mean of each numeric field, skipping nulls (a period with no score does not drag the average to 0). */
function averageMetrics(list: Metrics[]): Metrics {
  const keys = Object.keys(list[0]) as (keyof Metrics)[];
  const out = {} as Record<keyof Metrics, number | null>;
  for (const k of keys) {
    const vals = list.map((m) => m[k]).filter((v): v is number => typeof v === "number");
    out[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return out as unknown as Metrics;
}

export async function reviewData(ctx: Ctx, period: ReviewPeriod, start: DateStr): Promise<ReviewData> {
  await ensureTables();
  const end = periodEnd(start, period);
  const inProgress = ctx.today >= start && ctx.today <= end;
  const measuredTo = inProgress ? ctx.today : end;
  const span = dateRange(start, measuredTo).length;

  // earlier periods are compared over the same number of days, so a Wednesday is not measured against a full week
  const earlier = [1, 2, 3, 4, 5].map((n) => {
    const s = shiftPeriod(period, start, -n);
    const full = dateRange(s, periodEnd(s, period)).length;
    return { from: s, to: addDays(s, Math.min(span, full) - 1) };
  });

  const [current, ...before] = await Promise.all([
    metricsFor(ctx, start, measuredTo),
    ...earlier.map((r) => metricsFor(ctx, r.from, r.to)),
  ]);

  const [dayRows, worked, diary, goals, review] = await Promise.all([
    q<{ date: DateStr; score: number | null; sleep_minutes: number | null }>(
      "select date, score, sleep_minutes from days where date between $1 and $2",
      [start, measuredTo],
    ),
    workedByDay(ctx, start, measuredTo),
    summariesInRange(start, measuredTo).catch(() => []),
    timeGoals(ctx, start, end),
    getReview(period, start),
  ]);
  const dayMap = new Map(dayRows.map((r) => [r.date, r]));
  const diaryMap = new Map(diary.map((s) => [s.date, s]));
  const days: ReviewDay[] = dateRange(start, measuredTo).map((d) => ({
    date: d,
    score: dayMap.get(d)?.score ?? null,
    rating: diaryMap.get(d)?.rating ?? null,
    headline: diaryMap.get(d)?.headline ?? null,
    workedH: Math.round(((worked.get(d) ?? 0) / 60) * 10) / 10,
    sleepH: dayMap.get(d)?.sleep_minutes == null ? null : Math.round((dayMap.get(d)!.sleep_minutes! / 60) * 10) / 10,
  }));

  return {
    period, start, end, measuredTo, inProgress, current,
    previous: before[0],
    baseline: averageMetrics(before.slice(1)),
    days, goals, review,
  };
}

// ------------------------------------------------------------------ AI review

const SYSTEM = `You are the owner's executive coach writing their review of a finished week or month.
You get the period's numbers compared with the previous period and with the average of the four before it, a
day-by-day list (score, hours, sleep, and the AI summary of each day's diary), their time goals, and the intentions
they set for the period.

Be honest, specific and useful. Base every statement on the data; quote numbers. Never invent events.
Write in second person ("You ..."), in English.

Return ONLY a JSON object, no markdown, with exactly these keys:
{
  "headline": "max 10 words capturing the period",
  "grade": number 0-10 with one decimal, how good the period was overall,
  "narrative": "4 to 6 sentences: what happened, how it compares, what stands out",
  "wins": ["up to 4 concrete wins"],
  "patterns": ["up to 4 recurring patterns or struggles seen across several days"],
  "drivers": ["up to 3 observations about what the better days had in common, with evidence"],
  "decisions": ["exactly 3 concrete, small decisions or focus points for the next period"]
}`;

const f1 = (v: number | null, unit = "") => (v === null ? "n/a" : `${Math.round(v * 10) / 10}${unit}`);

function metricsTable(d: ReviewData): string {
  const rows: [string, (m: Metrics) => number | null, string][] = [
    ["Average day score /10", (m) => m.avgScore, ""],
    ["Hours worked per day", (m) => m.avgWorkedHours, "h"],
    ["Tasks done", (m) => m.tasksDone, ""],
    ["Completion rate %", (m) => (m.completionRate === null ? null : m.completionRate * 100), "%"],
    ["Must-do hit rate %", (m) => (m.mustDoHitRate === null ? null : m.mustDoHitRate * 100), "%"],
    ["Unaccounted time %", (m) => m.unaccountedPct, "%"],
    ["Average sleep", (m) => m.avgSleepH, "h"],
    ["Average steps", (m) => m.avgSteps, ""],
    ["Exercise sets", (m) => m.exerciseSets, ""],
    ["Average AI day rating /10", (m) => m.avgDiaryRating, ""],
  ];
  return rows
    .map(([label, get, unit]) => `${label}: this ${d.period} ${f1(get(d.current), unit)} | previous ${f1(get(d.previous), unit)} | 4-${d.period} average ${f1(get(d.baseline), unit)}`)
    .join("\n");
}

async function promptFor(d: ReviewData): Promise<string> {
  const diary = await summariesInRange(d.start, d.measuredTo).catch(() => []);
  const byDate = new Map(diary.map((s) => [s.date, s]));
  const dayLines = d.days.map((x) => {
    const s = byDate.get(x.date);
    const bits = [
      `${weekdayName(x.date)} ${fmtDateShort(x.date)}`,
      `score ${x.score ?? "n/a"}`,
      `worked ${x.workedH}h`,
      `sleep ${x.sleepH === null ? "n/a" : `${x.sleepH}h`}`,
    ];
    if (s) {
      bits.push(`AI rating ${s.rating ?? "n/a"}: ${s.headline}`);
      if (s.wins.length) bits.push(`wins: ${s.wins.join("; ")}`);
      if (s.struggles.length) bits.push(`struggles: ${s.struggles.join("; ")}`);
      if (s.highlights.length) bits.push(`notable: ${s.highlights.join("; ")}`);
    }
    return `- ${bits.join(" | ")}`;
  });
  const goals = d.goals.goals.length
    ? d.goals.goals.map((g) => `- ${g.name}: ${fmtDuration(g.actualMin)} of ${fmtDuration(g.targetMin)} goal (${g.status.replace("_", " ")})`).join("\n")
    : "(no time goals set)";
  const intentions = d.review?.intentions.length
    ? d.review.intentions.map((i) => `- ${i.text} (${i.done === true ? "done" : i.done === false ? "not done" : "not marked"})`).join("\n")
    : "(none set)";
  return [
    `PERIOD: ${d.period} ${periodLabel(d.period, d.start)}${d.inProgress ? " (still running, measured up to today)" : ""}`,
    `\nNUMBERS\n${metricsTable(d)}`,
    `\nTIME GOALS\n${goals}\nOther logged time: ${fmtDuration(d.goals.otherMin)}`,
    `\nINTENTIONS SET FOR THIS ${d.period.toUpperCase()}\n${intentions}`,
    `\nDAY BY DAY\n${dayLines.join("\n")}`,
  ].join("\n");
}

const strList = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()).slice(0, max) : [];

export function parseReviewJson(raw: string) {
  const cleaned = raw.replace(/```(?:json)?/gi, "");
  const s = cleaned.indexOf("{");
  const e = cleaned.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("no JSON object in answer");
  const j = JSON.parse(cleaned.slice(s, e + 1)) as Record<string, unknown>;
  const headline = typeof j.headline === "string" ? j.headline.trim() : "";
  const narrative = typeof j.narrative === "string" ? j.narrative.trim() : "";
  if (!headline || !narrative) throw new Error("answer is missing headline or narrative");
  const g = Number(j.grade);
  return {
    headline: headline.slice(0, 160),
    narrative: narrative.slice(0, 3000),
    grade: Number.isFinite(g) ? Math.max(0, Math.min(10, Math.round(g * 10) / 10)) : null,
    wins: strList(j.wins, 4),
    patterns: strList(j.patterns, 4),
    drivers: strList(j.drivers, 3),
    decisions: strList(j.decisions, 3),
  };
}

export async function generateReview(ctx: Ctx, period: ReviewPeriod, start: DateStr, budgetMs = 45_000): Promise<ReviewRow> {
  if (!aiConfigured()) throw new UserError("AI reviews need OPENROUTER_API_KEY in the environment.");
  const data = await reviewData(ctx, period, start);
  const user = await promptFor(data);
  let last: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text, model } = await chatWithModel(
        [
          { role: "system", content: SYSTEM },
          { role: "user", content: attempt === 0 ? user : `${user}\n\nReply with the JSON object only.` },
        ],
        { maxTokens: 1800, timeoutMs: Math.min(35_000, budgetMs), totalMs: budgetMs, temperature: 0.3 },
      );
      const r = parseReviewJson(text);
      return (await one<ReviewRow>(
        `insert into reviews (period, start_date, end_date, headline, narrative, grade, wins, patterns, drivers, decisions, model, generated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         on conflict (period, start_date) do update set headline = excluded.headline, narrative = excluded.narrative,
           grade = excluded.grade, wins = excluded.wins, patterns = excluded.patterns, drivers = excluded.drivers,
           decisions = excluded.decisions, model = excluded.model, generated_at = now()
         returning *`,
        [
          period, start, data.end, r.headline, r.narrative, r.grade, JSON.stringify(r.wins), JSON.stringify(r.patterns),
          JSON.stringify(r.drivers), JSON.stringify(r.decisions), model,
        ],
      ))!;
    } catch (e) {
      last = e as Error;
      if (e instanceof SyntaxError || /JSON|headline/.test(last.message)) continue;
      break;
    }
  }
  console.error("[review] failed:", last?.message);
  throw new UserError("The AI could not write the review right now. Try again in a minute.");
}

/**
 * Nightly: on Monday write last week's review, on the 1st last month's, unless one exists already.
 * Returns what it did, for logs.
 */
export async function autoReviews(ctx: Ctx, budgetMs: number): Promise<string[]> {
  const done: string[] = [];
  const todo: { period: ReviewPeriod; start: DateStr }[] = [];
  const thisWeek = periodStart(ctx.today, "week");
  if (ctx.today === thisWeek) todo.push({ period: "week", start: shiftPeriod("week", thisWeek, -1) });
  const thisMonth = periodStart(ctx.today, "month");
  if (ctx.today === thisMonth) todo.push({ period: "month", start: shiftPeriod("month", thisMonth, -1) });
  for (const t of todo) {
    const existing = await getReview(t.period, t.start);
    if (existing?.generated_at) continue;
    await generateReview(ctx, t.period, t.start, budgetMs);
    done.push(`${t.period}:${t.start}`);
  }
  return done;
}
