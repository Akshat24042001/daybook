import { createHmac } from "node:crypto";
import { q } from "../db";
import { LINK_PARAM, LINK_TTL_SEC, tokenSecret } from "../session-token";
import { SECTION_LABEL, SECTION_ORDER, dueFor, sectionize } from "../sections";
import type { Ctx } from "../settings";
import { fmtDateLong, fmtDuration, fmtHM, addDays, type DateStr, weekdayName, fmtDateShort } from "../time";
import type { EntryStatus, EntryView } from "../types";
import { entriesForDate } from "../services/entries";
import { getDay, recapFor } from "../services/days";
import { cadenceToNudge, listCadence, targetsBehind } from "../services/goals";
import { exerciseCounts, lastExercise, listExerciseTypes, type ExerciseType } from "../services/health";
import { unresolvedEntries } from "../services/plan";
import { esc, type Button, type ForceReply, type InlineMarkup } from "./api";
import { getSummary, listEntries } from "../services/diary";
import { touchStates } from "../services/keep-in-touch";

export interface Msg {
  text: string;
  markup?: InlineMarkup;
  /** ask Telegram to open a reply box instead of showing buttons (the reply is routed by the message id) */
  forceReply?: ForceReply;
}

const btn = (text: string, callback_data: string): Button => ({ text, callback_data });

export function isHttpsBase(): boolean {
  return /^https:\/\//i.test(process.env.APP_BASE_URL ?? "");
}

/** Same token as makeToken("link") in session-token.ts, computed synchronously for message builders. */
export function linkToken(nowMs = Date.now()): string | null {
  const key = tokenSecret();
  if (!key) return null;
  const exp = Math.floor(nowMs / 1000) + LINK_TTL_SEC;
  return `${exp}.${createHmac("sha256", key).update(`link.${exp}`).digest("base64url")}`;
}

export function appUrl(path: string, auth = false): string {
  const raw = process.env.APP_BASE_URL ?? "";
  let base: string;
  try { base = new URL(raw).origin; } catch { base = raw.replace(/\/$/, ""); }
  const token = auth ? linkToken() : null;
  const sep = path.includes("?") ? "&" : "?";
  return token ? `${base}${path}${sep}${LINK_PARAM}=${token}` : `${base}${path}`;
}

/** Telegram only accepts https URLs on buttons, so URL buttons are dropped for http://localhost.
 *  URLs carry a signed link token (session-token.ts) so they open signed in inside Telegram's WebView without a
 *  session cookie. The token expires after two weeks and never contains the password. */
export function urlBtn(text: string, path: string): Button | null {
  return isHttpsBase() ? { text, url: appUrl(path, true) } : null;
}

export function inline(rows: (Button | null | undefined)[][]): InlineMarkup {
  return {
    inline_keyboard: rows
      .map((r) => r.filter((b): b is Button => !!b))
      .filter((r) => r.length > 0),
  };
}

export const STATUS_EMOJI: Record<EntryStatus, string> = {
  open: "▫️",
  done: "✅",
  progressed: "↗️",
  attempted: "↩️",
  skipped: "✗",
  dropped: "🗑",
  waiting: "⏳",
};
export const STATUS_WORD: Record<EntryStatus, string> = {
  open: "Open",
  done: "Done",
  progressed: "Progressed",
  attempted: "Attempted",
  skipped: "Not today",
  dropped: "Dropped",
  waiting: "Waiting",
};

/** yymmdd, compact enough for the 64-byte callback_data limit. */
export function packDate(d: DateStr): string {
  return d.slice(2).replace(/-/g, "");
}
export function unpackDate(s: string): DateStr {
  return `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
}

function titleOf(e: Pick<EntryView, "title" | "project_name">): string {
  return e.project_name ? `${esc(e.project_name)}: ${esc(e.title)}` : esc(e.title);
}

function timeSuffix(ctx: Ctx, e: EntryView): string {
  const due = dueFor(e, ctx.tz, ctx.boundaryMin);
  return due ? ` (${fmtHM(due, ctx.tz)})` : "";
}

/** Task action message (PRD 9.3), sent from the Today list or a reminder. */
export function taskAction(ctx: Ctx, e: EntryView, prefix = ""): Msg {
  const meta: string[] = [];
  if (e.person_name) meta.push(`${e.person_role === "requested_by" ? "requested by" : "with"} ${esc(e.person_name)}`);
  if (e.minutes_today) meta.push(`${fmtDuration(e.minutes_today)} logged`);
  if (e.carry_count >= 2) meta.push(`carried ${e.carry_count}×`);
  if (e.status !== "open") meta.push(`${STATUS_EMOJI[e.status]} ${STATUS_WORD[e.status]}`);
  const text = `${prefix}<b>${titleOf(e)}</b>${timeSuffix(ctx, e)}${meta.length ? `\n${meta.join(" · ")}` : ""}`;
  const id = e.id;
  return {
    text,
    markup: inline([
      [btn("✅ Done", `t:d:${id}`), btn("↗ Progressed", `t:p:${id}`), btn("📞 Attempted", `t:a:${id}`)],
      [btn("⏰ +30m", `t:z:${id}`), btn("🗓 Tomorrow", `t:m:${id}`), btn("✗ Not today", `t:s:${id}`)],
      [btn("⏳ Waiting on…", `t:w:${id}`), btn("📝 Note", `t:n:${id}`)],
      [urlBtn("✏️ Open in app", `/task/${e.task_id}`)],
    ]),
  };
}

export const MINUTE_CHIPS = [5, 10, 15, 20, 30, 45, 60, 90, 120];

export function minutesPrompt(e: EntryView, status: EntryStatus): Msg {
  return {
    text: `${STATUS_EMOJI[status]} <b>${titleOf(e)}</b>: ${STATUS_WORD[status]}. How long did you spend?`,
    markup: inline([
      MINUTE_CHIPS.slice(0, 5).map((m) => btn(String(m), `tm:${e.id}:${m}`)),
      MINUTE_CHIPS.slice(5).map((m) => btn(String(m), `tm:${e.id}:${m}`)),
      [btn("No time", `tm:${e.id}:0`)],
    ]),
  };
}

export function retryPrompt(e: EntryView): Msg {
  return {
    text: `📞 <b>${titleOf(e)}</b>: Attempted. Retry when?`,
    markup: inline([
      [btn("In 2h", `rt:${e.id}:2h`), btn("Tomorrow AM", `rt:${e.id}:am`), btn("Tomorrow PM", `rt:${e.id}:pm`)],
      [urlBtn("Pick on web", `/task/${e.task_id}`)],
    ]),
  };
}

function bullet(ctx: Ctx, e: EntryView): string {
  const bits: string[] = [];
  if (e.project_name) bits.push(esc(e.project_name));
  if (e.minutes_today) bits.push(fmtDuration(e.minutes_today));
  if (e.carry_count >= 3) bits.push(`carried ${e.carry_count}×`);
  return `${STATUS_EMOJI[e.status]} ${esc(e.title)}${timeSuffix(ctx, e)}${bits.length ? ` · ${bits.join(" · ")}` : ""}`;
}

/** 📋 Today: compact list, inline buttons for the must-dos, [Open Today]. */
export async function todayList(ctx: Ctx): Promise<Msg> {
  const entries = await entriesForDate(ctx.today);
  const sec = sectionize(entries, ctx.tz, ctx.boundaryMin);
  const lines: string[] = [`<b>Today · ${fmtDateLong(ctx.today)}</b>`];
  if (entries.length === 0) lines.push("Nothing planned. Send a message to add a task.");
  for (const key of SECTION_ORDER) {
    const list = sec[key];
    if (!list.length) continue;
    if (key === "done") {
      lines.push(`\n<b>Done (${list.length})</b>`);
      continue;
    }
    lines.push(`\n<b>${SECTION_LABEL[key]}${key === "personal" ? ` (${list.length})` : ""}</b>`);
    for (const e of list) lines.push(bullet(ctx, e));
  }
  const openMust = sec.must.filter((e) => e.status !== "done");
  return {
    text: lines.join("\n"),
    markup: inline([
      ...openMust.map((e) => [btn(`⭐ ${e.title}`.slice(0, 60), `t:o:${e.id}`)]),
      [urlBtn("Open Today", "/today")],
    ]),
  };
}

// ---------------------------------------------------------------- keep in touch

/** Daily "reach out" nudge: the 3 most overdue contacts, each with Talked / Snooze. Null when nobody is due. */
export async function touchNudge(ctx: Ctx, heading = "🤝 <b>Keep in touch</b>"): Promise<Msg | null> {
  const due = (await touchStates(ctx.today, ctx.tz)).filter((s) => s.due);
  if (!due.length) return null;
  const top = due.slice(0, 3);
  const lines = [heading, ...top.map((s) => `• <b>${esc(s.name)}</b>: ${s.lastTouch ? `last touch ${s.sinceDays} days ago` : `no touch in ${s.sinceDays} days`}`)];
  if (due.length > 3) lines.push(`…and ${due.length - 3} more on the Contacts page.`);
  return {
    text: lines.join("\n"),
    markup: inline([
      ...top.map((s) => [btn(`✓ Talked to ${s.name}`.slice(0, 40), `kt:t:${s.contactId}`), btn("😴 1 week", `kt:z:${s.contactId}`)]),
      [urlBtn("Open Contacts", "/contacts")],
    ]),
  };
}

// ---------------------------------------------------------------- diary

/** Evening "how did today go?" prompt. Sent only when nothing has been written for the day yet. */
export async function diaryPrompt(date: DateStr): Promise<Msg | null> {
  if ((await listEntries(date)).length > 0) return null;
  return {
    text:
      "📔 <b>How did today go?</b>\n" +
      "Reply to this message with a voice note or a few lines: what happened, who you met, how you felt. " +
      "I'll add it to your diary and write the day's summary.",
    forceReply: { force_reply: true, input_field_placeholder: "Speak or type about your day" },
  };
}

// ---------------------------------------------------------------- morning brief

export async function morningBrief(ctx: Ctx): Promise<Msg> {
  const today = ctx.today;
  const yesterday = addDays(today, -1);
  const entries = await entriesForDate(today);
  const sec = sectionize(entries, ctx.tz, ctx.boundaryMin);
  const y = await recapFor(ctx, yesterday);
  const day = await getDay(today);
  const lines: string[] = [`☀️ <b>Morning brief · ${weekdayName(today)} ${fmtDateShort(today)}</b>`];

  const yBits: string[] = [];
  yBits.push(y.score !== null ? `score ${y.score}` : "no score");
  yBits.push(`${fmtDuration(y.worked)} worked`);
  yBits.push(`${y.counts.done} done`);
  lines.push(`Yesterday: ${yBits.join(" · ")}`);
  // the nightly diary summary, when it exists
  const ySummary = await getSummary(yesterday).catch(() => null);
  if (ySummary) lines.push(`📔 ${ySummary.rating !== null ? `<b>${ySummary.rating}/10</b> · ` : ""}<i>${esc(ySummary.headline)}</i>`);

  const planned = !!day?.planned_at && day.planned_at.getTime() < ctx.now.getTime();
  const autoCarried = entries.filter((e) => e.source === "auto" && e.carried_from).length;
  if (!planned) {
    lines.push(`You did not plan last night. ${autoCarried} ${autoCarried === 1 ? "task" : "tasks"} auto-carried.`);
  }

  const section = (label: string, list: EntryView[]) => {
    if (!list.length) return;
    lines.push(`\n<b>${label}</b>`);
    for (const e of list) lines.push(bullet(ctx, e));
  };
  section("Must do", sec.must);
  section("Timed", sec.timed);
  section("Follow-ups", sec.followups);
  section("Other", sec.other);
  if (sec.personal.length) lines.push(`\n<b>Personal</b>: ${sec.personal.length} ${sec.personal.length === 1 ? "task" : "tasks"}`);
  if (!entries.length) lines.push("\nNothing planned for today.");

  const behind = await targetsBehind(ctx);
  if (behind.length) {
    lines.push("\n<b>Targets behind pace</b>");
    for (const b of behind) {
      const prog = b.task.goal_min ? `${fmtDuration(b.minutes)} of ${fmtDuration(b.task.goal_min)}` : b.task.goal_count ? `${b.count} of ${b.task.goal_count}` : "not done";
      lines.push(`• ${esc(b.task.title)}: ${prog}, ${b.daysLeft}d left`);
    }
  }
  const overdue = (await listCadence(ctx)).filter((c) => c.overdue);
  if (overdue.length) {
    lines.push("\n<b>Overdue cadence</b>");
    for (const c of overdue) lines.push(`• ${esc(c.task.title)}: ${c.daysSince} of ${c.limit} days`);
  }
  const rotting = await q<{ title: string; carry_count: number }>(
    "select title, carry_count from tasks where state = 'active' and carry_count >= $1 order by carry_count desc limit 5",
    [ctx.s.rot_threshold],
  );
  if (rotting.length) {
    lines.push("\n<b>Rotting (carried too often)</b>");
    for (const r of rotting) lines.push(`• ${esc(r.title)}: ${r.carry_count}×`);
  }

  const askSleep = day?.sleep_minutes == null;
  if (askSleep) lines.push("\n😴 <b>How long did you sleep?</b> Tap below, or type <code>slept 7h</code>.");

  return {
    text: lines.join("\n"),
    markup: inline([
      ...(askSleep ? sleepKeyboard(today) : []),
      [planned ? urlBtn("Open Today", "/today") : urlBtn("Plan now", `/plan?date=${today}`), btn("🏢 At office", "sw:office")],
    ]),
  };
}

// ---------------------------------------------------------------- sleep

const SLEEP_PRESETS_MIN = [300, 360, 390, 420, 450, 480, 540];

/** One tap per common duration: sl:<minutes>:<yymmdd> */
export function sleepKeyboard(date: DateStr): Button[][] {
  const d = packDate(date);
  const label = (m: number) => `${Math.floor(m / 60)}${m % 60 ? "½" : ""}h`;
  return [
    SLEEP_PRESETS_MIN.slice(0, 4).map((m) => btn(label(m), `sl:${m}:${d}`)),
    SLEEP_PRESETS_MIN.slice(4).map((m) => btn(label(m), `sl:${m}:${d}`)),
  ];
}

/** How well: sq:<1-5>:<yymmdd> */
export function sleepQualityKeyboard(date: DateStr): Button[][] {
  const d = packDate(date);
  return [[1, 2, 3, 4, 5].map((n) => btn(["😫", "😕", "😐", "🙂", "😄"][n - 1], `sq:${n}:${d}`))];
}

// ---------------------------------------------------------------- recap, score, steps

const SCORE_ROW_1 = [0, 1, 2, 3, 4, 5];
const SCORE_ROW_2 = [6, 7, 8, 9, 10];
const STEP_PRESETS = [2000, 4000, 6000, 8000, 10000];

export function scoreKeyboard(date: DateStr, score: number | null): Button[][] {
  const d = packDate(date);
  if (score !== null) {
    // a whole score gets a one-tap half point, like tapping the same number twice on the web
    const half = Number.isInteger(score) && score < 10 ? [btn(`${score}.5`, `sc:s:${score}.5:${d}`)] : [];
    return [[btn(`Score ${score} ✓ (change)`, `sc:c:${d}`), ...half]];
  }
  const mk = (n: number) => btn(String(n), `sc:s:${n}:${d}`);
  return [SCORE_ROW_1.map(mk), SCORE_ROW_2.map(mk)];
}

export function scoreDecimals(date: DateStr, n: number): Button[][] {
  const d = packDate(date);
  return [[btn(`${n}.0`, `sc:s:${n}:${d}`), btn(`${n}.5`, `sc:s:${n}.5:${d}`), btn("← back", `sc:c:${d}`)]];
}

export function stepsKeyboard(date: DateStr, steps: number | null): Button[][] {
  const d = packDate(date);
  if (steps === null) return [STEP_PRESETS.map((v) => btn(`${v / 1000}k`, `st:${v}:${d}`))];
  return [
    STEP_PRESETS.map((v) => btn(`${v / 1000}k`, `st:${v}:${d}`)),
    [
      btn("-500", `st:${Math.max(0, steps - 500)}:${d}`),
      btn(`${steps.toLocaleString("en-US")} steps`, `st:${steps}:${d}`),
      btn("+500", `st:${steps + 500}:${d}`),
    ],
  ];
}

export async function recapMessage(ctx: Ctx, date: DateStr, opts: { scoreGrid?: boolean } = {}): Promise<Msg> {
  const r = await recapFor(ctx, date);
  const line1 = `📊 <b>Recap · ${weekdayName(date)} ${fmtDateShort(date)}</b>: worked ${fmtDuration(r.worked)}`;
  const line2 = `${r.counts.done} done · ${r.counts.progressed} progressed · ${r.counts.attempted} attempted · ${r.counts.skipped} not today${r.counts.waiting ? ` · ${r.counts.waiting} waiting` : ""}`;
  const un = `Unaccounted ${fmtDuration(r.unaccountedMin)} (${Math.round(r.unaccountedPct)}%)`;
  const md = r.mustDoTotal ? `must-dos ${r.mustDoHit}/${r.mustDoTotal}` : "no must-dos";
  const tomorrow = addDays(date, 1);
  return {
    text: `${line1}\n${line2}\n${un} · ${md}`,
    markup: inline([
      ...scoreKeyboard(date, opts.scoreGrid ? null : r.score),
      ...stepsKeyboard(date, r.steps),
      [urlBtn("Plan tomorrow", `/plan?date=${tomorrow}`)],
    ]),
  };
}

/** Rebuilds only the keyboard of a recap/score message from the current database state. */
export async function recapMarkup(ctx: Ctx, date: DateStr, opts: { scoreGrid?: boolean } = {}): Promise<InlineMarkup> {
  return (await recapMessage(ctx, date, opts)).markup!;
}

export async function scoreReminder(ctx: Ctx, date: DateStr): Promise<Msg | null> {
  const day = await getDay(date);
  if (day?.score !== null && day?.score !== undefined) return null;
  return {
    text: `🙂 How was ${date === ctx.today ? "today" : fmtDateShort(date)}? Score it out of 10.\nOr type <code>score 8.5</code> for a half point.`,
    markup: inline([...scoreKeyboard(date, null), [urlBtn("Open Today", "/today")]]),
  };
}

/** Evening reminder if tomorrow has no planned entries yet. */
export async function planTomorrowReminder(ctx: Ctx): Promise<Msg | null> {
  const tomorrow = addDays(ctx.today, 1);
  const rows = await q<{ n: number }>(
    "select count(*)::int as n from day_entries where date = $1 and status = 'open'",
    [tomorrow],
  );
  if ((rows[0]?.n ?? 0) > 0) return null;
  return {
    text: `📅 <b>Tomorrow isn't planned yet.</b>\nAdd at least one task so you wake up with a direction.`,
    markup: inline([[urlBtn("Plan tomorrow", `/plan?date=${tomorrow}`)]]),
  };
}

/** Alert if any must-dos for today are still open near end of working hours. */
export async function mustDoOpenReminder(ctx: Ctx): Promise<Msg | null> {
  const rows = await q<{ title: string }>(
    `select t.title from day_entries e join tasks t on t.id = e.task_id
     where e.date = $1 and e.must_do and e.status = 'open' and t.state = 'active'
     order by e.id limit 5`,
    [ctx.today],
  );
  if (rows.length === 0) return null;
  const list = rows.map((r) => `• ${esc(r.title)}`).join("\n");
  return {
    text: `⚠️ <b>${rows.length} must-do${rows.length === 1 ? "" : "s"} still open</b>\n${list}`,
    markup: inline([[urlBtn("Open Today", "/today")]]),
  };
}

/** Reminder to log task time if worked > 0 but logged minutes = 0 for today. */
export async function timeLogReminder(ctx: Ctx): Promise<Msg | null> {
  const [workedRow, loggedRow] = await Promise.all([
    q<{ n: number }>(
      "select count(*)::int as n from work_segments where start_at::date = $1 and kind = 'work'",
      [ctx.today],
    ),
    q<{ m: number }>(
      "select coalesce(sum(minutes),0)::int as m from time_logs where date = $1",
      [ctx.today],
    ),
  ]);
  const worked = (workedRow[0]?.n ?? 0) > 0;
  const logged = (loggedRow[0]?.m ?? 0) > 0;
  if (!worked || logged) return null;
  return {
    text: `⏱ <b>No task time logged today.</b>\nYou worked but didn't log minutes against any task. Takes 30 seconds.`,
    markup: inline([[urlBtn("Log time", "/today")]]),
  };
}

// ---------------------------------------------------------------- exercise

export const SLOT_STEP = 5;

export function slotCode(slot: Date): string {
  return Math.floor(slot.getTime() / 60000).toString(36);
}
export function slotFromCode(code: string): Date {
  return new Date(parseInt(code, 36) * 60000);
}

function amountLabel(t: Pick<ExerciseType, "name" | "unit">, amount: number): string {
  return t.unit === "seconds" ? `${amount}s ${esc(t.name)}` : `${amount} ${esc(t.name)}`;
}

export async function exerciseCountsLine(date: DateStr): Promise<string> {
  const c = await exerciseCounts(date);
  const bits = [`${c.done} done`];
  if (c.skipped) bits.push(`${c.skipped} skipped`);
  if (c.missed) bits.push(`${c.missed} missed`);
  return bits.join(", ");
}

export async function exercisePing(ctx: Ctx, slot: Date, typeId?: number, amount?: number): Promise<Msg> {
  const clock = fmtHM(slot, ctx.tz);
  const counts = await exerciseCountsLine(ctx.today);
  const sc = slotCode(slot);
  let type: ExerciseType | undefined;
  let amt = amount;
  if (typeId !== undefined) {
    type = (await listExerciseTypes(false)).find((t) => t.id === typeId);
    if (type && amt === undefined) amt = type.default_amount;
  } else {
    const last = await lastExercise();
    if (last) {
      type = last.type;
      amt = last.amount;
    }
  }
  if (!type || amt === undefined) {
    return {
      text: `💪 ${clock} exercise. Today: ${counts}.\nNo exercise types yet. Add some in Settings.`,
      markup: inline([[urlBtn("Open Health", "/health")], [btn("⏭ Skip", `ex:s:${sc}`)]]),
    };
  }
  const shown = type.unit === "seconds" ? `${amt}s` : String(amt);
  return {
    text: `💪 ${clock} exercise. Today: ${counts}.`,
    markup: inline([
      [btn(`✅ Log ${amountLabel(type, amt)}`, `ex:d:${type.id}:${amt}:${sc}`)],
      [
        btn("-5", `ex:a:${type.id}:${Math.max(1, amt - SLOT_STEP)}:${sc}`),
        btn(shown, "ex:n"),
        btn("+5", `ex:a:${type.id}:${amt + SLOT_STEP}:${sc}`),
      ],
      [btn("🔄 Change exercise", `ex:c:${sc}`), btn("⏭ Skip", `ex:s:${sc}`)],
    ]),
  };
}

export async function exerciseTypePicker(ctx: Ctx, slot: Date): Promise<Msg> {
  const types = await listExerciseTypes(true);
  const sc = slotCode(slot);
  return {
    text: `💪 ${fmtHM(slot, ctx.tz)} exercise. Pick one:`,
    markup: inline([
      ...types.map((t) => [btn(`${t.name} (${t.unit === "seconds" ? `${t.default_amount}s` : t.default_amount})`, `ex:t:${t.id}:${sc}`)]),
    ]),
  };
}

// ---------------------------------------------------------------- misc small messages

export function openSegmentPrompt(ctx: Ctx, since: Date, kindLabel: string): Msg {
  return {
    text: `⏱ You are still on <b>${kindLabel}</b> since ${fmtHM(since, ctx.tz)}. When did you finish?`,
    markup: inline([
      [btn("End now", "sg:e:0"), btn("Ended 1h ago", "sg:e:60"), btn("Ended 2h ago", "sg:e:120")],
      [urlBtn("Fix on web", "/today")],
    ]),
  };
}

export async function cadenceNudge(ctx: Ctx, taskId: number): Promise<Msg | null> {
  const c = (await cadenceToNudge(ctx)).find((x) => x.task.id === taskId);
  if (!c) return null;
  return {
    text: `🔁 <b>${esc(c.task.title)}</b>: ${c.daysSince} of ${c.limit} days since last done.`,
    markup: inline([
      [btn("Do it today", `cd:t:${taskId}`), btn("Snooze 1 day", `cd:s:${taskId}`), urlBtn("Open", `/goals`)],
    ]),
  };
}

export async function unresolvedCount(ctx: Ctx): Promise<number> {
  return (await unresolvedEntries(addDays(ctx.today, 1))).length;
}
