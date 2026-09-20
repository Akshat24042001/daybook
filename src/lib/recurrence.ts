import { type DateStr, daysInMonth, isoDow, parseDateStr } from "./time";

/**
 * Minimal RRULE support for what the quick-add syntax can produce:
 *   FREQ=WEEKLY;BYDAY=MO[,TH]   FREQ=MONTHLY;BYMONTHDAY=1   FREQ=DAILY
 * Recurring tasks are expanded from their rule for a given calendar/logical date.
 */

const BYDAY: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

export function rruleMatches(rrule: string | null | undefined, date: DateStr): boolean {
  if (!rrule) return false;
  const parts = Object.fromEntries(
    rrule.split(";").map((kv) => {
      const [k, v] = kv.split("=");
      return [k.trim().toUpperCase(), (v ?? "").trim().toUpperCase()];
    }),
  ) as Record<string, string>;

  switch (parts.FREQ) {
    case "DAILY":
      return true;
    case "WEEKLY": {
      const days = (parts.BYDAY ?? "").split(",").map((d) => BYDAY[d]).filter(Boolean);
      return days.includes(isoDow(date));
    }
    case "MONTHLY": {
      const want = parseInt(parts.BYMONTHDAY ?? "", 10);
      if (!Number.isFinite(want)) return false;
      const { y, m, d } = parseDateStr(date);
      // "every 31st" falls on the last day of shorter months
      return d === Math.min(want, daysInMonth(y, m));
    }
    default:
      return false;
  }
}
