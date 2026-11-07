/** Formatting helpers usable on both the server and the client. */
export function ago(d: string | Date | null | undefined): string {
  if (!d) return "never";
  const ms = Date.now() - new Date(d).getTime();
  const future = ms < 0;
  const a = Math.abs(ms);
  const m = Math.round(a / 60_000);
  const txt = m < 1 ? "now" : m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  return txt === "now" ? "now" : future ? `in ${txt}` : `${txt} ago`;
}

/** The currencies you can pick for a deal, a quote, a package or your reports. INR first: it is the default. */
export const CURRENCIES = ["INR", "USD", "AED", "GBP", "EUR", "CAD", "AUD", "SGD", "SAR", "CNY"];

/**
 * Amounts are added up in USD internally (each deal keeps its own currency; value_usd is the common unit), and shown in
 * your report currency. fx is "1 unit of currency = x USD" (Sales settings > Currency rates).
 */
export function fromUsd(usd: number, cur: string, fx: Record<string, number>): number {
  const rate = fx[(cur || "USD").toUpperCase()];
  return rate && rate > 0 ? usd / rate : usd;
}
export function toUsd(amount: number, cur: string, fx: Record<string, number>): number {
  const rate = fx[(cur || "USD").toUpperCase()];
  return rate && rate > 0 ? amount * rate : amount;
}

const SYMBOL: Record<string, string> = { INR: "₹", USD: "$", GBP: "£", EUR: "€", CAD: "CA$", AUD: "A$", SGD: "S$", CNY: "CN¥" };

/** The symbol for a currency (₹ for INR), or its code where there is no common one (AED, SAR). */
export function currencySymbol(cur: string | null | undefined): string {
  const c = (cur || "INR").toUpperCase();
  return SYMBOL[c] ?? c;
}

/** How a currency reads in a picker: "₹ INR", "$ USD", "AED". */
export function currencyLabel(cur: string): string {
  const c = cur.toUpperCase();
  return SYMBOL[c] ? `${SYMBOL[c]} ${c}` : c;
}

export function money(n: number | null | undefined, cur = "INR"): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "";
  const v = Number(n);
  const c = (cur || "INR").toUpperCase();
  return `${SYMBOL[c] ?? `${c} `}${v.toLocaleString(c === "INR" ? "en-IN" : "en-US", { maximumFractionDigits: 0 })}`;
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
