/** The honest Sunday review: the numbers that move revenue, where deals die, and what you promised and did not do. */
import { money } from "@/components/sales/format";
import { one, q } from "../db";
import { esc } from "../telegram/api";
import { reportMoney, salesConfig } from "./config";

export interface Review {
  from: string;
  /** the report currency every amount here is in */
  currency: string;
  started: number;
  replies: number;
  reply_rate: number | null;
  meetings: number;
  proposals: number;
  won: number;
  won_value: number;
  lost: number;
  lost_reasons: { reason: string; n: number }[];
  cash_in: number;
  cash_overdue: number;
  promises_broken: number;
  promises_kept: number;
  moves_done: number;
  moves_skipped: number;
  moves_overdue: number;
  days_to_close: number | null;
  by_channel: { channel: string; out: number; replied: number }[];
  by_source: { source: string; deals: number; won: number; won_value: number }[];
  leaks: { stage: string; n: number }[];
  radar: { found: number; qualified: number; converted: number };
  top_sources: { name: string; qualified: number; deals: number }[];
  stuck: number;
}

const FX = "coalesce((select (config->'fx'->>currency)::numeric from sales_settings), 1)";

export async function weeklyReview(days = 7): Promise<Review> {
  const p = [String(days)];
  const R = reportMoney(await salesConfig());
  const conv = (usd: number) => Math.round(R.fromUsd(usd));
  const since = `now() - ($1 || ' days')::interval`;
  const n = async (sql: string) => Number((await one<{ n: number | null }>(sql, sql.includes("$1") ? p : []))?.n ?? 0);
  const started = await n(`select count(distinct deal_id)::int as n from sales_interactions i where direction in ('out','both') and occurred_at > ${since}
    and not exists (select 1 from sales_interactions j where j.deal_id = i.deal_id and j.direction in ('out','both') and j.occurred_at < ${since})`);
  const replies = await n(`select count(distinct deal_id)::int as n from sales_interactions where direction in ('in','both') and occurred_at > ${since}`);
  const by_channel = await q<{ channel: string; out: number; replied: number }>(
    `select o.channel, count(distinct o.deal_id)::int as out,
       count(distinct o.deal_id) filter (where exists (select 1 from sales_interactions r where r.deal_id = o.deal_id and r.direction in ('in','both') and r.occurred_at > o.occurred_at))::int as replied
     from sales_interactions o where o.direction = 'out' and o.occurred_at > ${since} and o.channel in ('whatsapp','email','linkedin','instagram','call','sms')
     group by o.channel order by 2 desc`,
    p,
  );
  const outTotal = by_channel.reduce((s, c) => s + c.out, 0);
  const repliedTotal = by_channel.reduce((s, c) => s + c.replied, 0);
  const lost_reasons = await q<{ reason: string; n: number }>(
    `select coalesce(nullif(d.lost_reason, ''), 'no reason') as reason, count(*)::int as n from sales_deals d join sales_stages s on s.id = d.stage_id
     where s.category = 'lost' and d.closed_at > now() - interval '90 days' group by 1 order by 2 desc limit 5`,
  );
  const leaks = await q<{ stage: string; n: number }>(
    `select f.name as stage, count(*)::int as n from sales_deal_events e join sales_stages t on t.id = e.to_stage join sales_stages f on f.id = e.from_stage
     where e.kind = 'stage' and t.category in ('lost','parked') and e.created_at > now() - interval '90 days' group by f.name order by 2 desc limit 5`,
  );
  const bySourceUsd = await q<{ source: string; deals: number; won: number; won_usd: number }>(
    `select d.source, count(*)::int as deals, count(*) filter (where s.category = 'won')::int as won, coalesce(sum(d.value_usd) filter (where s.category = 'won'), 0)::int as won_usd
     from sales_deals d join sales_stages s on s.id = d.stage_id where d.created_at > now() - interval '90 days' group by d.source order by won_usd desc, deals desc`,
  );
  const by_source = bySourceUsd.map(({ won_usd, ...s }) => ({ ...s, won_value: conv(Number(won_usd)) }));
  const radar = (await one<{ found: number; qualified: number; converted: number }>(
    `select count(*)::int as found, count(*) filter (where score >= (select coalesce((config->'radar'->>'min_score')::int, 60) from sales_settings))::int as qualified,
       count(*) filter (where deal_id is not null)::int as converted from sales_radar_items where found_at > ${since}`,
    p,
  )) ?? { found: 0, qualified: 0, converted: 0 };
  const top_sources = await q<{ name: string; qualified: number; deals: number }>(
    "select name, items_qualified as qualified, deals_created as deals from sales_radar_sources where items_qualified > 0 order by deals_created desc, items_qualified desc limit 5",
  );
  return {
    from: new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10),
    currency: R.cur,
    started,
    replies,
    reply_rate: outTotal ? Math.round((repliedTotal / outTotal) * 100) : null,
    meetings: await n(`select count(*)::int as n from sales_meetings where not cancelled and starts_at between ${since} and now()`),
    proposals: await n(`select count(*)::int as n from sales_quote_revisions where sent_at > ${since}`),
    won: await n(`select count(*)::int as n from sales_deal_events e join sales_stages s on s.id = e.to_stage where s.role = 'won' and e.created_at > ${since}`),
    won_value: conv(await n(`select coalesce(sum(d.value_usd),0)::int as n from sales_deal_events e join sales_stages s on s.id = e.to_stage join sales_deals d on d.id = e.deal_id where s.role = 'won' and e.created_at > ${since}`)),
    lost: await n(`select count(*)::int as n from sales_deal_events e join sales_stages s on s.id = e.to_stage where s.category = 'lost' and e.created_at > ${since}`),
    lost_reasons,
    cash_in: conv(await n(`select coalesce(sum(amount * ${FX}),0)::int as n from sales_payments where status = 'paid' and paid_on > (now() - ($1 || ' days')::interval)::date`)),
    cash_overdue: conv(await n(`select coalesce(sum(amount * ${FX}),0)::int as n from sales_payments where status = 'due' and due_on < current_date`)),
    promises_broken: await n("select count(*)::int as n from sales_commitments where owner = 'me' and status = 'open' and due_at < now()"),
    promises_kept: await n(`select count(*)::int as n from sales_commitments where owner = 'me' and status = 'done' and done_at > ${since}`),
    moves_done: await n(`select count(*)::int as n from sales_moves where status = 'done' and done_at > ${since}`),
    moves_skipped: await n(`select count(*)::int as n from sales_moves where status = 'skipped' and done_at > ${since}`),
    moves_overdue: await n("select count(*)::int as n from sales_moves where status = 'open' and due_at < now() - interval '1 day'"),
    days_to_close: Number((await one<{ n: number | null }>("select round(avg(extract(epoch from closed_at - created_at) / 86400))::int as n from sales_deals d join sales_stages s on s.id = d.stage_id where s.category = 'won' and closed_at > now() - interval '180 days'"))?.n ?? 0) || null,
    by_channel,
    by_source,
    leaks,
    radar,
    top_sources,
    stuck: await n("select count(*)::int as n from sales_deals d join sales_stages s on s.id = d.stage_id where s.category = 'open' and s.sla_days is not null and d.stage_changed_at < now() - (s.sla_days || ' days')::interval"),
  };
}


/** The verdicts that matter, said plainly. */
export function verdicts(r: Review): string[] {
  const out: string[] = [];
  if (r.started < 10) out.push(`Only ${r.started} new conversations started. Revenue follows this number more than any other; aim for 15 or more a week.`);
  if (r.reply_rate !== null && r.reply_rate < 15) out.push(`Reply rate ${r.reply_rate}%. The openers are not landing: shorter, more specific to them, no pitch in the first message.`);
  if (r.moves_overdue > 5) out.push(`${r.moves_overdue} moves are more than a day overdue. Clear them or skip them; a stale list gets ignored.`);
  if (r.promises_broken > 0) out.push(`${r.promises_broken} promise(s) you made are past due. Broken promises kill deals faster than price.`);
  if (r.cash_overdue > 0) out.push(`${money(r.cash_overdue, r.currency)} is overdue. Chase it before starting new work for those clients.`);
  if (r.stuck > 0) out.push(`${r.stuck} deal(s) are stuck past their stage limit. Push, park with a date, or close them.`);
  if (r.leaks[0]) out.push(`Most deals die at ${r.leaks[0].stage} (${r.leaks[0].n} in 90 days). That is the step to fix.`);
  const best = r.by_channel.filter((c) => c.out >= 3).sort((a, b) => b.replied / b.out - a.replied / a.out)[0];
  if (best) out.push(`${best.channel} gets the best replies (${best.replied}/${best.out}). Lean on it.`);
  if (!out.length) out.push("A solid week. Keep the volume up.");
  return out;
}

export function reviewMessage(r: Review): string {
  return `📈 <b>Sales review, last 7 days</b>
New conversations: <b>${r.started}</b> · replies: <b>${r.replies}</b>${r.reply_rate !== null ? ` (${r.reply_rate}% reply rate)` : ""}
Meetings: <b>${r.meetings}</b> · proposals sent: <b>${r.proposals}</b>
Won: <b>${r.won}</b> (${money(r.won_value, r.currency)}) · lost: <b>${r.lost}</b>
Cash in: <b>${money(r.cash_in, r.currency)}</b> · overdue: <b>${money(r.cash_overdue, r.currency)}</b>
Moves done: ${r.moves_done} · skipped: ${r.moves_skipped} · overdue: ${r.moves_overdue}
Radar: ${r.radar.found} found, ${r.radar.qualified} qualified, ${r.radar.converted} became deals

<b>Straight talk</b>
${verdicts(r).map((v) => `• ${esc(v)}`).join("\n")}`;
}

/**
 * The second half of the Sunday message: the month against target, and the strongest findings from Insights
 * (only ones backed by enough data).
 */
export async function reviewInsights(): Promise<string> {
  const { forecast, speed, winLoss } = await import("./insights");
  const { messagePerformance } = await import("./learning");
  const [f, wl, mp, sp] = await Promise.all([forecast(), winLoss(180), messagePerformance(90), speed(90)]);
  const lines: string[] = [];
  if (f.target) {
    const m = (n: number) => money(n, f.currency);
    lines.push(`\n<b>This month</b>: ${m(f.won)} won of ${m(f.target)} (projected ${m(f.projected)}).`);
    if (f.need_per_week) lines.push(`Steady rhythm for the target: ${f.need_per_week.outreach} people contacted, ${f.need_per_week.conversations} conversations, ${f.need_per_week.proposals} proposals a week.`);
  }
  const found = [...mp.findings, ...wl.findings, ...sp.findings].slice(0, 3);
  if (found.length) lines.push(`\n<b>What the data says</b>\n${found.map((x) => `• ${esc(x)}`).join("\n")}`);
  return lines.join("\n");
}
