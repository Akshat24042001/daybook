import { atLogical, fmtHM, logicalDate, parseHM, type DateStr } from "./time";
import type { EntryView } from "./types";

/** Today screen sections, in display order (PRD 6.1). Shared by the web app and the bot. */
export type SectionKey = "must" | "timed" | "followups" | "other" | "personal" | "done";

export const SECTION_ORDER: SectionKey[] = ["must", "timed", "followups", "other", "personal", "done"];

export const SECTION_LABEL: Record<SectionKey, string> = {
  must: "Must do",
  timed: "Timed",
  followups: "Follow-ups",
  other: "Other",
  personal: "Personal",
  done: "Done",
};

/**
 * The time an entry is due on its own day. Recurring tasks keep a wall-clock time that applies to
 * every occurrence; other tasks only count if their due time falls on the entry's day.
 */
export function dueFor(
  e: Pick<EntryView, "due_at" | "type" | "date">,
  tz: string,
  boundaryMin: number,
): Date | null {
  if (!e.due_at) return null;
  if (e.type === "recurring") {
    return atLogical(e.date, parseHM(fmtHM(e.due_at, tz)), tz, boundaryMin);
  }
  return logicalDate(e.due_at, tz, boundaryMin) === e.date ? e.due_at : null;
}

export function sectionize(
  entries: EntryView[],
  tz: string,
  boundaryMin: number,
): Record<SectionKey, EntryView[]> {
  const out: Record<SectionKey, EntryView[]> = { must: [], timed: [], followups: [], other: [], personal: [], done: [] };
  for (const e of entries) {
    if (e.status === "done" || e.status === "dropped") out.done.push(e);
    else if (e.is_personal) out.personal.push(e);
    else if (e.must_do) out.must.push(e);
    else if (dueFor(e, tz, boundaryMin)) out.timed.push(e);
    else if (e.type === "follow_up") out.followups.push(e);
    else out.other.push(e);
  }
  out.timed.sort(
    (a, b) => dueFor(a, tz, boundaryMin)!.getTime() - dueFor(b, tz, boundaryMin)!.getTime(),
  );
  return out;
}

export function dateOf(e: { date: DateStr }): DateStr {
  return e.date;
}
