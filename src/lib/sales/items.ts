/**
 * What a deal is made of: line items with quantity, price, discount and GST, each one-time or recurring. The totals
 * can set the deal's value (one-time) and its recurring amount (per month), and a quote can start from them.
 */
import { one, q, UserError } from "../db";
import { updateDeal } from "./deals";

import { BILLINGS, itemTotals, type Billing, type DealItem, type ItemTotals } from "./items-calc";
export { BILLINGS, itemTotals, lineAmounts, type Billing, type DealItem, type ItemTotals } from "./items-calc";

export async function listItems(dealId: number): Promise<DealItem[]> {
  return q<DealItem>(
    "select id, deal_id, name, description, qty::float as qty, unit_price::float as unit_price, discount_pct::float as discount_pct, tax_pct::float as tax_pct, billing, sort from sales_deal_items where deal_id = $1 order by sort, id",
    [dealId],
  );
}

function num(v: unknown, label: string, max?: number): number {
  const n = Number(String(v ?? "").replace(/[,\s₹$%]/g, "") || 0);
  if (!Number.isFinite(n) || n < 0) throw new UserError(`${label} needs a number, 0 or more.`);
  if (max !== undefined && n > max) throw new UserError(`${label} cannot be over ${max}.`);
  return n;
}

export async function saveItem(dealId: number, i: { id?: number; name: string; description?: string | null; qty?: unknown; unit_price?: unknown; discount_pct?: unknown; tax_pct?: unknown; billing?: string }): Promise<number> {
  const name = i.name?.trim();
  if (!name) throw new UserError("Give the item a name.");
  const billing = (BILLINGS.find(([b]) => b === i.billing)?.[0] ?? "one_time") as Billing;
  const vals = [name.slice(0, 300), i.description?.trim() || null, num(i.qty ?? 1, "Quantity"), num(i.unit_price, "Price"), num(i.discount_pct, "Discount %", 100), num(i.tax_pct, "GST / tax %", 100), billing];
  if (i.id) {
    const row = await one<{ id: number }>(
      "update sales_deal_items set name = $3, description = $4, qty = $5, unit_price = $6, discount_pct = $7, tax_pct = $8, billing = $9 where id = $1 and deal_id = $2 returning id",
      [i.id, dealId, ...vals],
    );
    if (!row) throw new UserError("That item no longer exists.");
    return row.id;
  }
  const row = await one<{ id: number }>(
    `insert into sales_deal_items (deal_id, name, description, qty, unit_price, discount_pct, tax_pct, billing, sort)
     values ($1,$2,$3,$4,$5,$6,$7,$8,(select coalesce(max(sort),0)+10 from sales_deal_items where deal_id = $1)) returning id`,
    [dealId, ...vals],
  );
  return row!.id;
}

export async function deleteItem(dealId: number, id: number): Promise<void> {
  await q("delete from sales_deal_items where id = $1 and deal_id = $2", [id, dealId]);
}

/** Sets the deal's value from the one-time total and its recurring amount from the monthly total (both recorded). */
export async function applyItemTotals(dealId: number): Promise<ItemTotals> {
  const items = await listItems(dealId);
  if (!items.length) throw new UserError("Add an item first.");
  const t = itemTotals(items);
  const patch: Record<string, unknown> = {};
  if (t.one_time.total > 0) patch.value_amount = t.one_time.total;
  if (t.monthly.total > 0) { patch.recurring_amount = t.monthly.total; patch.billing_cycle = "monthly"; }
  if (Object.keys(patch).length) await updateDeal(dealId, patch);
  return t;
}

/** Adds every line of an offer package to the deal (with your default GST). */
export async function addPackageItems(dealId: number, pkg: { items: { name: string; description: string; qty: number; unit_price: number }[] }, taxPct: number): Promise<number> {
  let n = 0;
  for (const it of pkg.items) {
    await saveItem(dealId, { name: it.name, description: it.description, qty: it.qty, unit_price: it.unit_price, tax_pct: taxPct, billing: "one_time" });
    n++;
  }
  return n;
}
