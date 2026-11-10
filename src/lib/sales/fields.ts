/**
 * Every field a deal has, in one place: the edit form, the details panel, the pipeline columns, the closing checklists
 * and the change history all read this list. Client-safe (no server imports).
 *
 * The groups follow how a deal is worked, and the qualification fields follow well-known methods, named where they come
 * from so you can read further:
 * - BANT (Budget, Authority, Need, Timeline): IBM's classic qualification.
 * - MEDDPICC (Metrics, Economic buyer, Decision criteria, Decision process, Paper process, Identify pain, Champion,
 *   Competition): from PTC in the 1990s (credited to Dick Dunkel and Jack Napoli), extended later with Paper process and
 *   Competition.
 * - Gap selling (Keenan, "Gap Selling", 2018): the current state, the future state they want, and the gap between them.
 * - Lost reasons start from Zig Ziglar's five obstacles to a sale ("Secrets of Closing the Sale", 1984): no need, no
 *   money, no hurry, no desire, no trust; plus the reasons deals are lost in practice (a competitor, doing it themselves,
 *   no decision at all, going silent).
 */

export type FieldType =
  | "text" | "long_text" | "number" | "money" | "percent" | "date" | "datetime" | "select" | "multi_select" | "checkbox"
  | "url" | "phone" | "email" | "tags" | "person";

export interface FieldDef {
  key: string;
  label: string;
  group: FieldGroup;
  type: FieldType;
  hint?: string;
  options?: string[];
  /** a field you defined yourself (Sales settings > Fields) */
  custom?: boolean;
  required_to_win?: boolean;
}

export const FIELD_GROUPS = ["Basics", "Location", "The need", "How they decide", "Closing", "Notes", "Your fields"] as const;
export type FieldGroup = (typeof FIELD_GROUPS)[number];

export const DEAL_TYPES: [string, string][] = [
  ["new", "New business"], ["upsell", "Upsell (more for a client)"], ["renewal", "Renewal / retainer"], ["repeat", "Repeat project"],
  ["partnership", "Partnership / white-label"], ["other", "Other"],
];
export const SOURCES = ["outbound", "inbound", "referral", "network", "content", "partner", "radar", "repeat", "other"];

export const DEAL_FIELDS: FieldDef[] = [
  // basics
  { key: "title", label: "Deal name", group: "Basics", type: "text" },
  { key: "deal_type", label: "Type", group: "Basics", type: "select", options: DEAL_TYPES.map(([k]) => k) },
  { key: "source", label: "Source", group: "Basics", type: "select", options: SOURCES },
  { key: "source_detail", label: "Source detail", group: "Basics", type: "text", hint: "Campaign, post link, event, who passed it on" },
  { key: "value_amount", label: "Value", group: "Basics", type: "money" },
  { key: "probability", label: "Win chance %", group: "Basics", type: "percent", hint: "Blank uses the stage's default" },
  { key: "expected_close", label: "Expected close", group: "Basics", type: "date" },
  { key: "services", label: "Services", group: "Basics", type: "tags", hint: "Comma separated" },
  { key: "industry", label: "Industry", group: "Basics", type: "text" },
  { key: "tags", label: "Tags", group: "Basics", type: "tags", hint: "Comma separated, e.g. hot, government, Q1" },
  // location
  { key: "city", label: "City", group: "Location", type: "text" },
  { key: "region", label: "State / region", group: "Location", type: "text" },
  { key: "country", label: "Country", group: "Location", type: "text" },
  { key: "address", label: "Address", group: "Location", type: "long_text", hint: "Office or site address, landmark, PIN code" },
  // the need (gap selling, BANT need, MEDDPICC metrics and pain)
  { key: "requirements", label: "Requirement", group: "The need", type: "long_text", hint: "What they asked for, in their words" },
  { key: "pain", label: "Problem today", group: "The need", type: "long_text", hint: "What is broken or costing them now, and why (the current state)" },
  { key: "current_solution", label: "What they use now", group: "The need", type: "text", hint: "Tool, vendor, staff or spreadsheet doing it today" },
  { key: "desired_outcome", label: "What they want instead", group: "The need", type: "long_text", hint: "The result they described, in their words (the future state)" },
  { key: "impact", label: "What it is worth to them", group: "The need", type: "long_text", hint: "Money saved or made, hours, leads, errors: numbers they gave" },
  { key: "compelling_event", label: "Why now", group: "The need", type: "text", hint: "Deadline, launch, season, audit, new hire: the reason it cannot wait" },
  { key: "budget", label: "Budget", group: "The need", type: "text", hint: "What they said they can spend" },
  { key: "timeline", label: "Their timeline", group: "The need", type: "text", hint: "When they want it live" },
  // how they decide (MEDDPICC, BANT authority)
  { key: "economic_buyer_id", label: "Who signs", group: "How they decide", type: "person", hint: "The person who approves the money (economic buyer)" },
  { key: "champion_id", label: "Champion", group: "How they decide", type: "person", hint: "Who wants this and pushes for you inside" },
  { key: "decision_criteria", label: "How they will choose", group: "How they decide", type: "long_text", hint: "Price, speed, references, features: what they compare on" },
  { key: "decision_process", label: "Steps to a yes", group: "How they decide", type: "long_text", hint: "Who sees it, in what order, by when" },
  { key: "paper_process", label: "Paperwork", group: "How they decide", type: "long_text", hint: "PO, vendor registration, legal review, NDA, contract signing" },
  { key: "competitors", label: "Competitors", group: "How they decide", type: "tags", hint: "Who else they are talking to, comma separated. Doing nothing counts." },
  { key: "risks", label: "Risks", group: "How they decide", type: "long_text", hint: "What could kill or delay it" },
  // closing record
  { key: "poc_id", label: "Point of contact", group: "Closing", type: "person", hint: "Who you work with day to day once it is signed" },
  { key: "start_date", label: "Start date", group: "Closing", type: "date" },
  { key: "delivery_date", label: "Delivery date", group: "Closing", type: "date" },
  { key: "delivery_duration", label: "Delivery time", group: "Closing", type: "text", hint: "e.g. 6 weeks, 3 phases" },
  { key: "scope", label: "Scope of work", group: "Closing", type: "long_text", hint: "Exactly what is included, and what is not" },
  { key: "payment_terms", label: "Payment terms", group: "Closing", type: "long_text", hint: "e.g. 50% advance, 30% on demo, 20% on handover; net 15" },
  { key: "contract_ref", label: "Contract / PO number", group: "Closing", type: "text" },
  { key: "won_reason", label: "Why they chose you", group: "Closing", type: "select" },
  { key: "won_detail", label: "In their words", group: "Closing", type: "long_text" },
  { key: "lost_reason", label: "Why it was lost", group: "Closing", type: "select" },
  { key: "lost_to", label: "Lost to", group: "Closing", type: "text", hint: "Competitor, in-house, or no decision" },
  { key: "lost_detail", label: "What happened", group: "Closing", type: "long_text" },
  { key: "lessons", label: "Lesson", group: "Closing", type: "long_text", hint: "What would have won it, or what to repeat" },
  // notes
  { key: "notes", label: "Other details", group: "Notes", type: "long_text", hint: "Anything else worth knowing" },
  { key: "summary", label: "Where we are", group: "Notes", type: "long_text" },
  { key: "next_action", label: "Next step", group: "Notes", type: "text" },
  { key: "next_action_at", label: "Next step at", group: "Notes", type: "datetime" },
];

export const DEAL_FIELD = new Map(DEAL_FIELDS.map((f) => [f.key, f]));

/** Fields whose changes are written to the deal's history (not the running summary, which changes on every capture). */
export const TRACKED_FIELDS = new Set(DEAL_FIELDS.map((f) => f.key).filter((k) => !["summary"].includes(k)).concat(["currency", "custom"]));

// ---------------------------------------------------------------- companies and people

export const COMPANY_EDIT_FIELDS: FieldDef[] = [
  { key: "name", label: "Company name", group: "Basics", type: "text" },
  { key: "website", label: "Website", group: "Basics", type: "url" },
  { key: "industry", label: "Industry", group: "Basics", type: "text" },
  { key: "employees", label: "Employees", group: "Basics", type: "number" },
  { key: "phone", label: "Office phone", group: "Basics", type: "phone" },
  { key: "email", label: "Office email", group: "Basics", type: "email" },
  { key: "tax_id", label: "GST / tax ID", group: "Basics", type: "text", hint: "Needed on invoices" },
  { key: "linkedin", label: "LinkedIn page", group: "Basics", type: "url" },
  { key: "city", label: "City", group: "Location", type: "text" },
  { key: "region", label: "State / region", group: "Location", type: "text" },
  { key: "country", label: "Country", group: "Location", type: "text" },
  { key: "postal_code", label: "PIN / postal code", group: "Location", type: "text" },
  { key: "address", label: "Address", group: "Location", type: "long_text" },
  { key: "notes", label: "Notes", group: "Notes", type: "long_text" },
];

export const SENIORITY = ["Owner / founder", "CXO", "Director / VP", "Manager", "Staff", "Other"];
export const PREFERRED_CHANNELS = ["WhatsApp", "Call", "Email", "LinkedIn", "In person"];

export const PERSON_EDIT_FIELDS: FieldDef[] = [
  { key: "full_name", label: "Name", group: "Basics", type: "text" },
  { key: "title", label: "Role / designation", group: "Basics", type: "text" },
  { key: "department", label: "Department", group: "Basics", type: "text" },
  { key: "seniority", label: "Seniority", group: "Basics", type: "select", options: SENIORITY },
  { key: "is_decision_maker", label: "Decides on the money", group: "Basics", type: "checkbox" },
  { key: "relationship", label: "How you know them", group: "Basics", type: "select", options: ["cold", "warm", "referral", "partner", "client"] },
  { key: "phones", label: "Phones", group: "Basics", type: "tags", hint: "Comma separated, with country code" },
  { key: "whatsapp", label: "WhatsApp (if different)", group: "Basics", type: "phone" },
  { key: "emails", label: "Emails", group: "Basics", type: "tags", hint: "Comma separated" },
  { key: "linkedin", label: "LinkedIn", group: "Basics", type: "url" },
  { key: "instagram", label: "Instagram", group: "Basics", type: "text" },
  { key: "preferred_channel", label: "Best way to reach", group: "Basics", type: "select", options: PREFERRED_CHANNELS },
  { key: "language", label: "Language", group: "Basics", type: "text", hint: "e.g. Hindi, English" },
  { key: "city", label: "City", group: "Location", type: "text" },
  { key: "country", label: "Country", group: "Location", type: "text" },
  { key: "notes", label: "Notes", group: "Notes", type: "long_text", hint: "Personal context: family, interests, how they like to work" },
];

// ---------------------------------------------------------------- qualification

export interface QualItem { key: string; label: string; letter: string; filled: (d: Record<string, unknown>) => boolean }
const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && String(v).trim() !== "");

/** What a qualified deal has answered. Letters point at the method each comes from (BANT, MEDDPICC, gap selling). */
export const QUALIFICATION: QualItem[] = [
  { key: "pain", label: "Problem today", letter: "Pain", filled: (d) => has(d.pain) || has(d.requirements) },
  { key: "desired_outcome", label: "What they want instead", letter: "Gap", filled: (d) => has(d.desired_outcome) },
  { key: "impact", label: "What it is worth to them", letter: "Metrics", filled: (d) => has(d.impact) },
  { key: "budget", label: "Budget", letter: "Budget", filled: (d) => has(d.budget) },
  { key: "timeline", label: "Timeline", letter: "Timeline", filled: (d) => has(d.timeline) || has(d.expected_close) },
  { key: "compelling_event", label: "Why now", letter: "Urgency", filled: (d) => has(d.compelling_event) },
  { key: "economic_buyer_id", label: "Who signs", letter: "Authority", filled: (d) => has(d.economic_buyer_id) },
  { key: "champion_id", label: "Champion", letter: "Champion", filled: (d) => has(d.champion_id) },
  { key: "decision_criteria", label: "How they will choose", letter: "Criteria", filled: (d) => has(d.decision_criteria) },
  { key: "decision_process", label: "Steps to a yes", letter: "Process", filled: (d) => has(d.decision_process) },
  { key: "paper_process", label: "Paperwork", letter: "Paper", filled: (d) => has(d.paper_process) },
  { key: "competitors", label: "Competitors", letter: "Competition", filled: (d) => has(d.competitors) },
];

export function qualification(d: Record<string, unknown>): { done: number; total: number; missing: QualItem[] } {
  const missing = QUALIFICATION.filter((q) => !q.filled(d));
  return { done: QUALIFICATION.length - missing.length, total: QUALIFICATION.length, missing };
}

// ---------------------------------------------------------------- reasons (editable in Sales settings)

export interface Reasons { lost: string[]; disqualified: string[]; won: string[]; parked: string[]; reopened: string[] }

export const DEFAULT_REASONS: Reasons = {
  lost: [
    "No need: the problem was not big enough",
    "No money: no budget for it",
    "No hurry: not a priority now",
    "No desire: not interested in this kind of solution",
    "No trust: not sure we could deliver",
    "Price: our quote was too high for them",
    "Chose a competitor",
    "Doing it themselves / in-house",
    "No decision: stayed as they are",
    "Stopped responding",
    "Scope did not fit what we do",
    "Our contact left or lost the say",
    "Backed out after saying yes",
    "Other",
  ],
  disqualified: [
    "Not our kind of client",
    "No budget at all",
    "Spam or not a real enquiry",
    "Job seeker, student or freelancer pitching us",
    "A competitor or vendor fishing",
    "Duplicate of another deal",
    "Cannot reach anyone who decides",
    "Other",
  ],
  won: [
    "Clear return on the money",
    "Trust in us / the relationship",
    "Proof: case study or demo convinced them",
    "Referral or recommendation",
    "Speed: we could start or deliver soonest",
    "Price",
    "Scope fit exactly",
    "Other",
  ],
  parked: [
    "Budget opens next quarter or year",
    "Busy with other priorities",
    "Waiting on an internal decision",
    "Project paused on their side",
    "Seasonal: revisit before the season",
    "Other",
  ],
  reopened: [
    "They came back",
    "New budget or new need",
    "Competitor failed them",
    "Moved by mistake",
    "Other",
  ],
};

// ---------------------------------------------------------------- moves between stages

export type CloseKind = "won" | "lost" | "disqualified" | "parked" | "reopen" | "move";

/** What a move means: closing as won, lost or disqualified, parking, reopening, or an ordinary step. */
export function closeKind(from: { category: string }, to: { category: string; role?: string | null }): CloseKind {
  if (to.category === "won" && from.category !== "won") return "won";
  if (to.category === "lost") return to.role === "disqualified" ? "disqualified" : "lost";
  if (to.category === "parked" && from.category !== "parked") return "parked";
  if (to.category === "open" && from.category !== "open") return "reopen";
  return "move";
}

/** A move that asks for details before it happens (anything but an ordinary step with no requirement). */
export function needsDetails(from: { category: string }, to: { category: string; role?: string | null }, requires: string): boolean {
  return requires !== "none" || closeKind(from, to) !== "move";
}

// ---------------------------------------------------------------- activity log

export const ACTIVITY_TYPES: { key: string; label: string; channel: string }[] = [
  { key: "call", label: "Phone call", channel: "call" },
  { key: "meeting", label: "Video meeting", channel: "meeting" },
  { key: "in_person", label: "In person / site visit", channel: "in_person" },
  { key: "whatsapp", label: "WhatsApp", channel: "whatsapp" },
  { key: "email", label: "Email", channel: "email" },
  { key: "linkedin", label: "LinkedIn", channel: "linkedin" },
  { key: "instagram", label: "Instagram", channel: "instagram" },
  { key: "sms", label: "SMS", channel: "sms" },
  { key: "note", label: "Note / remark", channel: "note" },
  { key: "other", label: "Other", channel: "other" },
];

export const OUTCOMES: Record<string, string[]> = {
  call: ["Connected", "No answer", "Busy / call back", "Voicemail", "Wrong number", "Asked to message instead"],
  meeting: ["Held", "No-show", "Rescheduled", "Cancelled"],
  in_person: ["Held", "No-show", "Rescheduled", "Cancelled"],
  any: ["Interested", "Needs time", "Asked for a proposal", "Objection raised", "Not interested", "Follow-up agreed"],
};

// ---------------------------------------------------------------- documents

export const DOC_CATEGORIES: [string, string][] = [
  ["proposal", "Proposal / quote"], ["contract", "Signed contract"], ["po", "Purchase order"], ["sow", "Scope of work"],
  ["nda", "NDA"], ["invoice", "Invoice"], ["receipt", "Payment receipt"], ["brief", "Brief / requirement"],
  ["design", "Design / mockup"], ["deck", "Deck"], ["other", "Other"],
];

// ---------------------------------------------------------------- values in words

/** A stored value as you would say it (for history and lists). Person ids are resolved by the caller. */
export function showValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
