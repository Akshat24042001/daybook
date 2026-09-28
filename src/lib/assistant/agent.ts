/**
 * The assistant's loop. The model plans SQL, the server runs it read-only, the rows go back, and the model answers
 * with text plus charts/tables that REFERENCE query results by name. The rows in every chart and table come from
 * the database, never from the model's typing, so the numbers on screen cannot be made up.
 *
 * The protocol is plain JSON in the reply (not provider tool-calling), so any free open model can follow it.
 */
import { chatWithModel } from "../ai";
import { fmtDateLong, fmtHM, weekdayName } from "../time";
import type { Ctx } from "../settings";
import { SCHEMA_GUIDE } from "./schema";
import { resultForModel, runReadOnlySql, SqlRejected, type SqlResult } from "./sql";
import type { Block, ChartKind, MemoryFact, Step, StatItem } from "./types";

const MAX_ROUNDS = 5;
const MAX_QUERIES_PER_ROUND = 6;

export interface AgentTurn { role: "user" | "assistant"; content: string }

export interface AgentResult {
  content: string;
  blocks: Block[];
  steps: Step[];
  model: string | null;
  title: string | null;
  remember: string[];
  forget: number[];
  /** proposed changes that passed the check; stored and shown as buttons by the caller */
  actions: Record<string, unknown>[];
}

interface Emit {
  status(text: string): void;
  query(step: Step): void;
}

// ---------------------------------------------------------------- prompt

function systemPrompt(ctx: Ctx, memory: MemoryFact[], snapshot: string): string {
  const now = ctx.now;
  return `You are the owner's personal analyst and chief of staff inside Daybook, their private life-and-work tracker.
You can read every part of their Daybook through SQL: tasks, time, projects, exercise, sleep, steps, diary, reviews,
contacts, references, scratchpad. There is one owner; "I", "me", "my" is always them.

HOW TO BEHAVE
- Be brutally honest and specific. No flattery, no filler, no generic advice. Name the pattern, give the number, say
  what it means, say what to do next. If they are slipping, avoiding something or overcommitting, say so plainly.
- Numbers first. Every number you state must come from a query result in this conversation. Never invent or estimate
  data. If the data is missing or thin, say exactly what is missing and how they could capture it.
- Put things in context: compare with their own baseline (previous week, 30-day average) when that sharpens the point.
- Always state the date range you looked at. Use their words: "Not today" for status 'skipped'.
- Reply in the language they write in (English or Hinglish). Keep it tight: short paragraphs and bullets, markdown.
- Use charts for trends and distributions, tables for lists, stat tiles for 2-4 headline numbers. Do not repeat every
  number of a chart in the text; call out what matters.

CONTEXT
Now: ${weekdayName(ctx.today)} ${fmtDateLong(ctx.today)}, ${fmtHM(now, ctx.tz)} local (${ctx.tz}).
Today's logical date: ${ctx.today}. The day boundary is ${ctx.s.day_boundary}: times before it belong to the previous date.
Working days (ISO, 1=Mon): ${ctx.s.working_days.join(",")}. Step goal: ${ctx.s.step_goal}. Available hours a day: ${ctx.s.available_hours}.
${snapshot ? `\nSNAPSHOT (live, for orientation; query for anything you state in detail)\n${snapshot}\n` : ""}
MEMORY (things the owner told you to keep, or durable facts you saved earlier; id: fact)
${memory.length ? memory.map((m) => `${m.id}: ${m.fact}`).join("\n") : "(nothing yet)"}

${SCHEMA_GUIDE}

PROTOCOL — every reply is exactly ONE JSON object, nothing before or after it.

To read data, reply:
{"queries":[{"name":"q1","why":"short reason","sql":"select ..."}]}
- Up to ${MAX_QUERIES_PER_ROUND} queries per reply; ask for everything you will need at once. Names: q1, q2, ... unique in the chat turn.
- Prefer the v_ views. Aggregate in SQL; return at most ~60 rows unless listing items. Round decimals.
- Results come back as pipe-separated rows. On an error, fix the SQL and try again.

To answer, reply:
{"answer":"markdown text",
 "stats":[{"label":"Worked","value":"38.5 h","sub":"vs 41 h last week","tone":"bad"}],
 "charts":[{"from":"q1","type":"bar|line|area|pie|stacked","title":"...","x":"column","y":["column", "..."],"unit":"h"}],
 "tables":[{"from":"q2","title":"...","columns":["column", "..."]}],
 "remember":["durable fact worth keeping"], "forget":[memory ids], "title":"3-6 word chat title",
 "followups":["a sharp next question they could ask", "..."]}
- Only "answer" is required. "from" must name a query that succeeded; x and y must be its column names. For charts,
  shape the data in SQL first (one row per x value, numeric y columns; for "stacked" several y columns; for "pie"
  one y column). Put a readable unit like h, min, %, reps in "unit".
- "remember": only when they ask you to remember something, or they state a lasting goal, preference, constraint or
  fact about their life. Not numbers that change daily. "forget" when they ask you to drop a memory.
- "followups": 2-3 short questions that would dig deeper, in their voice.
- If the question needs no data (small talk, a plan, a definition), answer directly.

ACTIONS — you can propose changes; each becomes a button the owner taps to apply (and can undo). Add to the answer:
 "actions":[{"type":"task_status","entry_id":123,"status":"done"}, ...]
Types and fields (look up ids with queries first; never guess an id):
- task_status: entry_id (v_task_days.entry_id), status done|progressed|attempted|skipped|dropped|open, reason (skipped only: no_time|low_energy|blocked|not_important)
- log_time: task_id, minutes, date (default today)
- add_task: text in quick-add syntax, e.g. "Aivaura: Send proposal ~30m !! @tom @5pm +Rahul" (Project: prefix, ~estimate, !! must-do, @date/@time, ? someday, >> ongoing, *7d cadence, /p personal)
- move_task: entry_id, date (YYYY-MM-DD, today, tomorrow)
- waiting: entry_id, until (check-back date), on (who/what, optional)
- task_note: task_id, text
- switch_state: kind office|outside|remote|commute|meal|break|exercise|personal|off (off = Day end)
- edit_segment: segment_id (v_segments.id), start and/or end as "HH:MM" local (end "running" reopens it)
- set_day: field score|steps|sleep_minutes, value, date (default today)
- log_exercise: exercise (type name), amount
- diary_note: text, date (default today)
- scratch_note: text, title (optional)
- contact_touch: contact_id, kind call|meet|message|other, note (optional), date (default today)
Rules: when they ask for a change, propose exactly that change (several actions are fine: "mark X done and log 45m").
When you list pending or overdue tasks, you may offer up to 4 obvious one-tap actions. Nothing changes until they tap,
so write "Tap to apply" and never claim you already did it. Up to 12 actions.`;
}

// ---------------------------------------------------------------- parsing

/** Pulls the first JSON object out of a model reply, tolerating fences, <think> blocks and raw newlines in strings. */
export function parseReply(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let out = "";
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) { esc = false; out += ch; continue; }
      if (ch === "\\") { esc = true; out += ch; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") continue;
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        out += ch;
        try {
          return JSON.parse(out.replace(/,\s*([}\]])/g, "$1")) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
    out += ch;
  }
  return null;
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

interface QuerySpec { name: string; sql: string; why: string }

function readQueries(p: Record<string, unknown>): QuerySpec[] {
  return arr(p.queries).slice(0, MAX_QUERIES_PER_ROUND).map((raw, i) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    return { name: str(o.name, 40).replace(/[^\w-]/g, "") || `q${i + 1}`, sql: str(o.sql, 8000), why: str(o.why, 160) };
  }).filter((x) => x.sql);
}

const TONES = new Set(["good", "bad", "warn", "neutral"]);
const CHARTS = new Set<ChartKind>(["bar", "line", "area", "pie", "stacked"]);

function isNumeric(v: unknown) {
  return typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) && !/^\d{4}-\d{2}/.test(v));
}

/** Turns the model's chart/table/stat requests into blocks with the real rows embedded. Bad references are dropped. */
export function buildBlocks(p: Record<string, unknown>, results: Map<string, SqlResult>): Block[] {
  const blocks: Block[] = [];
  const stats: StatItem[] = arr(p.stats).slice(0, 6).flatMap((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const label = str(o.label, 40);
    const value = str(typeof o.value === "number" ? String(o.value) : o.value, 40);
    if (!label || !value) return [];
    const tone = TONES.has(String(o.tone)) ? (o.tone as StatItem["tone"]) : undefined;
    return [{ label, value, sub: str(o.sub, 80) || undefined, tone }];
  });
  if (stats.length) blocks.push({ type: "stats", items: stats });

  for (const raw of arr(p.charts).slice(0, 4)) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const r = results.get(str(o.from, 40));
    if (!r || !r.rows.length) continue;
    const x = r.columns.includes(str(o.x, 80)) ? str(o.x, 80) : r.columns[0];
    let y = arr(o.y).map((c) => str(c, 80)).filter((c) => c !== x && r.columns.includes(c));
    if (!y.length) y = r.columns.filter((c) => c !== x && r.rows.some((row) => isNumeric(row[c]))).slice(0, 4);
    if (!y.length) continue;
    const chart = CHARTS.has(o.type as ChartKind) ? (o.type as ChartKind) : "bar";
    const rows = r.rows.slice(0, 200).map((row) => {
      const out: Record<string, unknown> = { [x]: row[x] ?? "∅" };
      for (const c of y) out[c] = row[c] === null || row[c] === undefined ? null : Number(row[c]);
      return out;
    });
    blocks.push({ type: "chart", chart, title: str(o.title, 100) || "Chart", x, y: chart === "pie" ? y.slice(0, 1) : y, rows, unit: str(o.unit, 12) || undefined });
  }

  for (const raw of arr(p.tables).slice(0, 4)) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const r = results.get(str(o.from, 40));
    if (!r) continue;
    const wanted = arr(o.columns).map((c) => str(c, 80)).filter((c) => r.columns.includes(c));
    const columns = wanted.length ? wanted : r.columns;
    const rows = r.rows.slice(0, 100).map((row) => Object.fromEntries(columns.map((c) => [c, row[c] ?? null])));
    blocks.push({ type: "table", title: str(o.title, 100) || "Results", columns, rows, total: r.rows.length });
  }

  const followups = arr(p.followups).map((f) => str(f, 140)).filter(Boolean).slice(0, 3);
  if (followups.length) blocks.push({ type: "followups", items: followups });
  return blocks;
}

// ---------------------------------------------------------------- loop

export async function runAgent(opts: {
  ctx: Ctx;
  question: string;
  history: AgentTurn[];
  memory: MemoryFact[];
  snapshot: string;
  emit: Emit;
  deadline: number;
  /** model chosen for the chat; the free fallback list still backs it up */
  prefer?: string | null;
  /** checks proposed actions against the data; returns a reason per rejected one */
  checkAction?: (raw: Record<string, unknown>) => Promise<string | null>;
}): Promise<AgentResult> {
  const { ctx, question, history, memory, snapshot, emit, deadline, prefer, checkAction } = opts;
  let actionRetry = false;
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt(ctx, memory, snapshot) },
    ...history.slice(-12),
    { role: "user", content: question },
  ];
  const results = new Map<string, SqlResult>();
  const steps: Step[] = [];
  let model: string | null = null;
  let repaired = false;

  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const left = deadline - Date.now();
    const lastChance = round === MAX_ROUNDS || left < 14_000;
    if (lastChance && round > 0) {
      messages.push({ role: "user", content: "No more queries. Reply now with the answer JSON using what you have; say what you could not check." });
    }
    emit.status(round === 0 ? "Thinking…" : lastChance ? "Writing the answer…" : "Reading the results…");
    const reply = await chatWithModel(messages, {
      maxTokens: 2200,
      temperature: 0.2,
      timeoutMs: Math.max(5_000, Math.min(35_000, left - 2_000)),
      totalMs: Math.max(5_000, left - 1_000),
      prefer,
    });
    model = reply.model;
    const parsed = parseReply(reply.text);

    if (!parsed) {
      if (!repaired && !lastChance) {
        repaired = true;
        messages.push({ role: "assistant", content: reply.text.slice(0, 4000) });
        messages.push({ role: "user", content: "That was not a single JSON object. Reply again with exactly one JSON object as the PROTOCOL says." });
        continue;
      }
      // a model that will not speak JSON still gets its words shown
      return { content: reply.text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim(), blocks: [], steps, model, title: null, remember: [], forget: [], actions: [] };
    }

    const queries = readQueries(parsed);
    if (queries.length && !lastChance) {
      messages.push({ role: "assistant", content: JSON.stringify({ queries }) });
      emit.status(queries.length === 1 ? `Querying: ${queries[0].why || queries[0].name}` : `Running ${queries.length} queries…`);
      const feedback: string[] = [];
      for (const qs of queries) {
        const step: Step = { name: qs.name, why: qs.why || undefined, sql: qs.sql };
        try {
          const r = await runReadOnlySql(qs.sql, ctx.tz);
          results.set(qs.name, r);
          step.rows = r.rows.length;
          step.ms = r.ms;
          feedback.push(`RESULT ${qs.name} (${r.rows.length}${r.truncated ? "+" : ""} rows):\n${resultForModel(r)}`);
        } catch (e) {
          const msg = e instanceof SqlRejected ? `rejected: ${e.message}` : (e as Error).message.split("\n")[0].slice(0, 300);
          step.error = msg;
          feedback.push(`ERROR ${qs.name}: ${msg}`);
        }
        steps.push(step);
        emit.query(step);
      }
      messages.push({
        role: "user",
        content: `${feedback.join("\n\n")}\n\nIf anything failed or is missing, send corrected queries. Otherwise reply with the answer JSON.`,
      });
      continue;
    }

    const answer = str(parsed.answer, 20_000);
    if (!answer && !lastChance && !repaired) {
      repaired = true;
      messages.push({ role: "assistant", content: reply.text.slice(0, 4000) });
      messages.push({ role: "user", content: 'Reply with {"answer": ...} now, or with {"queries": [...]} if you need data.' });
      continue;
    }
    // proposed changes: check them now, and give the model one chance to fix wrong ids
    let actions = arr(parsed.actions).filter((a): a is Record<string, unknown> => !!a && typeof a === "object").slice(0, 12);
    if (actions.length && checkAction) {
      const verdicts = await Promise.all(actions.map((a) => checkAction(a)));
      const bad = verdicts.map((v, i) => (v ? `action ${i + 1} (${str(actions[i].type, 30)}): ${v}` : null)).filter(Boolean);
      if (bad.length && !actionRetry && !lastChance) {
        actionRetry = true;
        messages.push({ role: "assistant", content: reply.text.slice(0, 6000) });
        messages.push({
          role: "user",
          content: `Some actions were rejected:\n${bad.join("\n")}\nQuery for the right ids if needed, then send the answer JSON again with corrected actions (or drop them).`,
        });
        emit.status("Checking the changes…");
        continue;
      }
      actions = actions.filter((_, i) => !verdicts[i]);
    }
    return {
      actions,
      content: answer || "I could not put an answer together this time. Try asking again, maybe more specifically.",
      blocks: buildBlocks(parsed, results),
      steps,
      model,
      title: str(parsed.title, 60) || null,
      remember: arr(parsed.remember).map((f) => str(f, 500)).filter(Boolean).slice(0, 5),
      forget: arr(parsed.forget).map((n) => Number(n)).filter((n) => Number.isInteger(n)).slice(0, 20),
    };
  }
  return { content: "I ran out of time before finishing. Ask again, or narrow the question.", blocks: [], steps, model, title: null, remember: [], forget: [], actions: [] };
}
