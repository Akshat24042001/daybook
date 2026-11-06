/** When a hunt runs next, and how to say it in words. Pure functions: no database. */
import { addDays, calendarDate, isoDow, zonedInstant, zonedParts, type DateStr } from "../time";

export interface Schedule {
  schedule: "interval" | "at";
  every_hours: number;
  /** "HH:MM" in your timezone (kind 'at') */
  at_time: string;
  /** ISO weekdays it may run on: 1 = Monday ... 7 = Sunday */
  days: number[];
  /** interval only: only start runs from this hour (0-23) up to, not including, this hour (1-24) */
  window_from: number;
  window_to: number;
}

const HOUR = 3_600_000;
const NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parseAt(at: string): [number, number] {
  const [h, m] = at.split(":").map(Number);
  return [Math.min(23, Math.max(0, h || 0)), Math.min(59, Math.max(0, m || 0))];
}

/** The first run time strictly after `after` that fits the schedule. Null when no weekday is allowed. */
export function nextRunAfter(s: Schedule, after: Date, tz: string): Date | null {
  const days = s.days.length ? s.days : [1, 2, 3, 4, 5, 6, 7];
  if (s.schedule === "at") {
    const [h, m] = parseAt(s.at_time);
    const start = calendarDate(after, tz);
    for (let i = 0; i < 9; i++) {
      const date = addDays(start, i);
      if (!days.includes(isoDow(date))) continue;
      const t = zonedInstant(date, h, m, tz);
      if (t.getTime() > after.getTime()) return t;
    }
    return null;
  }
  const from = Math.min(23, Math.max(0, s.window_from));
  const to = Math.min(24, Math.max(from + 1, s.window_to));
  let cand = new Date(after.getTime() + Math.max(1, s.every_hours) * HOUR);
  for (let i = 0; i < 400; i++) {
    const date: DateStr = calendarDate(cand, tz);
    const hour = zonedParts(cand, tz).h;
    const dayOk = days.includes(isoDow(date));
    if (dayOk && hour >= from && hour < to) return cand;
    // jump to the start of the next allowed window: later today if it has not opened yet, else tomorrow
    cand = dayOk && hour < from ? zonedInstant(date, from, 0, tz) : zonedInstant(addDays(date, 1), from, 0, tz);
  }
  return null;
}

export function describeSchedule(s: Schedule): string {
  const days = [...new Set(s.days)].sort((a, b) => a - b);
  const every = days.length === 7 || days.length === 0;
  const dayText = every ? "" : days.join() === "1,2,3,4,5" ? "weekdays" : days.map((d) => NAMES[d]).join(", ");
  if (s.schedule === "at") return `${every ? "Daily" : dayText[0].toUpperCase() + dayText.slice(1)} at ${s.at_time}`;
  const freq = s.every_hours === 1 ? "Every hour" : `Every ${s.every_hours} hours`;
  const win = s.window_from === 0 && s.window_to === 24 ? "" : `, ${String(s.window_from).padStart(2, "0")}:00 to ${String(s.window_to === 24 ? 0 : s.window_to).padStart(2, "0")}:00`;
  return `${freq}${win}${every ? "" : `, ${dayText}`}`;
}

/** Runs per day, averaged over a week. */
export function runsPerDay(s: Schedule): number {
  const days = new Set(s.days.length ? s.days : [1, 2, 3, 4, 5, 6, 7]).size;
  const perActiveDay = s.schedule === "at" ? 1 : Math.max(1, Math.ceil((Math.max(s.window_to, s.window_from + 1) - s.window_from) / Math.max(1, s.every_hours)));
  return (perActiveDay * days) / 7;
}

/** Web searches a hunt spends per day, so you can see the cost of a schedule before saving it. */
export function searchesPerDay(s: Schedule, queriesPerRun: number, keywords: number): number {
  return Math.round(runsPerDay(s) * (queriesPerRun + keywords));
}
