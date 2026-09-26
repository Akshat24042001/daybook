import { ACTIVITIES, ACTIVITY } from "./activity";
import type { SegmentKind } from "./hours";
import { clockToMinutes } from "./parser";
import {
  type DateStr,
  addDays,
  atLogical,
  fmtDuration,
  logicalDate,
  zonedInstant,
} from "./time";

/**
 * Manual time entry (PRD 8 says segments are editable; this lets you *say* them):
 *   "office 10:45 to 1:30"
 *   "entered office at 10:45 and left at 1:30"
 *   "office 10 to 1, break 1 to 1:45, outside 1:45 to 6"
 *   "yesterday office 9:30 to 6:15"
 * The same clock rules as quick-add apply: bare hours 1-7 are PM, 8-11 AM. If an end time lands
 * before its start it rolls forward (10 to 1 = 10:00 to 13:00, 10pm to 1 = 22:00 to 01:00).
 * Pure function, no I/O.
 */

export interface TimeLogSegment {
  kind: SegmentKind;
  /** minutes since midnight of `date`; may be 1440 or more when the segment runs past midnight */
  startMin: number;
  endMin: number | null;
}

export interface ParsedTimeLog {
  date: DateStr;
  segments: TimeLogSegment[];
  errors: string[];
}

export interface TimeLogContext {
  now: Date;
  tz: string;
  boundaryMin: number;
}

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const WEEKDAYS = "mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?";
const MONTH_INDEX: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DOW_INDEX: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

// On a tie (two words at the same spot) the later pattern wins, so "work from home" is remote, not office.
const KIND_PATTERNS: [SegmentKind, RegExp][] = [
  ["outside", /\b(?:outside|out on work|out of (?:the )?office|client visit|site visit|field visit|field work|on[- ]?site|visit)\b/gi],
  ["break", /\b(?:break|rest|nap|tea|coffee|chai|refresh(?:ment)?)\b/gi],
  ["meal", /\b(?:lunch|breakfast|dinner|meal|snacks?)\b/gi],
  ["office", /\b(?:office|desk|at work|worked|working|work)\b/gi],
  ["remote", /\b(?:wfh|remote(?:ly)?|work(?:ed|ing)? from home)\b/gi],
  ["commute", /\b(?:commut\w*|travel\w*|drive|driving|drove|metro|train|bus|cab)\b/gi],
  ["exercise", /\b(?:exercis\w*|gym|workout|walk\w*|run|running|jog\w*|yoga|swim\w*|sports?)\b/gi],
  ["personal", /\b(?:personal|errands?|shopping|family)\b/gi],
];
const START_WORDS = /\b(?:in|entered|arrived|reached|started|came|from|since|begin|began|joined)\b/i;
const END_WORDS = /\b(?:out|left|leave|exit|finished|ended|stopped|done|till|until|to)\b/i;

interface TimeToken {
  index: number;
  end: number;
  minutes: number;
}

function normaliseAmPm(s: string | undefined): string | undefined {
  return s ? s.replace(/\./g, "").toLowerCase() : undefined;
}

export function isoDate(instant: Date, ctx: TimeLogContext): DateStr {
  return logicalDate(instant, ctx.tz, ctx.boundaryMin);
}

function resolveDate(text: string, ctx: TimeLogContext): { date: DateStr; rest: string; error?: string } {
  const today = isoDate(ctx.now, ctx);
  let rest = text;
  let date = today;
  let m: RegExpExecArray | null;
  if ((m = /\b(?:day before yesterday)\b/i.exec(rest))) {
    date = addDays(today, -2);
    rest = rest.replace(m[0], " ");
  } else if ((m = /\byesterday\b/i.exec(rest))) {
    date = addDays(today, -1);
    rest = rest.replace(m[0], " ");
  } else if ((m = /\btoday\b/i.exec(rest))) {
    rest = rest.replace(m[0], " ");
  } else if ((m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(${MONTHS})\\b`, "i").exec(rest))) {
    const d = +m[1];
    const mon = MONTH_INDEX[m[2].slice(0, 3).toLowerCase()];
    const year = +today.slice(0, 4);
    let cand = `${year}-${String(mon).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (cand > today) cand = `${year - 1}-${String(mon).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    date = cand;
    rest = rest.replace(m[0], " ");
  } else if ((m = new RegExp(`\\b(?:on\\s+|last\\s+)?(${WEEKDAYS})\\b`, "i").exec(rest))) {
    const target = DOW_INDEX[m[1].slice(0, 3).toLowerCase()];
    // most recent such weekday, not today
    for (let back = 1; back <= 7; back++) {
      const cand = addDays(today, -back);
      const dow = new Date(`${cand}T00:00:00Z`).getUTCDay() || 7;
      if (dow === target) {
        date = cand;
        break;
      }
    }
    rest = rest.replace(m[0], " ");
  }
  return { date, rest };
}

function findTimeTokens(text: string): TimeToken[] {
  const tokens: TimeToken[] = [];
  const re = /(?<![\w:.])(\d{1,2})(?:[:.](\d{2}))?\s*((?:a|p)\.?m\.?)?(?![\w:])|\bnoon\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (/^noon$/i.test(m[0])) {
      tokens.push({ index: m.index, end: m.index + m[0].length, minutes: 12 * 60 });
      continue;
    }
    const before = text.slice(0, m.index).toLowerCase();
    const after = text.slice(m.index + m[0].length).toLowerCase();
    const explicit = m[2] !== undefined || m[3] !== undefined;
    const contextBefore = /(?:\b(?:at|from|to|till|until|between|and|in|out|left|entered|arrived|reached|started|came|finished|ended|stopped|since)\s+|[-–—]\s*)$/.test(before);
    const contextAfter = /^\s*(?:to|till|until|-|–|—)\s*\d/.test(after);
    if (!explicit && !contextBefore && !contextAfter) continue;
    const ampm = normaliseAmPm(m[3]);
    const minutes = clockToMinutes(+m[1], m[2] ? +m[2] : 0, ampm);
    if (minutes === null) continue;
    tokens.push({ index: m.index, end: m.index + m[0].length, minutes });
  }
  return tokens;
}

function kindNear(slice: string): SegmentKind | null {
  let best: { kind: SegmentKind; at: number } | null = null;
  for (const [kind, re] of KIND_PATTERNS) {
    const rx = new RegExp(re.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = rx.exec(slice))) {
      if (!best || m.index >= best.at) best = { kind, at: m.index };
    }
  }
  return best?.kind ?? null;
}

/** Whether the text reads like a manual time entry (used by the bot to decide between task and time log). */
export function looksLikeTimeLog(text: string): boolean {
  if (/^\/log\b/i.test(text.trim())) return true;
  if (/[!>@~#^*]{1,2}|\+\w/.test(text.replace(/\s\?\s/, " "))) {
    // quick-add syntax present: this is a task line
    if (/(?:^|\s)(?:!!|>>|@\S+|~\d|#[wmq]\b|\*\d+d|\^\S+|\+[A-Za-z])/.test(text)) return false;
  }
  const tokens = findTimeTokens(text);
  if (tokens.length < 2) return false;
  const hasKind = KIND_PATTERNS.some(([, re]) => new RegExp(re.source, "i").test(text));
  const hasPhrase = START_WORDS.test(text) && /\b(?:out|left|leave|exit|finished|ended|stopped|till|until|to)\b/i.test(text);
  return hasKind || (hasPhrase && /\b(?:office|entered|arrived|reached|left)\b/i.test(text));
}

export function parseTimeLog(input: string, ctx: TimeLogContext): ParsedTimeLog | null {
  const text0 = input.replace(/^\s*\/log\b/i, " ").trim();
  const { date, rest } = resolveDate(text0, ctx);
  const text = ` ${rest} `;
  const tokens = findTimeTokens(text);
  if (tokens.length === 0) return null;

  const out: ParsedTimeLog = { date, segments: [], errors: [] };
  let prevEnd = 0;
  let prevKind: SegmentKind | null = null;
  let prevAbs = -1;

  for (let i = 0; i < tokens.length; i += 2) {
    const a = tokens[i];
    const b = tokens[i + 1];
    const lead = text.slice(prevEnd, a.index);
    const between = b ? text.slice(a.end, b.index) : text.slice(a.end);
    const trail = b ? text.slice(b.end, tokens[i + 2]?.index ?? text.length) : "";

    let kind = kindNear(lead) ?? kindNear(between);
    if (!kind && b) kind = kindNear(trail.split(/[,;\n]/)[0] ?? "");
    kind = kind ?? prevKind ?? "office";

    // resolve the start; never before the previous segment's end (rolls forward by 12h)
    let start = a.minutes;
    while (start < prevAbs) start += 12 * 60;

    if (!b) {
      // a lone start time: an open segment, only if it reads like "entered at 10:45" / "office from 10:45"
      const hasStartCue = START_WORDS.test(lead + " " + between) || KIND_PATTERNS.some(([, re]) => new RegExp(re.source, "i").test(lead));
      if (!hasStartCue) out.errors.push("I found a start time with no end time. Say when you left, e.g. \"office 10:45 to 1:30\".");
      else out.segments.push({ kind, startMin: start, endMin: null });
      break;
    }

    let end = b.minutes;
    while (end <= start) end += 12 * 60;
    if (end - start > 16 * 60) {
      out.errors.push(`That is ${fmtDuration(end - start)} in one go. Check the times.`);
    }
    out.segments.push({ kind, startMin: start, endMin: end });
    prevEnd = b.end;
    prevKind = kind;
    prevAbs = end;
  }

  if (out.segments.length === 0 && out.errors.length === 0) return null;
  return out;
}

/** Wall-clock minutes-since-midnight of a logical day to an instant, including values past midnight. */
export function wallMinutesToInstant(date: DateStr, minutes: number, ctx: TimeLogContext): Date {
  if (minutes >= 24 * 60) {
    return zonedInstant(addDays(date, 1), Math.floor((minutes - 1440) / 60), (minutes - 1440) % 60, ctx.tz);
  }
  return atLogical(date, minutes, ctx.tz, ctx.boundaryMin);
}

export interface ResolvedSegment {
  kind: SegmentKind;
  start: Date;
  end: Date | null;
}

export function resolveSegments(p: ParsedTimeLog, ctx: TimeLogContext): ResolvedSegment[] {
  return p.segments.map((s) => ({
    kind: s.kind,
    start: wallMinutesToInstant(p.date, s.startMin, ctx),
    end: s.endMin === null ? null : wallMinutesToInstant(p.date, s.endMin, ctx),
  }));
}

export const KIND_TEXT = Object.fromEntries(ACTIVITIES.map((a) => [a.kind, a.label])) as Record<SegmentKind, string>;

export function hm(min: number): string {
  const t = min % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** Human summary lines, including the calculated duration and the total worked time. */
export function describeTimeLog(p: ParsedTimeLog): { lines: string[]; workedMin: number } {
  let worked = 0;
  const lines = p.segments.map((s) => {
    if (s.endMin === null) return `${KIND_TEXT[s.kind]} from ${hm(s.startMin)} (still running)`;
    const dur = s.endMin - s.startMin;
    if (ACTIVITY[s.kind].work) worked += dur;
    return `${KIND_TEXT[s.kind]} ${hm(s.startMin)} to ${hm(s.endMin)} = ${fmtDuration(dur)}${s.endMin >= 1440 ? " (past midnight)" : ""}`;
  });
  return { lines, workedMin: worked };
}
