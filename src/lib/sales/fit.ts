/** Loads what the fit score needs (your targets, results, offers) and scores deals from their records. */
import { one, q } from "../db";
import { salesConfig } from "./config";
import { focusOutlook } from "./focus";
import { fitScore, type Fit, type FitContext, type FitInput } from "./fit-calc";
import { listOffers } from "./offers";

export async function loadFitContext(): Promise<FitContext> {
  const cfg = await salesConfig();
  const [outlook, offers, avg] = await Promise.all([
    focusOutlook(cfg).catch(() => ({ countries: [], industries: [] })),
    listOffers({ activeOnly: true }).catch(() => []),
    one<{ v: number | null }>(
      `select avg(d.value_usd)::float as v from sales_deals d join sales_stages s on s.id = d.stage_id
       where s.category = 'won' and d.value_usd > 0 and coalesce(d.closed_at, d.updated_at) > now() - interval '365 days'`,
    ),
  ]);
  // your home market: from your time zone note ("India (IST)")
  const home = /india|ist\b/i.test(cfg.owner.timezone_note ?? "") ? "India" : null;
  return {
    homeCountry: home, countries: cfg.countries, industries: cfg.industries,
    industryStats: outlook.industries, countryStats: outlook.countries,
    offers: offers.length ? offers.map((o) => ({ id: o.id, name: o.name, summary: o.summary, keywords: o.keywords })) : cfg.offers.map((name) => ({ name })),
    avgWonUsd: avg?.v ?? null,
  };
}

interface Row {
  id: number; industry: string | null; country: string | null; city: string | null; source: string; value_usd: number | null; budget: string | null;
  services: string[]; person_id: number | null; economic_buyer_id: number | null; company_id: number | null;
  text: string | null; c_industry: string | null; c_country: string | null; employees: number | null; dm: boolean; bought: string[] | null;
}

/** Fit for many deals at once (the pipeline), or one (the deal page). */
export async function fitForDeals(ids: number[], ctx?: FitContext): Promise<Map<number, Fit>> {
  const out = new Map<number, Fit>();
  if (!ids.length) return out;
  const c = ctx ?? (await loadFitContext());
  const rows = await q<Row>(
    `select d.id, d.industry, d.country, d.city, d.source, d.value_usd::float as value_usd, d.budget, d.services, d.person_id, d.economic_buyer_id, d.company_id,
            concat_ws(E'\\n', d.title, d.requirements, d.pain, d.desired_outcome, d.impact, d.current_solution, d.notes, d.summary,
              co.description, co.audit->>'summary', co.audit->>'money_leak',
              (select string_agg(concat_ws(' ', o->>'title', o->>'problem'), E'\\n') from jsonb_array_elements(case when jsonb_typeof(co.audit->'opportunities') = 'array' then co.audit->'opportunities' else '[]'::jsonb end) o),
              co.enrichment->'pain_points'->>'v', co.enrichment->'summary'->>'v') as text,
            co.industry as c_industry, co.country as c_country, co.employees,
            (d.economic_buyer_id is not null
              or exists (select 1 from sales_people p where p.id = d.person_id and p.is_decision_maker)
              or exists (select 1 from sales_deal_people x where x.deal_id = d.id and x.role = 'decision_maker')) as dm,
            (select array_agg(distinct s) from sales_deals w join sales_stages ws on ws.id = w.stage_id, unnest(w.services) s
              where w.company_id = d.company_id and w.id <> d.id and ws.category = 'won') as bought
     from sales_deals d left join sales_companies co on co.id = d.company_id
     where d.id = any($1::int[])`,
    [ids],
  );
  for (const r of rows) {
    const input: FitInput = {
      industry: r.industry ?? r.c_industry, country: r.country ?? r.c_country, city: r.city, employees: r.employees, source: r.source,
      value_usd: r.value_usd, budget: r.budget, decision_maker: r.dm, has_contact: !!r.person_id, services: r.services ?? [], text: r.text ?? "",
      bought: r.bought ?? [],
    };
    out.set(r.id, fitScore(input, c));
  }
  return out;
}
