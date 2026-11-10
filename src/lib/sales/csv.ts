/** CSV in and out (RFC 4180: quoted fields, doubled quotes, commas and line breaks inside quotes). Client-safe. */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const cell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v);
  // a leading = + - @ would run as a formula in a spreadsheet: keep it as text
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Columns a deal import understands, with the header names that map to each automatically. */
export const IMPORT_FIELDS: { key: string; label: string; aliases: string[] }[] = [
  { key: "title", label: "Deal name", aliases: ["deal", "deal name", "title", "opportunity", "lead", "lead name"] },
  { key: "company", label: "Company", aliases: ["company", "company name", "organisation", "organization", "business", "account"] },
  { key: "person", label: "Contact name", aliases: ["contact", "contact name", "name", "person", "full name", "client name"] },
  { key: "email", label: "Email", aliases: ["email", "e-mail", "email address", "mail"] },
  { key: "phone", label: "Phone", aliases: ["phone", "mobile", "phone number", "whatsapp", "contact number", "mobile number"] },
  { key: "title_role", label: "Contact role", aliases: ["designation", "job title", "role", "position"] },
  { key: "stage", label: "Stage (name)", aliases: ["stage", "status", "deal stage"] },
  { key: "value_amount", label: "Value", aliases: ["value", "amount", "deal value", "price", "budget amount"] },
  { key: "currency", label: "Currency", aliases: ["currency", "cur"] },
  { key: "source", label: "Source", aliases: ["source", "lead source", "channel"] },
  { key: "city", label: "City", aliases: ["city", "town", "location"] },
  { key: "region", label: "State / region", aliases: ["state", "region", "province"] },
  { key: "country", label: "Country", aliases: ["country"] },
  { key: "industry", label: "Industry", aliases: ["industry", "sector", "vertical"] },
  { key: "services", label: "Services", aliases: ["services", "service", "product", "products", "interested in"] },
  { key: "requirements", label: "Requirement", aliases: ["requirement", "requirements", "need", "notes", "description", "remarks"] },
  { key: "expected_close", label: "Expected close", aliases: ["expected close", "close date", "closing date"] },
  { key: "tags", label: "Tags", aliases: ["tags", "labels"] },
  { key: "budget", label: "Budget", aliases: ["budget"] },
];

const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Which import field each CSV header most likely is (or "" to skip). */
export function guessMapping(header: string[]): string[] {
  const used = new Set<string>();
  return header.map((h) => {
    const x = n(h);
    const f = IMPORT_FIELDS.find((f) => !used.has(f.key) && (f.aliases.includes(x) || n(f.label) === x));
    if (f) used.add(f.key);
    return f?.key ?? "";
  });
}
