/**
 * Capture pipeline: anything you send in (a forwarded chat, a WhatsApp export, a LinkedIn screenshot, a voice note after a
 * meeting, an email, a page from the bookmarklet) becomes: the right person and deal, timeline entries, promises both ways,
 * an updated "where we are", stage moves, and fresh next moves. You never fill a form.
 */
import { createHash } from "node:crypto";
import { one, q, UserError } from "../db";
import { AiUnavailable, isAiUnavailable } from "../ai-quota";
import { getSettings } from "../settings";
import { zonedInstant } from "../time";
import { salesConfig, toUsd, type SalesConfig } from "./config";
import { dealStateForFiling, iso } from "./context";
import { dealReach, onlyReachable } from "./reach";
import {
  addCommitment, createDeal, dealForPerson, getDeal, logActivity, logInteraction, updateDeal, type Channel, type Direction,
} from "./deals";
import { ACTIVITY_TYPES } from "./fields";
import { addIdentities, domainOf, ensureCompany, resolvePerson, upsertPerson, type PersonRow } from "./identity";
import { enqueue } from "./jobs";
import { llmJson } from "./llm";
import { readScreens, screensAsText } from "./read-screens";
import { keepShots, shotDataUrls } from "./shots";
import { applyEvent, moveDeal, stageByRole } from "./stages";

export interface CaptureInput {
  source: string;
  channel?: string | null;
  text?: string | null;
  /** data URLs */
  images?: string[];
  hints?: {
    deal_id?: number;
    person_id?: number;
    meeting_id?: number;
    url?: string;
    page_title?: string;
    file_name?: string;
    direction?: Direction;
    kind?: string;
  };
  tg_chat?: number | null;
  tg_message_id?: number | null;
}

export async function capture(input: CaptureInput, opts: { now?: boolean } = {}): Promise<number> {
  const row = await one<{ id: number }>(
    `insert into sales_captures (source, channel, text, images, hints, tg_chat, tg_message_id) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [input.source, input.channel ?? null, input.text ?? null, JSON.stringify(input.images ?? []), JSON.stringify(input.hints ?? {}), input.tg_chat ?? null, input.tg_message_id ?? null],
  );
  if (!opts.now) await enqueue("process_capture", { id: row!.id });
  return row!.id;
}

// ------------------------------------------------------------------ WhatsApp exports

export interface ChatLine {
  at: Date;
  sender: string;
  text: string;
}

const WA_LINE =
  /^‎?\[?(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?\]?\s*(?:-\s+)?([^:]{1,80}?):\s?([\s\S]*)$/;

/** Parses an exported WhatsApp chat (iPhone or Android format). Returns null when the text is not one. */
export function parseWhatsAppExport(raw: string, tz: string): ChatLine[] | null {
  const lines = raw.replace(/\r/g, "").split("\n");
  const out: ChatLine[] = [];
  let matched = 0;
  for (const line of lines) {
    const m = line.replace(/[‎  ]/g, " ").replace(/^\s+/, "").match(WA_LINE);
    if (m) {
      matched += 1;
      let [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
      let y: number, mo: number, d: number;
      if (a > 31) [y, mo, d] = [a, b, c];
      else {
        // India and most of the world write day first; a first number above 12 settles it either way
        if (b > 12 && a <= 12) [mo, d] = [a, b];
        else [d, mo] = [a, b];
        y = c < 100 ? 2000 + c : c;
      }
      let h = Number(m[4]);
      const min = Number(m[5]);
      const ap = m[7]?.toLowerCase().replace(/[.\s]/g, "");
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
      const date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      let at: Date;
      try {
        at = zonedInstant(date, h, min, tz);
        if (Number.isNaN(at.getTime())) continue;
      } catch {
        continue;
      }
      out.push({ at, sender: m[8].trim(), text: m[9].trim() });
    } else if (out.length && line.trim()) {
      out[out.length - 1].text += `\n${line}`;
    }
  }
  if (matched < 2 || matched < lines.filter((l) => l.trim()).length * 0.3) return null;
  return out.filter((l) => !/^(messages and calls are end-to-end encrypted|<media omitted>|this message was deleted)/i.test(l.text));
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex");

function isMe(cfg: SalesConfig, name: string): boolean {
  const n = name.toLowerCase().trim();
  return cfg.owner.aliases.some((a) => a.toLowerCase() === n) || n === cfg.owner.name.toLowerCase();
}

// ------------------------------------------------------------------ extraction

export interface QuickAction {
  kind: "reply" | "follow_up" | "promise" | "meeting" | "call" | "send" | "stage";
  label: string;
  detail?: string | null;
  due?: string | null;
  /** for kind "stage": the stage role to move to */
  stage?: string | null;
}

export interface Extraction {
  kind: "conversation" | "note" | "meeting_notes" | "lead_post" | "profile" | "email" | "other";
  is_sales_related: boolean;
  people: {
    name?: string; company?: string; title?: string; email?: string; phone?: string; linkedin?: string; instagram?: string; country?: string; city?: string;
    role?: string; is_me?: boolean; department?: string; seniority?: string; whatsapp?: string; language?: string; is_decision_maker?: boolean;
  }[];
  company?: { name?: string; website?: string; country?: string; industry?: string; city?: string; phone?: string; email?: string; linkedin?: string; address?: string; employees?: number } | null;
  /** the deal's details, filled only where you have not written anything yet */
  details?: {
    deal_title?: string | null; deal_type?: string | null; industry?: string | null; city?: string | null;
    pain?: string | null; desired_outcome?: string | null; impact?: string | null; current_solution?: string | null; compelling_event?: string | null;
    decision_criteria?: string | null; decision_process?: string | null; competitors?: string[] | null; risks?: string | null;
    scope?: string | null; payment_terms?: string | null; expected_close?: string | null; start_date?: string | null;
  } | null;
  channel?: string | null;
  direction?: Direction | null;
  occurred_at?: string | null;
  messages?: { from: "me" | "them"; at?: string | null; text: string }[];
  chat_with?: string | null;
  summary: string;
  deal_summary?: string | null;
  commitments?: { owner: "me" | "them"; text: string; due?: string | null }[];
  requirements?: string | null;
  budget?: string | null;
  timeline?: string | null;
  objections?: string[];
  services?: string[];
  stage_signal?: "none" | "replied" | "meeting_booked" | "proposal_requested" | "price_objection" | "accepted" | "not_now" | "lost" | "payment_received" | null;
  stage_detail?: string | null;
  revisit_on?: string | null;
  meeting_at?: string | null;
  value?: { amount?: number; currency?: string } | null;
  next_step?: string | null;
  /** when the next step should happen */
  next_step_due?: string | null;
  /** open promises (by id, from the deal's state) that this input shows are done */
  done_commitment_ids?: number[] | null;
  /** two to four things the owner can do next, each one click in the app */
  quick_actions?: QuickAction[] | null;
  /** a reply the owner could send now, when one is due */
  reply_draft?: string | null;
  referrer?: { name?: string } | null;
  intermediary?: { name?: string; type?: string } | null;
}

const EXTRACT_SYSTEM = (cfg: SalesConfig, now: Date, tz: string) => `You are the sales memory of ${cfg.owner.name} (${cfg.owner.company}, an AI agency in India).
The owner appears as: ${cfg.owner.aliases.join(", ")}; owner emails ${cfg.owner.emails.join(", ")}. Never list the owner in "people" unless is_me true.
NOW: ${now.toISOString()} (owner timezone ${tz}). Resolve relative dates ("Friday", "next week", "after Diwali") to YYYY-MM-DD.
Read the input (a chat, transcript, screenshot, email, note or web page) and return JSON:
{
 "kind": "conversation|note|meeting_notes|lead_post|profile|email|other",
 "is_sales_related": true if this is about a client, prospect, lead, partner, referral, project, quote or payment,
 "people": [{"name","company","title","email","phone","linkedin","instagram","country","city","role":"decision_maker|champion|influencer|user|finance|gatekeeper|contact","is_me":false,
   "department","seniority":"owner|c_level|vp|head|manager|individual" or null,"whatsapp","language","is_decision_maker":true|false|null}],
   (read email signatures, letterheads and profile headers for title, phone, website, city)
 "company": {"name","website","country","industry","city","phone","email","linkedin","address","employees": number or null} or null,
 "channel": "whatsapp|linkedin|email|call|meeting|in_person|instagram|sms|twitter|other",
 "direction": "in" (they wrote / spoke) | "out" (owner wrote) | "both",
 "occurred_at": "YYYY-MM-DD HH:MM" local time it happened, if known, else null,
 "messages": for chats or screenshots of chats, each message [{"from":"me|them","at":"YYYY-MM-DD HH:MM" in the owner's local time, or null,"text"}] (max 60, oldest first),
   else []. Times: use the time shown on each message and the date separator above it ("Today", "Yesterday", "Monday", "12 Nov");
   resolve those relative to the status bar date if the screenshot shows one, else relative to NOW. A message with no date shown takes the
   date of the separator above it; when no date can be known at all, null. Never guess a time or a date. A date shown without a
   year ("4 Nov", "Monday") is in the year of NOW (or the year before, if that would be in the future); never take a year from anywhere else,
 "chat_with": the name or number shown at the top of the chat (who the conversation is with), else null,
 "summary": 1 to 3 plain lines on what happened,
 "deal_summary": the updated "where we are" for the whole deal in 2 to 4 lines, merging PREVIOUS STATE with this input,
 "commitments": promises with owner "me" (owner promised) or "them", e.g. {"owner":"them","text":"share sample data","due":"YYYY-MM-DD"}
   ("tomorrow" or "by Friday" counts from the day that message was sent, not from today),
 "requirements", "budget", "timeline": short text or null,
 "objections": [], "services": which of the owner's offers fit (short names),
 "stage_signal": "none|replied|meeting_booked|proposal_requested|price_objection|accepted|not_now|lost|payment_received",
 "stage_detail": one line (reason if lost, why not now),
 "revisit_on": YYYY-MM-DD when they said to come back later, else null,
 "meeting_at": ISO start time of a meeting agreed in the future, else null,
 "value": {"amount": number, "currency": "INR|USD|AED|GBP|EUR|CAD|AUD|SGD"} if a price or budget number is stated, else null (amount as a plain number: 2 lakh is 200000; leave currency out unless it is named or shown, e.g. ₹, Rs, $, and ${cfg.default_currency} is assumed),
 "next_step": the single best next action for the owner NOW, after this input, imperative, under 15 words,
 "next_step_due": YYYY-MM-DD when that next step should be done (what they or the owner said; else a realistic day: a reply today, a demo or proposal in 1 to 3 working days), else null,
 "done_commitment_ids": ids from OPEN PROMISES in PREVIOUS STATE that this input shows are done (they sent what they promised, or the owner did what was promised), else [],
 "quick_actions": 2 to 4 concrete things the owner should do next, most urgent first, each
   {"kind":"reply|follow_up|promise|meeting|call|send|stage","label":"imperative, under 10 words","detail":"what exactly, one line, or null",
    "due":"YYYY-MM-DD or null","stage":"for kind stage only: contacted|engaged|discovery|proposal|negotiation|won|lost|nurture, else null"}
   (reply: answer their last message; follow_up: chase if they went quiet; promise: something the owner said they would do; send: share a
   document, proposal or sample; meeting/call: book or prepare it; stage: only when the conversation clearly moved the deal),
 "reply_draft": if they are waiting on the owner, a short reply the owner could send now, in the language and tone of the chat,
   plain text without greetings longer than one word, else null,
 "referrer": {"name"} if someone referred this lead, else null,
 "intermediary": {"name","type":"agency|broker|consultant|partner"} if the deal runs through a middle person, else null,
 "details": {
   "deal_title": short deal name like "Shah Dental: WhatsApp booking bot" or null,
   "deal_type": "new|upsell|renewal|repeat|partnership|other" or null,
   "industry", "city": of the client, or null,
   "pain": the problem in their words, "desired_outcome": what they want to achieve, "impact": what the problem costs them,
   "current_solution": what they use or do today, "compelling_event": why now / deadline,
   "decision_criteria": how they will choose, "decision_process": who decides and the steps,
   "competitors": [other vendors or options they mention], "risks": what could kill or delay it,
   "scope": what is to be delivered, "payment_terms": e.g. "50% advance, 50% on delivery",
   "expected_close": YYYY-MM-DD when they plan to decide, "start_date": YYYY-MM-DD when work should start
   (each null unless stated or clearly implied in the input)
 }
}
RULES THAT MATTER MOST:
1. WHO SAID WHAT. In SCREENSHOT TEXT, ME/THEM comes from an image reader and can be wrong (LinkedIn shows names, not sides).
   The name in brackets decides: the owner's names (${[cfg.owner.name, ...cfg.owner.aliases].join(", ")}) are "me", any other name is "them".
   A message that matches one in PREVIOUS STATE's conversation keeps the side it had there (FROM ME = "me", FROM THEM = "them").
   The person sharing details of their own business (their clinic, company, website, phone, team) is "them". Resolve UNSURE lines by these clues.
2. THE NEXT STEP MOVES ON. PREVIOUS STATE has the CURRENT NEXT STEP and OPEN PROMISES. If this input shows a step happened
   (they sent the details that were asked for, a call took place, a document was shared), it is done: put its promise ids in
   done_commitment_ids and make next_step the NEW thing that follows (for example "Prepare the demo with their clinic details and share it"),
   with next_step_due. Never repeat a step that this input shows is already done.
3. THE BUSINESS. The business the contact owns or works at (a clinic, hospital, shop, firm, school), named anywhere in the
   input, goes in "company" with its exact name, and any website or link of theirs they share goes in company.website.
4. DETAILS. Fill requirements, budget, timeline, pain, scope, decision process and the rest from what they actually said, and UPDATE them
   when the conversation changes them ("budget is now 3 lakh", "we need it by March"). Never repeat what PREVIOUS STATE already says.
5. CHANNELS AND FACTS. PREVIOUS STATE says how you can reach them and what you do not know. next_step and quick_actions only use channels
   you can reach them on; a missing fact that matters becomes a step to find it out, never an assumption.
6. TIME. Messages carry the time they were sent. If everything in this input is older than PREVIOUS STATE's conversation, it is history:
   log it, but do not set a next step or a stage signal from it.
Use only facts in the input. Unknown fields are null. Never invent emails, phone numbers, websites or names.`;

/**
 * Files an input in two steps when it has screenshots: an image model writes out what is on them (readScreens), then
 * the text models, which are stronger at the long filing instructions, do the filing from that text. Pass
 * screenText when the screenshots were already read (a retry), so they are not read again.
 */
export async function extract(
  cfg: SalesConfig, tz: string, text: string, images: string[], previous: string | null, hintLine: string,
  o: { screenText?: string | null; totalMs?: number } = {},
): Promise<Extraction & { screen_text?: string | null }> {
  const started = Date.now(); // reading and filing together fit in one 60-second request
  const shots = images.slice(0, 4);
  const screen = o.screenText ?? (shots.length ? screensAsText(await readScreens(shots, 28_000, cfg.owner)) : null);
  const typed = text && text !== "(see image)" ? text.slice(0, 14_000) : "";
  const body = [
    typed,
    screen ? `SCREENSHOT TEXT (written out from ${shots.length || "the"} screenshot${shots.length === 1 ? "" : "s"} by an image reader; ME = the owner, THEM = the other side, with the name shown in brackets; UNSURE = the reader could not tell):\n${screen.slice(0, 14_000)}` : "",
  ].filter(Boolean).join("\n\n") || "(empty)";
  const intro = `${hintLine}${previous ? `\nPREVIOUS STATE OF THIS DEAL:\n${previous}\n` : ""}\nINPUT:\n${body}`;
  const ext = await llmJson<Extraction>(EXTRACT_SYSTEM(cfg, new Date(), tz), intro, { maxTokens: 2600, totalMs: o.totalMs ?? Math.max(15_000, 54_000 - (Date.now() - started)) });
  return { ...ext, screen_text: screen };
}

// ------------------------------------------------------------------ processing

export interface CaptureResult {
  deal_id?: number | null;
  person_id?: number | null;
  created_person?: number | null;
  created_deal?: number | null;
  interactions?: number[];
  commitments?: number[];
  moved?: string | null;
  summary?: string;
  candidates?: PersonRow[];
  suggestion?: { kind: "stage"; role: string; reason?: string | null; date?: string | null; label: string } | null;
  capture_id?: number;
  next_step?: string | null;
  channel?: string | null;
  message_count?: number;
  skipped?: string;
  seen?: string[];
  /** fields this capture filled in (deal, person, company), by their labels */
  filled?: string[];
  /** screenshots kept on the deal */
  shots?: number;
  /** messages in it that were already on the deal (sent before), not logged again */
  already?: number;
  deal_title?: string | null;
  meeting_at?: string | null;
  commitment_texts?: string[];
  /** what to do next, each one click (also kept on the deal) */
  quick_actions?: QuickAction[];
  reply_draft?: string | null;
  /** the messages read from it, for the summary card */
  messages?: { from: "me" | "them"; at?: string | null; text: string }[];
  /** filing failed: the capture is kept so it can be tried again */
  failed?: string;
  /** it failed only because today's AI allowance is used up: it is filed by itself when the AI is back */
  waiting?: boolean;
  /** the deal it can be saved to as a plain note right now, without AI */
  note_deal_id?: number | null;
  /** something to check (the chat looks like it is with someone else) */
  warning?: string | null;
  /** how it was handled, when that matters (an older screenshot did not change the next step) */
  note?: string | null;
}

const QA_KINDS = new Set(["reply", "follow_up", "promise", "meeting", "call", "send", "stage"]);
const STAGE_ROLES = new Set(["contacted", "engaged", "discovery", "proposal", "negotiation", "won", "lost", "nurture"]);
/** The AI's quick actions, checked: known kinds, short labels, real dates, at most four. */
export function cleanQuickActions(list: unknown): QuickAction[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((a): a is QuickAction => !!a && typeof a === "object" && QA_KINDS.has((a as QuickAction).kind) && typeof (a as QuickAction).label === "string" && !!(a as QuickAction).label.trim())
    .filter((a) => a.kind !== "stage" || STAGE_ROLES.has(String(a.stage)))
    .map((a) => ({
      kind: a.kind, label: a.label.trim().slice(0, 80), detail: a.detail ? String(a.detail).slice(0, 300) : null,
      due: a.due && /^\d{4}-\d{2}-\d{2}$/.test(String(a.due)) ? String(a.due) : null, stage: a.kind === "stage" ? String(a.stage) : null,
    }))
    .slice(0, 4);
}

interface CaptureRow {
  id: number;
  source: string;
  channel: string | null;
  text: string | null;
  images: string[];
  image_paths?: string[];
  hints: CaptureInput["hints"] & Record<string, unknown>;
  screen_text?: string | null;
  status: string;
  result: CaptureResult | null;
  tg_chat: number | null;
}

const CHANNEL_SET = new Set(["email", "whatsapp", "linkedin", "instagram", "call", "meeting", "in_person", "telegram", "sms", "twitter", "document", "other", "note"]);
const asChannel = (c: string | null | undefined, fallback: Channel): Channel => (c && CHANNEL_SET.has(c) ? (c as Channel) : fallback);

/**
 * A time from a screenshot or a chat, as an instant. Local "YYYY-MM-DD HH:MM" is read in your timezone; a time with a
 * zone is taken as is. A time in the future (a misread year, a typo) is pulled back a year if that fits, else dropped:
 * a message cannot have been sent after you logged it. Pure.
 */
export function messageAt(at: string | null | undefined, tz: string, now: Date, allowFuture = false): string | null {
  const v = (at ?? "").trim();
  if (!v) return null;
  let d: Date | null = null;
  const local = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(v);
  if (local) d = zonedInstant(`${local[1]}-${local[2]}-${local[3]}`, local[4] ? +local[4] : 12, local[5] ? +local[5] : 0, tz);
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(v)) d = new Date(v);
  if (!d || Number.isNaN(d.getTime())) return null;
  if (!allowFuture && d.getTime() > now.getTime() + 15 * 60_000) {
    // a day or two ahead is a misread day, not a year: no time is better than a wrong one
    if (d.getTime() - now.getTime() < 2 * 86_400_000) return null;
    const back = new Date(d);
    back.setUTCFullYear(back.getUTCFullYear() - 1);
    return back.getTime() <= now.getTime() + 15 * 60_000 ? back.toISOString() : null;
  }
  return d.toISOString();
}

/**
 * The year of a date is kept only when the source shows it ("2024", "04/11/24", "'24"). Chat screenshots say "4 Nov"
 * with no year, and models fill in a year from their training (often a past one): a lead talked to this week then
 * shows "743 days ago". A year the source does not show becomes the latest one that is not in the future. Pure.
 */
export function trustYear(at: string | null | undefined, source: string, now: Date): string | null {
  const v = (at ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(v);
  if (!m) return at ?? null;
  const year = Number(m[1]);
  const cur = now.getUTCFullYear();
  if (year === cur) return v;
  const yy = String(year).slice(2);
  const shown = new RegExp(`\\b${year}\\b|'${yy}\\b|\\b\\d{1,2}[/.-]\\d{1,2}[/.-]${yy}\\b`).test(source);
  if (shown) return v;
  const mmdd = `${m[2]}-${m[3]}`;
  const t = Date.parse(`${cur}-${mmdd}T00:00:00Z`);
  // later than two days from now would be a future date: then it was last year
  const y = Number.isFinite(t) && t > now.getTime() + 2 * 86_400_000 ? cur - 1 : cur;
  return `${y}-${mmdd}${m[4]}`;
}

/** What the screenshot reader saw at the top: the app and who the chat is with. Pure. */
export function screenHeader(screen: string | null | undefined): { app: string | null; chatWith: string | null } {
  const t = screen ?? "";
  const m = /CHAT WITH:\s*([^,\n]+?)\s*(?:,\s*APP:\s*([^\n]+))?$/im.exec(t);
  const appRaw = (m?.[2] ?? /APP:\s*([^\n,]+)/i.exec(t)?.[1] ?? "").toLowerCase();
  const app = /whats/.test(appRaw) ? "whatsapp" : /linked/.test(appRaw) ? "linkedin" : /insta/.test(appRaw) ? "instagram" : /telegram/.test(appRaw) ? "telegram"
    : /gmail|outlook|mail/.test(appRaw) ? "email" : /sms|messages|imessage/.test(appRaw) ? "sms" : null;
  const who = m?.[1]?.trim() || null;
  return { app, chatWith: who && !/^(unknown|unreadable|\[unreadable\])$/i.test(who) ? who : null };
}

/** True when two names cannot be the same person (no shared name word, neither is a number). Pure. */
export function differentPerson(a: string | null | undefined, b: string | null | undefined): boolean {
  const words = (x: string) => x.toLowerCase().replace(/^(dr|mr|mrs|ms|miss)\.?\s+/, "").split(/[^a-z]+/).filter((w) => w.length >= 3);
  if (!a || !b || /\d{5,}/.test(a) || /\d{5,}/.test(b)) return false;
  const wa = words(a);
  const wb = words(b);
  return wa.length > 0 && wb.length > 0 && !wa.some((w) => wb.includes(w));
}

function dueIso(d: string | null | undefined): string | null {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  return `${d.slice(0, 10)}T12:30:00.000Z`; // 18:00 IST on that day
}

export async function processCapture(id: number, force: { person_id?: number; deal_id?: number; newPersonName?: string } = {}): Promise<CaptureResult> {
  const cap = await one<CaptureRow>("select * from sales_captures where id = $1", [id]);
  if (!cap) throw new Error(`capture ${id} missing`);
  const cfg = await salesConfig();
  const tz = (await getSettings()).timezone;
  const hints = cap.hints ?? {};

  let text = cap.text ?? "";
  let chat: ChatLine[] | null = null;
  let chatName: string | null = null;
  if (text) chat = parseWhatsAppExport(text, tz);
  if (chat) {
    chatName = (hints.file_name ? String(hints.file_name).replace(/^WhatsApp Chat( - | with )/i, "").replace(/\.(txt|zip)$/i, "") : null) || null;
    const fresh = [];
    for (const l of chat) {
      const h = hash(`${chatName}|${l.at.toISOString()}|${l.sender}|${l.text}`);
      const seen = await one("select 1 from sales_seen where hash = $1", [h]);
      if (!seen) fresh.push({ ...l, h });
    }
    if (!fresh.length) {
      const r: CaptureResult = { skipped: "Nothing new in this chat since the last export." };
      await q("update sales_captures set status = 'done', result = $2, processed_at = now() where id = $1", [id, JSON.stringify(r)]);
      return r;
    }
    chat = fresh;
    text = `WhatsApp chat${chatName ? ` with ${chatName}` : ""} (owner lines are from ${cfg.owner.aliases.join("/")}):\n` +
      fresh.slice(-250).map((l) => `[${l.at.toISOString().slice(0, 16)}] ${isMe(cfg, l.sender) ? "ME" : l.sender}: ${l.text}`).join("\n");
  }

  // the deal this belongs to, when known up front
  let dealId: number | null = force.deal_id ?? (hints.deal_id ? Number(hints.deal_id) : null);
  let personId: number | null = force.person_id ?? (hints.person_id ? Number(hints.person_id) : null);
  if (hints.meeting_id && !dealId) {
    const m = await one<{ deal_id: number | null; person_id: number | null }>("select deal_id, person_id from sales_meetings where id = $1", [hints.meeting_id]);
    dealId = m?.deal_id ?? null;
    personId = personId ?? m?.person_id ?? null;
  }
  if (dealId && !personId) personId = (await one<{ person_id: number | null }>("select person_id from sales_deals where id = $1", [dealId]))?.person_id ?? null;
  // the deal as it stands (next step, open promises, the conversation so far), so this log can move it on correctly
  const prev = dealId ? await dealStateForFiling(dealId) : null;

  const hintLine = [
    cap.source ? `SOURCE: ${cap.source}` : "",
    cap.channel ? `CHANNEL HINT: ${cap.channel}` : "",
    hints.url ? `PAGE: ${hints.page_title ?? ""} ${hints.url}` : "",
    chatName ? `CHAT NAME: ${chatName}` : "",
    hints.direction ? `DIRECTION HINT: ${hints.direction}` : "",
  ].filter(Boolean).join("\n");

  let ext: Extraction;
  const started = Date.now(); // the whole thing has to fit in one 60-second request
  try {
    // the screenshots are read once; the text is kept so a retry only redoes the filing
    const images = await shotDataUrls(cap);
    let screen = cap.screen_text ?? null;
    if (images.length && !screen) {
      screen = screensAsText(await readScreens(images.slice(0, 4), 28_000, cfg.owner));
      await q("update sales_captures set screen_text = $2 where id = $1", [id, screen]);
    }
    ext = await extract(cfg, tz, text, images, prev, hintLine, { screenText: screen, totalMs: Math.max(15_000, 54_000 - (Date.now() - started)) });
  } catch (e) {
    if (isAiUnavailable(e)) {
      // nothing is lost: the entry waits and is filed by itself when the allowance is back (or saved now as a note)
      const back = e.until ? ` at ${e.until.toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz })}` : "";
      const msg = `Today's free AI allowance is used up, so this is not filed yet. It is kept and will be filed by itself when the AI is back${back}.` +
        (dealId ? " To have it on the timeline now, save it as a note." : "");
      await q("update sales_captures set status = 'failed', wait_ai = true, error = $2, processed_at = now() where id = $1", [id, msg]);
      throw new AiUnavailable(e.until, msg);
    }
    const msg = e instanceof UserError ? e.message : `The AI could not file this: ${(e as Error).message.slice(0, 160)}. Try again.`;
    await q("update sales_captures set status = 'failed', wait_ai = false, error = $2, processed_at = now() where id = $1", [id, msg]);
    throw new UserError(msg);
  }
  const result = await applyExtraction(cap, ext, { cfg, dealId, personId, chat, chatName, newPersonName: force.newPersonName });
  if (chat && result.deal_id) result.seen = (chat as (ChatLine & { h?: string })[]).map((l) => l.h).filter((x): x is string => !!x);
  await q("update sales_captures set status = $2, result = $3, processed_at = now(), error = null, wait_ai = false where id = $1", [
    id, result.candidates?.length || (!result.deal_id && !result.skipped) ? "needs_person" : result.skipped ? "ignored" : "done", JSON.stringify(result),
  ]);
  if (chat && result.deal_id) {
    for (const l of chat as (ChatLine & { h?: string })[]) if (l.h) await q("insert into sales_seen (hash) values ($1) on conflict do nothing", [l.h]);
  }
  // the screenshots stay with the deal they were filed to
  const shots = (cap.images?.length ?? 0) || (cap.image_paths?.length ?? 0);
  if (result.deal_id && shots) {
    await keepShots(id, result.deal_id);
    result.shots = shots;
  }
  return result;
}

interface ApplyCtx {
  cfg: SalesConfig;
  dealId: number | null;
  personId: number | null;
  chat: ChatLine[] | null;
  chatName: string | null;
  newPersonName?: string;
}

export async function applyExtraction(cap: CaptureRow, extIn: Extraction, a: ApplyCtx): Promise<CaptureResult> {
  // times as real instants (your timezone, never in the future); the platform from what the screen showed
  const tz = (await getSettings()).timezone;
  const now = new Date();
  const header = screenHeader((extIn as Extraction & { screen_text?: string | null }).screen_text ?? cap.screen_text ?? null);
  // what was actually read: a year must appear here to be believed
  const source = `${(extIn as Extraction & { screen_text?: string | null }).screen_text ?? cap.screen_text ?? ""}\n${cap.text ?? ""}`;
  let ext: Extraction = {
    ...extIn,
    // the channel you picked wins; then the app the screen shows; then what the AI read
    channel: cap.channel || (header.app && header.app !== "telegram" ? header.app : extIn.channel),
    occurred_at: messageAt(trustYear(extIn.occurred_at, source, now), tz, now),
    meeting_at: messageAt(trustYear(extIn.meeting_at, source, now), tz, now, true),
    messages: (extIn.messages ?? []).map((m) => ({ ...m, at: messageAt(trustYear(m?.at, source, now), tz, now) })),
  };
  const { cfg } = a;
  const res: CaptureResult = {
    summary: ext.summary, next_step: ext.next_step ?? null, interactions: [], commitments: [],
    messages: (ext.messages ?? []).filter((m) => m?.text).slice(-40).map((m) => ({ from: m.from === "me" ? "me" : "them", at: m.at ?? null, text: String(m.text).slice(0, 500) })),
  };
  let dealId = a.dealId;
  let personId = a.personId;
  const others = (ext.people ?? []).filter((p) => !p.is_me && (p.name || p.email || p.phone || p.linkedin) && !(p.name && isMe(cfg, p.name)));
  const primary = a.newPersonName ? { ...(others[0] ?? {}), name: a.newPersonName } : others[0];

  if (!dealId && !personId) {
    if (ext.is_sales_related === false && cap.source !== "telegram" && cap.source !== "bookmarklet" && cap.source !== "shortcut" && cap.source !== "web") {
      return { ...res, skipped: "Not a sales conversation." };
    }
    if (!primary && !a.chatName) return { ...res, deal_id: null };
    const hint = primary ?? { name: a.chatName ?? undefined };
    const r = a.newPersonName ? { person: null, how: "none" as const, candidates: [] } : await resolvePerson({ ...hint, company: hint.company ?? ext.company?.name });
    if (r.how === "ambiguous") return { ...res, candidates: r.candidates };
    if (r.person) {
      personId = r.person.id;
      await addIdentities(personId, hint);
    } else {
      const companyId = await ensureCompany(hint.company ?? ext.company?.name ?? null, { website: ext.company?.website, country: ext.company?.country ?? hint.country, industry: ext.company?.industry });
      personId = await upsertPerson({ ...hint, company_id: companyId, relationship: ext.referrer?.name ? "referral" : "cold" });
      res.created_person = personId;
    }
    dealId = await dealForPerson(personId);
    if (!dealId) {
      const firstDir = ext.messages?.[0]?.from ?? (ext.direction === "out" ? "me" : "them");
      const companyId = (await one<{ company_id: number | null }>("select company_id from sales_people where id = $1", [personId]))?.company_id ?? null;
      dealId = await createDeal({
        person_id: personId,
        company_id: companyId,
        source: ext.referrer?.name ? "referral" : ext.kind === "lead_post" ? "radar" : firstDir === "them" ? "inbound" : "outbound",
        source_detail: cap.hints?.url ? String(cap.hints.url).slice(0, 300) : cap.source,
        services: ext.services ?? [],
        country: ext.company?.country ?? primary?.country ?? null,
        requirements: ext.requirements ?? null,
      });
      res.created_deal = dealId;
      await enqueue("enrich_person", { id: personId }, { dedupeKey: `enrich_person:${personId}` });
      if (companyId) await enqueue("enrich_company", { id: companyId }, { dedupeKey: `enrich_company:${companyId}` });
    }
  } else if (!dealId && personId) {
    dealId = (await dealForPerson(personId)) ?? (await createDeal({ person_id: personId, source: "network" }));
  } else if (dealId && !personId) {
    personId = (await one<{ person_id: number | null }>("select person_id from sales_deals where id = $1", [dealId]))?.person_id ?? null;
  }
  res.deal_id = dealId;
  res.person_id = personId;
  if (personId && primary) await addIdentities(personId, primary).catch(() => {});

  // everyone else in the conversation joins the deal with their part in it
  for (const p of others.slice(1, 6)) {
    if (!p.name) continue;
    const pid = await upsertPerson({ ...p, company: p.company ?? ext.company?.name }).catch(() => null);
    if (pid && dealId) {
      const role = ["decision_maker", "champion", "influencer", "user", "finance", "gatekeeper"].includes(p.role ?? "") ? p.role : "contact";
      await q("insert into sales_deal_people (deal_id, person_id, role) values ($1,$2,$3) on conflict (deal_id, person_id) do update set role = excluded.role", [dealId, pid, role]);
    }
  }
  const deal = dealId ? await getDeal(dealId) : null;
  if (deal && ext.referrer?.name && !deal.referrer_id) {
    const rid = await upsertPerson({ name: ext.referrer.name, relationship: "referral" });
    await updateDeal(deal.id, { referrer_id: rid, source: deal.source === "outbound" ? "referral" : deal.source }, { cause: "ai" });
  }
  if (deal && ext.intermediary?.name && !deal.intermediary_id) {
    const iid = await upsertPerson({ name: ext.intermediary.name, relationship: "partner" });
    const type = ["agency", "broker", "consultant", "partner", "referrer"].includes(ext.intermediary.type ?? "") ? ext.intermediary.type : "partner";
    await updateDeal(deal.id, { intermediary_id: iid, intermediary_type: type }, { cause: "ai" });
  }

  // the same screenshot (or an overlapping one) sent twice: messages already on this deal are not logged again
  const msgKey = (m: { from: string; text: string }) => hash(`msg|${dealId}|${m.from}|${m.text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 500)}`);
  let freshMsgs = ext.messages ?? [];
  let allSeen = false;
  if (!a.chat && dealId && freshMsgs.length) {
    const keys = freshMsgs.map(msgKey);
    const seen = new Set((await q<{ hash: string }>("select hash from sales_seen where hash = any($1)", [keys])).map((r) => r.hash));
    // also a message already on the deal's timeline some other way (typed, sent from the app, an earlier paste)
    const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const logged = (await q<{ body: string | null }>("select body from sales_interactions where deal_id = $1 and body is not null order by occurred_at desc limit 200", [dealId]))
      .map((r) => norm(r.body ?? "")).filter(Boolean);
    freshMsgs.forEach((m, i) => {
      const t = norm(m.text);
      if (t.length >= 12 && logged.some((b) => b.includes(t))) seen.add(keys[i]);
    });
    freshMsgs = freshMsgs.filter((_, i) => !seen.has(keys[i]));
    res.already = keys.length - freshMsgs.length;
    allSeen = freshMsgs.length === 0;
    const newKeys = keys.filter((k) => !seen.has(k));
    if (newKeys.length) {
      await q("insert into sales_seen (hash) select unnest($1::text[]) on conflict do nothing", [newKeys]);
      res.seen = [...(res.seen ?? []), ...newKeys];
    }
  }

  // an older screenshot or chat (everything in it is older than what is already logged) fills the timeline and the
  // details, but does not move the next step or the stage backwards
  const prevLatest = dealId ? (await one<{ m: string | null }>("select max(occurred_at) as m from sales_interactions where deal_id = $1 and direction <> 'internal'", [dealId]))?.m ?? null : null;
  const newestIn = [...(ext.messages ?? []).map((m) => m.at), ext.occurred_at].filter((x): x is string => !!x).sort().at(-1) ?? null;
  const stale = !!(prevLatest && newestIn && Date.parse(newestIn) < Date.parse(prevLatest) - 3_600_000);
  if (stale) res.note = "This is older than what is already logged: the timeline and details were updated, the next step and stage were left as they are.";

  // the number shown at the top of a WhatsApp chat is theirs; a chat with someone else is flagged before you trust it
  const top = header.chatWith ?? ext.chat_with ?? null;
  if (personId && top) {
    const pr = await one<{ full_name: string; phones: string[] }>("select full_name, phones from sales_people where id = $1", [personId]);
    const num = top.replace(/[^\d+]/g, "");
    if (num.replace(/\D/g, "").length >= 8 && pr && !pr.phones.some((x) => x.replace(/\D/g, "").endsWith(num.replace(/\D/g, "").slice(-10)))) {
      await q("update sales_people set phones = array_append(phones, $2), whatsapp = coalesce(whatsapp, $2), updated_at = now() where id = $1", [personId, top.trim()]);
      res.filled = [...(res.filled ?? []), "Person: Phone (from the chat)"];
    }
    if (pr && differentPerson(top, pr.full_name)) res.warning = `This chat looks like it is with "${top}", but this lead's contact is ${pr.full_name}. If it was the wrong lead, press Undo on this log.`;
  }

  // timeline: chats are grouped per day so the timeline stays readable; everything else is one entry
  const channel = asChannel(a.chat ? "whatsapp" : ext.channel ?? cap.channel, cap.source === "email" ? "email" : "note");
  const ids: number[] = [];
  if (a.chat?.length) {
    const byDay = new Map<string, ChatLine[]>();
    for (const l of a.chat) {
      const k = l.at.toISOString().slice(0, 10);
      byDay.set(k, [...(byDay.get(k) ?? []), l]);
    }
    for (const [day, lines] of byDay) {
      const mine = lines.filter((l) => isMe(cfg, l.sender));
      const theirs = lines.filter((l) => !isMe(cfg, l.sender));
      for (const [group, dir] of [[theirs, "in"], [mine, "out"]] as const) {
        if (!group.length) continue;
        const r = await logInteraction({
          deal_id: dealId, person_id: personId, channel, direction: dir as Direction,
          occurred_at: group[group.length - 1].at,
          body: group.map((l) => `${isMe(cfg, l.sender) ? "Me" : l.sender} (${l.at.toISOString().slice(11, 16)}): ${l.text}`).join("\n").slice(0, 12_000),
          summary: byDay.size === 1 ? ext.summary : `${group.length} message${group.length > 1 ? "s" : ""} ${dir === "in" ? "from them" : "from me"}`,
          source: cap.source === "telegram" ? "whatsapp_export" : cap.source, capture_id: cap.id, external_id: `cap:${cap.id}:${day}:${dir}`,
        });
        if (r) {
          ids.push(r.id);
          if (r.moved) res.moved = r.moved.name;
        }
      }
    }
    res.message_count = a.chat.length;
  } else if (allSeen) {
    // nothing new to log; the details below are still filled in
  } else if (freshMsgs.length > 1) {
    // the conversation as it went: each run of messages from one side on one day is one entry, at its own time,
    // so the timeline and the journey keep the real back and forth (a message with no time shown takes the one before it)
    let lastAt: string | null = null;
    const timed = freshMsgs.map((m) => { if (m.at) lastAt = m.at; return { ...m, at: m.at ?? lastAt }; });
    const fallback = ext.occurred_at ?? null;
    const runs: { dir: Direction; msgs: typeof timed }[] = [];
    for (const m of timed) {
      const dir: Direction = m.from === "me" ? "out" : "in";
      const prev = runs[runs.length - 1];
      const sameDay = prev && (prev.msgs[prev.msgs.length - 1].at ?? "").slice(0, 10) === (m.at ?? "").slice(0, 10);
      if (prev && prev.dir === dir && sameDay) prev.msgs.push(m);
      else runs.push({ dir, msgs: [m] });
    }
    for (const [i, run] of runs.entries()) {
      const last = run.msgs[run.msgs.length - 1];
      const r = await logInteraction({
        deal_id: dealId, person_id: personId, channel, direction: run.dir,
        occurred_at: last.at ?? fallback,
        body: run.msgs.map((m) => `${m.from === "me" ? "Me" : "Them"}${m.at ? ` (${new Date(m.at).toLocaleString("en-IN", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})` : ""}: ${m.text}`).join("\n").slice(0, 12_000),
        summary: runs.length === 1 ? ext.summary : `${run.msgs.length} message${run.msgs.length > 1 ? "s" : ""} ${run.dir === "in" ? "from them" : "from me"}`,
        source: cap.source, capture_id: cap.id, external_id: `cap:${cap.id}:${i}:${run.dir}`, extracted: run.dir === "in" && i === runs.length - 1 ? ext : undefined,
      });
      if (r) {
        ids.push(r.id);
        if (r.moved) res.moved = r.moved.name;
      }
    }
    res.message_count = freshMsgs.length;
  } else {
    const one1 = freshMsgs.length === 1 ? freshMsgs[0] : null;
    const dir: Direction = cap.hints?.direction ?? (one1 ? (one1.from === "me" ? "out" : "in") : null) ?? ext.direction ?? (ext.kind === "note" || ext.kind === "meeting_notes" ? "both" : "in");
    const r = await logInteraction({
      deal_id: dealId, person_id: personId,
      channel: ext.kind === "meeting_notes" && channel === "note" ? "meeting" : channel,
      direction: ext.kind === "profile" || ext.kind === "lead_post" ? "internal" : dir,
      occurred_at: ext.occurred_at && !Number.isNaN(Date.parse(ext.occurred_at)) ? ext.occurred_at : null,
      body: (cap.text ?? "").slice(0, 12_000) || null, summary: ext.summary, source: cap.source, capture_id: cap.id,
      external_id: `cap:${cap.id}`, extracted: ext,
    });
    if (r) {
      ids.push(r.id);
      if (r.moved) res.moved = r.moved.name;
    }
  }
  res.interactions = ids;
  res.channel = channel;

  if (dealId) {
    // extra details are a bonus: if filling them fails, the log itself still goes through
    res.filled = [...(res.filled ?? []), ...(await fillPersonAndCompany(personId, primary, ext, channel).catch((e) => {
      console.warn("[capture] details not filled:", (e as Error).message);
      return [] as string[];
    }))];
    res.filled = [...(res.filled ?? []), ...(await linkDealCompany(dealId, personId, primary, ext).catch((e) => {
      console.warn("[capture] company not linked:", (e as Error).message);
      return [] as string[];
    }))];
    if (allSeen) ext = { ...ext, commitments: [], meeting_at: null, stage_signal: "none" };
    res.commitment_texts = (ext.commitments ?? []).filter((c) => c?.text).map((c) => `${c.owner === "me" ? "You" : "They"}: ${c.text}${c.due ? ` (by ${c.due})` : ""}`);
    for (const c of ext.commitments ?? []) {
      if (!c?.text || (c.owner !== "me" && c.owner !== "them")) continue;
      const cid = await addCommitment({ deal_id: dealId, person_id: personId, owner: c.owner, text: c.text, due_at: dueIso(c.due), interaction_id: ids[0] ?? null });
      if (cid) res.commitments!.push(cid);
    }
    const d = await getDeal(dealId);
    if (d) {
      const patch: Record<string, unknown> = {};
      if (ext.deal_summary) patch.summary = ext.deal_summary;
      else if (ext.summary && !d.summary) patch.summary = ext.summary;
      if (ext.requirements && ext.requirements !== d.requirements) patch.requirements = d.requirements ? `${d.requirements}\n${ext.requirements}`.slice(-2000) : ext.requirements;
      // a field you set or changed yourself is yours: the AI never overwrites it. A field the AI filled earlier is updated
      // when the conversation brings something new (a new budget, a new date).
      const yours = new Set((await q<{ field: string }>(
        `select field from (select distinct on (field) field, cause from sales_deal_events where deal_id = $1 and kind = 'field' and field is not null order by field, id desc) x
         where cause in ('manual','telegram','client')`, [dealId])).map((r) => r.field));
      const mayWrite = (k: string, cur: unknown) => !yours.has(k) || cur == null || cur === "" || (Array.isArray(cur) && !cur.length);
      if (ext.budget && mayWrite("budget", d.budget) && ext.budget !== d.budget) patch.budget = ext.budget;
      if (ext.timeline && mayWrite("timeline", d.timeline) && ext.timeline !== d.timeline) patch.timeline = ext.timeline;
      if (ext.objections?.length) patch.objections = Array.from(new Set([...(d.objections ?? []), ...ext.objections])).slice(-10);
      if (ext.services?.length && !d.services?.length) patch.services = ext.services.slice(0, 6);
      if (ext.value?.amount && !d.value_amount) {
        patch.value_amount = ext.value.amount;
        patch.currency = (ext.value.currency ?? cfg.default_currency).toUpperCase();
      }
      // steps and actions only on channels you can really use (this log's conversation counts)
      const reach = await dealReach(dealId);
      if (ext.next_step) ext = { ...ext, next_step: stale ? null : onlyReachable(ext.next_step, reach) };
      ext = { ...ext, quick_actions: (ext.quick_actions ?? []).map((a) => ({ ...a, label: onlyReachable(a?.label, reach) ?? a?.label, detail: onlyReachable(a?.detail, reach) })) as QuickAction[] };
      if (ext.next_step) {
        patch.next_action = ext.next_step;
        // a new step brings its own date; a stale date from the old step never stays behind
        const due = ext.next_step_due && /^\d{4}-\d{2}-\d{2}/.test(ext.next_step_due) && !Number.isNaN(Date.parse(ext.next_step_due.slice(0, 10))) ? ext.next_step_due.slice(0, 10) : null;
        if (due) patch.next_action_at = zonedInstant(due, 11, 0, (await getSettings()).timezone).toISOString();
        else if (ext.next_step.trim() !== (d.next_action ?? "").trim()) patch.next_action_at = null;
      }
      // promises this log shows are kept are closed, so their reminders stop
      const doneIds = (ext.done_commitment_ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
      if (doneIds.length) {
        const closed = await q<{ id: number }>("update sales_commitments set status = 'done', done_at = now() where deal_id = $1 and id = any($2::int[]) and status = 'open' returning id", [dealId, doneIds]);
        if (closed.length) res.filled = [...(res.filled ?? []), `${closed.length} promise${closed.length === 1 ? "" : "s"} marked done`];
      }
      const qa = cleanQuickActions(ext.quick_actions);
      if (qa.length || ext.reply_draft) {
        await q("update sales_deals set conversation = $2::jsonb || coalesce(jsonb_build_object('autopilot', conversation->'autopilot'), '{}'::jsonb) where id = $1", [dealId, JSON.stringify({
          quick_actions: qa, reply_draft: ext.reply_draft ? String(ext.reply_draft).slice(0, 1500) : null, at: new Date().toISOString(), capture_id: cap.id,
        })]);
        res.quick_actions = qa;
        res.reply_draft = ext.reply_draft ?? null;
      }
      if (ext.company?.country && !d.country) patch.country = ext.company.country;
      // the deal's details: only where nothing is written yet, so the AI never overwrites you
      const det = ext.details ?? {};
      const blank = (v: unknown) => v == null || v === "" || (Array.isArray(v) && !v.length);
      const dd = d as unknown as Record<string, unknown>;
      // empty fields are filled; fields the AI filled before are updated with what is new; yours are never touched
      const writable = (k: string) => blank(dd[k]) || !yours.has(k);
      for (const k of ["pain", "desired_outcome", "impact", "current_solution", "compelling_event", "decision_criteria", "decision_process", "risks", "scope", "payment_terms", "industry", "city"] as const) {
        const v = det[k];
        if (typeof v === "string" && v.trim() && writable(k) && v.trim() !== String(dd[k] ?? "").trim()) patch[k] = v.trim().slice(0, 2000);
      }
      if (det.competitors?.length && writable("competitors")) patch.competitors = Array.from(new Set([...((dd.competitors as string[] | null) ?? []), ...det.competitors])).slice(0, 10);
      for (const k of ["expected_close", "start_date"] as const) {
        const v = det[k];
        if (v && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v.slice(0, 10))) && writable(k) && String(dd[k] ?? "").slice(0, 10) !== v.slice(0, 10)) patch[k] = v.slice(0, 10);
      }
      if (det.deal_type && ["new", "upsell", "renewal", "repeat", "partnership", "other"].includes(det.deal_type) && blank(dd.deal_type)) patch.deal_type = det.deal_type;
      // a new lead gets a proper name instead of just the person's name
      if (res.created_deal && det.deal_title?.trim()) patch.title = det.deal_title.trim().slice(0, 200);
      res.filled = [...(res.filled ?? []), ...Object.keys(patch).filter((k) => !["summary", "next_action", "currency"].includes(k)).map((k) => FIELD_LABEL[k] ?? k.replace(/_/g, " "))];
      // a value the AI could not read as a number must not lose the rest of what it picked out
      await updateDeal(dealId, patch, { cause: "ai" }).catch(async (e) => {
        if (!("value_amount" in patch)) throw e;
        delete patch.value_amount;
        delete patch.currency;
        await updateDeal(dealId, patch, { cause: "ai" });
      });

      // stage signals: forward moves are automatic, closing moves are only suggested
      const sig = stale ? "none" : ext.stage_signal ?? "none";
      if (sig === "meeting_booked") {
        const mv = await applyEvent(dealId, "meeting", { interactionId: ids[0] });
        if (mv) res.moved = mv.name;
      } else if (sig === "price_objection" && d.stage_role === "proposal") {
        const neg = await stageByRole("negotiation");
        if (neg) {
          const mv = await moveDeal(dealId, neg.id, { cause: "ai", force: true, note: ext.stage_detail ?? "price objection", interactionId: ids[0] }).catch(() => null);
          if (mv) res.moved = mv.name;
        }
      } else if (sig === "not_now" && d.stage_category === "open") {
        // "not now, come back in March": parked in Nurture with the date they gave, so the revisit comes up on its own
        const nur = await stageByRole("nurture");
        const revisit = ext.revisit_on && /^\d{4}-\d{2}-\d{2}/.test(ext.revisit_on) ? ext.revisit_on.slice(0, 10) : null;
        const mv = nur ? await moveDeal(dealId, nur.id, { cause: "ai", force: true, reason: ext.stage_detail ?? "they said not now", date: revisit, note: "they said not now", interactionId: ids[0] }).catch(() => null) : null;
        if (mv) res.moved = `${mv.name}${revisit ? ` until ${revisit}` : ""}`;
        else res.suggestion = { kind: "stage", role: "nurture", reason: ext.stage_detail ?? null, date: ext.revisit_on ?? null, label: `Move to Nurture${ext.revisit_on ? ` until ${ext.revisit_on}` : ""}?` };
      } else if (sig === "lost") {
        res.suggestion = { kind: "stage", role: "lost", reason: ext.stage_detail ?? "they said no", label: `Mark as Lost (${(ext.stage_detail ?? "they said no").slice(0, 40)})?` };
      } else if (sig === "accepted" && !["won", "active", "delivered", "paid"].includes(d.stage_role ?? "")) {
        res.suggestion = { kind: "stage", role: "won", label: "Sounds like a yes. Mark as Won?" };
      } else if (sig === "payment_received") {
        res.suggestion = { kind: "stage", role: d.stage_role === "won" ? "active" : "paid", label: "Payment mentioned. Record it on the deal?" };
      }
      if (ext.meeting_at && !Number.isNaN(Date.parse(ext.meeting_at)) && Date.parse(ext.meeting_at) > Date.now()) {
        res.meeting_at = ext.meeting_at;
        await q(
          `insert into sales_meetings (external_id, deal_id, person_id, title, starts_at, ends_at) values ($1,$2,$3,$4,$5,$5::timestamptz + interval '45 minutes') on conflict (external_id) do nothing`,
          [`cap:${cap.id}`, dealId, personId, `Call with ${d.person_name ?? d.title}`, ext.meeting_at],
        );
      }
      if (ext.value?.amount && !d.value_usd) {
        await q("update sales_deals set value_usd = $2 where id = $1 and value_usd is null", [dealId, toUsd(cfg, ext.value.amount, ext.value.currency ?? cfg.default_currency)]);
      }
    }
    await enqueue("refresh_moves", { deal_id: dealId }, { dedupeKey: `refresh_moves:${dealId}` });
    // done for you: replies written, research started, the prep note for the next step (see autopilot)
    await enqueue("deal_autopilot", { deal_id: dealId, trigger: cap.source }, { dedupeKey: `deal_autopilot:${dealId}` });
    res.deal_title = (await one<{ title: string }>("select title from sales_deals where id = $1", [dealId]))?.title ?? null;
  }
  return res;
}

const FIELD_LABEL: Record<string, string> = {
  requirements: "Requirements", budget: "Budget", timeline: "Timeline", objections: "Objections", services: "Services", value_amount: "Value",
  country: "Country", pain: "Pain", desired_outcome: "Desired outcome", impact: "Impact", current_solution: "Current solution",
  compelling_event: "Why now", decision_criteria: "Decision criteria", decision_process: "Decision process", risks: "Risks", scope: "Scope",
  payment_terms: "Payment terms", industry: "Industry", city: "City", competitors: "Competitors", expected_close: "Expected close",
  start_date: "Start date", deal_type: "Deal type", title: "Deal name",
};

/** Fills the person's and the company's empty details from what the capture shows (signatures, profiles, letterheads). */
async function fillPersonAndCompany(personId: number | null, p: Extraction["people"][number] | undefined, ext: Extraction, channel: string): Promise<string[]> {
  const out: string[] = [];
  if (personId) {
    const cur = await one<Record<string, unknown>>("select title, city, country, department, seniority, whatsapp, language, preferred_channel, is_decision_maker, company_id from sales_people where id = $1", [personId]);
    if (cur) {
      const set: Record<string, unknown> = {};
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
      for (const [k, label] of [["title", "Title"], ["city", "City"], ["country", "Country"], ["department", "Department"], ["seniority", "Seniority"], ["whatsapp", "WhatsApp"], ["language", "Language"]] as const) {
        const v = str(p?.[k]);
        if (v && !cur[k]) { set[k] = v; out.push(`Person: ${label}`); }
      }
      // they wrote to you on this channel: that is how they like to talk, until you say otherwise
      if (!cur.preferred_channel && ["whatsapp", "email", "linkedin", "instagram", "call", "sms"].includes(channel) && ext.direction !== "out") { set.preferred_channel = channel; out.push("Person: Preferred channel"); }
      if (p?.is_decision_maker === true && !cur.is_decision_maker) { set.is_decision_maker = true; out.push("Person: Decision maker"); }
      const keys = Object.keys(set);
      if (keys.length) await q(`update sales_people set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1`, [personId, ...keys.map((k) => set[k])]);
      // the company: from the person, or the one named in the capture
      let companyId = (cur.company_id as number | null) ?? null;
      if (!companyId && (ext.company?.name || ext.company?.website)) {
        companyId = await ensureCompany(ext.company?.name ?? null, { website: ext.company?.website, country: ext.company?.country, industry: ext.company?.industry });
        if (companyId) { await q("update sales_people set company_id = $2 where id = $1 and company_id is null", [personId, companyId]); out.push("Person: Company"); }
      }
      const c = ext.company;
      if (companyId && c) {
        const co = await one<Record<string, unknown>>("select website, domain, industry, country, city, phone, email, linkedin, address, employees from sales_companies where id = $1", [companyId]);
        if (co) {
          const cs: Record<string, unknown> = {};
          for (const [k, label] of [["website", "Website"], ["industry", "Industry"], ["country", "Country"], ["city", "City"], ["phone", "Phone"], ["email", "Email"], ["linkedin", "LinkedIn"], ["address", "Address"]] as const) {
            const v = str(c[k]);
            if (v && !co[k]) { cs[k] = v; out.push(`Company: ${label}`); }
          }
          if (cs.website && !co.domain) {
            const dom = domainOf(String(cs.website));
            // a domain belongs to one company only
            if (dom && !(await one("select 1 from sales_companies where lower(domain) = lower($1) and id <> $2", [dom, companyId]))) cs.domain = dom;
          }
          if (typeof c.employees === "number" && c.employees > 0 && !co.employees) { cs.employees = Math.round(c.employees); out.push("Company: Employees"); }
          const ck = Object.keys(cs).filter((k) => cs[k] != null);
          if (ck.length) await q(`update sales_companies set ${ck.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1`, [companyId, ...ck.map((k) => cs[k])]);
        }
      }
    }
  }
  return out;
}

/**
 * The business named in a log (the clinic they work at, the website they shared) becomes the deal's company: linked to
 * the deal and the contact, its website saved, and the company research started, so the lead's details fill in on their own.
 */
export async function linkDealCompany(dealId: number, personId: number | null, p: Extraction["people"][number] | undefined, ext: Extraction): Promise<string[]> {
  const out: string[] = [];
  const name = ext.company?.name?.trim() || p?.company?.trim() || null;
  const site = ext.company?.website?.trim() || null;
  if (!name && !site) return out;
  const d = await one<{ company_id: number | null }>("select company_id from sales_deals where id = $1", [dealId]);
  if (!d) return out;
  let companyId = d.company_id;
  let fresh = false;
  if (!companyId) {
    companyId = (personId ? (await one<{ company_id: number | null }>("select company_id from sales_people where id = $1", [personId]))?.company_id : null)
      ?? (await ensureCompany(name, { website: site, country: ext.company?.country, industry: ext.company?.industry }));
    if (!companyId) return out;
    await updateDeal(dealId, { company_id: companyId }, { cause: "ai" });
    if (personId) await q("update sales_people set company_id = $2 where id = $1 and company_id is null", [personId, companyId]);
    out.push("Deal: Company");
    fresh = true;
  }
  const co = await one<{ website: string | null; domain: string | null; enriched_at: string | null; name: string; website_source: string | null }>(
    "select website, domain, enriched_at, name, website_source from sales_companies where id = $1", [companyId]);
  if (!co) return out;
  // the lead's own word beats a website research guessed (that guess may have been a namesake's)
  const replaces = !!site && !!co.website && co.website_source !== "you" && co.website_source !== "lead" && domainOf(site) !== co.domain;
  if (site && (!co.website || replaces)) {
    const dom = domainOf(site);
    const taken = dom ? await one("select 1 from sales_companies where lower(domain) = lower($1) and id <> $2", [dom, companyId]) : null;
    await q("update sales_companies set website = $2, domain = $3, website_source = 'lead', updated_at = now() where id = $1", [companyId, site, taken ? null : dom]);
    out.push("Company: Website");
    fresh = true;
  }
  // a business with a name or website and no research yet (or researched from a website that was not theirs): research it now
  if (fresh && (!co.enriched_at || replaces)) {
    await enqueue("enrich_company", { id: companyId }, { dedupeKey: `enrich_company:${companyId}` });
    if (site || co.website) await enqueue("audit_website", { id: companyId }, { dedupeKey: `audit:${companyId}` });
    out.push("Company research started");
  }
  return out;
}

/** Takes back everything a capture did: timeline entries, promises, stage moves, and a person or deal it created. */
/**
 * Saves a capture that the AI could not file (today's allowance is used up) to its deal's timeline as you wrote it:
 * no AI. The channel and who it was from are the ones you picked (else it is a note); the screenshots stay with it.
 * The entry is then done, so it is not filed again when the AI is back; Undo removes it like any capture.
 */
export async function keepAsNote(id: number): Promise<CaptureResult> {
  const cap = await one<CaptureRow & { deal_id: number | null; created_at: string; screen_text: string | null }>("select * from sales_captures where id = $1", [id]);
  if (!cap) throw new UserError("That entry is no longer there.");
  if (cap.status === "done" || cap.status === "needs_person") throw new UserError("That entry is already filed.");
  const dealId = Number(cap.hints?.deal_id ?? cap.deal_id) || null;
  if (!dealId) throw new UserError("Open the deal it belongs to and save it there.");
  const deal = await one<{ title: string | null }>("select title from sales_deals where id = $1", [dealId]);
  if (!deal) throw new UserError("That deal is no longer there.");
  const type = cap.channel && ACTIVITY_TYPES.some((t) => t.key === cap.channel) ? cap.channel : "note";
  const dir = cap.hints?.direction;
  const direction = type === "note" ? "internal" : dir === "in" || dir === "out" || dir === "both" ? dir : "both";
  const shots = (cap.images?.length ?? 0) || (cap.image_paths?.length ?? 0);
  const body = (cap.text ?? "").trim() || (cap.screen_text ?? "").trim();
  const interactionId = await logActivity(dealId, {
    type, direction, occurred_at: new Date(cap.created_at).toISOString(), body: body || null,
    subject: body ? null : `${shots} screenshot${shots === 1 ? "" : "s"}, saved without AI`,
  });
  await q("update sales_interactions set capture_id = $2 where id = $1", [interactionId, id]);
  if (shots) await keepShots(id, dealId);
  const result: CaptureResult = {
    deal_id: dealId, deal_title: deal.title, interactions: [interactionId], channel: type === "note" ? null : type, shots: shots || undefined,
    note: "Saved as you wrote it, without AI. Edit it on the timeline to set the channel or who it was from.",
  };
  await q("update sales_captures set status = 'done', wait_ai = false, error = null, deal_id = $2, result = $3, processed_at = now() where id = $1", [id, dealId, JSON.stringify(result)]);
  return { ...result, capture_id: id };
}

/** Entries kept while the AI allowance was used up go back in the queue; a job that still finds no AI waits for it. */
export async function requeueWaitingCaptures(): Promise<number> {
  const rows = await q<{ id: number; tg_chat: number | null }>(
    `select id, tg_chat from sales_captures where wait_ai and status = 'failed' and created_at > now() - interval '4 days' order by id limit 10`,
  );
  let n = 0;
  for (const r of rows) {
    if (await enqueue("process_capture", { id: r.id, ...(r.tg_chat ? { notify: true } : {}) }, { dedupeKey: `capture:${r.id}` })) n += 1;
  }
  return n;
}

export async function undoCapture(id: number): Promise<void> {
  const cap = await one<{ result: CaptureResult | null }>("select result from sales_captures where id = $1", [id]);
  const r = cap?.result ?? {};
  const ints = await q<{ id: number }>("select id from sales_interactions where capture_id = $1", [id]);
  const intIds = ints.map((x) => x.id);
  if (intIds.length) {
    const evs = await q<{ id: number; deal_id: number; from_stage: number | null }>(
      "select id, deal_id, from_stage from sales_deal_events where interaction_id = any($1) and kind = 'stage' order by id",
      [intIds],
    );
    if (evs.length && evs[0].from_stage) await q("update sales_deals set stage_id = $2, stage_changed_at = now() where id = $1", [evs[0].deal_id, evs[0].from_stage]);
    await q("delete from sales_deal_events where interaction_id = any($1)", [intIds]);
    await q("delete from sales_commitments where interaction_id = any($1)", [intIds]);
  }
  if (r.commitments?.length) await q("delete from sales_commitments where id = any($1)", [r.commitments]);
  if (r.seen?.length) await q("delete from sales_seen where hash = any($1)", [r.seen]);
  await q("delete from sales_interactions where capture_id = $1", [id]);
  await q("delete from sales_meetings where external_id = $1", [`cap:${id}`]);
  if (r.created_deal) await q("delete from sales_deals where id = $1", [r.created_deal]);
  if (r.created_person) await q("delete from sales_people where id = $1 and not exists (select 1 from sales_deals where person_id = $1)", [r.created_person]);
  await q("update sales_captures set status = 'ignored', deal_id = null where id = $1", [id]);
}

export function lastSeenText(at: unknown): string {
  return iso(at).slice(0, 10);
}
