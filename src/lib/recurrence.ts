import { type DateStr, addDays, daysInMonth, diffDays, isoDow, parseDateStr } from "./time";

/**
 * Repeat rules for recurring tasks. Stored as an RRULE-style string in tasks.rrule, a readable subset of the calendar
 * standard plus a few Daybook keys:
 *
 *   FREQ=DAILY|WEEKLY|MONTHLY|YEARLY   INTERVAL=n           (every n days / weeks / months / years)
 *   BYDAY=MO,TU,…                      weekdays (a filter for DAILY; the days for WEEKLY)
 *   BYDAY=1MO / -1FR                   MONTHLY: the first Monday, the last Friday (1..4 or -1)
 *   BYMONTHDAY=1,15,-1                 MONTHLY/YEARLY: days of the month, -1 = the last day
 *   BYMONTH=3                          YEARLY: the month
 *   DTSTART=YYYYMMDD                   first possible day, and the anchor for "every n"
 *   UNTIL=YYYYMMDD | COUNT=n           when it ends
 *   EXDATE=YYYYMMDD,…                  days it is skipped
 *   X-PAUSE=YYYYMMDD                   paused up to and including this day
 *   X-MISSED=SKIP|CARRY                a missed day: comes back next time (default) or stays until done
 *
 * Old rules (FREQ=WEEKLY;BYDAY=MO, FREQ=MONTHLY;BYMONTHDAY=1, FREQ=DAILY) read exactly as before.
 */

export type Freq = "daily" | "weekly" | "monthly" | "yearly";
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";
export const WEEKDAYS: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const DOW: Record<Weekday, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
export const WEEKDAY_NAME: Record<Weekday, string> = {
  MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday", SU: "Sunday",
};

export interface Repeat {
  freq: Freq;
  interval: number;
  /** DAILY: only these days (empty = every day). WEEKLY: the days. */
  days: Weekday[];
  /** MONTHLY: "on day 1 and 15" (monthDays) or "on the first Monday" (nth + nthDay). YEARLY: month + monthDays[0]. */
  monthDays: number[];
  nth: number | null;
  nthDay: Weekday | null;
  month: number | null;
  start: DateStr | null;
  until: DateStr | null;
  count: number | null;
  except: DateStr[];
  pauseUntil: DateStr | null;
  missed: "skip" | "carry";
}

export function defaultRepeat(start: DateStr | null = null): Repeat {
  return {
    freq: "daily", interval: 1, days: [], monthDays: [], nth: null, nthDay: null, month: null,
    start, until: null, count: null, except: [], pauseUntil: null, missed: "skip",
  };
}

const ymd = (s: string): DateStr | null => {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const compact = (d: DateStr) => d.replace(/-/g, "");

/** Reads a stored rule. Unknown or broken parts are ignored; returns null if there is no usable frequency. */
export function parseRepeat(rrule: string | null | undefined): Repeat | null {
  if (!rrule) return null;
  const parts = new Map<string, string>();
  for (const kv of rrule.split(";")) {
    const i = kv.indexOf("=");
    if (i > 0) parts.set(kv.slice(0, i).trim().toUpperCase(), kv.slice(i + 1).trim().toUpperCase());
  }
  const FREQ_OF: Record<string, Freq> = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" };
  const freq: Freq | undefined = FREQ_OF[parts.get("FREQ") ?? ""];
  if (!freq) return null;
  const r = defaultRepeat();
  r.freq = freq;
  const interval = parseInt(parts.get("INTERVAL") ?? "1", 10);
  r.interval = Number.isFinite(interval) && interval >= 1 && interval <= 365 ? interval : 1;
  for (const tok of (parts.get("BYDAY") ?? "").split(",").filter(Boolean)) {
    const m = /^([+-]?\d)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(tok);
    if (!m) continue;
    if (m[1] && freq === "monthly") {
      const n = parseInt(m[1], 10);
      if ((n >= 1 && n <= 4) || n === -1) {
        r.nth = n;
        r.nthDay = m[2] as Weekday;
      }
    } else if (!r.days.includes(m[2] as Weekday)) r.days.push(m[2] as Weekday);
  }
  r.days.sort((a, b) => DOW[a] - DOW[b]);
  r.monthDays = (parts.get("BYMONTHDAY") ?? "").split(",").map((x) => parseInt(x, 10))
    .filter((n) => Number.isInteger(n) && ((n >= 1 && n <= 31) || n === -1))
    .filter((n, i, a) => a.indexOf(n) === i)
    .sort((a, b) => (a === -1 ? 99 : a) - (b === -1 ? 99 : b));
  const month = parseInt(parts.get("BYMONTH") ?? "", 10);
  r.month = month >= 1 && month <= 12 ? month : null;
  r.start = ymd(parts.get("DTSTART") ?? "");
  r.until = ymd(parts.get("UNTIL") ?? "");
  const count = parseInt(parts.get("COUNT") ?? "", 10);
  r.count = Number.isInteger(count) && count >= 1 ? Math.min(count, 5000) : null;
  r.except = (parts.get("EXDATE") ?? "").split(",").map(ymd).filter((d): d is DateStr => !!d).sort();
  r.pauseUntil = ymd(parts.get("X-PAUSE") ?? "");
  r.missed = parts.get("X-MISSED") === "CARRY" ? "carry" : "skip";
  // a weekly rule with no day falls back to the start day's weekday at match time; keep it as given
  return r;
}

/** Writes a rule back to its stored form (only the keys that matter, in a stable order). */
export function formatRepeat(r: Repeat): string {
  const out = [`FREQ=${r.freq.toUpperCase()}`];
  if (r.interval > 1) out.push(`INTERVAL=${r.interval}`);
  if (r.freq === "monthly" && r.nth && r.nthDay) out.push(`BYDAY=${r.nth}${r.nthDay}`);
  else if ((r.freq === "daily" || r.freq === "weekly") && r.days.length) out.push(`BYDAY=${r.days.join(",")}`);
  if ((r.freq === "monthly" && !(r.nth && r.nthDay)) || r.freq === "yearly") {
    if (r.monthDays.length) out.push(`BYMONTHDAY=${(r.freq === "yearly" ? r.monthDays.slice(0, 1) : r.monthDays).join(",")}`);
  }
  if (r.freq === "yearly" && r.month) out.push(`BYMONTH=${r.month}`);
  if (r.start) out.push(`DTSTART=${compact(r.start)}`);
  if (r.until) out.push(`UNTIL=${compact(r.until)}`);
  else if (r.count) out.push(`COUNT=${r.count}`);
  if (r.except.length) out.push(`EXDATE=${[...new Set(r.except)].sort().map(compact).join(",")}`);
  if (r.pauseUntil) out.push(`X-PAUSE=${compact(r.pauseUntil)}`);
  if (r.missed === "carry") out.push("X-MISSED=CARRY");
  return out.join(";");
}

/** Checks a rule and returns what is wrong with it, in words, or null. */
export function repeatProblem(r: Repeat): string | null {
  if (r.freq === "weekly" && !r.days.length) return "Pick at least one day of the week.";
  if (r.freq === "monthly" && !r.monthDays.length && !(r.nth && r.nthDay)) return "Pick a day of the month.";
  if (r.freq === "yearly" && (!r.month || !r.monthDays.length)) return "Pick the date it repeats on.";
  if (r.until && r.start && r.until < r.start) return "The end date is before the start date.";
  return null;
}

// ---------------------------------------------------------------- matching

const monthIndex = (d: DateStr) => {
  const { y, m } = parseDateStr(d);
  return y * 12 + (m - 1);
};
/** Monday of the ISO week that contains d. */
const weekStart = (d: DateStr) => addDays(d, 1 - isoDow(d));

/** Does the pattern itself (ignoring start, end, pauses and exceptions) put an occurrence on `date`? */
function patternHits(r: Repeat, date: DateStr, anchor: DateStr): boolean {
  const { y, m, d } = parseDateStr(date);
  const last = daysInMonth(y, m);
  const dow = isoDow(date);
  const dayHit = (days: number[]) => days.some((want) => (want === -1 ? d === last : d === Math.min(want, last)));
  switch (r.freq) {
    case "daily":
      if (r.interval > 1 && diffDays(date, anchor) % r.interval !== 0) return false;
      return !r.days.length || r.days.some((w) => DOW[w] === dow);
    case "weekly": {
      const days = r.days.length ? r.days.map((w) => DOW[w]) : [isoDow(anchor)];
      if (!days.includes(dow)) return false;
      return r.interval <= 1 || (diffDays(weekStart(date), weekStart(anchor)) / 7) % r.interval === 0;
    }
    case "monthly": {
      if (r.interval > 1 && (monthIndex(date) - monthIndex(anchor)) % r.interval !== 0) return false;
      if (r.nth && r.nthDay) {
        if (dow !== DOW[r.nthDay]) return false;
        return r.nth === -1 ? d + 7 > last : Math.ceil(d / 7) === r.nth;
      }
      return dayHit(r.monthDays.length ? r.monthDays : [parseDateStr(anchor).d]);
    }
    case "yearly": {
      const { y: ay, m: am, d: ad } = parseDateStr(anchor);
      if (r.interval > 1 && (y - ay) % r.interval !== 0) return false;
      if (m !== (r.month ?? am)) return false;
      return dayHit(r.monthDays.length ? r.monthDays.slice(0, 1) : [ad]);
    }
  }
}

/**
 * Is `date` an occurrence of the rule? `fallbackStart` (the task's creation day) anchors "every n" rules and is the
 * first possible day when the rule has no DTSTART.
 */
export function repeatMatches(r: Repeat, date: DateStr, fallbackStart: DateStr = date): boolean {
  const start = r.start ?? fallbackStart;
  if (date < start) return false;
  if (r.until && date > r.until) return false;
  if (r.pauseUntil && date <= r.pauseUntil) return false;
  if (r.except.includes(date)) return false;
  if (!patternHits(r, date, start)) return false;
  if (r.count) {
    // the nth occurrence ends the rule; count the pattern hits from the start (bounded, rules are short)
    let n = 0;
    for (let d = start; d <= date && n <= r.count; d = addDays(d, 1)) {
      if (patternHits(r, d, start) && !r.except.includes(d)) n++;
    }
    if (n > r.count) return false;
  }
  return true;
}

/** Old entry point, kept for callers that only have the string. */
export function rruleMatches(rrule: string | null | undefined, date: DateStr, fallbackStart?: DateStr): boolean {
  const r = parseRepeat(rrule);
  return !!r && repeatMatches(r, date, fallbackStart ?? date);
}

/** The next `n` occurrences on or after `from` (looks up to two years ahead). */
export function nextOccurrences(r: Repeat, from: DateStr, n: number, fallbackStart: DateStr = from): DateStr[] {
  const out: DateStr[] = [];
  let d = from;
  for (let i = 0; i < 740 && out.length < n; i++, d = addDays(d, 1)) {
    if (repeatMatches(r, d, fallbackStart)) out.push(d);
  }
  return out;
}

/** A missed occurrence of this task stays on the list until done (instead of just coming back next time). */
export function carriesWhenMissed(rrule: string | null | undefined): boolean {
  return parseRepeat(rrule)?.missed === "carry";
}

// ---------------------------------------------------------------- typed phrases

const WD: Record<string, Weekday> = {
  mon: "MO", monday: "MO", tue: "TU", tues: "TU", tuesday: "TU", wed: "WE", wednesday: "WE", thu: "TH", thur: "TH", thurs: "TH",
  thursday: "TH", fri: "FR", friday: "FR", sat: "SA", saturday: "SA", sun: "SU", sunday: "SU",
};
const MO: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const NTH: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, last: -1 };

/** Words a repeat phrase may contain; the quick-add parser stops at the first other word. */
export const PHRASE_WORD =
  "(?:\\d{1,3}(?:st|nd|rd|th)?|other|day|days|weekday|weekdays|weekend|weekends|week|weeks|month|months|year|years|on|the|and|except|but|not|last|first|second|third|fourth|of|" +
  `${Object.keys(WD).join("|")}|${Object.keys(MO).join("|")})`;

/**
 * Reads what follows "every" in quick-add: "day", "other day", "3 days", "weekday", "mon wed fri", "2 weeks on tue",
 * "day except sun", "1st and 15th", "last day", "last fri", "month on the 2nd mon", "year on 12 mar", "12 mar".
 * Returns the rule, or a message if the words do not make a rule.
 */
export function parseRepeatPhrase(phrase: string): { repeat: Repeat } | { error: string } {
  const t = phrase.toLowerCase().replace(/,/g, " ").split(/\s+/).filter((w) => w && !["on", "the", "and", "of"].includes(w));
  const r = defaultRepeat();
  let i = 0;
  if (t[i] === "other") { r.interval = 2; i++; }
  else if (/^\d{1,3}$/.test(t[i] ?? "") && /^(day|days|week|weeks|month|months|year|years)$/.test(t[i + 1] ?? "")) {
    r.interval = Math.max(1, Math.min(365, +t[i]));
    i++;
  }
  const unit = t[i];
  const days: Weekday[] = [];
  const except: Weekday[] = [];
  const ordinals: number[] = [];
  let month: number | null = null;
  let nth: number | null = null;
  let nthDay: Weekday | null = null;
  let excepting = false;
  let explicitUnit: Freq | null = null;
  if (unit === "day" || unit === "days") { explicitUnit = "daily"; i++; }
  else if (unit === "week" || unit === "weeks") { explicitUnit = "weekly"; i++; }
  else if (unit === "month" || unit === "months") { explicitUnit = "monthly"; i++; }
  else if (unit === "year" || unit === "years") { explicitUnit = "yearly"; i++; }
  for (; i < t.length; i++) {
    const w = t[i];
    if (w === "except" || w === "but" || w === "not") { excepting = true; continue; }
    if (w === "weekday" || w === "weekdays") { days.push("MO", "TU", "WE", "TH", "FR"); continue; }
    if (w === "weekend" || w === "weekends") { (excepting ? except : days).push("SA", "SU"); continue; }
    if (WD[w]) { (excepting ? except : days).push(WD[w]); continue; }
    if (MO[w]) { month = MO[w]; continue; }
    if (w in NTH && WD[t[i + 1]]) { nth = NTH[w]; nthDay = WD[t[i + 1]]; i++; continue; }
    if (w === "last" && (t[i + 1] === "day" || t[i + 1] === undefined)) { ordinals.push(-1); i++; continue; }
    const n = /^(\d{1,2})(st|nd|rd|th)?$/.exec(w);
    if (n && +n[1] >= 1 && +n[1] <= 31) { ordinals.push(+n[1]); continue; }
    if (w === "day" || w === "days") continue;
    return { error: `I could not read "every ${phrase.trim()}".` };
  }
  const uniq = <T,>(xs: T[]) => xs.filter((x, k) => xs.indexOf(x) === k);

  if (explicitUnit === "yearly" || (month && ordinals.length && !explicitUnit)) {
    r.freq = "yearly";
    if (!month || !ordinals.length) return { error: 'Say the date, e.g. "every year on 12 mar".' };
    r.month = month;
    r.monthDays = [ordinals[0]];
  } else if (explicitUnit === "monthly" || ((ordinals.length || nth) && !explicitUnit && !days.length)) {
    r.freq = "monthly";
    if (nth && nthDay) { r.nth = nth; r.nthDay = nthDay; }
    else r.monthDays = uniq(ordinals);
  } else if (explicitUnit === "daily" && !days.length) {
    r.freq = "daily";
    if (except.length) r.days = WEEKDAYS.filter((w) => !except.includes(w));
  } else if (explicitUnit === "weekly" && !days.length && !except.length) {
    // "every week" / "every 2 weeks": on the weekday it starts
    r.freq = "weekly";
  } else if (days.length || explicitUnit === "weekly" || except.length) {
    const set = uniq(days.length ? days : WEEKDAYS).filter((w) => !except.includes(w));
    if (!set.length) return { error: "That leaves no days to repeat on." };
    // "every weekday" / "every mon wed" read as weekly; "every 2 days" with days stays daily
    r.freq = explicitUnit === "daily" && r.interval > 1 ? "daily" : "weekly";
    r.days = set.sort((a, b) => DOW[a] - DOW[b]);
    if (r.freq === "weekly" && r.days.length === 7 && r.interval === 1) { r.freq = "daily"; r.days = []; }
  } else if (explicitUnit === "daily") {
    r.freq = "daily";
  } else {
    return { error: `I could not read "every ${phrase.trim()}".` };
  }
  const problem = repeatProblem(r);
  return problem && r.freq !== "weekly" ? { error: problem } : { repeat: r };
}

// ---------------------------------------------------------------- words

const ORD = (n: number) => (n === -1 ? "last" : n === 1 ? "first" : n === 2 ? "second" : n === 3 ? "third" : n === 4 ? "fourth" : `${n}th`);
const dayOrd = (n: number) => {
  if (n === -1) return "the last day";
  const s = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `the ${n}${s}`;
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const short = (d: DateStr) => {
  const { y, m, d: dd } = parseDateStr(d);
  return `${dd} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
};

function daysPhrase(days: Weekday[]): string {
  const set = days.join(",");
  if (set === "MO,TU,WE,TH,FR") return "weekdays";
  if (set === "SA,SU") return "weekends";
  if (days.length === 7) return "every day";
  return list(days.map((w) => WEEKDAY_NAME[w]));
}

/** "Every day except Sunday", "Every 2 weeks on Monday and Thursday", "Monthly on the last Friday", … */
export function describeRepeat(r: Repeat): string {
  let s: string;
  switch (r.freq) {
    case "daily": {
      const base = r.interval > 1 ? `Every ${r.interval} days` : "Every day";
      if (!r.days.length || r.days.length === 7) s = base;
      else if (r.days.length >= 5 && r.interval === 1) {
        const missing = WEEKDAYS.filter((w) => !r.days.includes(w));
        s = daysPhrase(r.days) === "weekdays" ? "Every weekday" : `Every day except ${list(missing.map((w) => WEEKDAY_NAME[w]))}`;
      } else s = `${base}, only on ${daysPhrase(r.days)}`;
      break;
    }
    case "weekly": {
      const days = r.days.length ? daysPhrase(r.days) : "the same weekday";
      s = r.interval > 1 ? `Every ${r.interval} weeks on ${days}` : days === "every day" ? "Every day" : `Every ${days === "weekdays" ? "weekday" : days === "weekends" ? "weekend day" : days}`;
      break;
    }
    case "monthly": {
      const every = r.interval > 1 ? `Every ${r.interval} months` : "Monthly";
      s = r.nth && r.nthDay ? `${every} on the ${ORD(r.nth)} ${WEEKDAY_NAME[r.nthDay]}`
        : `${every} on ${list((r.monthDays.length ? r.monthDays : [1]).map(dayOrd))}`;
      break;
    }
    case "yearly": {
      const every = r.interval > 1 ? `Every ${r.interval} years` : "Every year";
      const d = r.monthDays[0] ?? 1;
      s = `${every} on ${d === -1 ? "the last day of" : d} ${MONTHS[(r.month ?? 1) - 1]}`;
      break;
    }
  }
  const tail: string[] = [];
  if (r.start) tail.push(`from ${short(r.start)}`);
  if (r.until) tail.push(`until ${short(r.until)}`);
  else if (r.count) tail.push(`${r.count} times`);
  if (r.pauseUntil) tail.push(`paused until ${short(r.pauseUntil)}`);
  if (r.except.length) tail.push(`skipping ${r.except.length} ${r.except.length === 1 ? "date" : "dates"}`);
  return tail.length ? `${s}, ${tail.join(", ")}` : s;
}

export function describeRrule(rrule: string | null | undefined): string {
  const r = parseRepeat(rrule);
  return r ? describeRepeat(r) : rrule ?? "";
}
