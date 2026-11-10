/** Line item maths, client-safe: amounts per line, and totals split into one-time and per-month recurring. */
export type Billing = "one_time" | "monthly" | "quarterly" | "yearly";
export const BILLINGS: [Billing, string][] = [["one_time", "One-time"], ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["yearly", "Yearly"]];

export interface DealItem {
  id: number;
  deal_id: number;
  name: string;
  description: string | null;
  qty: number;
  unit_price: number;
  discount_pct: number;
  tax_pct: number;
  billing: Billing;
  sort: number;
}

export interface ItemTotals {
  /** one-time items */
  one_time: { subtotal: number; discount: number; tax: number; total: number };
  /** recurring items, per month (quarterly / 3, yearly / 12) */
  monthly: { subtotal: number; discount: number; tax: number; total: number };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A line's amounts: before discount, the discount, the tax on what is left, and the total. */
export function lineAmounts(i: Pick<DealItem, "qty" | "unit_price" | "discount_pct" | "tax_pct">): { gross: number; discount: number; tax: number; total: number } {
  const gross = Number(i.qty) * Number(i.unit_price);
  const discount = (gross * Number(i.discount_pct)) / 100;
  const tax = ((gross - discount) * Number(i.tax_pct)) / 100;
  return { gross: r2(gross), discount: r2(discount), tax: r2(tax), total: r2(gross - discount + tax) };
}

export function itemTotals(items: Pick<DealItem, "qty" | "unit_price" | "discount_pct" | "tax_pct" | "billing">[]): ItemTotals {
  const z = () => ({ subtotal: 0, discount: 0, tax: 0, total: 0 });
  const t: ItemTotals = { one_time: z(), monthly: z() };
  for (const i of items) {
    const a = lineAmounts(i);
    const per = i.billing === "monthly" ? 1 : i.billing === "quarterly" ? 1 / 3 : i.billing === "yearly" ? 1 / 12 : 0;
    const bucket = i.billing === "one_time" ? t.one_time : t.monthly;
    const f = i.billing === "one_time" ? 1 : per;
    bucket.subtotal += a.gross * f;
    bucket.discount += a.discount * f;
    bucket.tax += a.tax * f;
    bucket.total += a.total * f;
  }
  for (const b of [t.one_time, t.monthly]) for (const k of Object.keys(b) as (keyof typeof b)[]) b[k] = r2(b[k]);
  return t;
}

