/** The pure part of the calendar: which days each view needs and where the arrows go. No database, so client components can import it. */
import { addDays, isoDow, parseDateStr, toDateStr, type DateStr } from "./time";

export type CalView = "day" | "week" | "month" | "year" | "agenda";
export const CAL_VIEWS: CalView[] = ["day", "week", "month", "year", "agenda"];

const mondayOf = (d: DateStr): DateStr => addDays(d, 1 - isoDow(d));

export function rangeFor(view: CalView, date: DateStr, today: DateStr): { from: DateStr; to: DateStr } {
  const { y, m } = parseDateStr(date);
  switch (view) {
    case "day": return { from: date, to: date };
    case "week": return { from: mondayOf(date), to: addDays(mondayOf(date), 6) };
    case "month": {
      const first = toDateStr(y, m, 1);
      const last = addDays(toDateStr(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1), -1);
      return { from: mondayOf(first), to: addDays(mondayOf(last), 6) };
    }
    case "year": return { from: toDateStr(y, 1, 1), to: toDateStr(y, 12, 31) };
    case "agenda": return { from: today, to: addDays(today, 29) };
  }
}

/** Where the arrows go. */
export function shiftDate(view: CalView, date: DateStr, dir: -1 | 1): DateStr {
  const { y, m, d } = parseDateStr(date);
  const clamp = (yy: number, mm: number) => Math.min(d, new Date(Date.UTC(yy, mm, 0)).getUTCDate());
  switch (view) {
    case "day": return addDays(date, dir);
    case "week": return addDays(date, 7 * dir);
    case "month": {
      const ny = m + dir < 1 ? y - 1 : m + dir > 12 ? y + 1 : y;
      const nm = m + dir < 1 ? 12 : m + dir > 12 ? 1 : m + dir;
      return toDateStr(ny, nm, clamp(ny, nm));
    }
    case "year": return toDateStr(y + dir, m, clamp(y + dir, m));
    case "agenda": return addDays(date, 30 * dir);
  }
}
