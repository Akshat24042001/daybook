/**
 * What the assistant is told when a chat is about Sales or about one lead. For a lead: its whole record in one
 * readable block (deal, contact, company, latest conversations, promises, moves, quotes, money), so it can answer
 * "what's happening with them?" at once and propose changes with the right ids.
 */
import { one, q } from "../db";
import { getDeal } from "./deals";
import { money } from "@/components/sales/format";

export interface ChatFocus {
  area?: "sales";
  deal_id?: number;
  /** a radar lead that is not a deal yet */
  radar_item_id?: number;
}

export function cleanFocus(v: unknown): ChatFocus | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = Number(o.deal_id);
  if (Number.isInteger(id) && id > 0) return { deal_id: id };
  const rid = Number(o.radar_item_id);
  if (Number.isInteger(rid) && rid > 0) return { radar_item_id: rid };
  return o.area === "sales" ? { area: "sales" } : null;
}

const day = (x: unknown) => (x ? new Date(String(x)).toISOString().slice(0, 10) : "");
const line = (label: string, v: unknown) => (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) ? "" : `${label}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);

/** One lead, everything that matters, as plain lines. */
export async function dealBrief(dealId: number): Promise<string | null> {
  const d = await getDeal(dealId);
  if (!d) return null;
  const r = d as unknown as Record<string, unknown>;
  const [person, company, talks, promises, moves, docs, pays, people] = await Promise.all([
    d.person_id ? one<Record<string, unknown>>("select id, full_name, title, emails, phones, whatsapp, linkedin, city, country, preferred_channel, is_decision_maker from sales_people where id = $1", [d.person_id]) : null,
    d.company_id ? one<Record<string, unknown>>("select id, name, website, industry, country, city, employees, description from sales_companies where id = $1", [d.company_id]) : null,
    q<{ occurred_at: string; channel: string; direction: string; s: string }>(
      "select occurred_at, channel, direction, left(coalesce(summary, body, subject, ''), 280) as s from sales_interactions where deal_id = $1 order by occurred_at desc limit 10", [dealId]),
    q<{ id: number; owner: string; text: string; due_at: string | null }>("select id, owner, text, due_at from sales_commitments where deal_id = $1 and status = 'open' order by due_at nulls last limit 8", [dealId]),
    q<{ id: number; title: string; due_at: string }>("select id, title, due_at from sales_moves where deal_id = $1 and status = 'open' order by due_at limit 5", [dealId]),
    q<{ title: string; kind: string; status: string; view_count: number }>("select title, kind, status, view_count from sales_docs where deal_id = $1 order by id desc limit 5", [dealId]),
    q<{ label: string; amount: number; currency: string; status: string; due_on: string | null }>("select label, amount, currency, status, due_on from sales_payments where deal_id = $1 order by id limit 6", [dealId]),
    q<{ id: number; full_name: string; title: string | null; role: string }>("select p.id, p.full_name, p.title, dp.role from sales_deal_people dp join sales_people p on p.id = dp.person_id where dp.deal_id = $1 and p.id <> coalesce($2, 0) limit 6", [dealId, d.person_id]),
  ]);
  const out = [
    `LEAD deal_id=${d.id}: ${d.title}`,
    line("Stage", `${d.stage_name} (since ${day(d.stage_changed_at)})`),
    line("Priority", `${d.priority}/100${d.priority_why?.length ? ` (${d.priority_why.slice(0, 3).join("; ")})` : ""}`),
    line("Value", d.value_amount ? money(Number(d.value_amount), d.currency) : "not set"),
    line("Win chance", d.probability ?? d.stage_probability),
    line("Expected close", day(d.expected_close)),
    line("Source", d.source),
    line("Next step", d.next_action ? `${d.next_action}${d.next_action_at ? ` (by ${day(d.next_action_at)})` : ""}` : "none set"),
    line("Where we are", d.summary),
    ...["requirements", "budget", "timeline", "pain", "desired_outcome", "impact", "current_solution", "compelling_event", "decision_criteria", "decision_process", "competitors", "risks", "scope", "payment_terms", "services", "tags", "notes"].map((k) => line(k.replace(/_/g, " "), r[k])),
    line("Last they wrote", day(d.last_inbound_at)),
    line("Last you wrote", day(d.last_outbound_at)),
    person ? `CONTACT person_id=${person.id}: ${person.full_name}${person.title ? `, ${person.title}` : ""}${person.is_decision_maker ? " (decision maker)" : ""}; ${[line("emails", person.emails), line("phones", person.phones), line("whatsapp", person.whatsapp), line("linkedin", person.linkedin), line("city", person.city), line("prefers", person.preferred_channel)].filter(Boolean).join("; ")}` : "CONTACT: none yet",
    people.length ? `OTHER PEOPLE: ${people.map((p) => `${p.full_name}${p.title ? `, ${p.title}` : ""} (${p.role}, person_id=${p.id})`).join("; ")}` : "",
    company ? `COMPANY: ${company.name}; ${[line("website", company.website), line("industry", company.industry), line("country", company.country), line("city", company.city), line("employees", company.employees)].filter(Boolean).join("; ")}${company.description ? `\n  ${String(company.description).slice(0, 400)}` : ""}` : "",
    talks.length ? `LATEST CONVERSATIONS (newest first):\n${talks.map((t) => `- ${day(t.occurred_at)} ${t.channel} ${t.direction === "in" ? "from them" : t.direction === "out" ? "from you" : t.direction}: ${t.s.replace(/\s+/g, " ")}`).join("\n")}` : "LATEST CONVERSATIONS: none logged",
    promises.length ? `OPEN PROMISES:\n${promises.map((p) => `- ${p.owner === "me" ? "You" : "They"}: ${p.text}${p.due_at ? ` (due ${day(p.due_at)})` : ""}`).join("\n")}` : "",
    moves.length ? `OPEN MOVES:\n${moves.map((m) => `- ${m.title} (due ${day(m.due_at)})`).join("\n")}` : "",
    docs.length ? `DOCUMENTS: ${docs.map((x) => `${x.title} (${x.kind}, ${x.status}${x.view_count ? `, opened ${x.view_count}x` : ""})`).join("; ")}` : "",
    pays.length ? `PAYMENTS: ${pays.map((p) => `${p.label} ${money(Number(p.amount), p.currency)} ${p.status}${p.due_on ? ` due ${day(p.due_on)}` : ""}`).join("; ")}` : "",
  ].filter(Boolean);
  return out.join("\n");
}

/** A radar lead, everything known about it: the post, who posted it, the business behind it, the research, the draft. */
export async function radarLeadBrief(itemId: number): Promise<string | null> {
  const it = await one<Record<string, unknown> & { company_id: number | null }>(
    `select r.*, s.name as source_name from sales_radar_items r left join sales_radar_sources s on s.id = r.source_id where r.id = $1`, [itemId]);
  if (!it) return null;
  const [co, people, move] = await Promise.all([
    it.company_id ? one<{ name: string; website: string | null; enrichment: Record<string, { v: unknown }> | null }>("select name, website, enrichment from sales_companies where id = $1", [it.company_id]) : null,
    it.company_id ? q<{ full_name: string; title: string | null; emails: string[]; phones: string[]; linkedin: string | null; is_decision_maker: boolean | null }>(
      "select full_name, title, emails, phones, linkedin, is_decision_maker from sales_people where company_id = $1 order by (is_decision_maker is true) desc limit 6", [it.company_id]) : [],
    one<{ draft: string | null; draft_subject: string | null; channel: string | null }>("select draft, draft_subject, channel from sales_moves where dedupe_key = $1", [`radar:${itemId}`]),
  ]);
  const j = (v: unknown) => (v ? JSON.stringify(v).slice(0, 2500) : "");
  const facts = co?.enrichment
    ? Object.entries(co.enrichment).filter(([, f]) => f && f.v !== null && f.v !== "").map(([k, f]) => `${k.replace(/_/g, " ")}: ${String(f.v).slice(0, 300)}`).join("\n")
    : "";
  return [
    `RADAR LEAD radar_item_id=${itemId} (not a deal yet${it.deal_id ? `; now deal_id=${it.deal_id}` : ""}): ${it.title}`,
    line("Posted", it.posted_at ? new Date(String(it.posted_at)).toISOString().slice(0, 16).replace("T", " ") : "unknown"),
    line("Found on", `${it.source_name ?? "manual"} ${it.url ?? ""}`),
    line("Fit score", it.score),
    `THEIR POST:\n${String(it.body ?? "").slice(0, 4000)}`,
    it.poster ? `WHO POSTED IT (platform profile): ${j(it.poster)}` : "",
    it.fit ? `SCORER'S NOTES: ${j(it.fit)}` : "",
    it.brief ? `PLAIN-LANGUAGE BRIEF: ${j(it.brief)}` : "",
    it.identity ? `BUSINESS BEHIND THE POST (only what the evidence showed): ${j(it.identity)}` : "",
    co ? `COMPANY RESEARCHED: ${co.name}${co.website ? ` (${co.website})` : ""}\n${facts.slice(0, 6000)}` : "",
    people.length ? `PEOPLE FOUND: ${people.map((p) => `${p.full_name}${p.title ? `, ${p.title}` : ""}${p.is_decision_maker ? " (decision maker)" : ""}${p.emails.length ? `, ${p.emails.join("/")}` : ""}${p.phones.length ? `, ${p.phones.join("/")}` : ""}${p.linkedin ? `, ${p.linkedin}` : ""}`).join("; ")}` : "",
    it.prep ? `PREPARATION: ${j((it.prep as { steps?: unknown }).steps)}` : "",
    move?.draft ? `MESSAGE ALREADY DRAFTED (${move.channel ?? ""}): ${move.draft_subject ? `${move.draft_subject}\n` : ""}${move.draft}` : "",
  ].filter(Boolean).join("\n");
}

/** The text added to the assistant's context for a focused chat. */
export async function focusContext(f: ChatFocus | null): Promise<string> {
  if (!f) return "";
  if (f.radar_item_id) {
    const brief = await radarLeadBrief(f.radar_item_id);
    if (!brief) return "";
    return `FOCUS: this chat is about ONE RADAR LEAD (a posted requirement, not a deal yet). "This lead", "they", "the client" and "it" mean it.
Answer from this record in 2 to 5 short lines, plainly, so the owner does not have to read the post. Say where a fact comes from (their post, their profile, the research).
If the record does not say, answer "not known" and say what would find out; never guess names, emails, numbers or budgets.
When asked for a message, write it ready to send, short, specific to their post. To make it a deal, tell the owner to press Make it a lead.
${brief}`;
  }
  if (f.deal_id) {
    const brief = await dealBrief(f.deal_id);
    if (!brief) return "";
    return `FOCUS: this chat is about ONE LEAD. "This lead", "they", "them", "it" and "the deal" mean it. Answer from this record first (query for more only if needed). To change anything, propose the sales actions with deal_id=${f.deal_id}${brief.match(/person_id=(\d+)/) ? ` (contact person_id=${brief.match(/person_id=(\d+)/)![1]})` : ""}.\n${brief}`;
  }
  const top = await q<{ id: number; title: string; stage: string; priority: number; value: string | null }>(
    `select d.id, d.title, s.name as stage, d.priority, case when d.value_amount is null then null else d.value_amount::text || ' ' || d.currency end as value
     from sales_deals d join sales_stages s on s.id = d.stage_id where s.category = 'open' order by d.priority desc limit 15`,
  );
  return `FOCUS: this chat is about the SALES PIPELINE (Aivaura). Prefer sales tables and the sales actions. When the owner names a lead, find its deal_id by title, person or company (ILIKE) before proposing a change.\nTOP OPEN DEALS (by priority): ${top.map((d) => `${d.title} [deal_id=${d.id}, ${d.stage}, priority ${d.priority}${d.value ? `, ${d.value}` : ""}]`).join("; ") || "none"}`;
}

/** Finds a lead by a few words of its title, contact or company (best match first). */
export async function findDeal(words: string): Promise<{ id: number; title: string } | null> {
  const w = words.trim();
  if (!w) return null;
  if (/^\d+$/.test(w)) return one<{ id: number; title: string }>("select id, title from sales_deals where id = $1", [Number(w)]);
  return one<{ id: number; title: string }>(
    `select d.id, d.title from sales_deals d join sales_stages s on s.id = d.stage_id
     left join sales_people p on p.id = d.person_id left join sales_companies c on c.id = d.company_id
     where d.title ilike $1 or p.full_name ilike $1 or c.name ilike $1
     order by (lower(d.title) = lower($2)) desc, (s.category = 'open') desc, d.priority desc, d.updated_at desc limit 1`,
    [`%${w.replace(/[%_]/g, "")}%`, w],
  );
}
