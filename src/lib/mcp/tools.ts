/**
 * The tools Daybook offers to Claude over MCP. Small on purpose: read the day and the sales pipeline, add a task, tick
 * a task off, log the day's numbers. Nothing here can send a message to a client, move a deal or delete anything.
 */
import { q, UserError } from "../db";
import { parseQuickAdd } from "../parser";
import { getDeal, listDeals, timeline, commitments } from "../sales/deals";
import { describeSchedule } from "../sales/hunt-schedule";
import { listHunts, runHuntNow } from "../sales/hunts";
import { listMoves } from "../sales/moves";
import { entriesForDate, setEntryStatus } from "../services/entries";
import { setInstagram, setScore, setSleep, setSteps } from "../services/days";
import { createFromParsed } from "../services/tasks";
import { makeCtx } from "../settings";
import { addDays, type DateStr } from "../time";
import type { EntryStatus } from "../types";

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** true when the tool only reads */
  readOnly: boolean;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: EntryStatus[] = ["done", "progressed", "attempted", "skipped", "dropped", "open"];

function dateArg(v: unknown, fallback: DateStr): DateStr {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v !== "string" || !DATE.test(v) || Number.isNaN(Date.parse(v))) throw new UserError("date must look like 2026-11-06.");
  return v as DateStr;
}
function numArg(v: unknown, name: string, min: number, max: number): number | null {
  if (v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new UserError(`${name} must be a number from ${min} to ${max}.`);
  return v;
}

export const TOOLS: Tool[] = [
  {
    name: "daybook_today",
    description: "The owner's task list for a day (default today): each task with its status, must-do flag, project and estimate, plus the day's score, steps, sleep and Instagram minutes.",
    readOnly: true,
    inputSchema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD, default today" } }, additionalProperties: false },
    async run(a) {
      const ctx = await makeCtx();
      const date = dateArg(a.date, ctx.today);
      const [entries, day] = await Promise.all([
        entriesForDate(date),
        q<{ score: number | null; steps: number | null; sleep_minutes: number | null; instagram_minutes: number | null }>(
          "select score, steps, sleep_minutes, instagram_minutes from days where date = $1", [date]),
      ]);
      return {
        date,
        day: day[0] ?? { score: null, steps: null, sleep_minutes: null, instagram_minutes: null },
        tasks: entries.map((e) => ({
          entry_id: e.id, task_id: e.task_id, title: e.title, status: e.status, must_do: e.must_do, type: e.type,
          project: e.project_name, estimate_min: e.estimate_min, minutes_logged: e.minutes_today,
        })),
      };
    },
  },
  {
    name: "daybook_recent_days",
    description: "Score, steps, sleep and Instagram minutes for each of the last N days (default 14, max 90). Use it for trends.",
    readOnly: true,
    inputSchema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 90 } }, additionalProperties: false },
    async run(a) {
      const ctx = await makeCtx();
      const n = Math.round(numArg(a.days, "days", 1, 90) ?? 14);
      return q(
        `select date::text as date, score, steps, round(sleep_minutes / 60.0, 1) as sleep_hours, sleep_quality, instagram_minutes
         from days where date between $1 and $2 order by date desc`,
        [addDays(ctx.today, -(n - 1)), ctx.today],
      );
    },
  },
  {
    name: "daybook_add_task",
    description: "Add a task the way the quick-add bar does. The text can carry hints: '#project', '~30m' estimate, 'tomorrow', 'at 5pm', '!' for must-do. Example: 'Call the bank tomorrow at 11am ~15m #admin'.",
    readOnly: false,
    inputSchema: { type: "object", properties: { text: { type: "string", minLength: 1, maxLength: 500 } }, required: ["text"], additionalProperties: false },
    async run(a) {
      if (typeof a.text !== "string" || !a.text.trim()) throw new UserError("text is required.");
      const ctx = await makeCtx();
      const parsed = parseQuickAdd(a.text.slice(0, 500), { now: ctx.now, tz: ctx.tz, boundaryMin: ctx.boundaryMin });
      const { task, entry } = await createFromParsed(ctx, parsed, {});
      return { task_id: task.id, entry_id: entry?.id ?? null, title: task.title, date: entry?.date ?? null };
    },
  },
  {
    name: "daybook_set_task_status",
    description: "Change a task's status for its day: done, progressed, attempted, skipped, dropped, or open (to undo). Use an entry_id from daybook_today.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: { entry_id: { type: "integer" }, status: { type: "string", enum: STATUSES } },
      required: ["entry_id", "status"], additionalProperties: false,
    },
    async run(a) {
      if (!Number.isInteger(a.entry_id)) throw new UserError("entry_id must be an integer.");
      if (!STATUSES.includes(a.status as EntryStatus)) throw new UserError(`status must be one of ${STATUSES.join(", ")}.`);
      await setEntryStatus(await makeCtx(), a.entry_id as number, a.status as EntryStatus);
      return { ok: true };
    },
  },
  {
    name: "daybook_log_day",
    description: "Record the day's numbers. Any of: steps, sleep_hours (sleep that led into the day), instagram_minutes (daily limit is 60), score (0-10 self-rating). Defaults to today. Pass only what you want to change.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string" }, steps: { type: "integer", minimum: 0, maximum: 200000 }, sleep_hours: { type: "number", minimum: 0, maximum: 24 },
        instagram_minutes: { type: "integer", minimum: 0, maximum: 1440 }, score: { type: "number", minimum: 0, maximum: 10 },
      },
      additionalProperties: false,
    },
    async run(a) {
      const ctx = await makeCtx();
      const date = dateArg(a.date, ctx.today);
      if (date > ctx.today) throw new UserError("Only today or earlier.");
      const steps = numArg(a.steps, "steps", 0, 200000);
      const sleep = numArg(a.sleep_hours, "sleep_hours", 0, 24);
      const ig = numArg(a.instagram_minutes, "instagram_minutes", 0, 1440);
      const score = numArg(a.score, "score", 0, 10);
      if (steps === null && sleep === null && ig === null && score === null) throw new UserError("Nothing to log.");
      if (steps !== null) await setSteps(date, Math.round(steps));
      if (sleep !== null) await setSleep(date, Math.round(sleep * 60));
      if (ig !== null) await setInstagram(date, Math.round(ig));
      if (score !== null) await setScore(date, Math.round(score * 10) / 10);
      return { ok: true, date };
    },
  },
  {
    name: "sales_pipeline",
    description: "Every open sales deal: id, title, company, contact, stage, value, heat and number of open next-moves. Optionally filter by stage name.",
    readOnly: true,
    inputSchema: { type: "object", properties: { stage: { type: "string" } }, additionalProperties: false },
    async run(a) {
      const deals = await listDeals();
      const stage = typeof a.stage === "string" ? a.stage.trim().toLowerCase() : "";
      return deals
        .filter((d) => !stage || d.stage_name.toLowerCase() === stage || d.stage_role === stage)
        .slice(0, 200)
        .map((d) => ({
          id: d.id, title: d.title, company: d.company_name, contact: d.person_name, stage: d.stage_name, category: d.stage_category,
          value: d.value_amount, currency: d.currency, heat: d.heat, priority: d.priority, open_moves: d.open_moves, next_action: d.next_action,
        }));
    },
  },
  {
    name: "sales_deal",
    description: "One deal in detail: its card, open promises on both sides, and the latest 15 interactions.",
    readOnly: true,
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
    async run(a) {
      if (!Number.isInteger(a.id)) throw new UserError("id must be an integer.");
      const deal = await getDeal(a.id as number);
      if (!deal) throw new UserError("Deal not found.");
      const [promises, history] = await Promise.all([commitments(deal.id), timeline(deal.id, 15)]);
      return { deal, commitments: promises, recent_interactions: history };
    },
  },
  {
    name: "sales_next_moves",
    description: "The sales actions due in the next 48 hours (reply, follow up, send proposal, chase a payment), most urgent first. Read-only: nothing is sent.",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run() {
      const moves = await listMoves({ horizonHours: 48, limit: 20 });
      return moves.map((m) => ({ id: m.id, kind: m.kind, title: m.title, why: m.why, channel: m.channel, due_at: m.due_at, deal: m.deal_title, person: m.person_name, company: m.company_name }));
    },
  },
  {
    name: "sales_hunts",
    description: "The scheduled AI lead hunts: name, brief, schedule in words, next and last run, and what each found in the last 7 days (found, qualified, hot, turned into leads).",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run() {
      return (await listHunts()).map((h) => ({
        id: h.id, name: h.name, enabled: h.enabled, brief: h.brief, schedule: describeSchedule(h), next_run_at: h.next_run_at,
        last_run: h.last_run ? { at: h.last_run.started_at, status: h.last_run.status, found: h.last_run.found, error: h.last_run.error } : null, last_7_days: h.week,
      }));
    },
  },
  {
    name: "sales_run_hunt",
    description: "Run a lead hunt now (it starts within a minute; results appear on the Radar page and in Telegram). Use an id from sales_hunts.",
    readOnly: false,
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
    async run(a) {
      if (!Number.isInteger(a.id)) throw new UserError("id must be an integer.");
      await runHuntNow(a.id as number);
      return { queued: true };
    },
  },
  {
    name: "sales_add_target",
    description: "Add a radar target or trip from one plain line, e.g. \"I'm in Udaipur from 29 Nov to 2 Dec, hotels and wedding planners\" or \"Dubai real estate brokers, ongoing\". It starts searching within a minute. A trip stops after its last day and its messages ask to meet in person.",
    readOnly: false,
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
    async run(a) {
      const { parseTarget } = await import("../sales/targets");
      const { saveHunt } = await import("../sales/hunts");
      const t = await parseTarget(String(a.text ?? ""));
      const trip = t.kind === "trip";
      const id = await saveHunt({
        ...t, sweep_sources: !trip,
        ...(trip ? { schedule: "interval", every_hours: 8, window_from: 7, window_to: 23, signals: t.signals ?? ["requirement", "hiring", "launch", "review"] } : {}),
      });
      await runHuntNow(id);
      return { id, name: t.name, kind: t.kind, cities: t.cities, industries: t.industries, trip_from: t.trip_from, trip_to: t.trip_to, understood_by: t.by };
    },
  },
];
