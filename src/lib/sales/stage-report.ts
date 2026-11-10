/**
 * Stage by stage: of the deals that entered each stage in the period, how many moved forward, went back, were won,
 * lost or parked, or are still there, and how long they stayed (median and average). Built from the deal's stage moves.
 */
import { q } from "../db";
import { reportMoney, salesConfig } from "./config";
import { median } from "./learning-calc";

export interface StageRow {
  stage_id: number;
  name: string;
  category: string;
  entered: number;
  forward: number;
  back: number;
  won: number;
  lost: number;
  parked: number;
  still: number;
  /** of those that left, the share that moved forward or were won */
  pass_rate: number | null;
  median_days: number | null;
  avg_days: number | null;
}

interface Step { deal_id: number; stage_id: number; at: string }
interface StageInfo { id: number; name: string; sort: number; category: string }

/** Pure: the report from each deal's ordered stage visits. */
export function stageRows(steps: Step[], stages: StageInfo[], since: number, now: number): StageRow[] {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const acc = new Map<number, { row: StageRow; days: number[] }>();
  const get = (id: number) => {
    let a = acc.get(id);
    if (!a) {
      const s = byId.get(id)!;
      a = { row: { stage_id: id, name: s.name, category: s.category, entered: 0, forward: 0, back: 0, won: 0, lost: 0, parked: 0, still: 0, pass_rate: null, median_days: null, avg_days: null }, days: [] };
      acc.set(id, a);
    }
    return a;
  };
  const byDeal = new Map<number, Step[]>();
  for (const s of steps) if (byId.has(s.stage_id)) byDeal.set(s.deal_id, [...(byDeal.get(s.deal_id) ?? []), s]);
  for (const list of byDeal.values()) {
    list.sort((a, b) => +new Date(a.at) - +new Date(b.at));
    // the same stage twice in a row (a "created" record and a first move into the same stage) is one visit
    for (let i = list.length - 1; i > 0; i--) if (list[i].stage_id === list[i - 1].stage_id) list.splice(i, 1);
    for (let i = 0; i < list.length; i++) {
      const cur = list[i];
      const at = +new Date(cur.at);
      if (at < since) continue;
      const a = get(cur.stage_id);
      a.row.entered++;
      const next = list[i + 1];
      if (!next) { a.row.still++; a.days.push((now - at) / 86_400_000); continue; }
      a.days.push((+new Date(next.at) - at) / 86_400_000);
      const from = byId.get(cur.stage_id)!;
      const to = byId.get(next.stage_id)!;
      if (to.category === "won" && from.category !== "won") a.row.won++;
      else if (to.category === "lost") a.row.lost++;
      else if (to.category === "parked") a.row.parked++;
      else if (to.sort > from.sort) a.row.forward++;
      else a.row.back++;
    }
  }
  return stages.filter((s) => acc.has(s.id)).map((s) => {
    const { row, days } = acc.get(s.id)!;
    const left = row.entered - row.still;
    const m = median(days);
    return {
      ...row,
      pass_rate: left > 0 ? Math.round(((row.forward + row.won) / left) * 100) : null,
      median_days: m === null ? null : Math.round(m * 10) / 10,
      avg_days: days.length ? Math.round((days.reduce((x, y) => x + y, 0) / days.length) * 10) / 10 : null,
    };
  });
}

export interface Recurring {
  currency: string;
  /** monthly recurring revenue from won deals with a live contract (or no end date), in the report currency */
  mrr: number;
  clients: number;
  renewals: { id: number; title: string; contract_end: string; amount: number; auto_renew: boolean }[];
}

/** Retainers and subscriptions: what comes in every month, and the contracts ending in the next 60 days. */
export async function recurringSummary(): Promise<Recurring> {
  const cfg = await salesConfig();
  const R = reportMoney(cfg);
  const rows = await q<{ id: number; title: string; recurring_amount: number; billing_cycle: string | null; currency: string; contract_end: string | null; auto_renew: boolean }>(
    `select d.id, d.title, d.recurring_amount::float as recurring_amount, d.billing_cycle, d.currency, d.contract_end, d.auto_renew
     from sales_deals d join sales_stages s on s.id = d.stage_id
     where s.category = 'won' and d.recurring_amount > 0 and (d.contract_end is null or d.contract_end >= current_date or d.auto_renew)`,
  );
  const monthly = (r: (typeof rows)[number]) => {
    const per = r.billing_cycle === "yearly" ? 12 : r.billing_cycle === "quarterly" ? 3 : 1;
    return R.fromUsd((cfg.fx[r.currency.toUpperCase()] ?? 1) * (r.recurring_amount / per));
  };
  const soon = rows.filter((r) => r.contract_end && new Date(`${r.contract_end}T00:00:00Z`).getTime() <= Date.now() + 60 * 86_400_000)
    .sort((a, b) => String(a.contract_end).localeCompare(String(b.contract_end)));
  return {
    currency: R.cur,
    mrr: Math.round(rows.reduce((a, r) => a + monthly(r), 0)),
    clients: rows.length,
    renewals: soon.map((r) => ({ id: r.id, title: r.title, contract_end: r.contract_end!, amount: Math.round(monthly(r)), auto_renew: r.auto_renew })),
  };
}

export async function stageReport(days = 180, now = new Date()): Promise<StageRow[]> {
  const stages = await q<StageInfo>("select id, name, sort, category from sales_stages where active order by sort");
  // every stage a deal entered: the stage it was created in, then each move; for deals touched in the period
  const steps = await q<Step>(
    `select e.deal_id, e.to_stage as stage_id, e.created_at as at from sales_deal_events e
     where e.kind in ('created','stage') and e.to_stage is not null
       and e.deal_id in (select deal_id from sales_deal_events where created_at > $1::timestamptz - ($2 || ' days')::interval)`,
    [now.toISOString(), String(days)],
  );
  return stageRows(steps, stages, now.getTime() - days * 86_400_000, now.getTime());
}
