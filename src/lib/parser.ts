import {
  type DateStr,
  type TargetPeriod,
  addDays,
  atLogical,
  daysInMonth,
  fmtClock,
  fmtDateShort,
  isoDow,
  logicalDate,
  parseDateStr,
  toDateStr,
} from "./time";

/**
 * Quick-add parser (PRD section 5). A pure function: same input and context
 * always give the same output, no I/O.
 *
 * Tokens can appear in any order. Everything that is not a token becomes the
 * title. The default type is one_off, so a plain line of text just works.
 */

export type TaskType =
  | "one_off"
  | "ongoing"
  | "follow_up"
  | "cadence"
  | "recurring"
  | "someday"
  | "target";

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  one_off: "One-off",
  ongoing: "Ongoing",
  follow_up: "Follow-up",
  cadence: "Cadence",
  recurring: "Recurring",
  someday: "Someday",
  target: "Target",
};

export interface ParseContext {
  now: Date;
  tz: string;
  boundaryMin: number;
  /** Day the entry is being added to. Defaults to today (the logical date of `now`). */
  defaultDate?: DateStr;
}

export interface ParsedQuickAdd {
  raw: string;
  title: string;
  project: string | null;
  mustDo: boolean;
  type: TaskType;
  /** Explicit date from an @date token, otherwise null. */
  date: DateStr | null;
  /** The day the day-entry lands on. */
  targetDate: DateStr;
  /** Minutes since local midnight, when a time was given. */
  timeMin: number | null;
  dueAt: Date | null;
  estimateMin: number | null;
  cadenceDays: number | null;
  rrule: string | null;
  targetPeriod: TargetPeriod | null;
  goalMin: number | null;
  person: string | null;
  personRole: "with" | "requested_by" | null;
  via: string | null;
  isPersonal: boolean;
  /** Plain-language notes shown under the input, e.g. that 5 PM rolled to tomorrow. */
  notes: string[];
  errors: string[];
}

const WEEKDAY_RE = "(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const MONTH_RE = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const CLOCK_RE = "\\d{1,2}(?::\\d{2})?\\s?(?:am|pm)|\\d{1,2}:\\d{2}";

const WEEKDAY_INDEX: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
const WEEKDAY_BYDAY: Record<number, string> = { 1: "MO", 2: "TU", 3: "WE", 4: "TH", 5: "FR", 6: "SA", 7: "SU" };
const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Removes every match of `re` from `s`, calling `cb` for each. Returns the reduced string. */
function extract(s: string, re: RegExp, cb: (m: RegExpExecArray, first: boolean) => void): string {
  let first = true;
  for (let guard = 0; guard < 20; guard++) {
    const m = re.exec(s);
    if (!m) break;
    cb(m, first);
    first = false;
    s = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
  }
  return s;
}

/** Converts a clock reading to minutes since midnight. Bare hours 1-7 are PM. */
export function clockToMinutes(hourRaw: number, minute: number, ampm: string | undefined): number | null {
  if (minute < 0 || minute > 59) return null;
  let h = hourRaw;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    const pm = ampm.toLowerCase() === "pm";
    h = h % 12;
    if (pm) h += 12;
  } else {
    if (h < 0 || h > 23) return null;
    if (h >= 1 && h <= 7) h += 12;
  }
  return h * 60 + minute;
}

function parseClock(text: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s?(am|pm)?$/i.exec(text.trim());
  if (!m) return null;
  return clockToMinutes(+m[1], m[2] ? +m[2] : 0, m[3]);
}

function weekdayFrom(word: string): number {
  return WEEKDAY_INDEX[word.slice(0, 3).toLowerCase()];
}

function tidyPersonName(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

export function parseQuickAdd(input: string, ctx: ParseContext): ParsedQuickAdd {
  const today = logicalDate(ctx.now, ctx.tz, ctx.boundaryMin);
  const out: ParsedQuickAdd = {
    raw: input,
    title: "",
    project: null,
    mustDo: false,
    type: "one_off",
    date: null,
    targetDate: ctx.defaultDate ?? today,
    timeMin: null,
    dueAt: null,
    estimateMin: null,
    cadenceDays: null,
    rrule: null,
    targetPeriod: null,
    goalMin: null,
    person: null,
    personRole: null,
    via: null,
    isPersonal: false,
    notes: [],
    errors: [],
  };

  let s = ` ${input} `;
  let ongoing = false;
  let someday = false;
  let hasCadence = false;
  let hasRecurring = false;

  // ~30m / ~2h / ~1h30m / ~1.5h
  s = extract(
    s,
    /(^|\s)~(\d+(?:\.\d+)?)(h|hr|hrs|m|min|mins)(?:(\d+)(?:m|min|mins))?(?=\s|$)/i,
    (m, first) => {
      if (!first) return;
      const unit = m[3].toLowerCase();
      let minutes = unit.startsWith("h") ? Math.round(parseFloat(m[2]) * 60) : Math.round(parseFloat(m[2]));
      if (m[4]) minutes += +m[4];
      if (minutes > 0) out.estimateMin = minutes;
    },
  );

  s = extract(s, /(^|\s)>>(?=\s|$)/, () => {
    ongoing = true;
  });
  s = extract(s, /(^|\s)!!(?=\s|$)/, () => {
    out.mustDo = true;
  });
  s = extract(s, /(^|\s)\*(\d+)d(?=\s|$)/i, (m, first) => {
    if (!first) return;
    const n = +m[2];
    if (n >= 1) {
      out.cadenceDays = n;
      hasCadence = true;
    } else {
      out.errors.push("Cadence must be at least 1 day.");
    }
  });
  s = extract(s, /(^|\s)#([wmqy])(?=\s|$)/i, (m, first) => {
    if (!first) return;
    const c = m[2].toLowerCase();
    out.targetPeriod = c === "w" ? "week" : c === "m" ? "month" : c === "q" ? "quarter" : "year";
  });

  // every mon / every 1st
  s = extract(
    s,
    new RegExp(`(^|\\s)every\\s+(${WEEKDAY_RE}|\\d{1,2}(?:st|nd|rd|th))(?=\\s|$)`, "i"),
    (m, first) => {
      if (!first) return;
      const word = m[2].toLowerCase();
      const dayNum = /^(\d{1,2})/.exec(word);
      if (dayNum) {
        const d = +dayNum[1];
        if (d >= 1 && d <= 31) {
          out.rrule = `FREQ=MONTHLY;BYMONTHDAY=${d}`;
          hasRecurring = true;
        } else {
          out.errors.push(`"every ${word}" is not a valid day of the month.`);
        }
      } else {
        out.rrule = `FREQ=WEEKLY;BYDAY=${WEEKDAY_BYDAY[weekdayFrom(word)]}`;
        hasRecurring = true;
      }
    },
  );

  s = extract(s, /(^|\s)\/p(?=\s|$)/i, () => {
    out.isPersonal = true;
  });
  s = extract(s, /(^|\s)\?(?=\s|$)/, () => {
    someday = true;
  });
  s = extract(s, /(^|\s)\^([^\s]+)/, (m, first) => {
    if (first) out.via = m[2];
  });
  s = extract(s, /(^|\s)\+([A-Za-z][A-Za-z0-9_'’-]*)/, (m, first) => {
    if (first) out.person = tidyPersonName(m[2]);
  });

  // Date with optional time: @tom 11am, @mon 5:30pm, @21sep 4pm
  let dateWord: string | null = null;
  let timeText: string | null = null;
  const dateRe = new RegExp(
    `(^|\\s)@(today|tom(?:orrow)?|${WEEKDAY_RE}|\\d{1,2}(?:st|nd|rd|th)?${MONTH_RE})(?:\\s+(${CLOCK_RE}))?(?=\\s|$)`,
    "i",
  );
  s = extract(s, dateRe, (m, first) => {
    if (!first) return;
    dateWord = m[2].toLowerCase();
    if (m[3]) timeText = m[3];
  });
  // Time alone: @5pm / @17:00 / @5
  s = extract(s, /(^|\s)@(\d{1,2}(?::\d{2})?\s?(?:am|pm)?)(?=\s|$)/i, (m, first) => {
    if (first && !timeText) timeText = m[2];
  });

  // Date resolution
  if (dateWord) {
    const w: string = dateWord;
    if (w === "today") out.date = today;
    else if (w === "tom" || w === "tomorrow") out.date = addDays(today, 1);
    else if (new RegExp(`^${WEEKDAY_RE}$`, "i").test(w)) {
      const target = weekdayFrom(w);
      const delta = (target - isoDow(today) + 7) % 7 || 7;
      out.date = addDays(today, delta);
    } else {
      const dm = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?(${MONTH_RE})$`, "i").exec(w);
      if (dm) {
        const day = +dm[1];
        const month = MONTH_INDEX[dm[2].slice(0, 3).toLowerCase()];
        const { y } = parseDateStr(today);
        const build = (yr: number) => (day >= 1 && day <= daysInMonth(yr, month) ? toDateStr(yr, month, day) : null);
        let d = build(y);
        if (d && d < today) d = build(y + 1);
        if (d) out.date = d;
        else out.errors.push(`"@${w}" is not a real date.`);
      }
    }
  }

  // Time resolution
  if (timeText) {
    const minutes = parseClock(timeText);
    if (minutes === null) {
      out.errors.push(`"@${timeText}" is not a valid time.`);
    } else {
      out.timeMin = minutes;
      const base = out.date ?? ctx.defaultDate ?? today;
      let due = atLogical(base, minutes, ctx.tz, ctx.boundaryMin);
      const rollable = out.date === null && (ctx.defaultDate === undefined || ctx.defaultDate === today);
      if (rollable && due.getTime() < ctx.now.getTime()) {
        const next = addDays(base, 1);
        due = atLogical(next, minutes, ctx.tz, ctx.boundaryMin);
        out.targetDate = next;
        out.notes.push(`${fmtClock(due, ctx.tz)} has already passed today, so this is set for tomorrow.`);
      } else {
        out.targetDate = base;
      }
      out.dueAt = due;
    }
  }
  if (out.date && out.timeMin === null) out.targetDate = out.date;

  // Title and project prefix
  let title = s.replace(/\s+/g, " ").trim();
  const prefix = /^([A-Za-z0-9][A-Za-z0-9 &._'’-]{0,39}?):\s+(\S.*)$/.exec(title);
  if (prefix) {
    out.project = prefix[1].trim();
    title = prefix[2].trim();
  }
  out.title = title;
  if (!title) out.errors.push("Add a title.");

  // Type inference. Precedence: target > cadence > recurring > someday > ongoing > follow-up.
  if (out.targetPeriod) {
    out.type = "target";
    if (out.estimateMin !== null) {
      out.goalMin = out.estimateMin;
      out.estimateMin = null;
    }
  } else if (hasCadence) out.type = "cadence";
  else if (hasRecurring) out.type = "recurring";
  else if (someday) out.type = "someday";
  else if (ongoing) out.type = "ongoing";
  else if (out.person && !out.isPersonal) out.type = "follow_up";

  if (out.person) out.personRole = out.isPersonal ? "requested_by" : "with";

  // Cadence tasks never become must-do by themselves (PRD 4.2). An explicit !! is still respected.
  return out;
}

/** Plain-language lines for the live preview (web) and the bot's reply. */
export function describeParsed(p: ParsedQuickAdd, ctx: { tz: string; today: DateStr }): string[] {
  const lines: string[] = [];
  const typeText: Record<TaskType, string> = {
    one_off: "One-off task",
    ongoing: "Ongoing task (appears every working day until Done)",
    follow_up: "Follow-up",
    cadence: `Cadence: every ${p.cadenceDays ?? "?"} days`,
    recurring: "Recurring",
    someday: "Someday pool",
    target: "Target",
  };
  lines.push(typeText[p.type]);
  if (p.project) lines.push(`Project: ${p.project}`);
  if (p.person) lines.push(`${p.personRole === "requested_by" ? "Requested by" : "With"}: ${p.person}`);
  if (p.mustDo) lines.push("Must-do");
  if (p.isPersonal) lines.push("Personal");
  if (p.via) lines.push(`Via: ${p.via}`);
  if (p.estimateMin !== null) lines.push(`Estimate: ${p.estimateMin} min`);
  if (p.type === "target" && p.targetPeriod) {
    lines.push(`Target for this ${p.targetPeriod}${p.goalMin ? `, ${p.goalMin / 60}h goal` : ""}`);
  }
  if (p.rrule) lines.push(`Repeats: ${describeRrule(p.rrule)}`);
  if (p.type !== "someday" && p.type !== "target") {
    if (p.dueAt) lines.push(`${dateLabel(p.targetDate, ctx.today)} at ${fmtClock(p.dueAt, ctx.tz)}`);
    else if (p.date) lines.push(dateLabel(p.date, ctx.today));
  }
  return lines;
}

export function describeRrule(rrule: string): string {
  const weekly = /FREQ=WEEKLY;BYDAY=(\w\w)/.exec(rrule);
  if (weekly) {
    const names: Record<string, string> = { MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday", SU: "Sunday" };
    return `every ${names[weekly[1]] ?? weekly[1]}`;
  }
  const monthly = /FREQ=MONTHLY;BYMONTHDAY=(\d+)/.exec(rrule);
  if (monthly) return `on day ${monthly[1]} of every month`;
  return rrule;
}

function dateLabel(date: DateStr, today: DateStr): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return fmtDateShort(date);
}
