/**
 * Everything a salesperson can see or change, in one place. Every function takes the salesperson and checks access
 * first; a lead they may not see answers "not found" (never "not allowed"), so they cannot even learn it exists.
 *
 * They see a lead when you shared it with them or they added it. On it they see:
 *   - the deal's own fields (stage, dates, next step, needs…), the value only if you allowed it;
 *   - the main contact and the company, and the research only if you allowed it (always for leads they added);
 *   - updates (timeline, promises, screenshots, documents) they made, or that were shared with them.
 * Never: priority, fit, the AI's "where we are", your private notes, custom fields, other salespeople, other leads.
 */
import { createHash } from "node:crypto";
import { one, q, UserError } from "../db";
import { getSettings } from "../settings";
import { salesConfig } from "../sales/config";
import { addCommitment, logActivity, logInteraction, setCommitment, updateDeal, type Direction } from "../sales/deals";
import { domainOf } from "../sales/identity";
import { extract } from "../sales/ingest";
import { enqueue } from "../sales/jobs";
import { startResearch } from "../sales/research";
import { keepShots } from "../sales/shots";
import { moveDeal } from "../sales/stages";
import { NotFound } from "./api";
import { checkNewLead, type NewLeadInput } from "./new-lead";
import type { Rep } from "./users";

export interface Access {
  show_value: boolean;
  show_research: boolean;
  mine: boolean;
}

/** The salesperson's access to a lead, or NotFound. */
export async function access(rep: Rep, dealId: number): Promise<Access> {
  if (!Number.isInteger(dealId) || dealId <= 0) throw new NotFound();
  const a = await one<{ show_value: boolean; show_research: boolean; mine: boolean }>(
    `select a.show_value, a.show_research, (d.created_by_user = a.user_id) as mine
     from sales_deal_access a join sales_deals d on d.id = a.deal_id where a.deal_id = $1 and a.user_id = $2`,
    [dealId, rep.id],
  );
  if (!a) throw new NotFound();
  return { show_value: !!(a.show_value || a.mine), show_research: !!(a.show_research || a.mine), mine: !!a.mine };
}

/** SQL: an update row the salesperson may see (they made it, or it was shared with them). */
const visible = (alias: string, p: string) => `(${alias}.author_user = ${p} or ${p} = any(${alias}.shared_with))`;

// ---------------------------------------------------------------- lists

export interface RepLeadRow {
  id: number;
  title: string;
  stage: string;
  stage_category: string;
  person: string | null;
  company: string | null;
  next_action: string | null;
  next_action_at: string | null;
  last_touch: string | null;
  mine: boolean;
  value: string | null;
}

export async function myLeads(rep: Rep): Promise<RepLeadRow[]> {
  const rows = await q<RepLeadRow & { value_amount: number | null; currency: string; show_value: boolean }>(
    `select d.id, d.title, s.name as stage, s.category as stage_category, p.full_name as person, c.name as company, d.next_action, d.next_action_at,
       (select max(i.occurred_at) from sales_interactions i where i.deal_id = d.id and ${visible("i", "$1")}) as last_touch,
       (d.created_by_user = $1) as mine, (a.show_value or d.created_by_user = $1) as show_value, d.value_amount, d.currency
     from sales_deal_access a join sales_deals d on d.id = a.deal_id join sales_stages s on s.id = d.stage_id
     left join sales_people p on p.id = d.person_id left join sales_companies c on c.id = d.company_id
     where a.user_id = $1
     order by (s.category = 'open') desc, d.next_action_at nulls last, d.updated_at desc`,
    [rep.id],
  );
  return rows.map(({ value_amount, currency, show_value, ...r }) => ({ ...r, value: show_value && value_amount ? `${Number(value_amount).toLocaleString("en-IN")} ${currency}` : null }));
}

export interface RepMove {
  deal_id: number;
  lead: string;
  kind: "next_step" | "my_promise" | "their_promise" | "reply" | "follow_up" | "no_next_step";
  title: string;
  due_at: string | null;
}

/** Their moves, worked out only from what they can see (so nothing hidden leaks through a move's wording). */
export async function myMoves(rep: Rep, now = new Date()): Promise<RepMove[]> {
  const D = 86_400_000;
  const leads = await q<{ id: number; title: string; person: string | null; next_action: string | null; next_action_at: string | null; created_at: string; category: string }>(
    `select d.id, d.title, p.full_name as person, d.next_action, d.next_action_at, d.created_at, s.category
     from sales_deal_access a join sales_deals d on d.id = a.deal_id join sales_stages s on s.id = d.stage_id left join sales_people p on p.id = d.person_id
     where a.user_id = $1 and s.category = 'open'`,
    [rep.id],
  );
  if (!leads.length) return [];
  const ids = leads.map((l) => l.id);
  const [promises, last] = await Promise.all([
    q<{ deal_id: number; owner: string; text: string; due_at: string | null }>(
      `select k.deal_id, k.owner, k.text, k.due_at from sales_commitments k where k.deal_id = any($2::int[]) and k.status = 'open' and ${visible("k", "$1")}`,
      [rep.id, ids],
    ),
    q<{ deal_id: number; direction: string; occurred_at: string }>(
      `select distinct on (i.deal_id) i.deal_id, i.direction, i.occurred_at from sales_interactions i
       where i.deal_id = any($2::int[]) and i.direction <> 'internal' and ${visible("i", "$1")} order by i.deal_id, i.occurred_at desc`,
      [rep.id, ids],
    ),
  ]);
  const out: RepMove[] = [];
  const lastBy = new Map(last.map((l) => [l.deal_id, l]));
  for (const l of leads) {
    const who = l.person ?? l.title;
    if (l.next_action && l.next_action_at && new Date(l.next_action_at).getTime() <= now.getTime() + D) out.push({ deal_id: l.id, lead: l.title, kind: "next_step", title: l.next_action, due_at: l.next_action_at });
    if (!l.next_action) out.push({ deal_id: l.id, lead: l.title, kind: "no_next_step", title: `Set a next step for ${l.title}`, due_at: null });
    const t = lastBy.get(l.id);
    if (t?.direction === "in") out.push({ deal_id: l.id, lead: l.title, kind: "reply", title: `Reply to ${who}`, due_at: t.occurred_at });
    else {
      const since = t ? new Date(t.occurred_at).getTime() : new Date(l.created_at).getTime();
      if (now.getTime() - since > 3 * D) out.push({ deal_id: l.id, lead: l.title, kind: "follow_up", title: `Follow up with ${who}${t ? "" : " (no contact logged yet)"}`, due_at: new Date(since + 3 * D).toISOString() });
    }
  }
  for (const k of promises) {
    const lead = leads.find((l) => l.id === k.deal_id)!;
    const dueSoon = !k.due_at || new Date(k.due_at).getTime() <= now.getTime() + D;
    if (k.owner === "me" && dueSoon) out.push({ deal_id: k.deal_id, lead: lead.title, kind: "my_promise", title: `You promised: ${k.text}`, due_at: k.due_at });
    if (k.owner === "them" && k.due_at && new Date(k.due_at).getTime() < now.getTime()) out.push({ deal_id: k.deal_id, lead: lead.title, kind: "their_promise", title: `Chase: they promised ${k.text}`, due_at: k.due_at });
  }
  const rank = { reply: 0, my_promise: 1, next_step: 2, their_promise: 3, follow_up: 4, no_next_step: 5 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.due_at ? new Date(a.due_at).getTime() : Infinity) - (b.due_at ? new Date(b.due_at).getTime() : Infinity));
}

// ---------------------------------------------------------------- one lead

/** The deal fields a salesperson sees and may edit. Never priority, fit, summary, notes, custom fields, commission. */
export const REP_FIELDS = [
  "title", "next_action", "next_action_at", "expected_close", "requirements", "budget", "timeline", "pain", "desired_outcome", "impact",
  "current_solution", "compelling_event", "decision_criteria", "decision_process", "competitors", "risks", "scope", "payment_terms",
  "services", "tags", "country", "city", "industry", "deal_type", "start_date", "delivery_date", "source_detail", "revisit_on",
] as const;
const PERSON_FIELDS = ["full_name", "title", "emails", "phones", "whatsapp", "linkedin", "instagram", "city", "country", "preferred_channel", "language", "is_decision_maker"] as const;
const COMPANY_FIELDS = ["name", "website", "industry", "city", "country", "phone", "email", "address"] as const;
/** field changes they may see in the history (never value unless allowed, never the hidden fields) */
const HISTORY_FIELDS = new Set<string>(REP_FIELDS);

export async function leadView(rep: Rep, dealId: number) {
  const a = await access(rep, dealId);
  const d = await one<Record<string, unknown>>(
    `select d.*, s.name as stage_name, s.category as stage_category, s.role as stage_role from sales_deals d join sales_stages s on s.id = d.stage_id where d.id = $1`,
    [dealId],
  );
  if (!d) throw new NotFound();
  const deal: Record<string, unknown> = { id: d.id, stage_id: d.stage_id, stage_name: d.stage_name, stage_category: d.stage_category, stage_role: d.stage_role, stage_changed_at: d.stage_changed_at, source: d.source, created_at: d.created_at, mine: a.mine };
  for (const k of REP_FIELDS) deal[k] = d[k];
  if (a.show_value) {
    deal.value_amount = d.value_amount;
    deal.currency = d.currency;
  }
  const pick = <K extends string>(row: Record<string, unknown> | null, keys: readonly K[]) => (row ? Object.fromEntries(["id", ...keys].map((k) => [k, row[k]])) : null);
  const [person, company, timeline, promises, shots, docs, history, stages] = await Promise.all([
    d.person_id ? one<Record<string, unknown>>("select * from sales_people where id = $1", [d.person_id]) : null,
    d.company_id ? one<Record<string, unknown>>("select * from sales_companies where id = $1", [d.company_id]) : null,
    q(`select i.id, i.occurred_at, i.channel, i.direction, i.subject, i.summary, i.body, i.outcome, i.duration_min, (i.author_user = $2) as by_me
       from sales_interactions i where i.deal_id = $1 and ${visible("i", "$2")} order by i.occurred_at desc limit 200`, [dealId, rep.id]),
    q(`select k.id, k.owner, k.text, k.due_at, k.status, (k.author_user = $2) as by_me from sales_commitments k where k.deal_id = $1 and k.status <> 'dropped' and ${visible("k", "$2")} order by k.status, k.due_at nulls last`, [dealId, rep.id]),
    q<{ id: number; n: number; created_at: string; summary: string | null }>(
      `select c.id, greatest(jsonb_array_length(coalesce(c.images, '[]'::jsonb)), cardinality(c.image_paths)) as n, c.created_at, c.result->>'summary' as summary
       from sales_captures c where c.deal_id = $1 and c.status <> 'ignored' and ${visible("c", "$2")} order by c.created_at desc limit 40`, [dealId, rep.id]),
    q(`select x.id, x.slug, x.kind, x.title, x.status from sales_docs x where x.deal_id = $1 and ${visible("x", "$2")} order by x.id desc`, [dealId, rep.id]),
    q<{ kind: string; field: string | null; old_value: string | null; new_value: string | null; from_name: string | null; to_name: string | null; created_at: string }>(
      `select e.kind, e.field, e.old_value, e.new_value, f.name as from_name, t.name as to_name, e.created_at
       from sales_deal_events e left join sales_stages f on f.id = e.from_stage left join sales_stages t on t.id = e.to_stage
       where e.deal_id = $1 and e.kind in ('stage','field','created') order by e.created_at desc limit 200`, [dealId]),
    q("select id, name, category, role from sales_stages where active order by sort"),
  ]);
  const research = a.show_research
    ? { company: company?.enrichment ?? null, person: person?.enrichment ?? null, company_researched: company?.enriched_at ?? null }
    : null;
  return {
    deal,
    access: a,
    person: pick(person, PERSON_FIELDS),
    company: pick(company, COMPANY_FIELDS),
    timeline,
    promises,
    shots: shots.flatMap((s) => Array.from({ length: s.n }, (_, i) => ({ capture_id: s.id, index: i, at: s.created_at, summary: s.summary }))),
    docs,
    // stage moves and field changes, without who made them or why (that can be private)
    history: history.filter((h) => h.kind !== "field" || (h.field && (HISTORY_FIELDS.has(h.field) || (a.show_value && ["value_amount", "currency"].includes(h.field))))).map((h) => ({ ...h })),
    stages,
    research,
  };
}

// ---------------------------------------------------------------- changes

const clean = (v: unknown, max = 4000) => (typeof v === "string" ? v.trim().slice(0, max) : v);

export async function repUpdateLead(rep: Rep, dealId: number, patch: Record<string, unknown>): Promise<void> {
  const a = await access(rep, dealId);
  const allowed = new Set<string>([...REP_FIELDS, ...(a.show_value ? ["value_amount", "currency"] : [])]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.has(k)) throw new UserError(`You cannot change ${k.replace(/_/g, " ")} here.`);
    out[k] = clean(v);
  }
  if (!Object.keys(out).length) throw new UserError("Nothing to change.");
  await updateDeal(dealId, out, { cause: "manual" });
}

export async function repUpdateContact(rep: Rep, dealId: number, patch: Record<string, unknown>): Promise<void> {
  await access(rep, dealId);
  const d = (await one<{ person_id: number | null; company_id: number | null }>("select person_id, company_id from sales_deals where id = $1", [dealId]))!;
  const person: Record<string, unknown> = {};
  const company: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k.startsWith("company.")) {
      const f = k.slice(8);
      if (!(COMPANY_FIELDS as readonly string[]).includes(f)) throw new UserError("You cannot change that.");
      company[f] = clean(v, 500) || null;
    } else {
      if (!(PERSON_FIELDS as readonly string[]).includes(k)) throw new UserError("You cannot change that.");
      person[k] = k === "emails" || k === "phones" ? (Array.isArray(v) ? v : String(v ?? "").split(",")).map((x) => String(x).trim()).filter(Boolean).slice(0, 10) : k === "is_decision_maker" ? v === true : clean(v, 500) || null;
    }
  }
  if (Object.keys(person).length) {
    if (!d.person_id) throw new UserError("This lead has no contact yet.");
    if ("full_name" in person && !person.full_name) throw new UserError("A contact needs a name.");
    const keys = Object.keys(person);
    await q(`update sales_people set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1`, [d.person_id, ...keys.map((k) => person[k])]);
  }
  if (Object.keys(company).length) {
    if (!d.company_id) throw new UserError("This lead has no company yet.");
    if ("name" in company && !company.name) throw new UserError("A company needs a name.");
    if (company.website) company.domain = domainOf(String(company.website));
    const keys = Object.keys(company);
    await q(`update sales_companies set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1`, [d.company_id, ...keys.map((k) => company[k])]);
  }
}

export async function repMoveStage(rep: Rep, dealId: number, stageId: number, o: { reason?: string | null; date?: string | null; note?: string | null }): Promise<void> {
  await access(rep, dealId);
  await moveDeal(dealId, Number(stageId), { cause: "manual", reason: o.reason ?? null, date: o.date ?? null, note: o.note ?? null });
}

export async function repLogActivity(rep: Rep, dealId: number, a: { type: string; body: string; direction?: string; occurred_at?: string | null; outcome?: string | null; duration_min?: number | null }): Promise<number> {
  await access(rep, dealId);
  const body = String(a.body ?? "").trim();
  if (!body) throw new UserError("Write what happened.");
  const person = (await one<{ person_id: number | null }>("select person_id from sales_deals where id = $1", [dealId]))?.person_id ?? null;
  return logActivity(dealId, { type: a.type || "note", body: body.slice(0, 12_000), direction: (a.direction as Direction) || undefined, occurred_at: a.occurred_at ?? null, outcome: a.outcome ?? null, duration_min: a.duration_min ?? null, person_id: person });
}

export async function repDeleteActivity(rep: Rep, id: number): Promise<void> {
  const r = await one<{ deal_id: number }>("select deal_id from sales_interactions where id = $1 and author_user = $2", [id, rep.id]);
  if (!r) throw new NotFound();
  await access(rep, r.deal_id);
  await q("delete from sales_interactions where id = $1 and author_user = $2", [id, rep.id]);
}

export async function repAddPromise(rep: Rep, dealId: number, p: { owner: string; text: string; due?: string | null }): Promise<void> {
  await access(rep, dealId);
  const text = String(p.text ?? "").trim();
  if (!text) throw new UserError("Write the promise.");
  await addCommitment({ deal_id: dealId, owner: p.owner === "them" ? "them" : "me", text: text.slice(0, 500), due_at: p.due && /^\d{4}-\d{2}-\d{2}/.test(p.due) ? `${p.due.slice(0, 10)}T12:30:00.000Z` : null });
}

export async function repSetPromise(rep: Rep, id: number, status: string): Promise<void> {
  const k = await one<{ deal_id: number }>(`select deal_id from sales_commitments k where id = $1 and ${visible("k", "$2")}`, [id, rep.id]);
  if (!k) throw new NotFound();
  await access(rep, k.deal_id);
  if (!["open", "done", "dropped"].includes(status)) throw new UserError("Pick done, open or dropped.");
  await setCommitment(id, status as "open" | "done" | "dropped");
}

// ---------------------------------------------------------------- a screenshot, pasted chat or note on one of their leads

const hash = (s: string) => createHash("sha1").update(s).digest("hex");

/** AI reads it and files it on this lead only: messages, promises, empty fields. Never touches any other record. */
export async function repCapture(rep: Rep, dealId: number, input: { text?: string; images?: string[] }): Promise<{ logged: number; promises: number; filled: string[]; already: number; summary: string; shots: number }> {
  await access(rep, dealId);
  const text = String(input.text ?? "").slice(0, 60_000);
  const images = (input.images ?? []).filter((x) => typeof x === "string" && x.startsWith("data:image/") && x.length <= 4_000_000).slice(0, 4);
  if (!text.trim() && !images.length) throw new UserError("Paste a chat or add a screenshot first.");
  const cfg = await salesConfig();
  const tz = (await getSettings()).timezone;
  const d = (await one<Record<string, unknown> & { person_id: number | null }>("select * from sales_deals where id = $1", [dealId]))!;
  const ext = await extract(cfg, tz, text || "(see image)", images, null, `SOURCE: a salesperson's capture on the lead "${String(d.title)}"`);
  const cap = await one<{ id: number }>("insert into sales_captures (source, text, images, hints, status, deal_id) values ('team', $1, $2, $3, 'done', $4) returning id", [text || null, JSON.stringify(images), JSON.stringify({ deal_id: dealId }), dealId]);
  // the same chat twice is not logged twice (per lead)
  const msgs = ext.messages ?? [];
  const keys = msgs.map((m) => hash(`team|${dealId}|${m.from}|${m.text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 500)}`));
  const seen = new Set((await q<{ hash: string }>("select hash from sales_seen where hash = any($1)", [keys])).map((r) => r.hash));
  const fresh = msgs.filter((_, i) => !seen.has(keys[i]));
  if (keys.length) await q("insert into sales_seen (hash) select unnest($1::text[]) on conflict do nothing", [keys]);
  let logged = 0;
  const channel = ["whatsapp", "email", "linkedin", "instagram", "call", "meeting", "sms"].includes(String(ext.channel)) ? String(ext.channel) : "note";
  for (const dir of ["in", "out"] as const) {
    const group = fresh.filter((m) => (dir === "in" ? m.from === "them" : m.from === "me"));
    if (!group.length) continue;
    await logInteraction({ deal_id: dealId, person_id: d.person_id, channel: channel as never, direction: dir, occurred_at: null, body: group.map((m) => `${m.from === "me" ? "Me" : "Them"}: ${m.text}`).join("\n").slice(0, 12_000), summary: ext.summary, source: "team", capture_id: cap!.id, external_id: `team:${cap!.id}:${dir}` });
    logged += group.length;
  }
  if (!msgs.length && !(keys.length && !fresh.length)) {
    await logInteraction({ deal_id: dealId, person_id: d.person_id, channel: channel as never, direction: (ext.direction as Direction) ?? "both", occurred_at: null, body: text.slice(0, 12_000) || null, summary: ext.summary, source: "team", capture_id: cap!.id, external_id: `team:${cap!.id}` });
    logged = 1;
  }
  let promises = 0;
  if (fresh.length || !msgs.length) {
    for (const c of ext.commitments ?? []) {
      if (!c?.text) continue;
      await addCommitment({ deal_id: dealId, person_id: d.person_id, owner: c.owner === "them" ? "them" : "me", text: c.text.slice(0, 500), due_at: c.due && /^\d{4}-\d{2}-\d{2}/.test(c.due) ? `${c.due.slice(0, 10)}T12:30:00.000Z` : null });
      promises += 1;
    }
  }
  // empty fields only, and only the ones they may edit
  const patch: Record<string, unknown> = {};
  const det = (ext.details ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries({ requirements: ext.requirements, budget: ext.budget, timeline: ext.timeline, next_action: ext.next_step, ...det })) {
    if (!(REP_FIELDS as readonly string[]).includes(k) || k === "title") continue;
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    const cur = d[k];
    if (cur == null || cur === "" || (Array.isArray(cur) && !cur.length)) patch[k] = v;
  }
  if (Object.keys(patch).length) await updateDeal(dealId, patch, { cause: "ai" }).catch(() => {});
  if (images.length) await keepShots(cap!.id, dealId);
  return { logged, promises, filled: Object.keys(patch), already: keys.length - fresh.length, summary: ext.summary, shots: images.length };
}

// ---------------------------------------------------------------- a new lead

/** Reads a screenshot or pasted text into the new-lead form. Writes nothing. */
export async function prefillFromCapture(input: { text?: string; images?: string[] }): Promise<Partial<NewLeadInput>> {
  const text = String(input.text ?? "").slice(0, 30_000);
  const images = (input.images ?? []).filter((x) => typeof x === "string" && x.startsWith("data:image/") && x.length <= 4_000_000).slice(0, 4);
  if (!text.trim() && !images.length) throw new UserError("Paste text or add a screenshot first.");
  const ext = await extract(await salesConfig(), (await getSettings()).timezone, text || "(see image)", images, null, "SOURCE: a salesperson adding a new lead");
  const p = (ext.people ?? []).find((x) => !x.is_me) ?? {};
  return {
    person: p.name, title: p.title, phone: p.phone, email: p.email, linkedin: p.linkedin, instagram: p.instagram,
    company: ext.company?.name ?? p.company, website: ext.company?.website, city: p.city ?? ext.company?.city, country: p.country ?? ext.company?.country,
    industry: ext.company?.industry, need: ext.requirements ?? ext.summary, budget: ext.budget ?? undefined, timeline: ext.timeline ?? undefined,
    decision_maker: p.is_decision_maker ?? undefined, referrer_name: ext.referrer?.name,
  };
}

const MAX_NEW_PER_DAY = 30;

export async function repCreateLead(rep: Rep, raw: NewLeadInput): Promise<number> {
  const chk = checkNewLead(raw);
  if (!chk.ok) throw new UserError(Object.values(chk.errors)[0]);
  const s = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const today = (await one<{ n: number }>("select count(*)::int as n from sales_deals where created_by_user = $1 and created_at > now() - interval '24 hours'", [rep.id]))!.n;
  if (today >= MAX_NEW_PER_DAY) throw new UserError(`That is ${MAX_NEW_PER_DAY} new leads in a day. Work these first, or ask the owner.`);
  const phone = s(raw.phone, 40) || s(raw.whatsapp, 40);
  const email = s(raw.email, 200).toLowerCase();
  const digits = phone.replace(/\D/g, "").slice(-10);
  // the same lead twice from the same person is refused; a lead the owner already has is allowed but flagged to them
  const own = await one<{ title: string }>(
    `select d.title from sales_deal_access a join sales_deals d on d.id = a.deal_id left join sales_people p on p.id = d.person_id left join sales_companies c on c.id = d.company_id
     where a.user_id = $1 and (($2 <> '' and $2 = any(p.emails)) or ($3 <> '' and exists (select 1 from unnest(p.phones) x where right(regexp_replace(x, '\\D', '', 'g'), 10) = $3))
       or ($4 <> '' and lower(c.name) = lower($4) and lower(coalesce(p.full_name, '')) = lower($5)))`,
    [rep.id, email, digits, s(raw.company, 160), s(raw.person, 120)],
  );
  if (own) throw new UserError(`You already have this lead: ${own.title}.`);
  const dup = await one<{ title: string; id: number }>(
    `select d.id, d.title from sales_deals d left join sales_people p on p.id = d.person_id left join sales_companies c on c.id = d.company_id
     where coalesce(d.created_by_user, 0) <> $1 and (($2 <> '' and $2 = any(p.emails)) or ($3 <> '' and exists (select 1 from unnest(p.phones) x where right(regexp_replace(x, '\\D', '', 'g'), 10) = $3))
       or ($4 <> '' and lower(c.name) = lower($4))) order by d.updated_at desc limit 1`,
    [rep.id, email, digits, s(raw.company, 160)],
  );
  // their own records, never merged into yours: a salesperson must not see what you hold on someone
  const site = s(raw.website, 300);
  const url = site ? (/^https?:/i.test(site) ? site : `https://${site}`) : null;
  // a domain belongs to one company: when you already hold it, theirs keeps the website without claiming the domain
  const dom = url ? domainOf(url) : null;
  const domain = dom && !(await one("select 1 from sales_companies where lower(domain) = lower($1)", [dom])) ? dom : null;
  const company = s(raw.company, 160)
    ? (await one<{ id: number }>("insert into sales_companies (name, website, domain, city, country, industry) values ($1,$2,$3,$4,$5,$6) returning id",
        [s(raw.company, 160), url, domain, s(raw.city, 80) || null, s(raw.country, 80) || null, s(raw.industry, 80) || null]))!.id
    : null;
  const person = s(raw.person, 120)
    ? (await one<{ id: number }>(
        `insert into sales_people (full_name, title, company_id, emails, phones, whatsapp, linkedin, instagram, city, country, is_decision_maker, relationship)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [s(raw.person, 120), s(raw.title, 120) || null, company, email ? [email] : [], s(raw.phone, 40) ? [s(raw.phone, 40)] : [], s(raw.whatsapp, 40) || null,
          s(raw.linkedin, 300) || null, s(raw.instagram, 120) || null, s(raw.city, 80) || null, s(raw.country, 80) || null, raw.decision_maker ?? null,
          raw.source === "referral" ? "referral" : "cold"]))!.id
    : null;
  const src = { inbound: "inbound", referral: "referral", outbound: "outbound", linkedin: "outbound", social: "outbound", event: "network", existing_client: "repeat", partner: "partner", other: "other" }[String(raw.source)] ?? "other";
  const detail = raw.source === "referral"
    ? `Referred by ${s(raw.referrer_name, 120)} (${s(raw.referrer_type, 20)})`
    : [raw.source === "linkedin" ? "LinkedIn" : raw.source === "social" ? "Social" : null, s(raw.source_detail, 200)].filter(Boolean).join(": ") || null;
  const role = ({ new: "new", contacted: "contacted", discovery: "discovery", proposal: "proposal" } as Record<string, string>)[String(raw.status)] ?? "new";
  const stage = await one<{ id: number }>("select id from sales_stages where role = $1 and active", [role]) ?? await one<{ id: number }>("select id from sales_stages where role = 'new'");
  const title = [s(raw.company, 160), s(raw.person, 120)].filter(Boolean).join(": ");
  const deal = (await one<{ id: number }>(
    `insert into sales_deals (title, company_id, person_id, stage_id, source, source_detail, requirements, services, budget, timeline, city, country, industry,
       created_by_user, owner_id, dup_hint, pipeline_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,(select id from sales_pipelines where active order by sort, id limit 1)) returning id`,
    [title, company, person, stage!.id, src, detail, s(raw.need, 2000), (raw.services ?? []).map((x) => String(x).slice(0, 80)).slice(0, 8), s(raw.budget, 120) || null,
      s(raw.timeline, 120) || null, s(raw.city, 80) || null, s(raw.country, 80) || null, s(raw.industry, 80) || null, rep.id, rep.member_id,
      dup ? `Possibly the same as "${dup.title}" (deal ${dup.id})` : null],
  ))!.id;
  await q("insert into sales_deal_events (deal_id, kind, to_stage, cause, detail) values ($1,'created',$2,'manual',$3)", [deal, stage!.id, `added by ${rep.display_name}`]);
  if (person) await q("insert into sales_deal_people (deal_id, person_id, role) values ($1,$2,'contact') on conflict do nothing", [deal, person]);
  await q("insert into sales_deal_access (deal_id, user_id, show_value, show_research) values ($1,$2,true,true) on conflict do nothing", [deal, rep.id]);
  // deep research on what they gave: the company, then the person
  if (company) await startResearch({ subject: "company", id: company, trigger: "team" }).catch(() => {});
  if (person) await startResearch({ subject: "person", id: person, trigger: "team" }).catch(() => {});
  await enqueue("refresh_moves", { deal_id: deal }, { dedupeKey: `refresh_moves:${deal}` }).catch(() => {});
  return deal;
}
