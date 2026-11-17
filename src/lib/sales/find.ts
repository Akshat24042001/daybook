/**
 * Smart search for sales: a deal or a radar lead matches when every word you typed appears somewhere in it, in any
 * field: its title, the requirement, notes, summary, the company and the person (emails and phones too), every chat,
 * call note and email logged on it, the research, the brief and the draft. "dubai jewellery whatsapp" finds the deal
 * whose company is a jewellery shop in Dubai and whose chat mentions WhatsApp, whatever field each word is in.
 */
import { q } from "../db";
import { searchTerms, snippet } from "./find-match";

export { haystack, matchesAll, searchTerms, snippet } from "./find-match";

const digitsOf = (s: string) => s.replace(/\D/g, "");

const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** SQL: each term must appear in `doc` (as text or as phone digits). */
function termWhere(terms: string[], first: number): { sql: string; params: string[] } {
  const params: string[] = [];
  const parts = terms.map((t) => {
    params.push(`%${esc(t)}%`);
    const i = first + params.length - 1;
    const digits = digitsOf(t);
    if (digits.length >= 5 && digits.length === t.replace(/[\s+()-]/g, "").length) {
      params.push(`%${digits}%`);
      return `(x.doc ilike $${i} or regexp_replace(x.doc, '\\D', '', 'g') like $${i + 1})`;
    }
    return `x.doc ilike $${i}`;
  });
  return { sql: parts.join(" and "), params };
}

export interface DealMatch { id: number; title: string; stage: string; company: string | null; person: string | null; where: string | null }

/** Deals where every word appears somewhere: the deal, its company and person, and everything logged on it. */
export async function searchDeals(query: string, limit = 60): Promise<DealMatch[]> {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const w = termWhere(terms, 2);
  const rows = await q<DealMatch & { doc: string }>(
    `select d.id, d.title, s.name as stage, c.name as company, p.full_name as person, x.doc
     from sales_deals d join sales_stages s on s.id = d.stage_id
     left join sales_companies c on c.id = d.company_id left join sales_people p on p.id = d.person_id
     cross join lateral (select concat_ws(' ', to_jsonb(d)::text, to_jsonb(c)::text, to_jsonb(p)::text,
         (select string_agg(concat_ws(' ', i.subject, i.summary, i.body), ' ') from sales_interactions i where i.deal_id = d.id),
         (select string_agg(concat_ws(' ', dc.title, left(dc.body, 4000)), ' ') from sales_docs dc where dc.deal_id = d.id)) as doc) x
     where ${w.sql}
     order by (lower(d.title) like $1) desc, d.updated_at desc limit ${Math.max(1, Math.min(200, limit))}`,
    [`%${esc(terms[0])}%`, ...w.params],
  );
  return rows.map(({ doc, ...r }) => ({ ...r, where: snippet(doc, terms) }));
}

export interface LeadMatch { id: number; title: string; status: string; score: number | null; where: string | null }

/** Radar leads (any age) where every word appears: the post, the business found behind it, the research and the draft. */
export async function searchRadar(query: string, limit = 60): Promise<LeadMatch[]> {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const w = termWhere(terms, 2);
  const rows = await q<LeadMatch & { doc: string }>(
    `select r.id, r.title, r.status, r.score, x.doc
     from sales_radar_items r left join sales_companies c on c.id = r.company_id
     cross join lateral (select concat_ws(' ', r.title, r.body, r.url, r.author, r.poster::text, r.fit::text, r.identity::text, r.brief::text, r.prep::text, r.angle,
         to_jsonb(c)::text, (select string_agg(concat_ws(' ', m.draft_subject, m.draft), ' ') from sales_moves m where m.radar_item_id = r.id)) as doc) x
     where ${w.sql}
     order by (lower(r.title) like $1) desc, coalesce(r.posted_at, r.found_at) desc limit ${Math.max(1, Math.min(200, limit))}`,
    [`%${esc(terms[0])}%`, ...w.params],
  );
  return rows.map(({ doc, ...r }) => ({ ...r, where: snippet(doc, terms) }));
}
