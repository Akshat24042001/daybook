/**
 * What each kind of task is, in plain words. Shown on the task page, in the task dialog and in the picker, so nobody has
 * to guess why a task keeps appearing (or why it does not).
 */
import type { Hue } from "./hue";
import type { TaskType } from "./parser";

export interface TaskTypeInfo {
  label: string;
  /** one line: when it shows up */
  shows: string;
  /** one line: what happens if you do not finish it */
  missed: string;
  hue: Hue;
  /** the fields that matter for this kind of task */
  fields: { date: false | "Do on" | "Starts on"; time: boolean; repeat: "none" | "cadence" | "rule" | "target"; people: boolean };
}

export const TASK_TYPE_INFO: Record<TaskType, TaskTypeInfo> = {
  one_off: {
    label: "One-off", hue: "sky",
    shows: "Appears once, on the day you give it (or the day you plan it).",
    missed: "If you do not finish it, it comes back the next working day, and the number of times it has come back is counted. After 3 you are asked to decide.",
    fields: { date: "Do on", time: true, repeat: "none", people: false },
  },
  ongoing: {
    label: "Ongoing", hue: "teal",
    shows: "Appears on your list every working day until you mark it done.",
    missed: "Nothing is lost by a missed day: it simply appears again tomorrow. Mark Progressed on days you worked on it.",
    fields: { date: "Starts on", time: false, repeat: "none", people: false },
  },
  follow_up: {
    label: "Follow-up", hue: "peach",
    shows: "A one-off tied to a person: appears on the day you set, or when its waiting period ends.",
    missed: "Comes back the next working day, like a one-off. Use Waiting to park it until they reply.",
    fields: { date: "Do on", time: true, repeat: "none", people: true },
  },
  cadence: {
    label: "Cadence", hue: "lilac",
    shows: "Not on a fixed day: it shows up on Today as a nudge once the chosen number of days has passed since you last did it.",
    missed: "It keeps nudging, once a day, until you do it. Snooze it with Later.",
    fields: { date: false, time: false, repeat: "cadence", people: false },
  },
  recurring: {
    label: "Recurring", hue: "mint",
    shows: "Appears on the days its rule says: every day, every Monday, the 1st of the month, and so on.",
    missed: "A missed day is just missed: it does not pile up or carry over.",
    fields: { date: false, time: true, repeat: "rule", people: false },
  },
  someday: {
    label: "Someday", hue: "pink",
    shows: "Never on a day by itself. It waits in the Someday pool until you pull it into a day.",
    missed: "Nothing happens. It stays in the pool.",
    fields: { date: false, time: false, repeat: "none", people: false },
  },
  target: {
    label: "Target", hue: "butter",
    shows: "A goal for a week, month, quarter or year, measured in hours or sessions. Shown under Goals and as a chip on Today.",
    missed: "When the period ends it closes as met or missed.",
    fields: { date: false, time: false, repeat: "target", people: false },
  },
};
