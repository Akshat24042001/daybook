/**
 * The time zone every date on screen is shown in: the owner's (Settings), never the machine's.
 * The server runs in UTC and the browser in the owner's zone; formatting without a zone made the same entry read
 * 12:55 pm on one render and 6:25 pm on the next. The app layout sets it on the server and in the browser.
 */
import { TZDate } from "@date-fns/tz";
import { DEFAULT_TZ } from "./time";

let zone = DEFAULT_TZ;

export function setDisplayTz(tz: string | null | undefined): void {
  if (!tz) return;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    zone = tz;
  } catch {
    /* an unknown zone keeps the last good one */
  }
}

export const displayTz = (): string => zone;

/** toLocaleString in the owner's zone. */
export function fmtZoned(d: string | number | Date, opts: Intl.DateTimeFormatOptions, locale: string | string[] = "en-IN"): string {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  return x.toLocaleString(locale, { ...opts, timeZone: zone });
}

/** The wall clock of an instant in the owner's zone: for datetime-local inputs and day keys. */
export function zonedParts(d: string | number | Date = new Date()): { y: number; m: number; d: number; h: number; mi: number } {
  const x = d instanceof Date ? d : new Date(d);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(x).map((t) => [t.type, t.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}

/** A value for <input type="datetime-local">, on the owner's clock. */
export function toZonedInput(d: string | number | Date = new Date()): string {
  const p = zonedParts(d);
  const z = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${z(p.m)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}

/** "2026-11-16T18:02" typed on the owner's clock, as an instant. Null when it is not a date and time. */
export function fromZonedInput(v: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v ?? "");
  if (!m) return null;
  return new Date(new TZDate(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, zone).getTime()).toISOString();
}
