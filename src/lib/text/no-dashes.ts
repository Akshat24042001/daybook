// House rule: no em dashes or en dashes anywhere the app writes or sends text. They read as machine-written.
// Ranges become a plain hyphen ("10-12"), a dash used as punctuation becomes a comma, a dash bullet becomes "- ".

/** Every long-dash character: figure dash, en dash, em dash, horizontal bar, two- and three-em dashes, small em dash. */
export const LONG_DASH = /[\u2012\u2013\u2014\u2015\u2E3A\u2E3B\uFE58]/;
const D = "[\\u2012\\u2013\\u2014\\u2015\\u2E3A\\u2E3B\\uFE58]";

/** The instruction every AI prompt carries. */
export const NO_DASH_RULE =
  "Writing rule: never use em dashes or en dashes (the long dash characters). Use a comma, a colon, a full stop or brackets instead, and a plain hyphen for ranges like 10-12.";

export function noDashes(s: string): string;
export function noDashes(s: string | null | undefined): string | null | undefined;
export function noDashes(s: string | null | undefined): string | null | undefined {
  if (!s || !LONG_DASH.test(s)) return s;
  return s
    // a range or compound with no spaces: 10-12 written with a long dash, also 2pm to 3pm and Mon to Fri
    .replace(new RegExp(`([\\p{L}\\p{N}])${D}+(?=[\\p{L}\\p{N}])`, "gu"), "$1-")
    // a number range with spaces: 10, long dash, 12
    .replace(new RegExp(`(\\d)\\s+${D}+\\s+(?=\\d)`, "g"), "$1-")
    // a dash bullet at the start of a line
    .replace(new RegExp(`^([ \\t]*)${D}+[ \\t]*`, "gm"), "$1- ")
    // a dash at the end of a line or the text
    .replace(new RegExp(`[ \\t]*${D}+[ \\t]*$`, "gm"), "")
    // any other: punctuation, so a comma
    .replace(new RegExp(`\\s*${D}+\\s*`, "g"), ", ")
    // tidy what that leaves
    .replace(/,\s*([,.;:!?)\]])/g, "$1")
    .replace(/([(\[])\s*,\s*/g, "$1")
    .replace(/^,\s*/gm, "");
}

/** Cleans every string inside a value (objects and arrays included), for AI answers parsed from JSON. */
export function noDashesDeep<T>(v: T): T {
  if (typeof v === "string") return noDashes(v) as T;
  if (Array.isArray(v)) return v.map(noDashesDeep) as T;
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, noDashesDeep(x)])) as T;
  }
  return v;
}

/** Adds the writing rule to a chat: appended to the first system message, or as a system message of its own. */
export function withNoDashRule<M extends { role: string; content: unknown }>(messages: M[]): M[] {
  const i = messages.findIndex((m) => m.role === "system" && typeof m.content === "string");
  if (i >= 0) return messages.map((m, j) => (j === i ? { ...m, content: `${m.content as string}\n\n${NO_DASH_RULE}` } : m));
  return [{ role: "system", content: NO_DASH_RULE } as M, ...messages];
}
