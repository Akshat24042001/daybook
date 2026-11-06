/**
 * Turns a spoken task into quick-add syntax with plain rules (no AI), so speaking can replace typing:
 *   "Vector insights must do tomorrow at 5 pm estimate 2 hours"
 *     -> "Vector insights !! @tom @5pm ~2h"
 * Only unmistakable phrases are converted. The live preview shows how the line was understood, so a
 * wrong guess is visible before saving. Time entries ("office 10:45 to 1:30") are handled by timelog.ts.
 */

const WEEKDAY = "(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";

function cleanup(s: string): string {
  // Drop sentence punctuation stuck to a word ("Karmit.") but keep standalone tokens like "!!" and "?".
  return s
    .replace(/(?<=[\p{L}\p{N})])[.,;:]+(?=\s|$)/gu, "")
    .replace(/\s[.,;:]+(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds the project in a spoken line and returns it with the line minus the project words.
 *   "add a task to Aivaura call the bank"     -> Aivaura, "call the bank"
 *   "ship the report for the Vector project"  -> Vector,  "ship the report"
 *   "in the Home Renovation project order tiles" -> Home Renovation, "order tiles"
 * A name you already have is recognised after "to / in / for / under / into" even without the word "project"; a name you
 * do not have yet needs the word "project" after it, so ordinary words are never mistaken for one. Exported for tests.
 */
export function extractProject(line: string, known: string[] = []): { project: string | null; rest: string } {
  const text = ` ${line} `;
  const lead = String.raw`(?:^|\s)(?:(?:please\s+)?(?:add|create|put|file)\s+(?:a\s+|this\s+|the\s+)?(?:new\s+)?(?:task|todo|item|reminder)?\s*)?`;
  for (const name of [...known].sort((a, b) => b.length - a.length)) {
    const n = escRe(name.trim()).replace(/\\? /g, "\\s+");
    if (!n) continue;
    // "to Aivaura ...", "in the Vector project ...", "for Vector: ..."
    const re = new RegExp(`${lead}(?:to|in|into|for|under|on)\\s+(?:the\\s+)?(${n})(?:\\s+project)?(?=[\\s,:.]|$)[,:.]?`, "i");
    const m = re.exec(text);
    if (m) return { project: known.find((k) => k.toLowerCase() === m[1].toLowerCase()) ?? name, rest: (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim() };
    // "Vector project: ...", "project Vector ..."
    const re2 = new RegExp(`(?:^|\\s)(?:(${n})\\s+project|project\\s+(${n}))(?=[\\s,:.]|$)[,:.]?`, "i");
    const m2 = re2.exec(text);
    if (m2) return { project: known.find((k) => k.toLowerCase() === (m2[1] ?? m2[2]).toLowerCase()) ?? name, rest: (text.slice(0, m2.index) + " " + text.slice(m2.index + m2[0].length)).replace(/\s+/g, " ").trim() };
  }
  // a project that does not exist yet must be called a project: "for the Home Renovation project"
  const gen = new RegExp(`${lead}(?:to|in|into|for|under|on)\\s+(?:the\\s+)?([A-Za-z0-9][A-Za-z0-9&.'’-]*(?:\\s+[A-Za-z0-9&.'’-]+){0,2}?)\\s+project(?=[\\s,:.]|$)[,:.]?`, "i").exec(text);
  if (gen) return { project: gen[1].trim().replace(/\b\w/g, (c) => c.toUpperCase()), rest: (text.slice(0, gen.index) + " " + text.slice(gen.index + gen[0].length)).replace(/\s+/g, " ").trim() };
  return { project: null, rest: line };
}

export function voiceToQuickAdd(transcript: string, projects: string[] = []): string {
  const found = extractProject(transcript.trim(), projects);
  let s = ` ${found.rest} `;
  const rep = (re: RegExp, to: string) => {
    s = s.replace(re, to);
  };

  rep(/\b(?:this is a |mark (?:it )?as )?(?:must[- ]do|high priority|top priority)\b/gi, " !! ");
  rep(/\bpersonal(?: task)?\b/gi, " /p ");
  rep(/\bongoing(?: task)?\b|\bmulti[- ]day\b/gi, " >> ");
  rep(/\bsomeday\b|\bwhen (?:i(?:'m| am) )?free\b/gi, " ? ");

  // estimate 2 hours / estimated 30 minutes / takes 1.5 hours
  s = s.replace(/\b(?:estimate[d]?|takes?|about)\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/gi, (_m, n: string, unit: string) =>
    ` ~${n}${/^h/i.test(unit) ? "h" : "m"} `,
  );

  // tomorrow / next monday / on friday
  rep(/\b(?:for\s+)?tomorrow\b/gi, " @tom ");
  s = s.replace(new RegExp(`\\b(?:on|next|this)\\s+${WEEKDAY}\\b`, "gi"), (_m, d: string) => ` @${d.slice(0, 3).toLowerCase()} `);

  // at 5 pm / at 5:30 pm / at 17:00
  s = s.replace(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/gi, (_m, h: string, mm: string | undefined, ap: string) =>
    ` @${h}${mm ? `:${mm}` : ""}${ap.replace(/\./g, "").toLowerCase()} `,
  );
  s = s.replace(/\bat\s+(\d{1,2}):(\d{2})\b/g, (_m, h: string, mm: string) => ` @${h}:${mm} `);

  // fillers that add nothing
  rep(/\b(?:please\s+)?(?:add|create|remind me to|i need to|i have to|task)\b[:,]?\s*/gi, " ");
  const line = cleanup(s);
  // the quick-add bar puts a project in front of the title: "Vector: ship the report"
  return found.project && line ? `${found.project}: ${line}` : line;
}
