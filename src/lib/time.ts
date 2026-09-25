import { TZDate } from "@date-fns/tz";

/**
 * All timestamps are stored in UTC. Everything in this file converts to a
 * timezone (default Asia/Kolkata) only for display, scheduling and
 * "which day is this" logic. A "logical date" (DateStr) is the calendar date
 * after applying the day boundary (default 04:00), so 01:30 on the 20th still
 * belongs to the 19th.
 */

export type DateStr = string; // YYYY-MM-DD

export const DEFAULT_TZ = "Asia/Kolkata";
export const DEFAULT_BOUNDARY_MIN = 4 * 60;

const MIN = 60_000;

function ms(instant: Date | number): number {
  return instant instanceof Date ? instant.getTime() : instant;
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDateStr(y: number, m: number, d: number): DateStr {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function parseDateStr(s: DateStr): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) throw new Error(`Invalid date string: ${s}`);
  return { y: +match[1], m: +match[2], d: +match[3] };
}

/** Calendar-date arithmetic, independent of any timezone. */
export function addDays(date: DateStr, n: number): DateStr {
  const { y, m, d } = parseDateStr(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return toDateStr(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function diffDays(a: DateStr, b: DateStr): number {
  const pa = parseDateStr(a);
  const pb = parseDateStr(b);
  return Math.round(
    (Date.UTC(pa.y, pa.m - 1, pa.d) - Date.UTC(pb.y, pb.m - 1, pb.d)) / 86_400_000,
  );
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoDow(date: DateStr): number {
  const { y, m, d } = parseDateStr(date);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function dateRange(from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export interface ZonedParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

export function zonedParts(instant: Date | number, tz: string): ZonedParts {
  const z = new TZDate(ms(instant), tz);
  return {
    y: z.getFullYear(),
    m: z.getMonth() + 1,
    d: z.getDate(),
    h: z.getHours(),
    mi: z.getMinutes(),
    s: z.getSeconds(),
  };
}

/** Local calendar date (no day boundary applied). */
export function calendarDate(instant: Date | number, tz: string): DateStr {
  const p = zonedParts(instant, tz);
  return toDateStr(p.y, p.m, p.d);
}

/** Which day does this instant belong to, applying the day boundary. */
export function logicalDate(
  instant: Date | number,
  tz: string,
  boundaryMin: number,
): DateStr {
  return calendarDate(ms(instant) - boundaryMin * MIN, tz);
}

/** Instant for a local wall-clock time on a *calendar* date. */
export function zonedInstant(
  date: DateStr,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const { y, m, d } = parseDateStr(date);
  return new Date(new TZDate(y, m - 1, d, hour, minute, 0, tz).getTime());
}

/** [start, end) of a logical day: boundary o'clock to the next boundary o'clock. */
export function dayWindow(
  date: DateStr,
  tz: string,
  boundaryMin: number,
): { start: Date; end: Date } {
  const h = Math.floor(boundaryMin / 60);
  const mi = boundaryMin % 60;
  return {
    start: zonedInstant(date, h, mi, tz),
    end: zonedInstant(addDays(date, 1), h, mi, tz),
  };
}

export function parseHM(hm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!match) throw new Error(`Invalid HH:MM: ${hm}`);
  return +match[1] * 60 + +match[2];
}

export function formatHM(totalMin: number): string {
  const t = ((totalMin % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
}

/**
 * Instant for a wall-clock time (minutes since local midnight) that belongs to
 * a logical day. Times before the boundary (e.g. 01:30 with a 04:00 boundary)
 * fall on the next calendar date.
 */
export function atLogical(
  date: DateStr,
  minutesSinceMidnight: number,
  tz: string,
  boundaryMin: number,
): Date {
  const cal = minutesSinceMidnight < boundaryMin ? addDays(date, 1) : date;
  return zonedInstant(cal, Math.floor(minutesSinceMidnight / 60), minutesSinceMidnight % 60, tz);
}

/** Wall-clock "HH:MM" of an instant in the timezone. */
export function fmtHM(instant: Date | number, tz: string): string {
  const p = zonedParts(instant, tz);
  return `${pad2(p.h)}:${pad2(p.mi)}`;
}

/** 12-hour clock for messages, e.g. "5:00 PM". */
export function fmtClock(instant: Date | number, tz: string): string {
  const p = zonedParts(instant, tz);
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${h12}:${pad2(p.mi)} ${p.h < 12 ? "AM" : "PM"}`;
}

export function fmtDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${pad2(m)}m`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function weekdayName(date: DateStr): string {
  return WEEKDAYS[isoDow(date) % 7];
}

export function fmtDateLong(date: DateStr): string {
  const { y, m, d } = parseDateStr(date);
  return `${weekdayName(date)}, ${d} ${MONTHS[m - 1]} ${y}`;
}

export function fmtDateShort(date: DateStr): string {
  const { m, d } = parseDateStr(date);
  return `${d} ${MONTHS[m - 1]}`;
}

/**
 * The app's one short day format: "Thu, 24 Sep". Add the year only when it is not the current one
 * (pass `today` to decide), e.g. "Mon, 5 Jan 2025".
 */
export function fmtDay(date: DateStr, today?: DateStr): string {
  // never take a page down over a label: anything that is not YYYY-MM-DD is shown as it is
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const { y, m, d } = parseDateStr(date);
  const year = today && today.slice(0, 4) !== String(y) ? ` ${y}` : "";
  return `${weekdayName(date).slice(0, 3)}, ${d} ${MONTHS[m - 1]}${year}`;
}

/** "Today", "Yesterday", "Tomorrow", otherwise fmtDay. For anything within a day of today. */
export function fmtRelDay(date: DateStr, today: DateStr): string {
  const n = diffDays(date, today);
  if (n === 0) return "Today";
  if (n === -1) return "Yesterday";
  if (n === 1) return "Tomorrow";
  return fmtDay(date, today);
}

/** A range in one style: "21 – 27 Sep", "28 Sep – 4 Oct", "28 Dec 2025 – 3 Jan 2026". */
export function fmtRange(from: DateStr, to: DateStr): string {
  const a = parseDateStr(from);
  const b = parseDateStr(to);
  if (a.y !== b.y) return `${a.d} ${MONTHS[a.m - 1]} ${a.y} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]}`;
  return `${a.d} – ${b.d} ${MONTHS[b.m - 1]}`;
}

/** Monday of the week containing the date. */
export function weekStart(date: DateStr): DateStr {
  return addDays(date, -(isoDow(date) - 1));
}

export type TargetPeriod = "week" | "month" | "quarter" | "year";

export function periodStart(date: DateStr, period: TargetPeriod): DateStr {
  const { y, m } = parseDateStr(date);
  if (period === "week") return weekStart(date);
  if (period === "month") return toDateStr(y, m, 1);
  if (period === "year") return toDateStr(y, 1, 1);
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return toDateStr(y, qm, 1);
}

/** Last day (inclusive) of the period that starts at `start`. */
export function periodEnd(start: DateStr, period: TargetPeriod): DateStr {
  const { y, m } = parseDateStr(start);
  if (period === "week") return addDays(start, 6);
  if (period === "month") return toDateStr(y, m, daysInMonth(y, m));
  if (period === "year") return toDateStr(y, 12, 31);
  const lastMonth = m + 2;
  return toDateStr(y, lastMonth, daysInMonth(y, lastMonth));
}

export const DAY_MS = 86_400_000;
export const MIN_MS = MIN;
