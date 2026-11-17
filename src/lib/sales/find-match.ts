/** The pure half of smart search (find.ts): shared by the server and the pages, no database here. */

/** The words to look for, lowercased, without duplicates; quoted phrases stay whole. Pure. */
export function searchTerms(query: string): string[] {
  const out: string[] = [];
  const s = query.toLowerCase().slice(0, 200);
  for (const m of s.matchAll(/"([^"]+)"|(\S+)/g)) {
    const t = (m[1] ?? m[2] ?? "").trim().replace(/^[^\p{L}\p{N}+@#]+|[^\p{L}\p{N}]+$/gu, "");
    if (t.length >= 2 && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 8);
}

/** Digits only, for phone numbers typed with or without spaces and codes. Pure. */
export const digitsOf = (s: string) => s.replace(/\D/g, "");

/** True when every term is found in the text (phone numbers match on their digits). Pure. */
export function matchesAll(text: string, terms: string[]): boolean {
  if (!terms.length) return true;
  const t = text.toLowerCase();
  const d = digitsOf(t);
  return terms.every((w) => t.includes(w) || (digitsOf(w).length >= 5 && digitsOf(w).length === w.replace(/[\s+()-]/g, "").length && d.includes(digitsOf(w))));
}

/** Everything about a value, flattened to one string, for matching on the client. Pure. */
export function haystack(...parts: unknown[]): string {
  const out: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (v === null || v === undefined || depth > 6) return;
    if (typeof v === "string") out.push(v);
    else if (typeof v === "number" || typeof v === "boolean") out.push(String(v));
    else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (typeof v === "object") Object.values(v as Record<string, unknown>).forEach((x) => walk(x, depth + 1));
  };
  parts.forEach((p) => walk(p, 0));
  return out.join(" \n ");
}

/** A short piece of text around the first match, so you see why it matched. Pure. */
export function snippet(doc: string, terms: string[]): string | null {
  const plain = doc.replace(/\\[nrt]/g, " ").replace(/[{}"[\]]/g, " ").replace(/\s+/g, " ");
  const low = plain.toLowerCase();
  for (const t of terms) {
    const i = low.indexOf(t);
    if (i >= 0) return `${i > 40 ? "..." : ""}${plain.slice(Math.max(0, i - 40), i + t.length + 60).trim()}${i + t.length + 60 < plain.length ? "..." : ""}`;
  }
  return null;
}
