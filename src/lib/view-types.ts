import { dueFor } from "./sections";
import type { Ctx } from "./settings";
import { diffDays, fmtDuration, fmtHM, fmtRelDay, zonedParts, type DateStr } from "./time";
import type { UnfinishedTask } from "./services/unfinished";
import type { UnfinishedRow } from "@/components/unfinished/unfinished-client";
import type { EntryStatus, EntryView, TaskType } from "./types";

/** Plain, serialisable shapes handed from server components to client components. */
export interface RowData {
  id: number;
  taskId: number;
  title: string;
  type: TaskType;
  status: EntryStatus;
  mustDo: boolean;
  projectName: string | null;
  projectColor: string | null;
  personName: string | null;
  personRole: "with" | "requested_by" | null;
  isPersonal: boolean;
  estimateMin: number | null;
  timeLabel: string | null;
  minutes: number;
  carry: number;
  source: "planned" | "auto" | "carried";
  carriedFrom: DateStr | null;
  date: DateStr;
}

export function toRow(ctx: Ctx, e: EntryView): RowData {
  const due = dueFor(e, ctx.tz, ctx.boundaryMin);
  return {
    id: e.id,
    taskId: e.task_id,
    title: e.title,
    type: e.type,
    status: e.status,
    mustDo: e.must_do,
    projectName: e.project_name,
    projectColor: e.project_color,
    personName: e.person_name,
    personRole: e.person_role,
    isPersonal: e.is_personal,
    estimateMin: e.estimate_min,
    timeLabel: due ? fmtHM(due, ctx.tz) : null,
    minutes: e.minutes_today,
    carry: e.carry_count,
    source: e.source,
    carriedFrom: e.carried_from,
    date: e.date,
  };
}

/** "YYYY-MM-DDTHH:mm" in the app timezone, for <input type="datetime-local">. */
export function toLocalInput(ctx: Ctx, at: Date): string {
  const p = zonedParts(at, ctx.tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

export interface SegmentData {
  id: number;
  kind: "office" | "outside" | "break";
  start: string;
  end: string | null;
  startLabel: string;
  endLabel: string | null;
  minutes: number | null;
}

/** An unfinished task for the Unfinished page and Today's rail card. */
export function toUnfinishedRow(today: DateStr, t: UnfinishedTask): UnfinishedRow {
  return {
    taskId: t.taskId,
    title: t.title,
    type: t.type,
    projectName: t.projectName,
    projectColor: t.projectColor,
    personName: t.personName,
    isPersonal: t.isPersonal,
    ageDays: t.lastDate ? diffDays(today, t.lastDate) : null,
    lastLabel: t.lastDate ? fmtRelDay(t.lastDate, today) : null,
    lastStatus: t.lastStatus,
    days: t.days,
    carryCount: t.carryCount,
    minutesLabel: t.minutesTotal ? fmtDuration(t.minutesTotal) : null,
  };
}
