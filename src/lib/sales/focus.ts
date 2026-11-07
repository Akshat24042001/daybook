/**
 * Where the radar looks this week (country) and today (industry), chosen from results and stored, so the choice is
 * stable for its period and you can see why it was made. Maths in focus-calc.ts.
 */
import { one, q } from "../db";
import { focusFor, isoWeek, type SalesConfig } from "./config";
import { choose, sameCountry, sameIndustry, weigh, type Choice, type Stat, type Weighted } from "./focus-calc";

export interface FocusPick {
  value: string;
  mode: "exploit" | "explore" | "fixed";
  reason: string;
}
export interface Focus {
  country: string;
  industry: string;
  why: { country: FocusPick; industry: FocusPick };
}

function isoYear(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return t.getUTCFullYear();
}
export function periodKeys(now: Date): { country: string; industry: string } {
  return { country: `c:${isoYear(now)}-W${String(isoWeek(now)).padStart(2, "0")}`, industry: `i:${now.toISOString().slice(0, 10)}` };
}

type FreeCount = { v: string | null; n: number };

/** Results per entry on your list over the last 120 days, and how often each was already the focus. */
export async function focusStats(kind: "country" | "industry", values: string[], excludePeriod?: string): Promise<Stat[]> {
  const match = kind === "country" ? sameCountry : sameIndustry;
  const key = kind === "country" ? "country" : "industry";
  const [qualified, conversations, won, turns] = await Promise.all([
    q<FreeCount>(
      `select fit->>'${key}' as v, count(*)::int as n from sales_radar_items
       where status in ('qualified','contacted','converted') and found_at > now() - interval '120 days' and fit->>'${key}' is not null group by 1`,
    ),
    q<FreeCount>(
      `select coalesce(${kind === "country" ? "d.country, c.country" : "c.industry"}, r.fit->>'${key}') as v, count(*)::int as n
       from sales_deals d left join sales_companies c on c.id = d.company_id left join sales_radar_items r on r.id = d.radar_item_id
       where d.last_inbound_at is not null and d.created_at > now() - interval '120 days' group by 1`,
    ),
    q<FreeCount>(
      `select coalesce(${kind === "country" ? "d.country, c.country" : "c.industry"}, r.fit->>'${key}') as v, count(*)::int as n
       from sales_deals d join sales_stages s on s.id = d.stage_id left join sales_companies c on c.id = d.company_id
       left join sales_radar_items r on r.id = d.radar_item_id
       where s.category = 'won' and coalesce(d.closed_at, d.updated_at) > now() - interval '120 days' group by 1`,
    ),
    q<{ value: string; n: number; last: string }>(
      "select value, count(*)::int as n, max(period) as last from sales_focus where kind = $1 and ($2::text is null or period <> $2) group by value",
      [kind, excludePeriod ?? null],
    ),
  ]);
  const sum = (rows: FreeCount[], entry: string) => rows.reduce((a, r) => a + (match(r.v, entry) ? r.n : 0), 0);
  return values.map((value) => {
    const t = turns.find((x) => x.value === value);
    return { value, qualified: sum(qualified, value), conversations: sum(conversations, value), won: sum(won, value), turns: t?.n ?? 0, last: t?.last ?? null };
  });
}

async function decide(cfg: SalesConfig, kind: "country" | "industry", period: string, now: Date): Promise<FocusPick> {
  const values = kind === "country" ? cfg.countries : cfg.industries;
  const stored = await one<{ value: string; mode: FocusPick["mode"]; reason: string | null }>("select value, mode, reason from sales_focus where period = $1", [period]);
  // a stored pick stands for its whole period, unless you removed it from the list meanwhile
  if (stored && values.includes(stored.value)) return { value: stored.value, mode: stored.mode, reason: stored.reason ?? "" };
  const rotateIndex = kind === "country" ? values.indexOf(focusFor(cfg, now).country) : values.indexOf(focusFor(cfg, now).industry);
  let pick: Choice | FocusPick;
  let weights: Weighted[] = [];
  if (cfg.radar.targeting === "rotate") {
    pick = { value: values[Math.max(0, rotateIndex)], mode: "fixed", reason: "Even rotation (chosen in Sales settings)." };
  } else {
    const c = choose(await focusStats(kind, values, period), period, cfg.radar.explore_pct, Math.max(0, rotateIndex));
    weights = c.weights;
    pick = c;
  }
  await q(
    `insert into sales_focus (period, kind, value, mode, reason, weights) values ($1,$2,$3,$4,$5,$6)
     on conflict (period) do update set value = excluded.value, mode = excluded.mode, reason = excluded.reason, weights = excluded.weights, created_at = now()`,
    [period, kind, pick.value, pick.mode, pick.reason, JSON.stringify(weights)],
  );
  return { value: pick.value, mode: pick.mode, reason: pick.reason };
}

/** This week's country and today's industry, decided once per period. */
export async function currentFocus(cfg: SalesConfig, now = new Date()): Promise<Focus> {
  const keys = periodKeys(now);
  const [country, industry] = [await decide(cfg, "country", keys.country, now), await decide(cfg, "industry", keys.industry, now)];
  return { country: country.value, industry: industry.value, why: { country, industry } };
}

/** The table behind the choice, for Radar > Plan and Insights. */
export async function focusOutlook(cfg: SalesConfig): Promise<{ countries: Weighted[]; industries: Weighted[] }> {
  const [c, i] = await Promise.all([focusStats("country", cfg.countries), focusStats("industry", cfg.industries)]);
  return { countries: weigh(c), industries: weigh(i) };
}
