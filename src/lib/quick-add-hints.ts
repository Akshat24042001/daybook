/**
 * Quick-add helper: the syntax chips and autocomplete suggestions for the word at the caret.
 * Pure functions so they are easy to test; the quick-add bar renders them.
 */

export interface SyntaxChip {
  insert: string;
  label: string;
  hint: string;
}

export const SYNTAX_CHIPS: SyntaxChip[] = [
  { insert: "!!", label: "!! Must-do", hint: "Mark as a must-do" },
  { insert: "@tom", label: "@tom", hint: "Schedule for tomorrow (@today, @mon, @21sep)" },
  { insert: "@today 5pm", label: "@today 5pm", hint: "At a time today" },
  { insert: "~1h", label: "~1h", hint: "Estimate: ~30m, ~1h, ~1h30m" },
  { insert: "+", label: "+Person", hint: "Who it is with, e.g. +Rahul" },
  { insert: "*7d", label: "*7d", hint: "Repeat every N days (cadence)" },
  { insert: "every mon", label: "every mon", hint: "Recurring: every mon, every 15th" },
  { insert: ">>", label: ">> Ongoing", hint: "Ongoing: shows every working day until done" },
  { insert: "?", label: "? Someday", hint: "Park it in the Someday pool" },
  { insert: "#w", label: "#w Target", hint: "Weekly target (#m month, #q quarter, #y year)" },
  { insert: "/p", label: "/p Personal", hint: "Personal, not work" },
];

export interface Suggestion {
  /** what replaces the word at the caret */
  replace: string;
  label: string;
  hint?: string;
}

const DAYS = ["today", "tom", "mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_HINT: Record<string, string> = {
  today: "Today", tom: "Tomorrow", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday",
  sat: "Saturday", sun: "Sunday",
};

/** "Harsh Joshi" -> "HarshJoshi", which the parser turns back into "Harsh Joshi". */
export function personToken(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("")
    .replace(/[^A-Za-z0-9_'’-]/g, "");
}

/** The word around the caret, and where it starts. */
export function wordAt(text: string, caret: number): { word: string; start: number; end: number } {
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  let end = caret;
  while (end < text.length && !/\s/.test(text[end])) end++;
  return { word: text.slice(start, end), start, end };
}

export function suggestionsFor(
  text: string,
  caret: number,
  names: { projects: string[]; people: string[] },
  limit = 6,
): Suggestion[] {
  const { word } = wordAt(text, caret);
  const lower = word.toLowerCase();

  if (word.startsWith("+")) {
    const q = lower.slice(1);
    return names.people
      // match the start of the name or of any word in it ("+meh" finds Rahul Mehta), never the middle of a word
      .filter((p) => personToken(p).toLowerCase().startsWith(q) || p.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)))
      .slice(0, limit)
      .map((p) => ({ replace: `+${personToken(p)}`, label: p, hint: "person" }));
  }
  if (word.startsWith("@")) {
    const q = lower.slice(1);
    return DAYS.filter((d) => d.startsWith(q) && `@${d}` !== lower)
      .slice(0, limit)
      .map((d) => ({ replace: `@${d}`, label: `@${d}`, hint: DAY_HINT[d] }));
  }
  if (word.startsWith("~")) {
    return ["~15m", "~30m", "~45m", "~1h", "~2h", "~3h"]
      .filter((e) => e.startsWith(lower) && e !== lower)
      .map((e) => ({ replace: e, label: e, hint: "estimate" }));
  }
  if (word.startsWith("*")) {
    return ["*3d", "*7d", "*14d", "*30d"]
      .filter((e) => e.startsWith(lower) && e !== lower)
      .map((e) => ({ replace: e, label: e, hint: `every ${e.slice(1, -1)} days` }));
  }
  // project prefix: the start of the line matches a project name (multi-word names too) and no "Project:" yet
  const typed = text.slice(0, caret).trim().toLowerCase();
  if (text.includes(":") || typed.length < 2) return [];
  return names.projects
    .filter((p) => p.toLowerCase().startsWith(typed) && p.toLowerCase() !== typed)
    .slice(0, limit)
    .map((p) => ({ replace: `${p}:`, label: `${p}:`, hint: "project" }));
}

/** Applies a suggestion: replaces the word at the caret (or the whole prefix for projects) and adds a space. */
export function applySuggestion(text: string, caret: number, s: Suggestion): { text: string; caret: number } {
  if (s.hint === "project") {
    const rest = text.slice(caret).replace(/^\S*/, "").trimStart();
    const next = `${s.replace} ${rest}`;
    return { text: next, caret: s.replace.length + 1 };
  }
  const { start, end } = wordAt(text, caret);
  const next = `${text.slice(0, start)}${s.replace} ${text.slice(end).trimStart()}`;
  return { text: next, caret: start + s.replace.length + 1 };
}

/** Adds a syntax chip at the end of the line (or as "+" ready for a name). */
export function insertChip(text: string, chip: SyntaxChip): string {
  const base = text.replace(/\s+$/, "");
  return `${base}${base ? " " : ""}${chip.insert}${chip.insert === "+" ? "" : " "}`;
}
