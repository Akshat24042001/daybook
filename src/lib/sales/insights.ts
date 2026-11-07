/**
 * The numbers to steer by: the funnel, win and loss by segment, how quotes fare, the revenue target with a forecast
 * and the activity it needs, and how fast you respond. Every definition is stated here once.
 *
 * Definitions
 * - A deal "closed" when it is won, lost or disqualified, or ghosted (a ghost is a loss in practice). Nurture and
 *   on-hold are still alive and left out of win rates.
 * - Win rate = won / closed. A rate on fewer than 5 closed deals is shown but marked thin, and never used as a fact.
 * - Funnel steps are cumulative: a deal that reached Proposal also counts as contacted, in conversation and met.
 * - Money is in USD at your Sales settings exchange rates.
 */
import { one, q } from "../db";
import { calendarDate, daysInMonth, parseDateStr, toDateStr } from "../time";
import { salesConfig, type SalesConfig } from "./config";
import { median, MIN_SAMPLE } from "./learning-calc";
import { MESSAGE_CHANNELS, ownerTz } from "./learning";

const D = 86_400_000;
const H = 3_600_000;

interface DealFacts {
  id: number;
  created_at: string;
  appeared_at: string;
  closed_at: string | null;
  won_at: string | null;
  value_usd: number | null;
  source: string;
  services: string[];
  country: string | null;
  cat: string;
  role: string | null;
  probability: number | null;
  expected_close: string | null;
  level: number;
  first_out: string | null;
  last_inbound_at: string | null;
}

/**
 * Every deal with what it reached. level: 1 created, 2 contacted, 3 conversation, 4 meeting, 5 proposal, 6 won.
 */
async function dealFacts(days: number): Promise<DealFacts[]> {
  return q<DealFacts>(
    `with st as (select id, sort, category, role from sales_stages),
     sorts as (select
        (select sort from st where role = 'contacted') as contacted, (select sort from st where role = 'engaged') as engaged,
        (select sort from st where role = 'discovery') as discovery, (select sort from st where role = 'proposal') as proposal)
     select d.id, d.created_at, coalesce(r.found_at, d.created_at) as appeared_at, d.closed_at, d.value_usd, d.source, d.services,
            nullif(trim(coalesce(d.country, c.country, r.fit->>'country')), '') as country, s.category as cat, s.role, s.probability, d.expected_close,
            (select min(e.created_at) from sales_deal_events e join st on st.id = e.to_stage where e.deal_id = d.id and st.category = 'won') as won_at,
            (select min(i.occurred_at) from sales_interactions i where i.deal_id = d.id and i.direction = 'out') as first_out,
            d.last_inbound_at,
            (select case
               when s.category = 'won' or exists (select 1 from sales_deal_events e join st on st.id = e.to_stage where e.deal_id = d.id and st.category = 'won') then 6
               when greatest(case when s.category = 'open' then s.sort else 0 end, coalesce((select max(st.sort) from sales_deal_events e join st on st.id = e.to_stage where e.deal_id = d.id and st.category = 'open'), 0)) >= sorts.proposal
                    or exists (select 1 from sales_docs x where x.deal_id = d.id and x.kind = 'quote' and x.sent_at is not null) then 5
               when greatest(case when s.category = 'open' then s.sort else 0 end, coalesce((select max(st.sort) from sales_deal_events e join st on st.id = e.to_stage where e.deal_id = d.id and st.category = 'open'), 0)) >= sorts.discovery
                    or exists (select 1 from sales_meetings m where m.deal_id = d.id and not m.cancelled and m.starts_at <= now()) then 4
               when d.last_inbound_at is not null
                    or greatest(case when s.category = 'open' then s.sort else 0 end, coalesce((select max(st.sort) from sales_deal_events e join st on st.id = e.to_stage where e.deal_id = d.id and st.category = 'open'), 0)) >= sorts.engaged then 3
               when d.last_outbound_at is not null
                    or greatest(case when s.category = 'open' then s.sort else 0 end, coalesce((select max(st.sort) from sales_deal_events e join st on st.id = e.to_stage where e.deal_id = d.id and st.category = 'open'), 0)) >= sorts.contacted then 2
               else 1 end) as level
     from sales_deals d join sales_stages s on s.id = d.stage_id cross join sorts
     left join sales_companies c on c.id = d.company_id left join sales_radar_items r on r.id = d.radar_item_id
     where d.created_at > now() - ($1 || ' days')::interval`,
    [String(days)],
  );
}

const closedAs = (d: DealFacts): "won" | "lost" | null =>
  d.cat === "won" || d.level === 6 ? "won" : d.cat === "lost" || d.role === "ghosted" ? "lost" : null;

// ---------- 3. funnel and segments ----------

export interface FunnelStep { key: string; label: string; n: number; from_prev: number | null; from_start: number | null }
const STEPS = [["created", "Leads"], ["contacted", "Contacted"], ["conversation", "In conversation"], ["meeting", "Met"], ["proposal", "Proposal"], ["won", "Won"]] as const;

export function funnelOf(deals: { level: number }[]): FunnelStep[] {
  const counts = STEPS.map((_, i) => deals.filter((d) => d.level >= i + 1).length);
  return STEPS.map(([key, label], i) => ({
    key, label, n: counts[i],
    from_prev: i === 0 ? null : counts[i - 1] ? Math.round((counts[i] / counts[i - 1]) * 100) : null,
    from_start: counts[0] ? Math.round((counts[i] / counts[0]) * 100) : null,
  }));
}

export interface SegmentRow {
  key: string;
  deals: number;
  closed: number;
  won: number;
  win_rate: number | null;
  won_usd: number;
  avg_won_usd: number | null;
  median_days_to_close: number | null;
  thin: boolean;
}

export function sizeBand(v: number | null): string {
  if (v === null || v === undefined) return "Value not set";
  return v < 1000 ? "Under $1k" : v < 5000 ? "$1k to $5k" : v < 20000 ? "$5k to $20k" : "$20k and up";
}

export function segment(deals: DealFacts[], keysOf: (d: DealFacts) => string[]): SegmentRow[] {
  const groups = new Map<string, DealFacts[]>();
  for (const d of deals) for (const k of keysOf(d)) groups.set(k, [...(groups.get(k) ?? []), d]);
  return [...groups.entries()].map(([key, g]) => {
    const won = g.filter((d) => closedAs(d) === "won");
    const closed = g.filter((d) => closedAs(d) !== null);
    const wonUsd = won.reduce((a, d) => a + Number(d.value_usd ?? 0), 0);
    const valued = won.filter((d) => d.value_usd !== null);
    const cycle = median(won.map((d) => (new Date(d.won_at ?? d.closed_at ?? d.created_at).getTime() - new Date(d.created_at).getTime()) / D));
    return {
      key, deals: g.length, closed: closed.length, won: won.length,
      win_rate: closed.length ? Math.round((won.length / closed.length) * 100) : null,
      won_usd: Math.round(wonUsd), avg_won_usd: valued.length ? Math.round(valued.reduce((a, d) => a + Number(d.value_usd), 0) / valued.length) : null,
      median_days_to_close: cycle === null ? null : Math.round(cycle),
      thin: closed.length < MIN_SAMPLE,
    };
  }).sort((a, b) => b.won_usd - a.won_usd || b.deals - a.deals);
}

export interface QuoteStats {
  sent: number;
  accepted: number;
  lost: number;
  open: number;
  acceptance: number | null;
  with_discount: { sent: number; accepted: number; rate: number | null; avg_pct: number | null };
  without_discount: { sent: number; accepted: number; rate: number | null };
  by_revisions: { label: string; sent: number; accepted: number; rate: number | null }[];
  median_days_to_accept: number | null;
  by_size: { label: string; sent: number; accepted: number; rate: number | null }[];
}

export async function quoteStats(days: number): Promise<QuoteStats> {
  const cfg = await salesConfig();
  const rows = await q<{ id: number; sent_at: string; accepted_at: string | null; revs: number; discount: number; subtotal: number; total: number; currency: string; cat: string | null; role: string | null }>(
    `select x.id, x.sent_at, x.accepted_at,
            (select count(*)::int from sales_quote_revisions r where r.doc_id = x.id and r.sent_at is not null) as revs,
            coalesce(r.discount, 0)::float as discount, coalesce(r.total, 0)::float as total, r.currency,
            coalesce((select sum(case when it->>'qty' ~ '^[0-9]+(\.[0-9]+)?$' then (it->>'qty')::numeric else 0 end * case when it->>'unit_price' ~ '^[0-9]+(\.[0-9]+)?$' then (it->>'unit_price')::numeric else 0 end) from jsonb_array_elements(r.items) it), 0)::float as subtotal,
            s.category as cat, s.role
     from sales_docs x
     join sales_quote_revisions r on r.doc_id = x.id and r.rev = x.current_rev
     left join sales_deals d on d.id = x.deal_id left join sales_stages s on s.id = d.stage_id
     where x.kind = 'quote' and x.sent_at is not null and x.sent_at > now() - ($1 || ' days')::interval`,
    [String(days)],
  );
  const outcome = (r: (typeof rows)[number]) => (r.accepted_at || r.cat === "won" ? "accepted" : r.cat === "lost" || r.role === "ghosted" ? "lost" : "open");
  const rate = (g: typeof rows) => {
    const decided = g.filter((r) => outcome(r) !== "open");
    return decided.length ? Math.round((g.filter((r) => outcome(r) === "accepted").length / decided.length) * 100) : null;
  };
  const disc = rows.filter((r) => r.discount > 0);
  const nodisc = rows.filter((r) => !(r.discount > 0));
  const usd = (r: (typeof rows)[number]) => (cfg.fx[(r.currency ?? "USD").toUpperCase()] ?? 1) * r.total;
  const bands = ["Under $1k", "$1k to $5k", "$5k to $20k", "$20k and up"];
  const revBands: [string, (n: number) => boolean][] = [["First version", (n) => n <= 1], ["Revised once", (n) => n === 2], ["Revised 2+ times", (n) => n >= 3]];
  const acc = rows.filter((r) => r.accepted_at);
  const m = median(acc.map((r) => (new Date(r.accepted_at!).getTime() - new Date(r.sent_at).getTime()) / D));
  return {
    sent: rows.length,
    accepted: rows.filter((r) => outcome(r) === "accepted").length,
    lost: rows.filter((r) => outcome(r) === "lost").length,
    open: rows.filter((r) => outcome(r) === "open").length,
    acceptance: rate(rows),
    with_discount: {
      sent: disc.length, accepted: disc.filter((r) => outcome(r) === "accepted").length, rate: rate(disc),
      avg_pct: disc.length ? Math.round(disc.reduce((a, r) => a + (r.subtotal > 0 ? (r.discount / r.subtotal) * 100 : 0), 0) / disc.length) : null,
    },
    without_discount: { sent: nodisc.length, accepted: nodisc.filter((r) => outcome(r) === "accepted").length, rate: rate(nodisc) },
    by_revisions: revBands.map(([label, f]) => {
      const g = rows.filter((r) => f(r.revs));
      return { label, sent: g.length, accepted: g.filter((r) => outcome(r) === "accepted").length, rate: rate(g) };
    }).filter((b) => b.sent > 0),
    median_days_to_accept: m === null ? null : Math.round(m * 10) / 10,
    by_size: bands.map((label) => {
      const g = rows.filter((r) => sizeBand(usd(r)) === label);
      return { label, sent: g.length, accepted: g.filter((r) => outcome(r) === "accepted").length, rate: rate(g) };
    }).filter((b) => b.sent > 0),
  };
}

export interface WinLoss {
  days: number;
  funnel: FunnelStep[];
  by_service: SegmentRow[];
  by_country: SegmentRow[];
  by_source: SegmentRow[];
  by_size: SegmentRow[];
  quotes: QuoteStats;
  findings: string[];
}

function segmentFindings(name: string, rows: SegmentRow[], overall: number | null): string[] {
  const solid = rows.filter((r) => !r.thin && r.win_rate !== null);
  if (!solid.length || overall === null) return [];
  const best = [...solid].sort((a, b) => b.win_rate! - a.win_rate!)[0];
  const worst = [...solid].sort((a, b) => a.win_rate! - b.win_rate!)[0];
  const out: string[] = [];
  if (best.win_rate! - overall >= 10) out.push(`${name}: "${best.key}" wins ${best.win_rate}% of closed deals (${best.won} of ${best.closed}) against ${overall}% overall. Put more of your time there.`);
  if (worst !== best && overall - worst.win_rate! >= 10) out.push(`${name}: "${worst.key}" wins only ${worst.win_rate}% (${worst.won} of ${worst.closed}). Qualify harder or stop chasing it.`);
  return out;
}

export async function winLoss(days = 180): Promise<WinLoss> {
  const deals = await dealFacts(days);
  const closed = deals.filter((d) => closedAs(d) !== null);
  const overall = closed.length >= MIN_SAMPLE ? Math.round((closed.filter((d) => closedAs(d) === "won").length / closed.length) * 100) : null;
  const by_service = segment(deals, (d) => (d.services?.length ? d.services : ["Service not set"]));
  const by_country = segment(deals, (d) => [d.country ?? "Country not set"]);
  const by_source = segment(deals, (d) => [d.source]);
  const by_size = segment(deals, (d) => [sizeBand(d.value_usd === null ? null : Number(d.value_usd))]);
  const quotes = await quoteStats(days);
  const findings = [
    ...segmentFindings("Service", by_service, overall), ...segmentFindings("Country", by_country, overall),
    ...segmentFindings("Source", by_source, overall), ...segmentFindings("Deal size", by_size, overall),
  ];
  const wd = quotes.with_discount;
  const nd = quotes.without_discount;
  if (wd.sent >= MIN_SAMPLE && nd.sent >= MIN_SAMPLE && wd.rate !== null && nd.rate !== null) {
    if (wd.rate <= nd.rate) findings.push(`Discounts are not buying wins: quotes with a discount were accepted ${wd.rate}% of the time, without one ${nd.rate}%. Hold your price.`);
    else if (wd.rate - nd.rate >= 15) findings.push(`Discounted quotes close more (${wd.rate}% against ${nd.rate}%), at an average ${wd.avg_pct ?? 0}% off. Check that the extra wins pay for the margin.`);
  }
  return { days, funnel: funnelOf(deals), by_service, by_country, by_source, by_size, quotes, findings };
}

// ---------- 4. target, forecast and the activity it takes ----------

export interface Rate { value: number; n: number; assumed: boolean }
export interface Forecast {
  month: string;
  day: number;
  days_in_month: number;
  target_usd: number;
  won_usd: number;
  won_deals: number;
  cash_usd: number;
  expected_by_today_usd: number;
  weighted_pipeline_usd: number;
  likely_this_month_usd: number;
  likely_deals: { id: number; title: string; stage: string; value_usd: number; probability: number }[];
  projected_usd: number;
  gap_usd: number;
  rates: { avg_deal_usd: Rate; proposal_to_win: Rate; conversation_to_proposal: Rate; contacted_to_conversation: Rate; cycle_days: Rate };
  need_this_month: { deals: number; proposals: number; conversations: number; outreach: number } | null;
  need_per_week: { deals: number; proposals: number; conversations: number; outreach: number } | null;
  verdict: string;
}

/** A rate from your own history, or a stated assumption when there are fewer than 5 cases. */
function rate(hit: number, of: number, fallback: number): Rate {
  return of >= MIN_SAMPLE ? { value: hit / of, n: of, assumed: false } : { value: fallback, n: of, assumed: true };
}

export function plan(target: number, gap: number, r: Forecast["rates"]): Pick<Forecast, "need_this_month" | "need_per_week"> {
  if (target <= 0) return { need_this_month: null, need_per_week: null };
  const chain = (deals: number) => {
    const proposals = deals / Math.max(0.01, r.proposal_to_win.value);
    const conversations = proposals / Math.max(0.01, r.conversation_to_proposal.value);
    const outreach = conversations / Math.max(0.01, r.contacted_to_conversation.value);
    return { deals: Math.ceil(deals), proposals: Math.ceil(proposals), conversations: Math.ceil(conversations), outreach: Math.ceil(outreach) };
  };
  const monthDeals = gap > 0 ? gap / Math.max(1, r.avg_deal_usd.value) : 0;
  // the steady rhythm: a month's target in deals, spread over 4.33 weeks
  return { need_this_month: chain(monthDeals), need_per_week: chain(target / Math.max(1, r.avg_deal_usd.value) / 4.33) };
}

export async function forecast(now = new Date()): Promise<Forecast> {
  const cfg = await salesConfig();
  const tz = await ownerTz();
  const today = calendarDate(now, tz);
  const { y, m, d } = parseDateStr(today);
  const monthStart = toDateStr(y, m, 1);
  const dim = daysInMonth(y, m);
  const monthEnd = toDateStr(y, m, dim);
  const target = Math.max(0, Number(cfg.targets.monthly_revenue_usd) || 0);

  const won = await q<{ id: number; value_usd: number | null }>(
    `select d.id, d.value_usd from sales_deals d join sales_stages s on s.id = d.stage_id
     where s.category = 'won'
       and (coalesce((select min(e.created_at) from sales_deal_events e join sales_stages st on st.id = e.to_stage where e.deal_id = d.id and st.category = 'won'), d.closed_at, d.updated_at) at time zone $3)::date between $1::date and $2::date`,
    [monthStart, monthEnd, tz],
  );
  const wonUsd = won.reduce((a, r) => a + Number(r.value_usd ?? 0), 0);
  const cash = await one<{ n: number }>(
    `select coalesce(sum(p.amount * coalesce((select (config->'fx'->>p.currency)::numeric from sales_settings), 1)), 0)::float as n
     from sales_payments p where p.status = 'paid' and p.paid_on between $1::date and $2::date`,
    [monthStart, monthEnd],
  );
  const open = await q<{ id: number; title: string; stage: string; role: string | null; value_usd: number | null; probability: number | null; expected_close: string | null }>(
    `select d.id, d.title, s.name as stage, s.role, d.value_usd, coalesce(d.probability, s.probability) as probability, d.expected_close
     from sales_deals d join sales_stages s on s.id = d.stage_id where s.category = 'open'`,
  );
  const weighted = open.reduce((a, r) => a + Number(r.value_usd ?? 0) * (Number(r.probability ?? 0) / 100), 0);
  // likely to land this month: expected to close by month end, or already at proposal or negotiation
  const likely = open.filter((r) => r.value_usd && ((r.expected_close && String(r.expected_close).slice(0, 10) <= monthEnd) || r.role === "proposal" || r.role === "negotiation"));
  const likelyUsd = likely.reduce((a, r) => a + Number(r.value_usd) * (Number(r.probability ?? 0) / 100), 0);

  // conversion rates from the last 180 days
  const facts = await dealFacts(180);
  const closed = facts.filter((f) => closedAs(f) !== null);
  const wonFacts = closed.filter((f) => closedAs(f) === "won");
  const reachedProposalClosed = closed.filter((f) => f.level >= 5 || closedAs(f) === "won");
  // only conversations old enough to have had a fair chance of reaching a proposal (21 days)
  const reachedConversation = facts.filter((f) => f.level >= 3 && new Date(f.created_at).getTime() < now.getTime() - 21 * D);
  const contacted = facts.filter((f) => f.level >= 2 && new Date(f.created_at).getTime() < now.getTime() - 14 * D);
  const valued = wonFacts.filter((f) => f.value_usd !== null);
  const openValues = open.filter((r) => r.value_usd).map((r) => Number(r.value_usd));
  const cycles = wonFacts.map((f) => (new Date(f.won_at ?? f.closed_at ?? f.created_at).getTime() - new Date(f.created_at).getTime()) / D);
  const avg = valued.length >= MIN_SAMPLE
    ? { value: valued.reduce((a, f) => a + Number(f.value_usd), 0) / valued.length, n: valued.length, assumed: false }
    : { value: median(openValues) ?? 2000, n: valued.length, assumed: true };
  const rates: Forecast["rates"] = {
    avg_deal_usd: { ...avg, value: Math.round(avg.value) },
    proposal_to_win: rate(wonFacts.length, reachedProposalClosed.length, 0.3),
    conversation_to_proposal: rate(reachedConversation.filter((f) => f.level >= 5).length, reachedConversation.length, 0.35),
    contacted_to_conversation: rate(contacted.filter((f) => f.level >= 3).length, contacted.length, 0.15),
    cycle_days: cycles.length >= MIN_SAMPLE ? { value: Math.round(median(cycles)!), n: cycles.length, assumed: false } : { value: 30, n: cycles.length, assumed: true },
  };
  const projected = wonUsd + likelyUsd;
  const gap = Math.max(0, target - wonUsd);
  const expectedByToday = target * (d / dim);
  const p = plan(target, gap, rates);
  let verdict: string;
  if (!target) verdict = "Set a monthly revenue target in Sales settings to see your pace and the activity it takes.";
  else if (wonUsd >= target) verdict = `Target hit: $${Math.round(wonUsd).toLocaleString("en-US")} won against $${target.toLocaleString("en-US")}.`;
  else if (projected >= target) verdict = `On track if the likely deals close: $${Math.round(projected).toLocaleString("en-US")} projected. Push the ${likely.length} likely deal${likely.length === 1 ? "" : "s"} over the line.`;
  else verdict = `Behind: $${Math.round(wonUsd).toLocaleString("en-US")} won, $${Math.round(expectedByToday).toLocaleString("en-US")} expected by today, $${Math.round(projected).toLocaleString("en-US")} projected. A deal started now takes about ${rates.cycle_days.value} days to close, so the weekly rhythm below is what fixes next month.`;

  return {
    month: monthStart.slice(0, 7), day: d, days_in_month: dim, target_usd: target,
    won_usd: Math.round(wonUsd), won_deals: won.length, cash_usd: Math.round(cash?.n ?? 0),
    expected_by_today_usd: Math.round(expectedByToday), weighted_pipeline_usd: Math.round(weighted), likely_this_month_usd: Math.round(likelyUsd),
    likely_deals: likely.map((r) => ({ id: r.id, title: r.title, stage: r.stage, value_usd: Math.round(Number(r.value_usd)), probability: Number(r.probability ?? 0) })).sort((a, b) => b.value_usd * b.probability - a.value_usd * a.probability),
    projected_usd: Math.round(projected), gap_usd: Math.round(gap), rates, ...p, verdict,
  };
}

// ---------- 5. speed ----------

export interface SpeedBucket { label: string; leads: number; conversations: number; rate: number | null }
export interface Speed {
  days: number;
  first_touch: { leads: number; touched: number; untouched: number; median_h: number | null; within_1h: number | null; within_24h: number | null; by_bucket: SpeedBucket[] };
  reply: { inbound: number; answered: number; waiting: number; median_h: number | null; within_target: number | null; target_h: number; by_channel: { channel: string; n: number; median_h: number | null }[] };
  findings: string[];
}

export function speedBucket(ms: number | null): string {
  if (ms === null) return "Not contacted";
  return ms <= H ? "Within 1 hour" : ms <= 24 * H ? "Within a day" : ms <= 3 * D ? "1 to 3 days" : "Over 3 days";
}
const BUCKETS = ["Within 1 hour", "Within a day", "1 to 3 days", "Over 3 days"];

export async function speed(days = 90, now = Date.now(), cfg?: SalesConfig): Promise<Speed> {
  cfg = cfg ?? (await salesConfig());
  const facts = await dealFacts(days);
  // leads that came to you or that the radar found: not deals that started with your own message
  const leads = facts.filter((f) => {
    if (!f.first_out) return now - new Date(f.appeared_at).getTime() > D;
    const startedBySend = new Date(f.first_out).getTime() - new Date(f.created_at).getTime() < 2 * 60_000 && new Date(f.appeared_at).getTime() === new Date(f.created_at).getTime();
    return !startedBySend;
  });
  const delay = (f: DealFacts) => (f.first_out ? Math.max(0, new Date(f.first_out).getTime() - new Date(f.appeared_at).getTime()) : null);
  const touched = leads.filter((f) => f.first_out);
  const delays = touched.map((f) => delay(f)!);
  const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : null);
  const converted = (f: DealFacts) => !!f.last_inbound_at && !!f.first_out && new Date(f.last_inbound_at).getTime() > new Date(f.first_out).getTime();
  const by_bucket = BUCKETS.map((label) => {
    const g = touched.filter((f) => speedBucket(delay(f)) === label);
    return { label, leads: g.length, conversations: g.filter(converted).length, rate: pct(g.filter(converted).length, g.length) };
  });

  // reply speed: the clock starts at their first unanswered message and stops at your next message
  const rows = await q<{ deal_id: number; at: string; direction: string; channel: string }>(
    `select deal_id, occurred_at as at, direction, channel from sales_interactions
     where deal_id is not null and direction in ('in','out') and channel = any($2) and occurred_at > now() - ($1 || ' days')::interval
     order by deal_id, occurred_at`,
    [String(days), MESSAGE_CHANNELS],
  );
  const waits: { channel: string; ms: number }[] = [];
  let waiting = 0;
  let inbound = 0;
  let cur: number | null = null;
  let clock: { at: number; channel: string } | null = null;
  const close = () => {
    if (clock && now - clock.at > cfg!.reply_within_hours * H) waiting += 1;
    clock = null;
  };
  for (const r of rows) {
    if (r.deal_id !== cur) {
      close();
      cur = r.deal_id;
    }
    const at = new Date(r.at).getTime();
    if (r.direction === "in") {
      if (!clock) {
        clock = { at, channel: r.channel };
        inbound += 1;
      }
    } else if (clock) {
      waits.push({ channel: clock.channel, ms: at - clock.at });
      clock = null;
    }
  }
  close();
  const hours = (ms: number | null) => (ms === null ? null : Math.round((ms / H) * 10) / 10);
  const channels = [...new Set(waits.map((w) => w.channel))];
  const target = cfg.reply_within_hours;

  const findings: string[] = [];
  const fast = by_bucket[0];
  const slow = by_bucket.slice(2).reduce((a, b) => ({ leads: a.leads + b.leads, conversations: a.conversations + b.conversations }), { leads: 0, conversations: 0 });
  if (fast.leads >= MIN_SAMPLE && slow.leads >= MIN_SAMPLE) {
    const fr = pct(fast.conversations, fast.leads)!;
    const sr = pct(slow.conversations, slow.leads)!;
    if (fr - sr >= 10) findings.push(`Speed pays: leads you contacted within an hour turned into conversations ${fr}% of the time, against ${sr}% when you took over a day.`);
  }
  const med = median(waits.map((w) => w.ms));
  if (med !== null && waits.length >= MIN_SAMPLE && med > target * H) findings.push(`Your typical reply takes ${hours(med)} hours, over your ${target}-hour standard. Replies are the highest-value move on the list.`);
  const untouched = leads.length - touched.length;
  if (untouched > 0) findings.push(`${untouched} lead${untouched === 1 ? " has" : "s have"} never been contacted.`);

  return {
    days,
    first_touch: {
      leads: leads.length, touched: touched.length, untouched, median_h: hours(median(delays)),
      within_1h: pct(delays.filter((x) => x <= H).length, touched.length), within_24h: pct(delays.filter((x) => x <= 24 * H).length, touched.length), by_bucket,
    },
    reply: {
      inbound, answered: waits.length, waiting, median_h: hours(med), target_h: target,
      within_target: pct(waits.filter((w) => w.ms <= target * H).length, waits.length),
      by_channel: channels.map((c) => {
        const g = waits.filter((w) => w.channel === c);
        return { channel: c, n: g.length, median_h: hours(median(g.map((w) => w.ms))) };
      }).sort((a, b) => b.n - a.n),
    },
    findings,
  };
}
