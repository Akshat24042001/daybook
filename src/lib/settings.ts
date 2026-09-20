import { one, q, UserError, type Db, getPool } from "./db";
import {
  type DateStr,
  dayWindow,
  isoDow,
  logicalDate,
  parseHM,
} from "./time";
import type { Settings } from "./types";

/**
 * Request context: "now" plus settings, resolved once so every service uses the
 * same clock and timezone. `now` is injectable so tests (and the dev-only time
 * travel header) can run any moment of the day.
 */
export interface Ctx {
  now: Date;
  s: Settings;
  tz: string;
  boundaryMin: number;
  today: DateStr;
}

export async function getSettings(db: Db = getPool()): Promise<Settings> {
  const row = await one<Settings>("select * from settings where id = 1", [], db);
  if (!row) throw new Error("settings row missing; run migrations");
  return row;
}

export function buildCtx(s: Settings, now: Date): Ctx {
  const boundaryMin = parseHM(s.day_boundary);
  return {
    now,
    s,
    tz: s.timezone,
    boundaryMin,
    today: logicalDate(now, s.timezone, boundaryMin),
  };
}

export async function makeCtx(now: Date = new Date(), db: Db = getPool()): Promise<Ctx> {
  return buildCtx(await getSettings(db), now);
}

export function windowOf(ctx: Ctx, date: DateStr): { start: Date; end: Date } {
  return dayWindow(date, ctx.tz, ctx.boundaryMin);
}

export function isWorkingDay(ctx: Ctx, date: DateStr): boolean {
  return ctx.s.working_days.includes(isoDow(date));
}

const HM_FIELDS = [
  "day_boundary", "morning_brief", "exercise_start", "exercise_end", "cadence_nudge",
  "evening_fallback", "score_reminder", "open_segment_check", "weekly_review_time",
  "quiet_start", "quiet_end",
] as const;

const NUM_FIELDS: Record<string, [number, number]> = {
  exercise_interval_min: [5, 240],
  task_lead_min: [0, 240],
  must_do_cap: [1, 5],
  available_hours: [1, 24],
  rot_threshold: [1, 50],
  step_goal: [0, 100000],
  weekly_review_day: [1, 7],
};

export type SettingsPatch = Partial<Omit<Settings, "telegram_chat_id" | "owner_user_id" | "last_tick_at">>;

/** Validates and saves editable settings (PRD section 13). Throws UserError on bad input. */
export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };

  if (patch.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: patch.timezone });
    } catch {
      throw new UserError(`"${patch.timezone}" is not a valid timezone.`);
    }
    add("timezone", patch.timezone);
  }
  for (const f of HM_FIELDS) {
    const v = patch[f];
    if (v === undefined) continue;
    if (!/^\d{1,2}:\d{2}$/.test(v)) throw new UserError(`${f.replace(/_/g, " ")} must look like HH:MM.`);
    const [h, m] = v.split(":").map(Number);
    if (h > 23 || m > 59) throw new UserError(`${f.replace(/_/g, " ")} is not a valid time.`);
    add(f, `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  for (const [f, [lo, hi]] of Object.entries(NUM_FIELDS)) {
    const v = (patch as Record<string, unknown>)[f];
    if (v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) {
      throw new UserError(`${f.replace(/_/g, " ")} must be between ${lo} and ${hi}.`);
    }
    add(f, n);
  }
  if (patch.working_days !== undefined) {
    const days = [...new Set(patch.working_days.map(Number))].filter((d) => d >= 1 && d <= 7).sort();
    if (days.length === 0) throw new UserError("Pick at least one working day.");
    add("working_days", days);
  }
  if (patch.exercise_paused !== undefined) add("exercise_paused", !!patch.exercise_paused);
  if (sets.length) await q(`update settings set ${sets.join(", ")} where id = 1`, vals);
  return getSettings();
}
