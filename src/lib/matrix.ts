/**
 * The two Priorities boards, pure (no database): shared by the page in the browser and the server.
 * See services/matrix.ts for what each box means and how tasks are placed.
 */
import { diffDays, type DateStr } from "./time";

export type Mode = "value" | "eisen";
export type Level = "high" | "low";
export type ValueBox = "quick" | "big" | "fill" | "sink";
export type EisenBox = "do" | "schedule" | "delegate" | "drop";
export type Box = ValueBox | EisenBox;

export interface BoxDef {
  key: Box;
  name: string;
  /** what to do with what is in it */
  action: string;
  /** the two levels: [first axis, second axis] = value/effort or importance/urgency */
  levels: [Level, Level];
  hue: "mint" | "sky" | "butter" | "rose";
}

/** The four boxes of each board, in reading order (top left, top right, bottom left, bottom right). */
export const BOXES: Record<Mode, BoxDef[]> = {
  value: [
    { key: "quick", name: "Quick wins", action: "Do these first", levels: ["high", "low"], hue: "mint" },
    { key: "big", name: "Big bets", action: "Plan them and give them real time", levels: ["high", "high"], hue: "sky" },
    { key: "fill", name: "Fill-ins", action: "Do in the gaps, never first", levels: ["low", "low"], hue: "butter" },
    { key: "sink", name: "Time sinks", action: "Drop, shrink or rethink", levels: ["low", "high"], hue: "rose" },
  ],
  eisen: [
    { key: "do", name: "Do now", action: "Today, yourself", levels: ["high", "high"], hue: "rose" },
    { key: "schedule", name: "Schedule", action: "Put a date on it and protect the time", levels: ["high", "low"], hue: "sky" },
    { key: "delegate", name: "Delegate", action: "Hand it to someone, or batch it quickly", levels: ["low", "high"], hue: "butter" },
    { key: "drop", name: "Drop", action: "Delete it or park it as someday", levels: ["low", "low"], hue: "mint" },
  ],
};

export const AXES: Record<Mode, { a: string; b: string; aCol: "value_level" | "importance"; bCol: "effort_level" | "urgency"; rank: "value_rank" | "eisen_rank" }> = {
  value: { a: "Value", b: "Effort", aCol: "value_level", bCol: "effort_level", rank: "value_rank" },
  eisen: { a: "Importance", b: "Urgency", aCol: "importance", bCol: "urgency", rank: "eisen_rank" },
};

export const boxDef = (mode: Mode, key: Box): BoxDef | undefined => BOXES[mode].find((b) => b.key === key);
export const modeOfBox = (key: string): Mode | null =>
  BOXES.value.some((b) => b.key === key) ? "value" : BOXES.eisen.some((b) => b.key === key) ? "eisen" : null;

export interface MatrixTask {
  id: number;
  title: string;
  type: string;
  project: string | null;
  color: string | null;
  is_personal: boolean;
  estimate_min: number | null;
  due_date: DateStr | null;
  value_level: Level | null;
  effort_level: Level | null;
  importance: Level | null;
  urgency: Level | null;
  value_rank: number | null;
  eisen_rank: number | null;
  matrix_why: string | null;
  on_today: boolean;
  waiting: boolean;
  carry_count: number;
  created_at: string;
}

/** Urgent when due within two days or overdue; not urgent when due later; unknown with no date. Pure. */
export function urgencyFromDue(due: DateStr | null, today: DateStr): Level | null {
  if (!due) return null;
  return diffDays(due, today) <= 2 ? "high" : "low";
}

/** Which box a task is in on a board, and whether urgency was read from its date. Null = still to sort. Pure. */
export function boxOf(t: Pick<MatrixTask, "value_level" | "effort_level" | "importance" | "urgency" | "due_date">, mode: Mode, today: DateStr): { box: Box; autoUrgency: boolean } | null {
  if (mode === "value") {
    if (!t.value_level || !t.effort_level) return null;
    const b = BOXES.value.find((x) => x.levels[0] === t.value_level && x.levels[1] === t.effort_level)!;
    return { box: b.key, autoUrgency: false };
  }
  if (!t.importance) return null;
  const urg = t.urgency ?? urgencyFromDue(t.due_date, today) ?? "low";
  const b = BOXES.eisen.find((x) => x.levels[0] === t.importance && x.levels[1] === urg)!;
  return { box: b.key, autoUrgency: !t.urgency };
}

export interface Suggestion { id: number; title: string; box: Box; why: string }

/** A guess at effort from the time estimate, used when the AI is not available. Pure. */
export function effortFromEstimate(min: number | null): Level | null {
  if (!min) return null;
  if (min >= 120) return "high";
  if (min <= 45) return "low";
  return null;
}

/** Without the AI: only what the facts say (urgency from dates; effort from estimates needs a value, so none). Pure. */
export function heuristic(todo: Pick<MatrixTask, "id" | "title" | "due_date" | "estimate_min">[], mode: Mode, today: DateStr): Suggestion[] {
  if (mode === "value") return []; // value cannot be read from a date or an estimate; that call is yours
  return todo.flatMap((t) => {
    const u = urgencyFromDue(t.due_date, today);
    return u === "high" ? [{ id: t.id, title: t.title, box: "do" as Box, why: `Due ${t.due_date}: urgent, and you planned it.` }] : [];
  });
}

