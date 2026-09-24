/**
 * End-of-day diary: voice or typed notes for a logical day, and one AI summary per day that reads the notes
 * together with what the app already knows (tasks, time, score, exercise, steps).
 */
import { aiConfigured, chatWithModel } from "../ai";
import { getPool, one, q, UserError, type Db } from "../db";
import type { Ctx } from "../settings";
import { fmtDateLong, fmtDuration, type DateStr } from "../time";
import { recapFor } from "./days";

export type DiarySource = "voice" | "text" | "telegram";

export interface DiaryEntry {
  id: number;
  date: DateStr;
  body: string;
  source: DiarySource;
  created_at: Date;
}

export interface DiarySummary {
  date: DateStr;
  headline: string;
  summary: string;
  rating: number | null;
  mood: string | null;
  wins: string[];
  struggles: string[];
  highlights: string[];
  tomorrow: string[];
  tags: string[];
  model: string | null;
  entry_count: number;
  updated_at: Date;
}

/** Plain, serialisable shape handed to client components. */
export interface DiarySummaryView {
  date: DateStr;
  headline: string;
  summary: string;
  rating: number | null;
  mood: string | null;
  wins: string[];
  struggles: string[];
  highlights: string[];
  tomorrow: string[];
  tags: string[];
  model: string | null;
  entryCount: number;
}

export function toSummaryView(s: DiarySummary): DiarySummaryView {
  return {
    date: s.date, headline: s.headline, summary: s.summary, rating: s.rating, mood: s.mood, wins: s.wins,
    struggles: s.struggles, highlights: s.highlights, tomorrow: s.tomorrow, tags: s.tags, model: s.model,
    entryCount: s.entry_count,
  };
}

// Migrations run on cold start; this guards the first request after a deploy that skipped them.
let ensured: Promise<void> | null = null;
function ensureTables(db: Db = getPool()): Promise<void> {
  ensured ??= (async () => {
    await db.query(`
      create table if not exists diary_entries (
        id serial primary key,
        date date not null,
        body text not null check (length(body) between 1 and 20000),
        source text not null default 'voice' check (source in ('voice','text','telegram')),
        created_at timestamptz not null default now()
      );
      create index if not exists diary_entries_date_idx on diary_entries (date);
      create table if not exists diary_summaries (
        date date primary key,
        headline text not null,
        summary text not null,
        rating numeric(3,1) check (rating is null or (rating >= 0 and rating <= 10)),
        mood text,
        wins jsonb not null default '[]',
        struggles jsonb not null default '[]',
        highlights jsonb not null default '[]',
        tomorrow jsonb not null default '[]',
        tags jsonb not null default '[]',
        model text,
        entry_count int not null default 0,
        updated_at timestamptz not null default now()
      );`);
  })().catch((e) => {
    ensured = null;
    throw e;
  });
  return ensured;
}

export async function listEntries(date: DateStr, db: Db = getPool()): Promise<DiaryEntry[]> {
  await ensureTables(db);
  return q<DiaryEntry>("select * from diary_entries where date = $1 order by created_at, id", [date], db);
}

export async function addEntry(date: DateStr, body: string, source: DiarySource, db: Db = getPool()): Promise<DiaryEntry> {
  const text = body.trim();
  if (!text) throw new UserError("Say or type something first.");
  if (text.length > 20000) throw new UserError("That note is too long. Split it into two.");
  await ensureTables(db);
  return (await one<DiaryEntry>(
    "insert into diary_entries (date, body, source) values ($1, $2, $3) returning *",
    [date, text, source],
    db,
  ))!;
}

export async function updateEntry(id: number, body: string): Promise<DiaryEntry | null> {
  const text = body.trim();
  if (!text) throw new UserError("A note cannot be empty. Delete it instead.");
  await ensureTables();
  return one<DiaryEntry>("update diary_entries set body = $2 where id = $1 returning *", [id, text]);
}

export async function deleteEntry(id: number): Promise<DateStr | null> {
  await ensureTables();
  const row = await one<{ date: DateStr }>("delete from diary_entries where id = $1 returning date", [id]);
  return row?.date ?? null;
}

export async function getSummary(date: DateStr, db: Db = getPool()): Promise<DiarySummary | null> {
  await ensureTables(db);
  return one<DiarySummary>("select * from diary_summaries where date = $1", [date], db);
}

export async function summariesInRange(from: DateStr, to: DateStr, db: Db = getPool()): Promise<DiarySummary[]> {
  await ensureTables(db);
  return q<DiarySummary>("select * from diary_summaries where date between $1 and $2 order by date desc", [from, to], db);
}

/** Days in the range that have notes, with how many. */
export async function entryCountsInRange(from: DateStr, to: DateStr, db: Db = getPool()): Promise<Map<DateStr, number>> {
  await ensureTables(db);
  const rows = await q<{ date: DateStr; n: number }>(
    "select date, count(*)::int as n from diary_entries where date between $1 and $2 group by date",
    [from, to],
    db,
  );
  return new Map(rows.map((r) => [r.date, r.n]));
}

// ------------------------------------------------------------------ day context for the model

async function dayContext(ctx: Ctx, date: DateStr, db: Db = getPool()): Promise<string> {
  const [recap, tasks, time, exercise] = await Promise.all([
    recapFor(ctx, date, db),
    q<{ title: string; status: string; must_do: boolean; project: string | null; personal: boolean; note: string | null }>(
      `select t.title, e.status, e.must_do, p.name as project, t.is_personal as personal, e.note
       from day_entries e join tasks t on t.id = e.task_id left join projects p on p.id = t.project_id
       where e.date = $1 and e.status <> 'dropped'
       order by e.must_do desc, e.status, e.sort`,
      [date],
      db,
    ),
    q<{ project: string | null; minutes: number }>(
      `select p.name as project, sum(l.minutes)::int as minutes
       from time_logs l join tasks t on t.id = l.task_id left join projects p on p.id = t.project_id
       where l.date = $1 group by p.name order by 2 desc`,
      [date],
      db,
    ),
    q<{ name: string | null; unit: string | null; amount: number; sets: number }>(
      `select x.name, x.unit, coalesce(sum(l.amount), 0)::int as amount, count(*)::int as sets
       from exercise_logs l left join exercise_types x on x.id = l.exercise_type_id
       where l.date = $1 and l.status = 'done' group by x.name, x.unit`,
      [date],
      db,
    ),
  ]);

  const lines: string[] = [`Date: ${fmtDateLong(date)}`];
  lines.push(`Self-rated day score: ${recap.score === null ? "not given" : `${recap.score}/10`}`);
  lines.push(`Time worked: ${recap.worked > 0 ? fmtDuration(recap.worked) : "none recorded"}; logged on tasks: ${fmtDuration(recap.logged)}`);
  if (recap.mustDoTotal > 0) lines.push(`Must-dos: ${recap.mustDoHit} of ${recap.mustDoTotal} done or progressed`);
  lines.push(`Steps: ${recap.steps ?? "not recorded"}`);
  if (exercise.length) {
    lines.push(`Exercise: ${exercise.map((x) => `${x.name ?? "exercise"} ${x.amount}${x.unit === "seconds" ? "s" : ""} over ${x.sets} sets`).join("; ")}`);
  } else lines.push("Exercise: none logged");
  if (time.length) lines.push(`Time by project: ${time.map((t) => `${t.project ?? "no project"} ${fmtDuration(t.minutes)}`).join("; ")}`);
  const group = (s: string[]) => tasks.filter((t) => s.includes(t.status));
  const fmt = (t: (typeof tasks)[number]) =>
    `${t.must_do ? "[must-do] " : ""}${t.project ? `${t.project}: ` : ""}${t.title}${t.personal ? " (personal)" : ""}${t.note ? ` — note: ${t.note}` : ""}`;
  const done = group(["done"]);
  const progressed = group(["progressed", "attempted"]);
  const open = group(["open"]);
  const skipped = group(["skipped"]);
  if (done.length) lines.push(`Done (${done.length}):\n- ${done.map(fmt).join("\n- ")}`);
  if (progressed.length) lines.push(`Progressed:\n- ${progressed.map(fmt).join("\n- ")}`);
  if (open.length) lines.push(`Still open:\n- ${open.slice(0, 15).map(fmt).join("\n- ")}`);
  if (skipped.length) lines.push(`Skipped:\n- ${skipped.map(fmt).join("\n- ")}`);
  if (!tasks.length) lines.push("No tasks were planned for this day.");
  return lines.join("\n");
}

const SYSTEM = `You are the owner's personal chief of staff, writing their end-of-day diary summary.
You get (1) the day's facts from their tracking app and (2) their own diary notes, usually voice transcripts that may be messy, mix Hindi and English, or contain filler words.

Write for the owner in second person ("You ..."). Be warm but honest, concrete and brief. Never invent anything: every claim must come from the facts or the notes. Prefer specifics (names, numbers, places, decisions, ideas) over generic praise. If there are no notes, say the summary is based on tracked data only.

Rate the day 0-10 for how good it really was, weighing work output, must-dos, health (exercise, steps), wellbeing and what they said about it. If they gave a self score, consider it but make your own call.

Return ONLY a JSON object, no markdown fences, with exactly these keys:
{
  "headline": "max 10 words capturing the day",
  "summary": "3 to 5 sentences",
  "rating": number 0-10 with one decimal,
  "mood": "one or two words",
  "wins": ["up to 4 short items"],
  "struggles": ["up to 3 short items, empty if none"],
  "highlights": ["up to 6 specific details worth remembering from the notes: people, places, numbers, decisions, ideas, feelings"],
  "tomorrow": ["up to 4 follow-ups or intentions they mentioned or that clearly follow"],
  "tags": ["up to 5 lowercase topic tags, e.g. work, health, family, learning, money"]
}`;

const strList = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()).slice(0, max) : [];

/** Pulls the first JSON object out of a model answer, tolerating fences and chatter around it. */
export function parseSummaryJson(raw: string): Omit<DiarySummary, "date" | "model" | "entry_count" | "updated_at"> {
  const cleaned = raw.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in answer");
  const j = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  const headline = typeof j.headline === "string" ? j.headline.trim() : "";
  const summary = typeof j.summary === "string" ? j.summary.trim() : "";
  if (!headline || !summary) throw new Error("answer is missing headline or summary");
  const r = Number(j.rating);
  return {
    headline: headline.slice(0, 160),
    summary: summary.slice(0, 2000),
    rating: Number.isFinite(r) ? Math.max(0, Math.min(10, Math.round(r * 10) / 10)) : null,
    mood: typeof j.mood === "string" && j.mood.trim() ? j.mood.trim().slice(0, 40) : null,
    wins: strList(j.wins, 4),
    struggles: strList(j.struggles, 3),
    highlights: strList(j.highlights, 6),
    tomorrow: strList(j.tomorrow, 4),
    tags: strList(j.tags, 5).map((t) => t.toLowerCase().slice(0, 24)),
  };
}

export async function summarizeDay(ctx: Ctx, date: DateStr, db: Db = getPool()): Promise<DiarySummary> {
  if (!aiConfigured()) throw new UserError("AI summaries need OPENROUTER_API_KEY in the environment.");
  const [entries, facts] = await Promise.all([listEntries(date, db), dayContext(ctx, date, db)]);
  const notes = entries.length
    ? entries.map((e, i) => `Note ${i + 1} (${e.source}): ${e.body}`).join("\n\n")
    : "(no diary notes for this day)";
  const user = `FACTS FROM THE APP\n${facts}\n\nDIARY NOTES\n${notes}`;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text, model } = await chatWithModel(
        [
          { role: "system", content: SYSTEM },
          { role: "user", content: attempt === 0 ? user : `${user}\n\nReply with the JSON object only.` },
        ],
        { maxTokens: 1500, timeoutMs: 35_000, totalMs: 45_000, temperature: 0.3 },
      );
      const s = parseSummaryJson(text);
      return (await one<DiarySummary>(
        `insert into diary_summaries (date, headline, summary, rating, mood, wins, struggles, highlights, tomorrow, tags, model, entry_count, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
         on conflict (date) do update set headline = excluded.headline, summary = excluded.summary, rating = excluded.rating,
           mood = excluded.mood, wins = excluded.wins, struggles = excluded.struggles, highlights = excluded.highlights,
           tomorrow = excluded.tomorrow, tags = excluded.tags, model = excluded.model, entry_count = excluded.entry_count,
           updated_at = now()
         returning *`,
        [
          date, s.headline, s.summary, s.rating, s.mood,
          JSON.stringify(s.wins), JSON.stringify(s.struggles), JSON.stringify(s.highlights),
          JSON.stringify(s.tomorrow), JSON.stringify(s.tags), model, entries.length,
        ],
        db,
      ))!;
    } catch (e) {
      lastErr = e as Error;
      if (e instanceof SyntaxError || /JSON|headline/.test(lastErr.message)) continue; // model rambled: ask once more
      break;
    }
  }
  console.error("[diary] summary failed:", lastErr?.message);
  throw new UserError("The AI could not summarise the day right now. Your notes are saved; try again in a minute.");
}
