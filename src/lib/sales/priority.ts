/**
 * Priority: one 0 to 100 number per deal that says how much care it needs right now, and why.
 * It moves both ways, every 10 minutes:
 *   engagement  0-35  how recently THEY engaged (this deal, or anyone at the same company), halving about every 4 days
 *   momentum    0-10  replies in the last 14 days, minus a little when they are cooling compared to the 14 before
 *   intent      0-15  quote opened in the last 48 hours, a meeting in the next 3 days
 *   value       0-15  deal size on a log scale (unknown value counts as small)
 *   stage       0-15  how far along it is
 *   urgency     0-10  overdue moves, your promises due now
 *   comeback   +15    they (or their company) came back after 60+ days of silence: back to the top
 * Parked and lost deals stay low unless the person or company shows signs of life again.
 */
import { q } from "../db";

export interface PriorityRow {
  id: number;
  category: string;
  role: string | null;
  probability: number;
  value_usd: number | null;
  company: string | null;
  last_in: string | null;
  company_last_in: string | null;
  company_other_in: string | null;
  /** first reply in the last 21 days, and the last one before that window: the gap between them is the silence */
  first_recent: string | null;
  before_recent: string | null;
  in_14: number;
  in_prev_14: number;
  views_48h: number;
  meeting_soon: string | null;
  overdue_moves: number;
  promises_due: number;
  priority: number;
  priority_on: string | null;
}

const DAY = 86_400_000;
const days = (x: string | null, now: number) => (x ? (now - new Date(x).getTime()) / DAY : Infinity);
const rel = (d: number) => (d < 1 / 24 ? "just now" : d < 1 ? `${Math.round(d * 24)}h ago` : `${Math.round(d)}d ago`);

export function scoreDeal(r: PriorityRow, now = Date.now()): { score: number; why: string[] } {
  const parts: { pts: number; why: string }[] = [];
  const lastIn = Math.min(days(r.last_in, now), days(r.company_last_in, now));
  if (Number.isFinite(lastIn)) {
    const pts = 35 * Math.exp(-lastIn / 6);
    const other = r.company_other_in && days(r.company_other_in, now) <= lastIn + 0.01 && days(r.company_other_in, now) < days(r.last_in, now);
    parts.push({ pts, why: other ? `Someone else at ${r.company ?? "the company"} wrote ${rel(lastIn)}` : `They engaged ${rel(lastIn)}` });
  }
  let mom = Math.min(10, r.in_14 * 2.5);
  if (r.in_14 > 0 && r.in_14 < r.in_prev_14) {
    mom -= 3;
    parts.push({ pts: 0, why: "Cooling: fewer replies than the fortnight before" });
  }
  if (mom > 0) parts.push({ pts: mom, why: `${r.in_14} repl${r.in_14 === 1 ? "y" : "ies"} in 14 days` });
  let intent = 0;
  if (r.views_48h >= 3) {
    intent += 12;
    parts.push({ pts: 12, why: `Quote opened ${r.views_48h}x in 48h` });
  } else if (r.views_48h > 0) {
    intent += 8;
    parts.push({ pts: 8, why: "Quote opened in the last 48h" });
  }
  if (r.meeting_soon) {
    const pts = Math.min(6, 15 - intent);
    parts.push({ pts, why: `Meeting ${new Date(r.meeting_soon).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}` });
  }
  const v = r.value_usd ? Math.min(15, Math.log10(Number(r.value_usd) + 1) * 3.4) : 4;
  parts.push({ pts: v, why: r.value_usd ? `$${Math.round(Number(r.value_usd)).toLocaleString("en-US")} deal` : "Value unknown" });
  if (r.category === "open" || r.role === "won") parts.push({ pts: Math.min(15, r.probability * 0.17), why: "" });
  const urgent = Math.min(10, r.overdue_moves * 3 + r.promises_due * 4);
  if (urgent) parts.push({ pts: urgent, why: [r.overdue_moves ? `${r.overdue_moves} overdue move${r.overdue_moves > 1 ? "s" : ""}` : "", r.promises_due ? "Your promise is due" : ""].filter(Boolean).join(", ") });
  // the comeback: silence of 60+ days, then they (or their company) wrote again in the last 3 weeks
  const gapBefore = r.first_recent && r.before_recent ? days(r.before_recent, now) - days(r.first_recent, now) : 0;
  if (r.first_recent && gapBefore > 60) parts.push({ pts: 15, why: `Back after ${Math.round(gapBefore / 30)} months of silence` });

  let score = parts.reduce((s, p) => s + p.pts, 0);
  const alive = lastIn < 21;
  if ((r.category === "parked" || r.category === "lost") && !alive) score = Math.min(score, 15);
  if (["active", "delivered", "paid"].includes(r.role ?? "") && !alive && !urgent) score = Math.min(score, 25);
  const why = parts.filter((p) => p.why && (p.pts > 3 || p.pts === 0)).sort((a, b) => b.pts - a.pts).map((p) => p.why).slice(0, 4);
  return { score: Math.max(0, Math.min(100, Math.round(score))), why };
}

export function tier(score: number): { label: "Hot" | "Warm" | "Steady" | "Cold"; tone: string } {
  if (score >= 70) return { label: "Hot", tone: "bg-p-rose text-p-rose-fg" };
  if (score >= 45) return { label: "Warm", tone: "bg-p-butter text-p-butter-fg" };
  if (score >= 20) return { label: "Steady", tone: "bg-p-sky text-p-sky-fg" };
  return { label: "Cold", tone: "bg-muted text-subtle" };
}

const ROWS_SQL = `
  with inbound as (
    select i.deal_id, i.company_id, i.occurred_at from sales_interactions i where i.direction in ('in','both')
  )
  select d.id, s.category, s.role, s.probability, d.value_usd, c.name as company, d.priority, d.priority_on,
    (select max(occurred_at) from inbound x where x.deal_id = d.id) as last_in,
    (select max(occurred_at) from inbound x where d.company_id is not null and x.company_id = d.company_id) as company_last_in,
    (select max(occurred_at) from inbound x where d.company_id is not null and x.company_id = d.company_id and x.deal_id is distinct from d.id) as company_other_in,
    (select min(occurred_at) from inbound x where (x.deal_id = d.id or (d.company_id is not null and x.company_id = d.company_id)) and x.occurred_at > now() - interval '21 days') as first_recent,
    (select max(occurred_at) from inbound x where (x.deal_id = d.id or (d.company_id is not null and x.company_id = d.company_id)) and x.occurred_at <= now() - interval '21 days') as before_recent,
    (select count(*)::int from inbound x where (x.deal_id = d.id or (d.company_id is not null and x.company_id = d.company_id)) and x.occurred_at > now() - interval '14 days') as in_14,
    (select count(*)::int from inbound x where (x.deal_id = d.id or (d.company_id is not null and x.company_id = d.company_id)) and x.occurred_at between now() - interval '28 days' and now() - interval '14 days') as in_prev_14,
    (select count(*)::int from sales_doc_views v join sales_docs x on x.id = v.doc_id where x.deal_id = d.id and v.viewed_at > now() - interval '48 hours') as views_48h,
    (select min(starts_at) from sales_meetings m where m.deal_id = d.id and not m.cancelled and m.starts_at between now() and now() + interval '3 days') as meeting_soon,
    (select count(*)::int from sales_moves m where m.deal_id = d.id and m.status = 'open' and m.due_at < now() - interval '12 hours') as overdue_moves,
    (select count(*)::int from sales_commitments k where k.deal_id = d.id and k.owner = 'me' and k.status = 'open' and k.due_at < now() + interval '1 day') as promises_due
  from sales_deals d join sales_stages s on s.id = d.stage_id left join sales_companies c on c.id = d.company_id
  where ($1::int is null or d.id = $1 or d.company_id = (select company_id from sales_deals where id = $1))`;

/** Recomputes priority (and keeps heat equal to it) for all deals, or one deal and its company's other deals. */
export async function refreshPriorities(dealId?: number): Promise<void> {
  const rows = await q<PriorityRow>(ROWS_SQL, [dealId ?? null]);
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  for (const r of rows) {
    const { score, why } = scoreDeal(r, now);
    const newDay = !r.priority_on || String(r.priority_on).slice(0, 10) !== today;
    await q(
      `update sales_deals set priority = $2, heat = $2, priority_why = $3,
         priority_prev = case when $4 then priority else priority_prev end, priority_on = $5
       where id = $1`,
      [r.id, score, why, newDay, today],
    );
  }
}
