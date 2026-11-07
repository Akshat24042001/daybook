/** Deals, interactions, commitments and payments: the records everything else reads. */
import { one, q, UserError } from "../db";
import { salesConfig, toUsd } from "./config";
import { applyEvent, stageByRole, type Stage } from "./stages";

export type Channel =
  | "email" | "whatsapp" | "linkedin" | "instagram" | "call" | "meeting" | "in_person" | "telegram" | "sms" | "twitter" | "document" | "other" | "note";
export const CHANNELS: Channel[] = ["whatsapp", "email", "linkedin", "call", "meeting", "in_person", "instagram", "twitter", "sms", "telegram", "document", "note", "other"];
export type Direction = "in" | "out" | "both" | "internal";

export interface DealRow {
  id: number;
  title: string;
  company_id: number | null;
  person_id: number | null;
  stage_id: number;
  source: string;
  source_detail: string | null;
  referrer_id: number | null;
  intermediary_id: number | null;
  intermediary_type: string | null;
  talk_via_intermediary: boolean;
  commission_type: string | null;
  commission_value: number | null;
  value_amount: number | null;
  currency: string;
  value_usd: number | null;
  probability: number | null;
  expected_close: string | null;
  services: string[];
  country: string | null;
  next_action: string | null;
  next_action_at: string | null;
  heat: number;
  priority: number;
  priority_prev: number | null;
  priority_why: string[];
  summary: string | null;
  requirements: string | null;
  budget: string | null;
  timeline: string | null;
  objections: string[];
  last_touch_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  stage_changed_at: string;
  lost_reason: string | null;
  revisit_on: string | null;
  sequence_paused: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface DealCard extends DealRow {
  stage_name: string;
  stage_role: string | null;
  stage_category: string;
  stage_probability: number;
  stage_color: string;
  stage_sla: number | null;
  company_name: string | null;
  person_name: string | null;
  person_title: string | null;
  referrer_name: string | null;
  intermediary_name: string | null;
  open_moves: number;
  last_channel: string | null;
}

export const DEAL_CARD_SQL = `
  select d.*, s.name as stage_name, s.role as stage_role, s.category as stage_category, s.probability as stage_probability,
         s.color as stage_color, s.sla_days as stage_sla,
         c.name as company_name, p.full_name as person_name, p.title as person_title,
         r.full_name as referrer_name, im.full_name as intermediary_name,
         (select count(*)::int from sales_moves m where m.deal_id = d.id and m.status = 'open') as open_moves,
         (select i.channel from sales_interactions i where i.deal_id = d.id and i.direction <> 'internal' order by i.occurred_at desc limit 1) as last_channel
  from sales_deals d
  join sales_stages s on s.id = d.stage_id
  left join sales_companies c on c.id = d.company_id
  left join sales_people p on p.id = d.person_id
  left join sales_people r on r.id = d.referrer_id
  left join sales_people im on im.id = d.intermediary_id`;

export async function listDeals(where = "true", params: unknown[] = []): Promise<DealCard[]> {
  return q<DealCard>(`${DEAL_CARD_SQL} where ${where} order by d.priority desc, d.updated_at desc`, params);
}

export async function getDeal(id: number): Promise<DealCard | null> {
  return one<DealCard>(`${DEAL_CARD_SQL} where d.id = $1`, [id]);
}

export interface NewDeal {
  title?: string | null;
  company_id?: number | null;
  person_id?: number | null;
  source?: string;
  source_detail?: string | null;
  stage_role?: string;
  value_amount?: number | null;
  currency?: string | null;
  services?: string[];
  country?: string | null;
  referrer_id?: number | null;
  intermediary_id?: number | null;
  intermediary_type?: string | null;
  radar_item_id?: number | null;
  requirements?: string | null;
}

export async function createDeal(d: NewDeal): Promise<number> {
  const cfg = await salesConfig();
  const stage = (await stageByRole(d.stage_role ?? "new")) ?? (await one<Stage>("select * from sales_stages where active order by sort limit 1"));
  if (!stage) throw new UserError("No sales stages configured.");
  let title = d.title?.trim();
  if (!title) {
    const names = await one<{ c: string | null; p: string | null }>(
      "select (select name from sales_companies where id = $1) as c, (select full_name from sales_people where id = $2) as p",
      [d.company_id ?? null, d.person_id ?? null],
    );
    title = names?.c ?? names?.p ?? "New deal";
  }
  const currency = (d.currency ?? cfg.default_currency).toUpperCase();
  const row = await one<{ id: number }>(
    `insert into sales_deals (title, company_id, person_id, stage_id, source, source_detail, value_amount, currency, value_usd,
       services, country, referrer_id, intermediary_id, intermediary_type, radar_item_id, requirements)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
    [title, d.company_id ?? null, d.person_id ?? null, stage.id, d.source ?? "outbound", d.source_detail ?? null, d.value_amount ?? null,
      currency, toUsd(cfg, d.value_amount, currency), d.services ?? [], d.country ?? null, d.referrer_id ?? null, d.intermediary_id ?? null,
      d.intermediary_type ?? null, d.radar_item_id ?? null, d.requirements ?? null],
  );
  const id = row!.id;
  await q("insert into sales_deal_events (deal_id, kind, to_stage, cause, detail) values ($1,'created',$2,'manual',$3)", [id, stage.id, d.source ?? null]);
  if (d.person_id) await q("insert into sales_deal_people (deal_id, person_id, role) values ($1,$2,'contact') on conflict do nothing", [id, d.person_id]);
  if (d.referrer_id) await q("insert into sales_deal_people (deal_id, person_id, role) values ($1,$2,'referrer') on conflict do nothing", [id, d.referrer_id]);
  if (d.intermediary_id) await q("insert into sales_deal_people (deal_id, person_id, role) values ($1,$2,'intermediary') on conflict do nothing", [id, d.intermediary_id]);
  return id;
}

const EDITABLE = new Set([
  "title", "company_id", "person_id", "source", "source_detail", "referrer_id", "intermediary_id", "intermediary_type", "talk_via_intermediary",
  "commission_type", "commission_value", "value_amount", "currency", "probability", "expected_close", "services", "country", "next_action",
  "next_action_at", "summary", "requirements", "budget", "timeline", "objections", "revisit_on", "sequence_paused", "tags",
]);

export async function updateDeal(id: number, patch: Record<string, unknown>): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [k, v] of Object.entries(patch)) {
    if (!EDITABLE.has(k)) continue;
    params.push(v === "" ? null : v);
    sets.push(`${k} = $${params.length}`);
  }
  if (!sets.length) return;
  await q(`update sales_deals set ${sets.join(", ")}, updated_at = now() where id = $1`, params);
  if ("value_amount" in patch || "currency" in patch) {
    const cfg = await salesConfig();
    const d = await one<{ value_amount: number | null; currency: string }>("select value_amount, currency from sales_deals where id = $1", [id]);
    if (d) await q("update sales_deals set value_usd = $2 where id = $1", [id, toUsd(cfg, d.value_amount, d.currency)]);
  }
  if ("referrer_id" in patch && patch.referrer_id) await q("insert into sales_deal_people (deal_id, person_id, role) values ($1,$2,'referrer') on conflict do nothing", [id, patch.referrer_id]);
  if ("intermediary_id" in patch && patch.intermediary_id) await q("insert into sales_deal_people (deal_id, person_id, role) values ($1,$2,'intermediary') on conflict do nothing", [id, patch.intermediary_id]);
}

export async function deleteDeal(id: number): Promise<void> {
  await q("delete from sales_deals where id = $1", [id]);
}

/** The deal a person's new message belongs to: their latest open deal, else their latest deal of any kind. */
export async function dealForPerson(personId: number): Promise<number | null> {
  const row = await one<{ id: number }>(
    `select d.id from sales_deals d join sales_stages s on s.id = d.stage_id
     where d.person_id = $1 or d.id in (select deal_id from sales_deal_people where person_id = $1)
     order by (s.category in ('open','won')) desc, d.updated_at desc limit 1`,
    [personId],
  );
  return row?.id ?? null;
}

// ------------------------------------------------------------------ interactions

export interface NewInteraction {
  deal_id?: number | null;
  person_id?: number | null;
  company_id?: number | null;
  channel: Channel;
  direction: Direction;
  occurred_at?: Date | string | null;
  subject?: string | null;
  body?: string | null;
  summary?: string | null;
  source: string;
  confidence?: "sure" | "assumed";
  external_id?: string | null;
  capture_id?: number | null;
  extracted?: unknown;
  /** sent from a move: which one, what kind ("follow_up:2"), whether an AI draft existed and whether you changed it */
  move_id?: number | null;
  move_kind?: string | null;
  drafted?: boolean | null;
  edited?: boolean | null;
}

/** Logs one touch, keeps the deal's last-touch clocks right, and moves the deal along the state machine. */
export async function logInteraction(i: NewInteraction): Promise<{ id: number; moved: Stage | null } | null> {
  let companyId = i.company_id ?? null;
  if (!companyId && i.deal_id) companyId = (await one<{ company_id: number | null }>("select company_id from sales_deals where id = $1", [i.deal_id]))?.company_id ?? null;
  const row = await one<{ id: number }>(
    `insert into sales_interactions (deal_id, person_id, company_id, channel, direction, occurred_at, subject, body, summary, source, confidence, external_id, capture_id, extracted,
                                     move_id, move_kind, drafted, edited)
     values ($1,$2,$3,$4,$5,coalesce($6::timestamptz, now()),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     on conflict (external_id) do nothing returning id`,
    [i.deal_id ?? null, i.person_id ?? null, companyId, i.channel, i.direction, i.occurred_at ?? null, i.subject ?? null, i.body ?? null,
      i.summary ?? null, i.source, i.confidence ?? "sure", i.external_id ?? null, i.capture_id ?? null, i.extracted ? JSON.stringify(i.extracted) : null,
      i.move_id ?? null, i.move_kind ?? null, i.drafted ?? null, i.edited ?? null],
  );
  if (!row) return null; // already logged (same external id)
  let moved: Stage | null = null;
  if (i.deal_id && i.direction !== "internal") {
    const at = i.occurred_at ? new Date(i.occurred_at).toISOString() : new Date().toISOString();
    const inbound = i.direction === "in" || i.direction === "both";
    const outbound = i.direction === "out" || i.direction === "both";
    await q(
      `update sales_deals set
         last_touch_at = greatest(coalesce(last_touch_at, $2::timestamptz), $2::timestamptz),
         last_inbound_at = case when $3 then greatest(coalesce(last_inbound_at, $2::timestamptz), $2::timestamptz) else last_inbound_at end,
         last_outbound_at = case when $4 then greatest(coalesce(last_outbound_at, $2::timestamptz), $2::timestamptz) else last_outbound_at end,
         updated_at = now()
       where id = $1`,
      [i.deal_id, at, inbound, outbound],
    );
    if (inbound) moved = await applyEvent(i.deal_id, "inbound", { interactionId: row.id });
    if (!moved && outbound) moved = await applyEvent(i.deal_id, "outbound", { interactionId: row.id });
    if (i.channel === "meeting" || i.channel === "in_person" || i.channel === "call") {
      moved = (await applyEvent(i.deal_id, "meeting", { interactionId: row.id })) ?? moved;
    }
  }
  return { id: row.id, moved };
}

export interface InteractionRow {
  id: number;
  deal_id: number | null;
  person_id: number | null;
  person_name: string | null;
  channel: Channel;
  direction: Direction;
  occurred_at: string;
  subject: string | null;
  body: string | null;
  summary: string | null;
  source: string;
  confidence: string;
}

export async function timeline(dealId: number, limit = 200): Promise<InteractionRow[]> {
  return q<InteractionRow>(
    `select i.id, i.deal_id, i.person_id, p.full_name as person_name, i.channel, i.direction, i.occurred_at, i.subject, i.body, i.summary, i.source, i.confidence
     from sales_interactions i left join sales_people p on p.id = i.person_id
     where i.deal_id = $1 order by i.occurred_at desc limit $2`,
    [dealId, limit],
  );
}

/** When you last touched this deal on each channel, newest first. */
export async function lastTouchByChannel(dealId: number): Promise<{ channel: Channel; last_at: string; last_in: string | null; count: number }[]> {
  return q(
    `select channel, max(occurred_at) as last_at, max(occurred_at) filter (where direction in ('in','both')) as last_in, count(*)::int as count
     from sales_interactions where deal_id = $1 and direction <> 'internal' group by channel order by 2 desc`,
    [dealId],
  );
}

// ------------------------------------------------------------------ commitments

export interface CommitmentRow {
  id: number;
  deal_id: number | null;
  person_id: number | null;
  owner: "me" | "them";
  text: string;
  due_at: string | null;
  status: string;
  created_at: string;
}

export async function addCommitment(c: { deal_id: number | null; person_id?: number | null; owner: "me" | "them"; text: string; due_at?: string | null; interaction_id?: number | null }): Promise<number | null> {
  // the same promise extracted twice (a re-sent chat) is stored once
  const dup = await one<{ id: number }>(
    "select id from sales_commitments where deal_id is not distinct from $1 and owner = $2 and lower(text) = lower($3) and status = 'open'",
    [c.deal_id, c.owner, c.text.trim()],
  );
  if (dup) return dup.id;
  const row = await one<{ id: number }>(
    "insert into sales_commitments (deal_id, person_id, owner, text, due_at, interaction_id) values ($1,$2,$3,$4,$5,$6) returning id",
    [c.deal_id, c.person_id ?? null, c.owner, c.text.trim(), c.due_at ?? null, c.interaction_id ?? null],
  );
  return row?.id ?? null;
}

export async function setCommitment(id: number, status: "open" | "done" | "dropped"): Promise<void> {
  await q("update sales_commitments set status = $2, done_at = case when $2 = 'open' then null else now() end where id = $1", [id, status]);
  if (status !== "open") await q("update sales_moves set status = 'done', done_at = now() where dedupe_key in ($1, $2) and status in ('open','snoozed')", [`cm:${id}`, `ct:${id}`]);
}

export async function commitments(dealId: number): Promise<CommitmentRow[]> {
  return q<CommitmentRow>("select * from sales_commitments where deal_id = $1 order by status = 'open' desc, due_at nulls last, created_at desc", [dealId]);
}

// ------------------------------------------------------------------ payments

export interface PaymentRow {
  id: number;
  deal_id: number;
  label: string;
  amount: number;
  currency: string;
  due_on: string | null;
  paid_on: string | null;
  status: "due" | "paid" | "written_off";
  note: string | null;
}

export async function payments(dealId: number): Promise<PaymentRow[]> {
  return q<PaymentRow>("select * from sales_payments where deal_id = $1 order by coalesce(due_on, paid_on), id", [dealId]);
}

export async function addPayment(p: { deal_id: number; label: string; amount: number; currency: string; due_on?: string | null }): Promise<number> {
  const row = await one<{ id: number }>(
    "insert into sales_payments (deal_id, label, amount, currency, due_on) values ($1,$2,$3,$4,$5) returning id",
    [p.deal_id, p.label, p.amount, p.currency.toUpperCase(), p.due_on ?? null],
  );
  return row!.id;
}

/** Marks a payment paid and lets money drive the stage: first payment makes it Live, the last makes it Paid. */
export async function markPaid(id: number, paidOn: string, status: "paid" | "written_off" | "due" = "paid"): Promise<void> {
  const p = await one<PaymentRow>("update sales_payments set status = $2, paid_on = case when $2 = 'due' then null else $3::date end where id = $1 returning *", [id, status, paidOn]);
  if (!p) return;
  await q("update sales_moves set status = 'done', done_at = now() where dedupe_key = $1 and status in ('open','snoozed')", [`pay:${id}`]);
  if (status === "due") return;
  const left = await one<{ due: number; paid: number }>(
    "select count(*) filter (where status = 'due')::int as due, count(*) filter (where status = 'paid')::int as paid from sales_payments where deal_id = $1",
    [p.deal_id],
  );
  if (left && left.due === 0) await applyEvent(p.deal_id, "fully_paid");
  else await applyEvent(p.deal_id, "advance_paid");
}

export async function deletePayment(id: number): Promise<void> {
  await q("delete from sales_payments where id = $1", [id]);
}

// ------------------------------------------------------------------ heat

/** Priority and heat (kept equal) for all deals, or one deal and its company. See priority.ts. */
export async function refreshHeat(dealId?: number): Promise<void> {
  const { refreshPriorities } = await import("./priority");
  await refreshPriorities(dealId);
}
