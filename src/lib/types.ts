import type { DateStr, TargetPeriod } from "./time";
import type { TaskType } from "./parser";
import type { SegmentKind } from "./hours";

export type { TaskType, SegmentKind, DateStr, TargetPeriod };

export type EntryStatus = "open" | "done" | "progressed" | "attempted" | "skipped" | "dropped";
export type EntrySource = "planned" | "auto" | "carried";
export type TaskState = "active" | "done" | "dropped";

export interface Settings {
  timezone: string;
  day_boundary: string;
  working_days: number[];
  morning_brief: string;
  exercise_start: string;
  exercise_end: string;
  exercise_interval_min: number;
  exercise_paused: boolean;
  task_lead_min: number;
  cadence_nudge: string;
  evening_fallback: string;
  score_reminder: string;
  open_segment_check: string;
  weekly_review_day: number;
  weekly_review_time: string;
  must_do_cap: number;
  available_hours: number;
  rot_threshold: number;
  step_goal: number;
  quiet_start: string;
  quiet_end: string;
  lunch_start: string | null;
  lunch_end: string | null;
  telegram_chat_id: number | null;
  owner_user_id: string | null;
  last_tick_at: Date | null;
}

export interface TaskRow {
  id: number;
  title: string;
  notes: string | null;
  type: TaskType;
  project_id: number | null;
  person_id: number | null;
  person_role: "with" | "requested_by" | null;
  via: string | null;
  is_personal: boolean;
  estimate_min: number | null;
  due_date: DateStr | null;
  due_at: Date | null;
  lead_min: number | null;
  cadence_days: number | null;
  rrule: string | null;
  target_period: TargetPeriod | null;
  period_start: DateStr | null;
  goal_count: number | null;
  goal_min: number | null;
  state: TaskState;
  carry_count: number;
  last_done_at: Date | null;
  nudge_snoozed_until: DateStr | null;
  sort: number;
  created_at: Date;
  closed_at: Date | null;
  // joined
  project_name?: string | null;
  project_color?: string | null;
  person_name?: string | null;
}

export interface EntryRow {
  id: number;
  task_id: number;
  date: DateStr;
  must_do: boolean;
  sort: number;
  status: EntryStatus;
  source: EntrySource;
  note: string | null;
  carried_from: DateStr | null;
  updated_at: Date;
}

/** A day entry joined with its task, as the screens and the bot need it. */
export interface EntryView extends EntryRow {
  title: string;
  type: TaskType;
  project_id: number | null;
  project_name: string | null;
  project_color: string | null;
  person_name: string | null;
  person_role: "with" | "requested_by" | null;
  is_personal: boolean;
  estimate_min: number | null;
  due_at: Date | null;
  lead_min: number | null;
  carry_count: number;
  task_state: TaskState;
  minutes_today: number;
}
