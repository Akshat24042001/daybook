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

export function voiceToQuickAdd(transcript: string): string {
  let s = ` ${transcript.trim()} `;
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
  return cleanup(s);
}
