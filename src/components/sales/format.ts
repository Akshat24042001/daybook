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

export function money(n: number | null | undefined, cur = "USD"): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "";
  const v = Number(n);
  const sym: Record<string, string> = { USD: "$", INR: "₹", GBP: "£", EUR: "€", AED: "AED ", CAD: "CA$", AUD: "A$", SGD: "S$", SAR: "SAR " };
  return `${sym[cur] ?? `${cur} `}${v.toLocaleString(cur === "INR" ? "en-IN" : "en-US", { maximumFractionDigits: 0 })}`;
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
