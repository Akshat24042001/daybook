/**
 * The deal state machine. Stages and allowed transitions live in the database (editable in Sales settings).
 * Automation never targets a stage by name, only by role, so renaming or reordering stages is always safe.
 *
 * Rules:
 *   - a manual move must follow an allowed edge and satisfy its requirement (reason, revisit date, or a sent quote);
 *   - events (a reply, a meeting, a sent quote...) move deals forward automatically, only along allowed edges;
 *   - the AI may move a deal forward, but never closes one (Lost, Nurture, Disqualified always need you);
 *   - client actions (accepting a quote) and money (payments) are ground truth and may skip edges.
 */
import { one, q, UserError } from "../db";

export type Category = "open" | "won" | "lost" | "parked";
export type Requirement = "none" | "reason" | "date" | "quote";

export interface Stage {
  id: number;
  key: string;
  name: string;
  role: string | null;
  category: Category;
  probability: number;
  sla_days: number | null;
  sort: number;
  color: string;
  description: string | null;
  active: boolean;
}

export interface Transition {
  from_stage: number;
  to_stage: number;
  requires: Requirement;
}

export async function listStages(includeInactive = false): Promise<Stage[]> {
  return q<Stage>(`select * from sales_stages ${includeInactive ? "" : "where active"} order by sort, id`);
}

export async function listTransitions(): Promise<Transition[]> {
  return q<Transition>("select * from sales_transitions");
}

export async function stageByRole(role: string): Promise<Stage | null> {
  return one<Stage>("select * from sales_stages where role = $1 and active", [role]);
}

export async function allowedTargets(fromStage: number): Promise<(Stage & { requires: Requirement })[]> {
  return q(
    `select s.*, t.requires from sales_transitions t join sales_stages s on s.id = t.to_stage
     where t.from_stage = $1 and s.active order by s.sort`,
    [fromStage],
  );
}

export type DealEvent =
  | "outbound"
  | "inbound"
  | "meeting"
  | "quote_sent"
  | "quote_revised"
  | "quote_accepted"
  | "advance_paid"
  | "delivered"
  | "fully_paid"
  | "sequence_exhausted";

/** For each event: which current roles move, and to which role. */
export const EVENT_MAP: Record<DealEvent, { from: string[]; to: string; force?: boolean }> = {
  outbound: { from: ["new"], to: "contacted" },
  inbound: { from: ["new", "contacted", "ghosted", "nurture", "lost", "hold"], to: "engaged" },
  meeting: { from: ["new", "contacted", "engaged", "nurture", "hold", "ghosted"], to: "discovery" },
  quote_sent: { from: ["new", "contacted", "engaged", "discovery", "nurture", "hold", "ghosted"], to: "proposal" },
  quote_revised: { from: ["proposal"], to: "negotiation" },
  quote_accepted: { from: ["new", "contacted", "engaged", "discovery", "proposal", "negotiation", "hold", "nurture", "ghosted"], to: "won", force: true },
  advance_paid: { from: ["won", "proposal", "negotiation", "hold"], to: "active", force: true },
  delivered: { from: ["active"], to: "delivered" },
  fully_paid: { from: ["won", "active", "delivered"], to: "paid", force: true },
  sequence_exhausted: { from: ["contacted"], to: "ghosted" },
};

export interface MoveOpts {
  cause?: "manual" | "auto" | "ai" | "telegram" | "client";
  reason?: string | null;
  /** revisit date for Nurture / On hold / Ghosted */
  date?: string | null;
  note?: string | null;
  /** skip the edge and requirement checks (client actions, payments, or an explicit override with a note) */
  force?: boolean;
  interactionId?: number | null;
}

interface DealRow {
  id: number;
  stage_id: number;
}

/**
 * Checks that a manual move is allowed (an edge exists and its requirement is met) without changing anything, so a
 * caller can refuse before it writes related details. Returns the deal's current stage id and the target.
 */
export async function assertMove(dealId: number, toStage: number, o: MoveOpts = {}): Promise<{ from: number; target: Stage }> {
  const deal = await one<DealRow>("select id, stage_id from sales_deals where id = $1", [dealId]);
  if (!deal) throw new UserError("That deal no longer exists.");
  const target = await one<Stage>("select * from sales_stages where id = $1", [toStage]);
  if (!target) throw new UserError("That stage does not exist.");
  if (!o.force && deal.stage_id !== toStage) {
    const edge = await one<Transition>("select * from sales_transitions where from_stage = $1 and to_stage = $2", [deal.stage_id, toStage]);
    if (!edge) {
      const from = await one<Stage>("select * from sales_stages where id = $1", [deal.stage_id]);
      throw new UserError(`A deal cannot go from ${from?.name ?? "this stage"} to ${target.name}. Change the flow in Sales settings, or override with a note.`);
    }
    if (edge.requires === "reason" && !o.reason?.trim()) throw new UserError(`Moving to ${target.name} needs a reason.`);
    if (edge.requires === "date" && !o.date) throw new UserError(`Moving to ${target.name} needs a revisit date.`);
    if (edge.requires === "quote") {
      const sent = await one("select 1 from sales_docs where deal_id = $1 and kind in ('quote','brief','file','link') and sent_at is not null", [dealId]);
      if (!sent && !o.note?.trim()) throw new UserError(`Moving to ${target.name} needs a sent quote. Send one from the deal, or add a note (for example "sent the PDF on email").`);
    }
  }
  return { from: deal.stage_id, target };
}

/** Moves a deal, enforcing the state machine. Returns the new stage, or null when nothing changed. */
export async function moveDeal(dealId: number, toStage: number, o: MoveOpts = {}): Promise<Stage | null> {
  const { from, target } = await assertMove(dealId, toStage, o);
  if (from === toStage) return null;
  const deal = { id: dealId, stage_id: from };

  const closing = target.category === "won" || target.category === "lost";
  const revisit = o.date ?? (target.role === "ghosted" ? null : undefined);
  await q(
    `update sales_deals set stage_id = $2, stage_changed_at = now(), updated_at = now(),
       lost_reason = case when $3::text is not null then $3 else lost_reason end,
       revisit_on = case when $4::date is not null then $4::date when $6 then null else revisit_on end,
       closed_at = case when $5 then coalesce(closed_at, now()) else null end
     where id = $1`,
    [dealId, toStage, target.category === "lost" ? (o.reason ?? null) : null, revisit ?? null, closing, target.category === "open"],
  );
  await q(
    "insert into sales_deal_events (deal_id, kind, from_stage, to_stage, cause, detail, interaction_id) values ($1,'stage',$2,$3,$4,$5,$6)",
    [dealId, deal.stage_id, toStage, o.cause ?? "manual", [o.reason, o.note].filter(Boolean).join(" | ") || null, o.interactionId ?? null],
  );
  // a closed or parked deal stops chasing: its automatic moves go away
  if (target.category !== "open" && target.role !== "won") {
    await q("update sales_moves set status = 'obsolete' where deal_id = $1 and status in ('open','snoozed') and created_by = 'auto'", [dealId]);
  }
  return target;
}

/** Applies an event. Returns the new stage when the deal moved. */
export async function applyEvent(dealId: number, event: DealEvent, o: { interactionId?: number | null; note?: string | null } = {}): Promise<Stage | null> {
  const rule = EVENT_MAP[event];
  const cur = await one<{ role: string | null; stage_id: number }>(
    "select s.role, d.stage_id from sales_deals d join sales_stages s on s.id = d.stage_id where d.id = $1",
    [dealId],
  );
  if (!cur?.role || !rule.from.includes(cur.role)) return null;
  const target = await stageByRole(rule.to);
  if (!target) return null;
  if (!rule.force) {
    const edge = await one("select 1 from sales_transitions where from_stage = $1 and to_stage = $2", [cur.stage_id, target.id]);
    if (!edge) return null;
  }
  return moveDeal(dealId, target.id, {
    cause: event === "quote_accepted" ? "client" : "auto",
    force: true,
    interactionId: o.interactionId,
    note: o.note ?? `auto: ${event.replace(/_/g, " ")}`,
    date: event === "sequence_exhausted" ? null : undefined,
  });
}

// ------------------------------------------------------------------ editing the flow

export async function saveStage(s: Partial<Stage> & { name: string; category: Category }): Promise<number> {
  if (s.id) {
    await q(
      `update sales_stages set name = $2, category = $3, probability = $4, sla_days = $5, sort = $6, color = $7, description = $8, active = $9 where id = $1`,
      [s.id, s.name, s.category, s.probability ?? 0, s.sla_days ?? null, s.sort ?? 0, s.color ?? "#2F55E4", s.description ?? null, s.active ?? true],
    );
    return s.id;
  }
  const key = `${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "stage"}_${Date.now().toString(36)}`;
  const row = await one<{ id: number }>(
    `insert into sales_stages (key, name, category, probability, sla_days, sort, color, description) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [key, s.name, s.category, s.probability ?? 0, s.sla_days ?? null, s.sort ?? 999, s.color ?? "#2F55E4", s.description ?? null],
  );
  return row!.id;
}

export async function setTransition(from: number, to: number, requires: Requirement | null): Promise<void> {
  if (from === to) return;
  if (requires === null) {
    await q("delete from sales_transitions where from_stage = $1 and to_stage = $2", [from, to]);
    return;
  }
  await q(
    `insert into sales_transitions (from_stage, to_stage, requires) values ($1,$2,$3)
     on conflict (from_stage, to_stage) do update set requires = excluded.requires`,
    [from, to, requires],
  );
}

export async function deleteStage(id: number): Promise<void> {
  const used = await one<{ n: number }>("select count(*)::int as n from sales_deals where stage_id = $1", [id]);
  if (used && used.n > 0) throw new UserError(`${used.n} deal(s) are in this stage. Move them first, or switch the stage off instead.`);
  const st = await one<Stage>("select * from sales_stages where id = $1", [id]);
  if (st?.role) throw new UserError("Built-in stages drive the automation. Rename or switch them off instead of deleting.");
  await q("delete from sales_stages where id = $1", [id]);
}
