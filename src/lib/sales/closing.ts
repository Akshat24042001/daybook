/**
 * Closing a deal properly. Every move that ends or parks a deal asks for what you will want to know later:
 *
 * - Won: who you work with (point of contact), the final amount, when it starts and is delivered, the exact scope, the
 *   payment terms, why they chose you, and any of your own fields marked "needed to win". An advance percentage sets up
 *   the advance and balance payments. Signed papers are attached on the deal after.
 * - Lost: why (a fixed list you can edit), who it went to, what happened, the lesson, and optionally a date to try again.
 * - Disqualified: why it was never a real deal.
 * - Parked (Nurture, On hold, Ghosted): why, and when to come back.
 * - Reopened (a lost, parked or won deal back to an open stage): why.
 *
 * Moves made for you (a client accepting a quote, a payment, Telegram) are not blocked: the deal page shows what the
 * closing record is missing until you fill it in.
 */
import { one, q, UserError } from "../db";
import { salesConfig } from "./config";
import { listCustomFields } from "./custom-fields";
import { addPayment, updateDeal } from "./deals";
import { closeKind, type CloseKind } from "./fields";
import { upsertPerson } from "./identity";
import { assertMove, moveDeal, type Stage } from "./stages";

export interface ClosePayload {
  reason?: string | null;
  note?: string | null;
  /** revisit date: parked deals (required) and lost deals (optional) */
  date?: string | null;
  // won
  poc_id?: number | null;
  poc_new?: { name?: string; phone?: string; email?: string; title?: string } | null;
  final_amount?: number | string | null;
  currency?: string | null;
  start_date?: string | null;
  delivery_date?: string | null;
  delivery_duration?: string | null;
  scope?: string | null;
  payment_terms?: string | null;
  advance_pct?: number | string | null;
  contract_ref?: string | null;
  won_detail?: string | null;
  competitors?: string[] | string | null;
  custom?: Record<string, unknown> | null;
  // lost
  lost_to?: string | null;
  lost_detail?: string | null;
  lessons?: string | null;
}

export { closeKind, type CloseKind } from "./fields";

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/** What a won deal's closing record still lacks (empty when complete). */
export async function closingGaps(dealId: number): Promise<string[]> {
  const d = await one<Record<string, unknown> & { category: string }>(
    "select d.*, s.category from sales_deals d join sales_stages s on s.id = d.stage_id where d.id = $1",
    [dealId],
  );
  if (!d || d.category !== "won") return [];
  const gaps: string[] = [];
  if (!d.poc_id) gaps.push("point of contact");
  if (!(Number(d.value_amount) > 0)) gaps.push("final amount");
  if (!d.delivery_date && !text(d.delivery_duration)) gaps.push("delivery date or time");
  if (!text(d.scope)) gaps.push("scope of work");
  if (!text(d.won_reason)) gaps.push("why they chose you");
  const custom = (d.custom ?? {}) as Record<string, unknown>;
  for (const f of await listCustomFields("deal")) if (f.required_to_win && (custom[f.key] === undefined || custom[f.key] === null || custom[f.key] === "")) gaps.push(f.label.toLowerCase());
  return gaps;
}

/**
 * Moves a deal by hand with everything the move needs. With complete = true it only fills in a won deal's closing
 * record (no stage change), for deals that were won by a client action or from Telegram.
 */
export async function closeDeal(dealId: number, toStageId: number | null, p: ClosePayload, o: { complete?: boolean } = {}): Promise<Stage | null> {
  const deal = await one<{ id: number; stage_id: number; currency: string; value_amount: number | null; company_id: number | null }>(
    "select id, stage_id, currency, value_amount, company_id from sales_deals where id = $1",
    [dealId],
  );
  if (!deal) throw new UserError("That deal no longer exists.");
  const from = (await one<Stage>("select * from sales_stages where id = $1", [deal.stage_id]))!;
  const to = o.complete ? from : await one<Stage>("select * from sales_stages where id = $1", [toStageId]);
  if (!to) throw new UserError("That stage does not exist.");
  const kind: CloseKind = o.complete ? "won" : closeKind(from, to);
  if (o.complete && from.category !== "won") throw new UserError("Only a won deal has a closing record to complete.");
  const cfg = await salesConfig();
  const reason = text(p.reason);
  const pick = (list: string[], label: string) => {
    if (!reason) throw new UserError(`Pick ${label}.`);
    if (!list.includes(reason)) throw new UserError(`"${reason}" is not on the list. Pick one, or add it in Sales settings > Reasons.`);
  };
  const patch: Record<string, unknown> = {};
  // every check runs before anything (a new contact, the record) is written; the flow's own rules last
  const guard = () => (o.complete ? Promise.resolve() : assertMove(dealId, to.id, { reason: reason || null, date: text(p.date) || null, note: text(p.note) || null }).then(() => undefined));

  if (kind === "won") {
    pick(cfg.reasons.won, "why they chose you");
    let poc = p.poc_id ? Number(p.poc_id) : null;
    const nu = p.poc_new;
    const newPoc = !poc && nu && (text(nu.name) || text(nu.phone) || text(nu.email));
    if (newPoc && !text(nu!.name)) throw new UserError("Give the point of contact a name.");
    if (!poc && !newPoc) throw new UserError("Who is the point of contact? Pick someone on the deal or add them.");
    if (poc && !(await one("select 1 from sales_people where id = $1", [poc]))) throw new UserError("That person no longer exists.");
    const amount = Number(String(p.final_amount ?? "").replace(/[,\s₹$]/g, ""));
    if (!(amount > 0)) throw new UserError("Enter the final amount agreed.");
    if (!text(p.delivery_date) && !text(p.delivery_duration)) throw new UserError("When will it be delivered? Give a date or a time, e.g. 6 weeks.");
    if (!text(p.scope)) throw new UserError("Write the exact scope of work, so there is no argument later about what was included.");
    const required = (await listCustomFields("deal")).filter((f) => f.required_to_win);
    for (const f of required) {
      const v = p.custom?.[f.key];
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) throw new UserError(`${f.label} is needed to close as won.`);
    }
    await guard();
    if (newPoc) poc = await upsertPerson({ name: text(nu!.name), phone: text(nu!.phone) || undefined, email: text(nu!.email) || undefined, title: text(nu!.title) || null, company_id: deal.company_id, relationship: "client" });
    Object.assign(patch, {
      poc_id: poc, value_amount: amount, currency: text(p.currency) || deal.currency, start_date: text(p.start_date) || null,
      delivery_date: text(p.delivery_date) || null, delivery_duration: text(p.delivery_duration) || null, scope: text(p.scope),
      payment_terms: text(p.payment_terms) || null, contract_ref: text(p.contract_ref) || null, won_reason: reason, won_detail: text(p.won_detail) || null,
    });
    if (p.competitors) patch.competitors = p.competitors;
    if (p.custom && Object.keys(p.custom).length) patch.custom = p.custom;
    await q("insert into sales_deal_people (deal_id, person_id, role) values ($1,$2,'contact') on conflict do nothing", [dealId, poc]);
  } else {
    if (kind === "lost") {
      pick(cfg.reasons.lost, "why it was lost");
      Object.assign(patch, { lost_to: text(p.lost_to) || null, lost_detail: text(p.lost_detail) || null, lessons: text(p.lessons) || null });
    } else if (kind === "disqualified") {
      pick(cfg.reasons.disqualified, "why it is not a real deal");
      Object.assign(patch, { lost_detail: text(p.lost_detail) || text(p.note) || null });
    } else if (kind === "parked") {
      pick(cfg.reasons.parked, "why it is parked");
      if (!text(p.date)) throw new UserError("When should you come back to it? Pick a date.");
    } else if (kind === "reopen") {
      pick(cfg.reasons.reopened, "why it is reopened");
    }
    await guard();
  }

  if (Object.keys(patch).length) await updateDeal(dealId, patch);
  let moved: Stage | null = null;
  if (!o.complete) {
    moved = await moveDeal(dealId, to.id, {
      cause: "manual", reason: reason || null, date: text(p.date) || null,
      note: [text(p.note), kind === "lost" && text(p.lost_to) ? `lost to ${text(p.lost_to)}` : ""].filter(Boolean).join(" · ") || null,
    });
    if (kind === "lost" && text(p.date)) await q("update sales_deals set revisit_on = $2 where id = $1", [dealId, text(p.date)]);
  }

  // an advance percentage sets up the advance and balance, unless payments are already planned
  const pct = Number(p.advance_pct);
  if (kind === "won" && pct > 0 && pct <= 100 && !(await one("select 1 from sales_payments where deal_id = $1", [dealId]))) {
    const amount = Number(patch.value_amount);
    const cur = String(patch.currency);
    const advance = Math.round((amount * pct) / 100);
    await addPayment({ deal_id: dealId, label: `Advance (${pct}%)`, amount: advance, currency: cur, due_on: text(p.start_date) || new Date().toISOString().slice(0, 10) });
    if (pct < 100) await addPayment({ deal_id: dealId, label: "Balance on delivery", amount: amount - advance, currency: cur, due_on: text(p.delivery_date) || null });
  }
  return moved;
}
