/**
 * Capture pipeline: anything you send in (a forwarded chat, a WhatsApp export, a LinkedIn screenshot, a voice note after a
 * meeting, an email, a page from the bookmarklet) becomes: the right person and deal, timeline entries, promises both ways,
 * an updated "where we are", stage moves, and fresh next moves. You never fill a form.
 */
import { createHash } from "node:crypto";
import { one, q } from "../db";
import { getSettings } from "../settings";
import { zonedInstant } from "../time";
import { salesConfig, toUsd, type SalesConfig } from "./config";
import { iso } from "./context";
import {
  addCommitment, createDeal, dealForPerson, getDeal, logInteraction, updateDeal, type Channel, type Direction,
} from "./deals";
import { addIdentities, ensureCompany, resolvePerson, upsertPerson, type PersonRow } from "./identity";
import { enqueue } from "./jobs";
import { llmJson, type Part } from "./llm";
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

export interface Extraction {
  kind: "conversation" | "note" | "meeting_notes" | "lead_post" | "profile" | "email" | "other";
  is_sales_related: boolean;
  people: { name?: string; company?: string; title?: string; email?: string; phone?: string; linkedin?: string; instagram?: string; country?: string; city?: string; role?: string; is_me?: boolean }[];
  company?: { name?: string; website?: string; country?: string; industry?: string } | null;
  channel?: string | null;
  direction?: Direction | null;
  occurred_at?: string | null;
  messages?: { from: "me" | "them"; at?: string | null; text: string }[];
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
 "people": [{"name","company","title","email","phone","linkedin","instagram","country","city","role":"decision_maker|champion|influencer|user|finance|gatekeeper|contact","is_me":false}],
 "company": {"name","website","country","industry"} or null,
 "channel": "whatsapp|linkedin|email|call|meeting|in_person|instagram|sms|twitter|other",
 "direction": "in" (they wrote / spoke) | "out" (owner wrote) | "both",
 "occurred_at": ISO time if known else null,
 "messages": for chats or screenshots of chats, each message [{"from":"me|them","at":ISO or null,"text"}] (max 60, newest last), else [],
 "summary": 1 to 3 plain lines on what happened,
 "deal_summary": the updated "where we are" for the whole deal in 2 to 4 lines, merging PREVIOUS STATE with this input,
 "commitments": promises with owner "me" (owner promised) or "them", e.g. {"owner":"them","text":"share sample data","due":"YYYY-MM-DD"},
 "requirements", "budget", "timeline": short text or null,
 "objections": [], "services": which of the owner's offers fit (short names),
 "stage_signal": "none|replied|meeting_booked|proposal_requested|price_objection|accepted|not_now|lost|payment_received",
 "stage_detail": one line (reason if lost, why not now),
 "revisit_on": YYYY-MM-DD when they said to come back later, else null,
 "meeting_at": ISO start time of a meeting agreed in the future, else null,
 "value": {"amount": number, "currency": "INR|USD|AED|GBP|EUR|CAD|AUD|SGD"} if a price or budget number is stated, else null (amount as a plain number: 2 lakh is 200000; leave currency out unless it is named or shown, e.g. ₹, Rs, $, and ${cfg.default_currency} is assumed),
 "next_step": the single best next action for the owner, imperative, under 15 words,
 "referrer": {"name"} if someone referred this lead, else null,
 "intermediary": {"name","type":"agency|broker|consultant|partner"} if the deal runs through a middle person, else null
}
Use only facts in the input. Unknown fields are null. Never invent emails or phone numbers.`;

async function extract(cfg: SalesConfig, tz: string, text: string, images: string[], previous: string | null, hintLine: string): Promise<Extraction> {
  const intro = `${hintLine}${previous ? `\nPREVIOUS STATE OF THIS DEAL:\n${previous}\n` : ""}\nINPUT:\n${text.slice(0, 14_000)}`;
  const user: string | Part[] = images.length
    ? [{ type: "text", text: intro }, ...images.slice(0, 4).map((url) => ({ type: "image_url" as const, image_url: { url } }))]
    : intro;
  return llmJson<Extraction>(EXTRACT_SYSTEM(cfg, new Date(), tz), user, { vision: images.length > 0, maxTokens: 2200, totalMs: 55_000 });
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
}

interface CaptureRow {
  id: number;
  source: string;
  channel: string | null;
  text: string | null;
  images: string[];
  hints: CaptureInput["hints"] & Record<string, unknown>;
  status: string;
  result: CaptureResult | null;
  tg_chat: number | null;
}

const CHANNEL_SET = new Set(["email", "whatsapp", "linkedin", "instagram", "call", "meeting", "in_person", "telegram", "sms", "twitter", "document", "other", "note"]);
const asChannel = (c: string | null | undefined, fallback: Channel): Channel => (c && CHANNEL_SET.has(c) ? (c as Channel) : fallback);

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
  const prev = dealId ? (await getDeal(dealId))?.summary ?? null : null;

  const hintLine = [
    cap.source ? `SOURCE: ${cap.source}` : "",
    cap.channel ? `CHANNEL HINT: ${cap.channel}` : "",
    hints.url ? `PAGE: ${hints.page_title ?? ""} ${hints.url}` : "",
    chatName ? `CHAT NAME: ${chatName}` : "",
    hints.direction ? `DIRECTION HINT: ${hints.direction}` : "",
  ].filter(Boolean).join("\n");

  const ext = await extract(cfg, tz, text || "(see image)", cap.images ?? [], prev, hintLine);
  const result = await applyExtraction(cap, ext, { cfg, dealId, personId, chat, chatName, newPersonName: force.newPersonName });
  if (chat && result.deal_id) result.seen = (chat as (ChatLine & { h?: string })[]).map((l) => l.h).filter((x): x is string => !!x);
  await q("update sales_captures set status = $2, result = $3, processed_at = now(), error = null where id = $1", [
    id, result.candidates?.length || (!result.deal_id && !result.skipped) ? "needs_person" : result.skipped ? "ignored" : "done", JSON.stringify(result),
  ]);
  if (chat && result.deal_id) {
    for (const l of chat as (ChatLine & { h?: string })[]) if (l.h) await q("insert into sales_seen (hash) values ($1) on conflict do nothing", [l.h]);
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

export async function applyExtraction(cap: CaptureRow, ext: Extraction, a: ApplyCtx): Promise<CaptureResult> {
  const { cfg } = a;
  const res: CaptureResult = { summary: ext.summary, next_step: ext.next_step ?? null, interactions: [], commitments: [] };
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
    await updateDeal(deal.id, { referrer_id: rid, source: deal.source === "outbound" ? "referral" : deal.source });
  }
  if (deal && ext.intermediary?.name && !deal.intermediary_id) {
    const iid = await upsertPerson({ name: ext.intermediary.name, relationship: "partner" });
    const type = ["agency", "broker", "consultant", "partner", "referrer"].includes(ext.intermediary.type ?? "") ? ext.intermediary.type : "partner";
    await updateDeal(deal.id, { intermediary_id: iid, intermediary_type: type });
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
  } else if (ext.messages?.length && ext.messages.length > 1) {
    const theirs = ext.messages.filter((m) => m.from === "them");
    const mine = ext.messages.filter((m) => m.from === "me");
    for (const [group, dir] of [[theirs, "in"], [mine, "out"]] as const) {
      if (!group.length) continue;
      const last = group[group.length - 1];
      const r = await logInteraction({
        deal_id: dealId, person_id: personId, channel, direction: dir as Direction,
        occurred_at: last.at && !Number.isNaN(Date.parse(last.at)) ? last.at : ext.occurred_at && !Number.isNaN(Date.parse(ext.occurred_at)) ? ext.occurred_at : null,
        body: group.map((m) => `${m.from === "me" ? "Me" : "Them"}: ${m.text}`).join("\n").slice(0, 12_000),
        summary: ext.summary, source: cap.source, capture_id: cap.id, external_id: `cap:${cap.id}:${dir}`, extracted: dir === "in" ? ext : undefined,
      });
      if (r) {
        ids.push(r.id);
        if (r.moved) res.moved = r.moved.name;
      }
    }
    res.message_count = ext.messages.length;
  } else {
    const dir: Direction = cap.hints?.direction ?? ext.direction ?? (ext.kind === "note" || ext.kind === "meeting_notes" ? "both" : "in");
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
      if (ext.budget) patch.budget = ext.budget;
      if (ext.timeline) patch.timeline = ext.timeline;
      if (ext.objections?.length) patch.objections = Array.from(new Set([...(d.objections ?? []), ...ext.objections])).slice(-10);
      if (ext.services?.length && !d.services?.length) patch.services = ext.services.slice(0, 6);
      if (ext.value?.amount && !d.value_amount) {
        patch.value_amount = ext.value.amount;
        patch.currency = (ext.value.currency ?? cfg.default_currency).toUpperCase();
      }
      if (ext.next_step) {
        patch.next_action = ext.next_step;
      }
      if (ext.company?.country && !d.country) patch.country = ext.company.country;
      await updateDeal(dealId, patch);

      // stage signals: forward moves are automatic, closing moves are only suggested
      const sig = ext.stage_signal ?? "none";
      if (sig === "meeting_booked") {
        const mv = await applyEvent(dealId, "meeting", { interactionId: ids[0] });
        if (mv) res.moved = mv.name;
      } else if (sig === "price_objection" && d.stage_role === "proposal") {
        const neg = await stageByRole("negotiation");
        if (neg) {
          const mv = await moveDeal(dealId, neg.id, { cause: "ai", force: true, note: ext.stage_detail ?? "price objection", interactionId: ids[0] }).catch(() => null);
          if (mv) res.moved = mv.name;
        }
      } else if (sig === "not_now") {
        res.suggestion = { kind: "stage", role: "nurture", reason: ext.stage_detail ?? null, date: ext.revisit_on ?? null, label: `Move to Nurture${ext.revisit_on ? ` until ${ext.revisit_on}` : ""}?` };
      } else if (sig === "lost") {
        res.suggestion = { kind: "stage", role: "lost", reason: ext.stage_detail ?? "they said no", label: `Mark as Lost (${(ext.stage_detail ?? "they said no").slice(0, 40)})?` };
      } else if (sig === "accepted" && !["won", "active", "delivered", "paid"].includes(d.stage_role ?? "")) {
        res.suggestion = { kind: "stage", role: "won", label: "Sounds like a yes. Mark as Won?" };
      } else if (sig === "payment_received") {
        res.suggestion = { kind: "stage", role: d.stage_role === "won" ? "active" : "paid", label: "Payment mentioned. Record it on the deal?" };
      }
      if (ext.meeting_at && !Number.isNaN(Date.parse(ext.meeting_at)) && Date.parse(ext.meeting_at) > Date.now()) {
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
  }
  return res;
}

/** Takes back everything a capture did: timeline entries, promises, stage moves, and a person or deal it created. */
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
  await q("update sales_captures set status = 'ignored' where id = $1", [id]);
}

export function lastSeenText(at: unknown): string {
  return iso(at).slice(0, 10);
}
