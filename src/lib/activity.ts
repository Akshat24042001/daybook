/**
 * What a slice of the day is spent on. Shared by the server (hours, bot) and the client (Today, Stats),
 * so it holds no imports. Only `work` kinds count towards worked time.
 */
export const ACTIVITY_KINDS = ["office", "outside", "remote", "commute", "meal", "break", "exercise", "personal"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface ActivityInfo {
  kind: ActivityKind;
  label: string;
  /** one word for tight spaces */
  short: string;
  emoji: string;
  /** hex, readable on both light and dark backgrounds */
  color: string;
  work: boolean;
}

export const ACTIVITIES: ActivityInfo[] = [
  { kind: "office", label: "At office", short: "Office", emoji: "🏢", color: "#f59e0b", work: true },
  { kind: "outside", label: "Out on work", short: "Outside", emoji: "🚗", color: "#0ea5e9", work: true },
  { kind: "remote", label: "Remote work", short: "Remote", emoji: "💻", color: "#6366f1", work: true },
  { kind: "commute", label: "Commute", short: "Commute", emoji: "🚌", color: "#94a3b8", work: false },
  { kind: "meal", label: "Meal", short: "Meal", emoji: "🍽", color: "#f97316", work: false },
  { kind: "break", label: "Break", short: "Break", emoji: "☕", color: "#f43f5e", work: false },
  { kind: "exercise", label: "Exercise / walk", short: "Exercise", emoji: "🏃", color: "#10b981", work: false },
  { kind: "personal", label: "Personal", short: "Personal", emoji: "🏠", color: "#d946ef", work: false },
];

export const ACTIVITY: Record<ActivityKind, ActivityInfo> = Object.fromEntries(ACTIVITIES.map((a) => [a.kind, a])) as Record<ActivityKind, ActivityInfo>;

export function isActivityKind(v: string): v is ActivityKind {
  return (ACTIVITY_KINDS as readonly string[]).includes(v);
}
