/**
 * Daily sales activity for Today and Stats.
 *
 * Outreach = a message you send that opens or pushes a conversation, not an answer to them: an outbound message on a
 * messaging channel where they have not written since your previous message (in the last 14 days). First messages,
 * follow-ups, re-engages, check-ins and upsells count; replying to someone who wrote does not (that is the Replies
 * metric, and it already has its own move).
 */
import { one, q } from "../db";
import { addDays, calendarDate, type DateStr } from "../time";
import { salesConfig } from "./config";
import { MESSAGE_CHANNELS, ownerTz } from "./learning";

const OUTREACH_SQL = `
  i.direction = 'out' and i.deal_id is not null and i.channel = any($3)
  and not exists (
    select 1 from sales_interactions j
    where j.deal_id = i.deal_id and j.direction in ('in','both') and j.occurred_at < i.occurred_at and j.occurred_at > i.occurred_at - interval '14 days'
      and not exists (select 1 from sales_interactions k where k.deal_id = i.deal_id and k.direction = 'out' and k.occurred_at > j.occurred_at and k.occurred_at < i.occurred_at)
  )`;

export type SalesDay = { date: DateStr; outreach: number; replies: number; won_usd: number };

export async function salesDaily(from: DateStr, to: DateStr, tz?: string): Promise<SalesDay[]> {
  tz = tz ?? (await ownerTz());
  const params = [from, to, MESSAGE_CHANNELS, tz];
  const [out, rep, won] = await Promise.all([
    q<{ d: string; n: number }>(
      `select to_char((i.occurred_at at time zone $4)::date, 'YYYY-MM-DD') as d, count(*)::int as n from sales_interactions i
       where (i.occurred_at at time zone $4)::date between $1::date and $2::date and ${OUTREACH_SQL} group by 1`,
      params,
    ),
    q<{ d: string; n: number }>(
      `select to_char((i.occurred_at at time zone $4)::date, 'YYYY-MM-DD') as d, count(*)::int as n from sales_interactions i
       where (i.occurred_at at time zone $4)::date between $1::date and $2::date and i.direction = 'in' and i.deal_id is not null and i.channel = any($3) group by 1`,
      params,
    ),
    q<{ d: string; n: number }>(
      `select to_char((w.at at time zone $3)::date, 'YYYY-MM-DD') as d, sum(coalesce(w.value_usd, 0))::float as n from (
         select d.value_usd, (select min(e.created_at) from sales_deal_events e join sales_stages s on s.id = e.to_stage where e.deal_id = d.id and s.category = 'won') as at
         from sales_deals d) w
       where w.at is not null and (w.at at time zone $3)::date between $1::date and $2::date group by 1`,
      [from, to, tz],
    ),
  ]);
  const days: SalesDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.push({ date: d, outreach: out.find((r) => r.d === d)?.n ?? 0, replies: rep.find((r) => r.d === d)?.n ?? 0, won_usd: Math.round(won.find((r) => r.d === d)?.n ?? 0) });
  }
  return days;
}

export interface OutreachToday {
  done: number;
  goal: number;
  /** outreach moves due by tonight (first messages, follow-ups, re-engages and the like) */
  due: number;
  replies_waiting: number;
  /** no sales data at all yet: the card stays hidden */
  active: boolean;
}

const OUTREACH_KINDS = ["first_touch", "follow_up", "breakup", "reengage", "radar", "resurrect", "checkin", "upsell", "retainer", "referral_ask", "quote_unseen", "quote_silent"];

export async function outreachToday(now = new Date()): Promise<OutreachToday> {
  const [cfg, tz] = await Promise.all([salesConfig(), ownerTz()]);
  const today = calendarDate(now, tz);
  const [day] = await salesDaily(today, today, tz);
  const counts = await one<{ due: number; replies: number; deals: number }>(
    `select (select count(*)::int from sales_moves where status = 'open' and kind = any($1) and due_at <= now() + interval '12 hours') as due,
            (select count(*)::int from sales_moves where status = 'open' and kind = 'reply') as replies,
            (select count(*)::int from sales_deals) as deals`,
    [OUTREACH_KINDS],
  );
  return { done: day?.outreach ?? 0, goal: cfg.targets.daily_outreach, due: counts?.due ?? 0, replies_waiting: counts?.replies ?? 0, active: (counts?.deals ?? 0) > 0 };
}
